import { createMarketDataService, type MarketEnv } from "../market/service";
import {
  clearStaleWarmSymbols,
  createRun,
  getActiveRun,
  getRun,
  getScanner,
  listDueScanners,
  listScanners,
  listWarmSymbols,
  countWarmSymbols,
  updateRun,
  updateScanner,
  upsertWarmSymbols,
} from "./repo";
import {
  addHours,
  approxDailyValue,
  nowIso,
  passesWarmFilters,
  type ScannerJobMessage,
  type ScannerRunTrigger,
} from "./types";

export interface ScannerEnv extends MarketEnv {
  SCANNER_QUEUE: Queue<ScannerJobMessage>;
  SCANNER_PAGE_SIZE?: string;
}

function pageSize(env: ScannerEnv): number {
  return Math.min(Math.max(Number(env.SCANNER_PAGE_SIZE ?? "50") || 50, 10), 200);
}

export async function getScannersOverview(env: ScannerEnv) {
  const scanners = await listScanners(env.DB);
  const items = [];

  for (const scanner of scanners) {
    const [warmCount, activeRun] = await Promise.all([
      countWarmSymbols(env.DB, scanner.id),
      getActiveRun(env.DB, scanner.id),
    ]);

    items.push({
      ...serializeScanner(scanner),
      warmCount,
      activeRun: activeRun ? serializeRun(activeRun) : null,
    });
  }

  return items;
}

export async function getScannerDetail(env: ScannerEnv, scannerId: string) {
  const scanner = await getScanner(env.DB, scannerId);
  if (!scanner) return null;

  const [warmCount, activeRun, symbols] = await Promise.all([
    countWarmSymbols(env.DB, scanner.id),
    getActiveRun(env.DB, scanner.id),
    listWarmSymbols(env.DB, scanner.id),
  ]);

  return {
    ...serializeScanner(scanner),
    warmCount,
    activeRun: activeRun ? serializeRun(activeRun) : null,
    symbols: symbols.map(serializeWarmSymbol),
  };
}

export async function patchScanner(
  env: ScannerEnv,
  scannerId: string,
  body: {
    enabled?: boolean;
    intervalHours?: number;
    minAvgVolume10d?: number | null;
    minApproxDailyValue?: number | null;
  },
) {
  const scanner = await getScanner(env.DB, scannerId);
  if (!scanner) return null;

  const patch: Parameters<typeof updateScanner>[2] = {};

  if (body.intervalHours !== undefined) {
    if (!Number.isFinite(body.intervalHours) || body.intervalHours < 1) {
      throw new Error("intervalHours must be >= 1");
    }
    patch.interval_hours = Math.floor(body.intervalHours);
  }

  if (body.minAvgVolume10d !== undefined) {
    patch.min_avg_volume_10d = body.minAvgVolume10d;
  }

  if (body.minApproxDailyValue !== undefined) {
    patch.min_approx_daily_value = body.minApproxDailyValue;
  }

  if (body.enabled !== undefined) {
    const enabling = body.enabled && scanner.enabled === 0;
    const disabling = !body.enabled && scanner.enabled === 1;
    patch.enabled = body.enabled ? 1 : 0;

    if (enabling) {
      // Wait for next interval — do not run immediately.
      const hours = patch.interval_hours ?? scanner.interval_hours;
      patch.next_run_at = addHours(nowIso(), hours);
    }

    if (disabling) {
      patch.next_run_at = null;
    }
  }

  const updated = await updateScanner(env.DB, scannerId, patch);
  if (!updated) return null;

  const [warmCount, activeRun] = await Promise.all([
    countWarmSymbols(env.DB, updated.id),
    getActiveRun(env.DB, updated.id),
  ]);

  return {
    ...serializeScanner(updated),
    warmCount,
    activeRun: activeRun ? serializeRun(activeRun) : null,
  };
}

export async function startScannerRun(
  env: ScannerEnv,
  scannerId: string,
  trigger: ScannerRunTrigger,
) {
  const scanner = await getScanner(env.DB, scannerId);
  if (!scanner) {
    throw new Error("Scanner not found");
  }

  const active = await getActiveRun(env.DB, scannerId);
  if (active) {
    throw new Error(`Scanner already has an active run (${active.status})`);
  }

  const runId = crypto.randomUUID();
  const size = pageSize(env);
  const run = await createRun(env.DB, {
    id: runId,
    scannerId,
    trigger,
    pageSize: size,
  });

  await updateScanner(env.DB, scannerId, {
    last_run_status: "queued",
    last_run_error: null,
  });

  await env.SCANNER_QUEUE.send({
    type: "scan_page",
    runId,
    scannerId,
    offset: 0,
  });

  return serializeRun(run);
}

export async function processDueScanners(env: ScannerEnv): Promise<number> {
  const due = await listDueScanners(env.DB, nowIso());
  let started = 0;

  for (const scanner of due) {
    const active = await getActiveRun(env.DB, scanner.id);
    if (active) continue;

    try {
      await startScannerRun(env, scanner.id, "cron");
      started += 1;
    } catch (error) {
      console.error(`Failed to start cron run for ${scanner.id}:`, error);
    }
  }

  return started;
}

export async function processScannerJob(
  env: ScannerEnv,
  message: ScannerJobMessage,
): Promise<void> {
  if (message.type !== "scan_page") return;

  const run = await getRun(env.DB, message.runId);
  const scanner = await getScanner(env.DB, message.scannerId);

  if (!run || !scanner) {
    console.error("Missing run or scanner for job", message);
    return;
  }

  if (run.status === "ok" || run.status === "error") {
    return;
  }

  const seenAt = nowIso();

  if (run.status === "queued") {
    await updateRun(env.DB, run.id, {
      status: "running",
      started_at: seenAt,
      offset: message.offset,
    });
    await updateScanner(env.DB, scanner.id, {
      last_run_status: "running",
      last_run_error: null,
    });
  }

  try {
    const market = createMarketDataService(env);
    const page = await market.screen({
      exchange: scanner.code,
      offset: message.offset,
      limit: run.page_size,
    });

    let detailed = page;
    if (page.length > 0) {
      detailed = await market.getQuotes(
        page.map((quote) => ({
          symbol: quote.symbol,
          exchange: scanner.code,
        })),
      );
    }

    const matchedQuotes = detailed.filter((quote) =>
      passesWarmFilters(quote, {
        minAvgVolume10d: scanner.min_avg_volume_10d,
        minApproxDailyValue: scanner.min_approx_daily_value,
      }),
    );

    await upsertWarmSymbols(
      env.DB,
      matchedQuotes.map((quote) => ({
        id: crypto.randomUUID(),
        scannerId: scanner.id,
        symbol: quote.symbol,
        exchange: quote.exchange ?? scanner.code,
        name: quote.name ?? null,
        price: quote.price,
        changePercent: quote.changePercent,
        volume: quote.volume,
        avgVolume10d: quote.averageVolume10d ?? null,
        avgVolume3m: quote.averageVolume3m ?? null,
        fiftyDayAverage: quote.fiftyDayAverage ?? null,
        approxDailyValue: approxDailyValue(quote),
        currency: quote.currency ?? null,
        runId: run.id,
        seenAt,
      })),
    );

    const scanned = run.scanned + page.length;
    const matched = run.matched + matchedQuotes.length;
    const hasMore = page.length >= run.page_size;
    const nextOffset = message.offset + run.page_size;

    await updateRun(env.DB, run.id, {
      status: "running",
      offset: nextOffset,
      scanned,
      matched,
    });

    await updateScanner(env.DB, scanner.id, {
      last_run_scanned: scanned,
      last_run_matched: matched,
      last_run_status: "running",
    });

    if (hasMore) {
      await env.SCANNER_QUEUE.send({
        type: "scan_page",
        runId: run.id,
        scannerId: scanner.id,
        offset: nextOffset,
      });
      return;
    }

    await clearStaleWarmSymbols(env.DB, scanner.id, run.id);

    const finishedAt = nowIso();
    await updateRun(env.DB, run.id, {
      status: "ok",
      finished_at: finishedAt,
      scanned,
      matched,
      error: null,
    });

    const nextRunAt =
      scanner.enabled === 1
        ? addHours(finishedAt, scanner.interval_hours)
        : null;

    await updateScanner(env.DB, scanner.id, {
      last_run_at: finishedAt,
      last_run_status: "ok",
      last_run_error: null,
      last_run_scanned: scanned,
      last_run_matched: matched,
      next_run_at: nextRunAt,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown error";
    console.error(`Scanner run ${run.id} failed:`, error);

    await updateRun(env.DB, run.id, {
      status: "error",
      error: messageText,
      finished_at: nowIso(),
    });

    await updateScanner(env.DB, scanner.id, {
      last_run_status: "error",
      last_run_error: messageText,
      last_run_at: nowIso(),
      next_run_at:
        scanner.enabled === 1
          ? addHours(nowIso(), scanner.interval_hours)
          : scanner.next_run_at,
    });

    throw error;
  }
}

function serializeScanner(scanner: Awaited<ReturnType<typeof getScanner>>) {
  if (!scanner) return null;
  return {
    id: scanner.id,
    code: scanner.code,
    label: scanner.label,
    enabled: scanner.enabled === 1,
    intervalHours: scanner.interval_hours,
    minAvgVolume10d: scanner.min_avg_volume_10d,
    minApproxDailyValue: scanner.min_approx_daily_value,
    lastRunAt: scanner.last_run_at,
    nextRunAt: scanner.next_run_at,
    lastRunStatus: scanner.last_run_status,
    lastRunError: scanner.last_run_error,
    lastRunScanned: scanner.last_run_scanned,
    lastRunMatched: scanner.last_run_matched,
    updatedAt: scanner.updated_at,
  };
}

function serializeRun(run: NonNullable<Awaited<ReturnType<typeof getRun>>>) {
  return {
    id: run.id,
    scannerId: run.scanner_id,
    status: run.status,
    trigger: run.trigger,
    offset: run.offset,
    pageSize: run.page_size,
    scanned: run.scanned,
    matched: run.matched,
    error: run.error,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

function serializeWarmSymbol(
  row: Awaited<ReturnType<typeof listWarmSymbols>>[number],
) {
  return {
    id: row.id,
    scannerId: row.scanner_id,
    symbol: row.symbol,
    exchange: row.exchange,
    name: row.name,
    price: row.price,
    changePercent: row.change_percent,
    volume: row.volume,
    avgVolume10d: row.avg_volume_10d,
    avgVolume3m: row.avg_volume_3m,
    fiftyDayAverage: row.fifty_day_average,
    approxDailyValue: row.approx_daily_value,
    currency: row.currency,
    lastSeenAt: row.last_seen_at,
  };
}

export async function getRunStatus(env: ScannerEnv, runId: string) {
  const run = await getRun(env.DB, runId);
  return run ? serializeRun(run) : null;
}
