/**
 * Trend Analysis for Symbols (TAS) service.
 * Product name for cron + queue deep price analysis of EVG warm symbols.
 * Internal identifiers keep the "analysis" prefix; TAS is the product alias.
 */
import { createMarketDataService, type MarketEnv } from "../market/service";
import type { WarmSymbolRow } from "../scanners/types";
import {
  countAllWarmSymbols,
  countAnalyzedWarmSymbols,
  createAnalysisRun,
  getActiveAnalysisRun,
  getAnalysisConfig,
  getAnalysisRun,
  isAnalysisDue,
  listAllWarmSymbolsWithAnalysis,
  listWarmSymbolsPage,
  updateAnalysisConfig,
  updateAnalysisRun,
  updateSymbolAnalysis,
} from "./repo";
import {
  addHours,
  buildSymbolAnalysis,
  dailyRangeForLookback,
  nowIso,
  parseAnalysisJson,
  type AnalysisJobMessage,
  type AnalysisRunTrigger,
  type SymbolAnalysis,
} from "./types";

export interface AnalysisEnv extends MarketEnv {
  ANALYSIS_QUEUE: Queue<AnalysisJobMessage>;
  ANALYSIS_PAGE_SIZE?: string;
}

function resolvePageSize(
  env: AnalysisEnv,
  configPageSize: number,
): number {
  const fromEnv = Number(env.ANALYSIS_PAGE_SIZE);
  const base = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : configPageSize;
  return Math.min(Math.max(base || 5, 1), 25);
}

function serializeConfig(
  config: NonNullable<Awaited<ReturnType<typeof getAnalysisConfig>>>,
) {
  return {
    id: config.id,
    enabled: config.enabled === 1,
    intervalHours: config.interval_hours,
    lookbackDays: config.lookback_days,
    rollHours: config.roll_hours,
    pageSize: config.page_size,
    lastRunAt: config.last_run_at,
    nextRunAt: config.next_run_at,
    lastRunStatus: config.last_run_status,
    lastRunError: config.last_run_error,
    lastRunScanned: config.last_run_scanned,
    lastRunOk: config.last_run_ok,
    lastRunFailed: config.last_run_failed,
    updatedAt: config.updated_at,
  };
}

function serializeRun(run: NonNullable<Awaited<ReturnType<typeof getAnalysisRun>>>) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    offset: run.offset,
    pageSize: run.page_size,
    scanned: run.scanned,
    succeeded: run.succeeded,
    failed: run.failed,
    error: run.error,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

function serializeWarmSymbol(row: WarmSymbolRow) {
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
    analyzedAt: row.analyzed_at ?? null,
    analysisRunId: row.analysis_run_id ?? null,
    analysis: parseAnalysisJson(row.analysis_json ?? null),
  };
}

export async function getAnalysisOverview(env: AnalysisEnv) {
  const config = await getAnalysisConfig(env.DB);
  if (!config) {
    throw new Error("Analysis config missing — run D1 migrations");
  }

  const [warmCount, analyzedCount, activeRun] = await Promise.all([
    countAllWarmSymbols(env.DB),
    countAnalyzedWarmSymbols(env.DB),
    getActiveAnalysisRun(env.DB),
  ]);

  return {
    config: serializeConfig(config),
    warmCount,
    analyzedCount,
    activeRun: activeRun ? serializeRun(activeRun) : null,
  };
}

/** TAS symbols endpoint: always returns full analysis series when present. */
export async function getAnalysisSymbols(env: AnalysisEnv) {
  const rows = await listAllWarmSymbolsWithAnalysis(env.DB);
  return rows.map(serializeWarmSymbol);
}

export async function patchAnalysisConfig(
  env: AnalysisEnv,
  body: {
    enabled?: boolean;
    intervalHours?: number;
    lookbackDays?: number;
    rollHours?: number;
    pageSize?: number;
  },
) {
  const config = await getAnalysisConfig(env.DB);
  if (!config) {
    throw new Error("Analysis config missing — run D1 migrations");
  }

  const patch: Parameters<typeof updateAnalysisConfig>[1] = {};

  if (body.intervalHours !== undefined) {
    if (!Number.isFinite(body.intervalHours) || body.intervalHours < 1) {
      throw new Error("intervalHours must be >= 1");
    }
    patch.interval_hours = Math.floor(body.intervalHours);
  }

  if (body.lookbackDays !== undefined) {
    if (!Number.isFinite(body.lookbackDays) || body.lookbackDays < 1) {
      throw new Error("lookbackDays must be >= 1");
    }
    patch.lookback_days = Math.floor(body.lookbackDays);
  }

  if (body.rollHours !== undefined) {
    if (!Number.isFinite(body.rollHours) || body.rollHours < 1) {
      throw new Error("rollHours must be >= 1");
    }
    patch.roll_hours = Math.floor(body.rollHours);
  }

  if (body.pageSize !== undefined) {
    if (!Number.isFinite(body.pageSize) || body.pageSize < 1) {
      throw new Error("pageSize must be >= 1");
    }
    patch.page_size = Math.min(Math.floor(body.pageSize), 25);
  }

  if (body.enabled !== undefined) {
    const enabling = body.enabled && config.enabled === 0;
    const disabling = !body.enabled && config.enabled === 1;
    patch.enabled = body.enabled ? 1 : 0;

    if (enabling) {
      const hours = patch.interval_hours ?? config.interval_hours;
      patch.next_run_at = addHours(nowIso(), hours);
    }

    if (disabling) {
      patch.next_run_at = null;
    }
  }

  const updated = await updateAnalysisConfig(env.DB, patch);
  if (!updated) return null;

  const [warmCount, analyzedCount, activeRun] = await Promise.all([
    countAllWarmSymbols(env.DB),
    countAnalyzedWarmSymbols(env.DB),
    getActiveAnalysisRun(env.DB),
  ]);

  return {
    config: serializeConfig(updated),
    warmCount,
    analyzedCount,
    activeRun: activeRun ? serializeRun(activeRun) : null,
  };
}

/** Start a TAS run (manual or cron) and enqueue the first page. */
export async function startAnalysisRun(
  env: AnalysisEnv,
  trigger: AnalysisRunTrigger,
) {
  const config = await getAnalysisConfig(env.DB);
  if (!config) {
    throw new Error("Analysis config missing — run D1 migrations");
  }

  const active = await getActiveAnalysisRun(env.DB);
  if (active) {
    throw new Error(`TAS already has an active run (${active.status})`);
  }

  const runId = crypto.randomUUID();
  const size = resolvePageSize(env, config.page_size);
  const run = await createAnalysisRun(env.DB, {
    id: runId,
    trigger,
    pageSize: size,
  });

  await updateAnalysisConfig(env.DB, {
    last_run_status: "queued",
    last_run_error: null,
  });

  await env.ANALYSIS_QUEUE.send({
    type: "analysis_page",
    runId,
    offset: 0,
  });

  return serializeRun(run);
}

/** TAS cron: start when enabled and next_run_at is due. */
export async function processDueAnalysis(env: AnalysisEnv): Promise<number> {
  const due = await isAnalysisDue(env.DB, nowIso());
  if (!due) return 0;

  const active = await getActiveAnalysisRun(env.DB);
  if (active) return 0;

  try {
    await startAnalysisRun(env, "cron");
    return 1;
  } catch (error) {
    console.error("Failed to start TAS cron run:", error);
    return 0;
  }
}

/** Process one TAS page: chart each warm symbol and store full analysis JSON. */
export async function processAnalysisJob(
  env: AnalysisEnv,
  message: AnalysisJobMessage,
): Promise<void> {
  if (message.type !== "analysis_page") return;

  const run = await getAnalysisRun(env.DB, message.runId);
  const config = await getAnalysisConfig(env.DB);

  if (!run || !config) {
    console.error("Missing analysis run or config for job", message);
    return;
  }

  if (run.status === "ok" || run.status === "error") {
    return;
  }

  const startedAt = nowIso();

  if (run.status === "queued") {
    await updateAnalysisRun(env.DB, run.id, {
      status: "running",
      started_at: startedAt,
      offset: message.offset,
    });
    await updateAnalysisConfig(env.DB, {
      last_run_status: "running",
      last_run_error: null,
    });
  }

  try {
    const market = createMarketDataService(env);
    const page = await listWarmSymbolsPage(
      env.DB,
      message.offset,
      run.page_size,
    );

    let succeeded = 0;
    let failed = 0;
    const asOf = nowIso();
    const dailyRange = dailyRangeForLookback(config.lookback_days);

    for (const symbol of page) {
      try {
        const analysis = await analyzeSymbol(market, symbol, {
          asOf,
          lookbackDays: config.lookback_days,
          rollHours: config.roll_hours,
          dailyRange,
        });

        await updateSymbolAnalysis(env.DB, symbol.id, {
          analysisJson: JSON.stringify(analysis),
          analyzedAt: asOf,
          analysisRunId: run.id,
        });
        succeeded += 1;
      } catch (error) {
        failed += 1;
        const errText = error instanceof Error ? error.message : "Unknown error";
        console.error(`TAS failed for ${symbol.symbol}:`, error);

        const failedAnalysis: SymbolAnalysis = {
          asOf,
          lookbackDays: config.lookback_days,
          rollHours: config.roll_hours,
          daily: { bars: [], avgClose: null },
          intraday: { sourceInterval: "1h", points: [] },
          summary: {
            lastClose: null,
            closeVsLookbackAvgPct: null,
            rollingAvgClose: null,
          },
          error: errText,
        };

        await updateSymbolAnalysis(env.DB, symbol.id, {
          analysisJson: JSON.stringify(failedAnalysis),
          analyzedAt: asOf,
          analysisRunId: run.id,
        });
      }
    }

    const scanned = run.scanned + page.length;
    const totalSucceeded = run.succeeded + succeeded;
    const totalFailed = run.failed + failed;
    const hasMore = page.length >= run.page_size;
    const nextOffset = message.offset + run.page_size;

    await updateAnalysisRun(env.DB, run.id, {
      status: "running",
      offset: nextOffset,
      scanned,
      succeeded: totalSucceeded,
      failed: totalFailed,
    });

    await updateAnalysisConfig(env.DB, {
      last_run_scanned: scanned,
      last_run_ok: totalSucceeded,
      last_run_failed: totalFailed,
      last_run_status: "running",
    });

    if (hasMore) {
      await env.ANALYSIS_QUEUE.send({
        type: "analysis_page",
        runId: run.id,
        offset: nextOffset,
      });
      return;
    }

    const finishedAt = nowIso();
    await updateAnalysisRun(env.DB, run.id, {
      status: "ok",
      finished_at: finishedAt,
      scanned,
      succeeded: totalSucceeded,
      failed: totalFailed,
      error: null,
    });

    const nextRunAt =
      config.enabled === 1 ? addHours(finishedAt, config.interval_hours) : null;

    await updateAnalysisConfig(env.DB, {
      last_run_at: finishedAt,
      last_run_status: "ok",
      last_run_error: null,
      last_run_scanned: scanned,
      last_run_ok: totalSucceeded,
      last_run_failed: totalFailed,
      next_run_at: nextRunAt,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown error";
    console.error(`TAS run ${run.id} failed:`, error);

    await updateAnalysisRun(env.DB, run.id, {
      status: "error",
      error: messageText,
      finished_at: nowIso(),
    });

    await updateAnalysisConfig(env.DB, {
      last_run_status: "error",
      last_run_error: messageText,
      last_run_at: nowIso(),
      next_run_at:
        config.enabled === 1
          ? addHours(nowIso(), config.interval_hours)
          : config.next_run_at,
    });

    throw error;
  }
}

async function analyzeSymbol(
  market: ReturnType<typeof createMarketDataService>,
  symbol: WarmSymbolRow,
  opts: {
    asOf: string;
    lookbackDays: number;
    rollHours: number;
    dailyRange: "1mo" | "3mo" | "6mo";
  },
): Promise<SymbolAnalysis> {
  const ref = { symbol: symbol.symbol, exchange: symbol.exchange };

  const [daily, hourly] = await Promise.all([
    market.getChart(ref, { interval: "1d", range: opts.dailyRange }),
    market.getChart(ref, { interval: "1h", range: "5d" }),
  ]);

  return buildSymbolAnalysis({
    asOf: opts.asOf,
    lookbackDays: opts.lookbackDays,
    rollHours: opts.rollHours,
    dailyBars: daily.bars,
    hourlyBars: hourly.bars,
  });
}

export async function getAnalysisRunStatus(env: AnalysisEnv, runId: string) {
  const run = await getAnalysisRun(env.DB, runId);
  return run ? serializeRun(run) : null;
}
