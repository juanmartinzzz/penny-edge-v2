/**
 * SWATCH (Sell Watch) service.
 * Global schedule + per-asset close-to-close variation checks → Telegram.
 * Processes inline (no queue) — watchlists stay small.
 */
import { createMarketDataService, type MarketEnv } from "../market/service";
import {
  formatSwatchAlert,
  sendTelegramMessage,
  type SwatchAlertLine,
  type TelegramEnv,
} from "../telegram";
import {
  countSwatchAssets,
  createSwatchRun,
  deleteSwatchAsset,
  getActiveSwatchRun,
  getSwatchAsset,
  getSwatchConfig,
  getSwatchRun,
  insertSwatchAsset,
  isSwatchDue,
  listEnabledSwatchAssets,
  listSwatchAssets,
  updateSwatchAsset,
  updateSwatchConfig,
  updateSwatchRun,
} from "./repo";
import {
  SWATCH_EXCHANGES,
  SWATCH_FORM_DEFAULTS,
  addHours,
  chartRangeForWindow,
  evaluateCloseToClose,
  isInCooldown,
  isSwatchDirection,
  moveBreachesThreshold,
  nowIso,
  type SwatchDirection,
  type SwatchRunTrigger,
} from "./types";

export interface SwatchEnv extends MarketEnv, TelegramEnv {}

const EXCHANGE_VALUES = new Set<string>(
  SWATCH_EXCHANGES.map((item) => item.value),
);

function serializeConfig(
  config: NonNullable<Awaited<ReturnType<typeof getSwatchConfig>>>,
) {
  return {
    id: config.id,
    enabled: config.enabled === 1,
    intervalHours: config.interval_hours,
    lastRunAt: config.last_run_at,
    nextRunAt: config.next_run_at,
    lastRunStatus: config.last_run_status,
    lastRunError: config.last_run_error,
    lastRunScanned: config.last_run_scanned,
    lastRunOk: config.last_run_ok,
    lastRunFailed: config.last_run_failed,
    lastRunAlerted: config.last_run_alerted,
    updatedAt: config.updated_at,
  };
}

function serializeRun(
  run: NonNullable<Awaited<ReturnType<typeof getSwatchRun>>>,
) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    scanned: run.scanned,
    succeeded: run.succeeded,
    failed: run.failed,
    alerted: run.alerted,
    error: run.error,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

function serializeAsset(
  row: NonNullable<Awaited<ReturnType<typeof getSwatchAsset>>>,
) {
  return {
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange,
    enabled: row.enabled === 1,
    thresholdPct: row.threshold_pct,
    windowHours: row.window_hours,
    direction: row.direction as SwatchDirection,
    cooldownMinutes: row.cooldown_minutes,
    lastCheckedAt: row.last_checked_at,
    lastClose: row.last_close,
    lastMovePct: row.last_move_pct,
    lastAlertedAt: row.last_alerted_at,
    lastAlertMovePct: row.last_alert_move_pct,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeExchange(raw: string): string {
  return raw.trim().toUpperCase();
}

function assertThreshold(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error("thresholdPct must be > 0 and ≤ 100");
  }
  return value;
}

function assertWindowHours(value: number): number {
  if (!Number.isFinite(value) || value < 1 || value > 168) {
    throw new Error("windowHours must be between 1 and 168");
  }
  return value;
}

function assertCooldown(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 10080) {
    throw new Error("cooldownMinutes must be between 0 and 10080");
  }
  return Math.floor(value);
}

export async function getSwatchOverview(env: SwatchEnv) {
  const config = await getSwatchConfig(env.DB);
  if (!config) {
    throw new Error("SWATCH config missing — run D1 migrations");
  }

  const [counts, activeRun, assets] = await Promise.all([
    countSwatchAssets(env.DB),
    getActiveSwatchRun(env.DB),
    listSwatchAssets(env.DB),
  ]);

  return {
    config: serializeConfig(config),
    assetCount: counts.total,
    enabledCount: counts.enabled,
    defaults: SWATCH_FORM_DEFAULTS,
    exchanges: SWATCH_EXCHANGES.map((item) => ({ ...item })),
    assets: assets.map(serializeAsset),
    activeRun: activeRun ? serializeRun(activeRun) : null,
  };
}

export async function patchSwatchConfig(
  env: SwatchEnv,
  body: { enabled?: boolean; intervalHours?: number },
) {
  const config = await getSwatchConfig(env.DB);
  if (!config) {
    throw new Error("SWATCH config missing — run D1 migrations");
  }

  const patch: Parameters<typeof updateSwatchConfig>[1] = {};

  if (body.intervalHours !== undefined) {
    if (!Number.isFinite(body.intervalHours) || body.intervalHours < 1) {
      throw new Error("intervalHours must be >= 1");
    }
    patch.interval_hours = Math.floor(body.intervalHours);
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

  const updated = await updateSwatchConfig(env.DB, patch);
  if (!updated) return null;
  return getSwatchOverview(env);
}

export async function createAsset(
  env: SwatchEnv,
  body: {
    symbol?: string;
    exchange?: string;
    enabled?: boolean;
    thresholdPct?: number;
    windowHours?: number;
    direction?: string;
    cooldownMinutes?: number;
  },
) {
  if (!body.symbol?.trim()) throw new Error("symbol is required");
  if (!body.exchange?.trim()) throw new Error("exchange is required");

  const symbol = normalizeSymbol(body.symbol);
  const exchange = normalizeExchange(body.exchange);
  if (!EXCHANGE_VALUES.has(exchange)) {
    throw new Error(
      `exchange must be one of: ${[...EXCHANGE_VALUES].join(", ")}`,
    );
  }
  if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) {
    throw new Error("symbol looks invalid");
  }

  const directionRaw = body.direction ?? SWATCH_FORM_DEFAULTS.direction;
  if (!isSwatchDirection(directionRaw)) {
    throw new Error("direction must be up, down, or either");
  }

  try {
    const row = await insertSwatchAsset(env.DB, {
      id: crypto.randomUUID(),
      symbol,
      exchange,
      enabled: body.enabled === false ? 0 : 1,
      threshold_pct: assertThreshold(
        body.thresholdPct ?? SWATCH_FORM_DEFAULTS.thresholdPct,
      ),
      window_hours: assertWindowHours(
        body.windowHours ?? SWATCH_FORM_DEFAULTS.windowHours,
      ),
      direction: directionRaw,
      cooldown_minutes: assertCooldown(
        body.cooldownMinutes ?? SWATCH_FORM_DEFAULTS.cooldownMinutes,
      ),
    });
    return { asset: serializeAsset(row) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) {
      throw new Error(`${symbol} on ${exchange} is already on SWATCH`);
    }
    throw error;
  }
}

export async function patchAsset(
  env: SwatchEnv,
  id: string,
  body: {
    enabled?: boolean;
    thresholdPct?: number;
    windowHours?: number;
    direction?: string;
    cooldownMinutes?: number;
  },
) {
  const patch: Parameters<typeof updateSwatchAsset>[2] = {};

  if (body.enabled !== undefined) {
    patch.enabled = body.enabled ? 1 : 0;
  }
  if (body.thresholdPct !== undefined) {
    patch.threshold_pct = assertThreshold(body.thresholdPct);
  }
  if (body.windowHours !== undefined) {
    patch.window_hours = assertWindowHours(body.windowHours);
  }
  if (body.direction !== undefined) {
    if (!isSwatchDirection(body.direction)) {
      throw new Error("direction must be up, down, or either");
    }
    patch.direction = body.direction;
  }
  if (body.cooldownMinutes !== undefined) {
    patch.cooldown_minutes = assertCooldown(body.cooldownMinutes);
  }

  const row = await updateSwatchAsset(env.DB, id, patch);
  if (!row) return null;
  return { asset: serializeAsset(row) };
}

export async function removeAsset(env: SwatchEnv, id: string) {
  return deleteSwatchAsset(env.DB, id);
}

export async function getSwatchRunStatus(env: SwatchEnv, runId: string) {
  const run = await getSwatchRun(env.DB, runId);
  return run ? serializeRun(run) : null;
}

export async function startSwatchRun(
  env: SwatchEnv,
  trigger: SwatchRunTrigger,
) {
  const config = await getSwatchConfig(env.DB);
  if (!config) {
    throw new Error("SWATCH config missing — run D1 migrations");
  }

  const active = await getActiveSwatchRun(env.DB);
  if (active) {
    throw new Error(`SWATCH already has an active run (${active.status})`);
  }

  const runId = crypto.randomUUID();
  const run = await createSwatchRun(env.DB, { id: runId, trigger });

  await updateSwatchConfig(env.DB, {
    last_run_status: "queued",
    last_run_error: null,
  });

  await executeSwatchRun(env, run.id);

  const finished = await getSwatchRun(env.DB, run.id);
  return serializeRun(finished ?? run);
}

export async function processDueSwatch(env: SwatchEnv): Promise<number> {
  const due = await isSwatchDue(env.DB, nowIso());
  if (!due) return 0;

  const active = await getActiveSwatchRun(env.DB);
  if (active) return 0;

  try {
    await startSwatchRun(env, "cron");
    return 1;
  } catch (error) {
    console.error("Failed to start SWATCH cron run:", error);
    return 0;
  }
}

async function executeSwatchRun(env: SwatchEnv, runId: string): Promise<void> {
  const run = await getSwatchRun(env.DB, runId);
  const config = await getSwatchConfig(env.DB);
  if (!run || !config) return;

  const startedAt = nowIso();
  await updateSwatchRun(env.DB, runId, {
    status: "running",
    started_at: startedAt,
  });
  await updateSwatchConfig(env.DB, {
    last_run_status: "running",
    last_run_error: null,
  });

  try {
    const market = createMarketDataService(env);
    const assets = await listEnabledSwatchAssets(env.DB);
    const pendingAlerts: Array<SwatchAlertLine & { assetId: string }> = [];

    let succeeded = 0;
    let failed = 0;
    const asOf = nowIso();
    const nowMs = Date.now();

    for (const asset of assets) {
      try {
        const direction = isSwatchDirection(asset.direction)
          ? asset.direction
          : "either";
        const range = chartRangeForWindow(asset.window_hours);
        const chart = await market.getChart(
          { symbol: asset.symbol, exchange: asset.exchange },
          { interval: "1h", range },
        );
        const move = evaluateCloseToClose(
          chart.bars,
          asset.window_hours,
          nowMs,
        );
        if (!move) {
          throw new Error("Not enough hourly closes for the window");
        }

        const breached = moveBreachesThreshold(
          move.movePct,
          asset.threshold_pct,
          direction,
        );
        const cooling = isInCooldown(
          asset.last_alerted_at,
          asset.cooldown_minutes,
          nowMs,
        );

        await updateSwatchAsset(env.DB, asset.id, {
          last_checked_at: asOf,
          last_close: move.endClose,
          last_move_pct: move.movePct,
          last_error: null,
        });

        if (breached && !cooling) {
          pendingAlerts.push({
            assetId: asset.id,
            symbol: asset.symbol,
            exchange: asset.exchange,
            movePct: move.movePct,
            windowHours: asset.window_hours,
            thresholdPct: asset.threshold_pct,
          });
        }

        succeeded += 1;
      } catch (error) {
        failed += 1;
        const errText =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`SWATCH failed for ${asset.symbol}:`, error);
        await updateSwatchAsset(env.DB, asset.id, {
          last_checked_at: asOf,
          last_error: errText,
        });
      }
    }

    let alerted = 0;
    if (pendingAlerts.length > 0) {
      const sent = await sendTelegramMessage(
        env,
        formatSwatchAlert(pendingAlerts),
        { parseMode: "HTML" },
      );
      if (sent) {
        alerted = pendingAlerts.length;
        for (const line of pendingAlerts) {
          await updateSwatchAsset(env.DB, line.assetId, {
            last_alerted_at: asOf,
            last_alert_move_pct: line.movePct,
          });
        }
      } else {
        console.warn(
          `SWATCH alert not sent for ${pendingAlerts.map((a) => a.symbol).join(", ")} — will retry next run`,
        );
      }
    }

    const finishedAt = nowIso();
    const scanned = assets.length;
    await updateSwatchRun(env.DB, runId, {
      status: "ok",
      scanned,
      succeeded,
      failed,
      alerted,
      error: null,
      finished_at: finishedAt,
    });

    const nextRunAt =
      config.enabled === 1 ? addHours(finishedAt, config.interval_hours) : null;

    await updateSwatchConfig(env.DB, {
      last_run_at: finishedAt,
      last_run_status: "ok",
      last_run_error: null,
      last_run_scanned: scanned,
      last_run_ok: succeeded,
      last_run_failed: failed,
      last_run_alerted: alerted,
      next_run_at: nextRunAt,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown error";
    console.error(`SWATCH run ${runId} failed:`, error);

    await updateSwatchRun(env.DB, runId, {
      status: "error",
      error: messageText,
      finished_at: nowIso(),
    });

    await updateSwatchConfig(env.DB, {
      last_run_status: "error",
      last_run_error: messageText,
      last_run_at: nowIso(),
      next_run_at:
        config.enabled === 1
          ? addHours(nowIso(), config.interval_hours)
          : config.next_run_at,
    });
  }
}
