/**
 * SPA — Symbol Price Archive service.
 * Exchange-wide quote snapshots on a per-venue interval (default 20m).
 */
import {
  isExchangeSessionOpen,
  type ExchangeSession,
} from "../../../shared/exchangeHours";
import { createMarketDataService, type MarketEnv } from "../market/service";
import {
  isBinanceExchange,
  parseEnabledQuoteAssets,
  serializeEnabledQuoteAssets,
} from "../market/binance/constants";
import { listExchangeSessions } from "../scanners/repo";
import {
  countSpaSamples,
  createSpaRun,
  deleteSpaRunPages,
  getActiveSpaRun,
  getSpaExchange,
  getSpaRun,
  getSpaSample,
  insertSpaRunPage,
  insertSpaSample,
  listDueSpaExchanges,
  listSpaExchanges,
  listSpaRunPages,
  listSpaSamples,
  purgeOldSpaSamples,
  updateSpaExchange,
  updateSpaRun,
} from "./repo";
import {
  addMinutes,
  nowIso,
  parseCallsJson,
  parsePricesJson,
  type SpaApiCall,
  type SpaJobMessage,
  type SpaPricePoint,
  type SpaRunTrigger,
} from "./types";

export interface SpaEnv extends MarketEnv {
  SPA_QUEUE: Queue<SpaJobMessage>;
  SPA_PAGE_SIZE?: string;
}

function pageSize(env: SpaEnv): number {
  // Yahoo screener caps at 250; keep headroom under that.
  return Math.min(Math.max(Number(env.SPA_PAGE_SIZE ?? "200") || 200, 25), 250);
}

async function sessionForCode(
  env: SpaEnv,
  code: string,
): Promise<ExchangeSession | null> {
  const sessions = await listExchangeSessions(env.DB);
  const row = sessions.get(code);
  if (!row) return null;
  return {
    timezone: row.timezone,
    openLocal: row.openLocal,
    closeLocal: row.closeLocal,
    includeWeekends: row.includeWeekends,
  };
}

export async function getSpaOverview(env: SpaEnv) {
  const exchanges = await listSpaExchanges(env.DB);
  const sessions = await listExchangeSessions(env.DB);
  const items = [];

  for (const exchange of exchanges) {
    const [sampleCount, activeRun, recentSamples] = await Promise.all([
      countSpaSamples(env.DB, exchange.id),
      getActiveSpaRun(env.DB, exchange.id),
      listSpaSamples(env.DB, exchange.id, 8),
    ]);

    items.push({
      ...serializeExchange(exchange, sessions.get(exchange.code) ?? null),
      sampleCount,
      activeRun: activeRun ? serializeRun(activeRun) : null,
      recentSamples: recentSamples.map((s) => serializeSampleMeta(s)),
    });
  }

  return items;
}

export async function getSpaDetail(env: SpaEnv, exchangeId: string) {
  const exchange = await getSpaExchange(env.DB, exchangeId);
  if (!exchange) return null;

  const sessions = await listExchangeSessions(env.DB);
  const [sampleCount, activeRun, recentSamples] = await Promise.all([
    countSpaSamples(env.DB, exchange.id),
    getActiveSpaRun(env.DB, exchange.id),
    listSpaSamples(env.DB, exchange.id, 25),
  ]);

  return {
    ...serializeExchange(exchange, sessions.get(exchange.code) ?? null),
    sampleCount,
    activeRun: activeRun ? serializeRun(activeRun) : null,
    recentSamples: recentSamples.map((s) => serializeSampleMeta(s)),
  };
}

export async function patchSpaExchange(
  env: SpaEnv,
  exchangeId: string,
  body: {
    enabled?: boolean;
    intervalMinutes?: number;
    retentionDays?: number;
    enabledQuoteAssets?: string[];
  },
) {
  const exchange = await getSpaExchange(env.DB, exchangeId);
  if (!exchange) return null;

  const patch: Parameters<typeof updateSpaExchange>[2] = {};

  if (body.intervalMinutes !== undefined) {
    if (
      !Number.isFinite(body.intervalMinutes) ||
      body.intervalMinutes < 5 ||
      body.intervalMinutes > 24 * 60
    ) {
      throw new Error("intervalMinutes must be between 5 and 1440");
    }
    patch.interval_minutes = Math.floor(body.intervalMinutes);
  }

  if (body.retentionDays !== undefined) {
    if (
      !Number.isFinite(body.retentionDays) ||
      body.retentionDays < 1 ||
      body.retentionDays > 90
    ) {
      throw new Error("retentionDays must be between 1 and 90");
    }
    patch.retention_days = Math.floor(body.retentionDays);
  }

  if (body.enabledQuoteAssets !== undefined) {
    if (!isBinanceExchange(exchange.code)) {
      throw new Error("enabledQuoteAssets is only supported for Binance");
    }
    if (!Array.isArray(body.enabledQuoteAssets)) {
      throw new Error("enabledQuoteAssets must be an array of quote assets");
    }
    const normalized = body.enabledQuoteAssets
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
    if (normalized.length === 0) {
      throw new Error("Select at least one quote asset");
    }
    patch.enabled_quote_assets = serializeEnabledQuoteAssets(normalized);
  }

  if (body.enabled !== undefined) {
    const enabling = body.enabled && exchange.enabled === 0;
    const disabling = !body.enabled && exchange.enabled === 1;
    patch.enabled = body.enabled ? 1 : 0;

    if (enabling) {
      const minutes = patch.interval_minutes ?? exchange.interval_minutes;
      patch.next_run_at = addMinutes(nowIso(), minutes);
    }

    if (disabling) {
      patch.next_run_at = null;
    }
  }

  const updated = await updateSpaExchange(env.DB, exchangeId, patch);
  if (!updated) return null;

  const sessions = await listExchangeSessions(env.DB);
  const [sampleCount, activeRun, recentSamples] = await Promise.all([
    countSpaSamples(env.DB, updated.id),
    getActiveSpaRun(env.DB, updated.id),
    listSpaSamples(env.DB, updated.id, 8),
  ]);

  return {
    ...serializeExchange(updated, sessions.get(updated.code) ?? null),
    sampleCount,
    activeRun: activeRun ? serializeRun(activeRun) : null,
    recentSamples: recentSamples.map((s) => serializeSampleMeta(s)),
  };
}

export async function startSpaRun(
  env: SpaEnv,
  exchangeId: string,
  trigger: SpaRunTrigger,
) {
  const exchange = await getSpaExchange(env.DB, exchangeId);
  if (!exchange) {
    throw new Error("SPA exchange not found");
  }

  const active = await getActiveSpaRun(env.DB, exchangeId);
  if (active) {
    throw new Error(`SPA already has an active run (${active.status})`);
  }

  const runId = crypto.randomUUID();
  const size = pageSize(env);
  const run = await createSpaRun(env.DB, {
    id: runId,
    exchangeId,
    trigger,
    pageSize: size,
  });

  await updateSpaExchange(env.DB, exchangeId, {
    last_run_status: "queued",
    last_run_error: null,
  });

  await env.SPA_QUEUE.send({
    type: "spa_page",
    runId,
    exchangeId,
    offset: 0,
  });

  return serializeRun(run);
}

/** Cron: start due enabled SPA venues whose EVG session is open. */
export async function processDueSpa(env: SpaEnv): Promise<number> {
  const due = await listDueSpaExchanges(env.DB, nowIso());
  let started = 0;
  const now = new Date();

  for (const exchange of due) {
    const session = await sessionForCode(env, exchange.code);
    if (session && !isExchangeSessionOpen(session, now)) {
      continue;
    }

    const active = await getActiveSpaRun(env.DB, exchange.id);
    if (active) continue;

    try {
      await startSpaRun(env, exchange.id, "cron");
      started += 1;
    } catch (error) {
      console.error(`Failed to start SPA cron run for ${exchange.id}:`, error);
    }
  }

  return started;
}

/** Process one SPA screen page; merge into a sample on the final page. */
export async function processSpaJob(
  env: SpaEnv,
  message: SpaJobMessage,
): Promise<void> {
  if (message.type !== "spa_page") return;

  const run = await getSpaRun(env.DB, message.runId);
  const exchange = await getSpaExchange(env.DB, message.exchangeId);

  if (!run || !exchange) {
    console.error("Missing SPA run or exchange for job", message);
    return;
  }

  if (run.status === "ok" || run.status === "error") {
    return;
  }

  const seenAt = nowIso();

  if (run.status === "queued") {
    await updateSpaRun(env.DB, run.id, {
      status: "running",
      started_at: seenAt,
      offset: message.offset,
    });
    await updateSpaExchange(env.DB, exchange.id, {
      last_run_status: "running",
      last_run_error: null,
    });
  }

  try {
    const market = createMarketDataService(env);
    const quoteAssets = isBinanceExchange(exchange.code)
      ? parseEnabledQuoteAssets(exchange.enabled_quote_assets)
      : undefined;

    const startedMs = Date.now();
    const page = await market.screen({
      exchange: exchange.code,
      offset: message.offset,
      limit: run.page_size,
      quoteAssets,
    });

    const call: SpaApiCall = {
      at: nowIso(),
      endpoint: isBinanceExchange(exchange.code)
        ? "coingecko.tickers"
        : "yahoo.screener",
      pageOffset: message.offset,
      pageSize: run.page_size,
      quoteCount: page.length,
      latencyMs: Date.now() - startedMs,
      ok: true,
    };

    const quotes: SpaPricePoint[] = page.map((quote) => ({
      s: quote.symbol,
      p: quote.price,
      ...(quote.volume != null ? { v: quote.volume } : {}),
      ...(quote.name ? { n: quote.name } : {}),
    }));

    await insertSpaRunPage(env.DB, {
      id: crypto.randomUUID(),
      runId: run.id,
      pageOffset: message.offset,
      quotes,
      call,
    });

    const calls = [...parseCallsJson(run.calls_json), call];
    const scanned = run.scanned + page.length;
    const pages = run.pages + 1;
    const hasMore = page.length >= run.page_size;
    const nextOffset = message.offset + run.page_size;

    await updateSpaRun(env.DB, run.id, {
      status: "running",
      offset: nextOffset,
      scanned,
      pages,
      calls_json: JSON.stringify(calls),
    });

    await updateSpaExchange(env.DB, exchange.id, {
      last_run_scanned: scanned,
      last_run_status: "running",
    });

    if (hasMore) {
      await env.SPA_QUEUE.send({
        type: "spa_page",
        runId: run.id,
        exchangeId: exchange.id,
        offset: nextOffset,
      });
      return;
    }

    // Final page — merge staging pages into one sample snapshot.
    const staging = await listSpaRunPages(env.DB, run.id);
    const prices: SpaPricePoint[] = [];
    for (const row of staging) {
      prices.push(...parsePricesJson(row.quotes_json));
    }

    const sampleId = crypto.randomUUID();
    const finishedAt = nowIso();
    await insertSpaSample(env.DB, {
      id: sampleId,
      exchangeId: exchange.id,
      runId: run.id,
      sampledAt: finishedAt,
      prices,
      calls,
    });

    await deleteSpaRunPages(env.DB, run.id);

    await updateSpaRun(env.DB, run.id, {
      status: "ok",
      finished_at: finishedAt,
      scanned,
      pages,
      sample_id: sampleId,
      error: null,
      calls_json: JSON.stringify(calls),
    });

    const nextRunAt =
      exchange.enabled === 1
        ? addMinutes(finishedAt, exchange.interval_minutes)
        : null;

    await updateSpaExchange(env.DB, exchange.id, {
      last_run_at: finishedAt,
      last_run_status: "ok",
      last_run_error: null,
      last_run_scanned: scanned,
      last_sample_id: sampleId,
      next_run_at: nextRunAt,
    });

    const cutoff = addMinutes(finishedAt, -exchange.retention_days * 24 * 60);
    await purgeOldSpaSamples(env.DB, exchange.id, cutoff);
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`SPA run ${run.id} failed:`, error);

    await deleteSpaRunPages(env.DB, run.id).catch(() => undefined);

    await updateSpaRun(env.DB, run.id, {
      status: "error",
      error: messageText,
      finished_at: nowIso(),
    });

    await updateSpaExchange(env.DB, exchange.id, {
      last_run_status: "error",
      last_run_error: messageText,
      last_run_at: nowIso(),
      next_run_at:
        exchange.enabled === 1
          ? addMinutes(nowIso(), exchange.interval_minutes)
          : exchange.next_run_at,
    });

    throw error;
  }
}

export async function getSpaRunStatus(env: SpaEnv, runId: string) {
  const run = await getSpaRun(env.DB, runId);
  return run ? serializeRun(run) : null;
}

export async function getSpaSampleDetail(env: SpaEnv, sampleId: string) {
  const sample = await getSpaSample(env.DB, sampleId);
  if (!sample) return null;

  const exchange = await getSpaExchange(env.DB, sample.exchange_id);
  const prices = parsePricesJson(sample.prices_json);
  const calls = parseCallsJson(sample.calls_json);

  return {
    id: sample.id,
    exchangeId: sample.exchange_id,
    exchangeCode: exchange?.code ?? null,
    runId: sample.run_id,
    sampledAt: sample.sampled_at,
    symbolCount: sample.symbol_count,
    calls,
    prices: prices.map((p) => ({
      symbol: p.s,
      price: p.p,
      volume: p.v ?? null,
      name: p.n ?? null,
    })),
    createdAt: sample.created_at,
  };
}

function serializeExchange(
  exchange: NonNullable<Awaited<ReturnType<typeof getSpaExchange>>>,
  session: {
    timezone: string;
    openLocal: string;
    closeLocal: string;
    includeWeekends: boolean;
  } | null,
) {
  const binance = isBinanceExchange(exchange.code);
  const sessionOpen = session
    ? isExchangeSessionOpen({
        timezone: session.timezone,
        openLocal: session.openLocal,
        closeLocal: session.closeLocal,
        includeWeekends: session.includeWeekends,
      })
    : false;

  return {
    id: exchange.id,
    code: exchange.code,
    label: exchange.label,
    enabled: exchange.enabled === 1,
    intervalMinutes: exchange.interval_minutes,
    retentionDays: exchange.retention_days,
    enabledQuoteAssets: binance
      ? parseEnabledQuoteAssets(exchange.enabled_quote_assets)
      : null,
    sessionOpen,
    timezone: session?.timezone ?? null,
    openLocal: session?.openLocal ?? null,
    closeLocal: session?.closeLocal ?? null,
    includeWeekends: session?.includeWeekends ?? false,
    lastRunAt: exchange.last_run_at,
    nextRunAt: exchange.next_run_at,
    lastRunStatus: exchange.last_run_status,
    lastRunError: exchange.last_run_error,
    lastRunScanned: exchange.last_run_scanned,
    lastSampleId: exchange.last_sample_id,
    updatedAt: exchange.updated_at,
  };
}

function serializeRun(run: NonNullable<Awaited<ReturnType<typeof getSpaRun>>>) {
  return {
    id: run.id,
    exchangeId: run.exchange_id,
    status: run.status,
    trigger: run.trigger,
    offset: run.offset,
    pageSize: run.page_size,
    scanned: run.scanned,
    pages: run.pages,
    sampleId: run.sample_id,
    calls: parseCallsJson(run.calls_json),
    error: run.error,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

function serializeSampleMeta(
  sample: Awaited<ReturnType<typeof listSpaSamples>>[number],
) {
  return {
    id: sample.id,
    exchangeId: sample.exchange_id,
    runId: sample.run_id,
    sampledAt: sample.sampled_at,
    symbolCount: sample.symbol_count,
    callCount: parseCallsJson(sample.calls_json).length,
    createdAt: sample.created_at,
  };
}
