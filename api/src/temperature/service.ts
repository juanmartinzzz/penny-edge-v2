/**
 * Heat and Interest Scale (HIS) service.
 * Cron + queue scoring of TAS snapshots — no Yahoo re-fetch.
 */
import { parseAnalysisJson } from "../analysis/types";
import type { WarmSymbolRow } from "../scanners/types";
import {
  configParams,
  countScoredWarmSymbols,
  countWarmWithAnalysis,
  createTemperatureRun,
  getActiveTemperatureRun,
  getTemperatureConfig,
  getTemperatureRun,
  isTemperatureDue,
  listAllWarmSymbolsWithTemperature,
  listWarmSymbolsWithAnalysisPage,
  updateSymbolTemperature,
  updateTemperatureConfig,
  updateTemperatureRun,
} from "./repo";
import {
  addHours,
  normalizeTemperatureParamsPatch,
  nowIso,
  parseTemperatureParams,
  scoreTemperature,
  type TemperatureJobMessage,
  type TemperatureParams,
  type TemperatureRunTrigger,
  DEFAULT_TEMPERATURE_PARAMS,
} from "./types";

export interface TemperatureEnv {
  DB: D1Database;
  TEMPERATURE_QUEUE: Queue<TemperatureJobMessage>;
  TEMPERATURE_PAGE_SIZE?: string;
}

function resolvePageSize(env: TemperatureEnv, configPageSize: number): number {
  const fromEnv = Number(env.TEMPERATURE_PAGE_SIZE);
  const base =
    Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : configPageSize;
  return Math.min(Math.max(base || 25, 1), 100);
}

function serializeConfig(
  config: NonNullable<Awaited<ReturnType<typeof getTemperatureConfig>>>,
) {
  return {
    id: config.id,
    enabled: config.enabled === 1,
    intervalHours: config.interval_hours,
    pageSize: config.page_size,
    params: parseTemperatureParams(config.params_json),
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

function serializeRun(
  run: NonNullable<Awaited<ReturnType<typeof getTemperatureRun>>>,
) {
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

function parseComponentsJson(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
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
    analyzedAt: row.analyzed_at ?? null,
    temperature: row.temperature ?? null,
    temperatureAt: row.temperature_at ?? null,
    temperatureRunId: row.temperature_run_id ?? null,
    components: parseComponentsJson(row.temperature_components_json),
    analysis: parseAnalysisJson(row.analysis_json ?? null),
  };
}

export async function getTemperatureOverview(env: TemperatureEnv) {
  const config = await getTemperatureConfig(env.DB);
  if (!config) {
    throw new Error("Temperature config missing — run D1 migrations");
  }

  const [analyzedCount, scoredCount, activeRun] = await Promise.all([
    countWarmWithAnalysis(env.DB),
    countScoredWarmSymbols(env.DB),
    getActiveTemperatureRun(env.DB),
  ]);

  return {
    config: serializeConfig(config),
    analyzedCount,
    scoredCount,
    defaults: DEFAULT_TEMPERATURE_PARAMS,
    activeRun: activeRun ? serializeRun(activeRun) : null,
  };
}

export async function getTemperatureSymbols(env: TemperatureEnv) {
  const rows = await listAllWarmSymbolsWithTemperature(env.DB);
  return rows.map(serializeWarmSymbol);
}

export async function patchTemperatureConfig(
  env: TemperatureEnv,
  body: {
    enabled?: boolean;
    intervalHours?: number;
    pageSize?: number;
    params?: Partial<TemperatureParams>;
  },
) {
  const config = await getTemperatureConfig(env.DB);
  if (!config) {
    throw new Error("Temperature config missing — run D1 migrations");
  }

  const patch: Parameters<typeof updateTemperatureConfig>[1] = {};

  if (body.intervalHours !== undefined) {
    if (!Number.isFinite(body.intervalHours) || body.intervalHours < 1) {
      throw new Error("intervalHours must be >= 1");
    }
    patch.interval_hours = Math.floor(body.intervalHours);
  }

  if (body.pageSize !== undefined) {
    if (!Number.isFinite(body.pageSize) || body.pageSize < 1) {
      throw new Error("pageSize must be >= 1");
    }
    patch.page_size = Math.min(Math.floor(body.pageSize), 100);
  }

  if (body.params !== undefined) {
    const normalized = normalizeTemperatureParamsPatch(body.params);
    patch.params = {
      ...configParams(config),
      ...normalized,
    };
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

  const updated = await updateTemperatureConfig(env.DB, patch);
  if (!updated) return null;

  const [analyzedCount, scoredCount, activeRun] = await Promise.all([
    countWarmWithAnalysis(env.DB),
    countScoredWarmSymbols(env.DB),
    getActiveTemperatureRun(env.DB),
  ]);

  return {
    config: serializeConfig(updated),
    analyzedCount,
    scoredCount,
    defaults: DEFAULT_TEMPERATURE_PARAMS,
    activeRun: activeRun ? serializeRun(activeRun) : null,
  };
}

export async function startTemperatureRun(
  env: TemperatureEnv,
  trigger: TemperatureRunTrigger,
) {
  const config = await getTemperatureConfig(env.DB);
  if (!config) {
    throw new Error("Temperature config missing — run D1 migrations");
  }

  const active = await getActiveTemperatureRun(env.DB);
  if (active) {
    throw new Error(`HIS already has an active run (${active.status})`);
  }

  const runId = crypto.randomUUID();
  const size = resolvePageSize(env, config.page_size);
  const run = await createTemperatureRun(env.DB, {
    id: runId,
    trigger,
    pageSize: size,
  });

  await updateTemperatureConfig(env.DB, {
    last_run_status: "queued",
    last_run_error: null,
  });

  await env.TEMPERATURE_QUEUE.send({
    type: "temperature_page",
    runId,
    offset: 0,
  });

  return serializeRun(run);
}

export async function processDueTemperature(env: TemperatureEnv): Promise<number> {
  const due = await isTemperatureDue(env.DB, nowIso());
  if (!due) return 0;

  const active = await getActiveTemperatureRun(env.DB);
  if (active) return 0;

  try {
    await startTemperatureRun(env, "cron");
    return 1;
  } catch (error) {
    console.error("Failed to start HIS cron run:", error);
    return 0;
  }
}

export async function processTemperatureJob(
  env: TemperatureEnv,
  message: TemperatureJobMessage,
): Promise<void> {
  if (message.type !== "temperature_page") return;

  const run = await getTemperatureRun(env.DB, message.runId);
  const config = await getTemperatureConfig(env.DB);

  if (!run || !config) {
    console.error("Missing temperature run or config for job", message);
    return;
  }

  if (run.status === "ok" || run.status === "error") {
    return;
  }

  const startedAt = nowIso();

  if (run.status === "queued") {
    await updateTemperatureRun(env.DB, run.id, {
      status: "running",
      started_at: startedAt,
      offset: message.offset,
    });
    await updateTemperatureConfig(env.DB, {
      last_run_status: "running",
      last_run_error: null,
    });
  }

  try {
    const params = configParams(config);
    const page = await listWarmSymbolsWithAnalysisPage(
      env.DB,
      message.offset,
      run.page_size,
    );

    let succeeded = 0;
    let failed = 0;
    const asOf = nowIso();

    for (const symbol of page) {
      try {
        await scoreAndStore(env.DB, symbol, params, run.id, asOf);
        succeeded += 1;
      } catch (error) {
        failed += 1;
        console.error(`HIS failed for ${symbol.symbol}:`, error);
        const errText = error instanceof Error ? error.message : "Unknown error";
        await updateSymbolTemperature(env.DB, symbol.id, {
          temperature: null,
          componentsJson: JSON.stringify({ error: errText, source: "none" }),
          temperatureAt: asOf,
          temperatureRunId: run.id,
        });
      }
    }

    const scanned = run.scanned + page.length;
    const totalSucceeded = run.succeeded + succeeded;
    const totalFailed = run.failed + failed;
    const hasMore = page.length >= run.page_size;
    const nextOffset = message.offset + run.page_size;

    await updateTemperatureRun(env.DB, run.id, {
      status: "running",
      offset: nextOffset,
      scanned,
      succeeded: totalSucceeded,
      failed: totalFailed,
    });

    await updateTemperatureConfig(env.DB, {
      last_run_scanned: scanned,
      last_run_ok: totalSucceeded,
      last_run_failed: totalFailed,
      last_run_status: "running",
    });

    if (hasMore) {
      await env.TEMPERATURE_QUEUE.send({
        type: "temperature_page",
        runId: run.id,
        offset: nextOffset,
      });
      return;
    }

    const finishedAt = nowIso();
    await updateTemperatureRun(env.DB, run.id, {
      status: "ok",
      finished_at: finishedAt,
      scanned,
      succeeded: totalSucceeded,
      failed: totalFailed,
      error: null,
    });

    const nextRunAt =
      config.enabled === 1 ? addHours(finishedAt, config.interval_hours) : null;

    await updateTemperatureConfig(env.DB, {
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
    console.error(`HIS run ${run.id} failed:`, error);

    await updateTemperatureRun(env.DB, run.id, {
      status: "error",
      error: messageText,
      finished_at: nowIso(),
    });

    await updateTemperatureConfig(env.DB, {
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

async function scoreAndStore(
  db: D1Database,
  symbol: WarmSymbolRow,
  params: TemperatureParams,
  runId: string,
  asOf: string,
): Promise<void> {
  const analysis = parseAnalysisJson(symbol.analysis_json ?? null);
  const result = scoreTemperature(analysis, params);

  await updateSymbolTemperature(db, symbol.id, {
    temperature: result.temperature,
    componentsJson: JSON.stringify(result.components),
    temperatureAt: asOf,
    temperatureRunId: runId,
  });
}

export async function getTemperatureRunStatus(
  env: TemperatureEnv,
  runId: string,
) {
  const run = await getTemperatureRun(env.DB, runId);
  return run ? serializeRun(run) : null;
}
