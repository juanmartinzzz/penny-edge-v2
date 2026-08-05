/**
 * SWATCH (Sell Watch) service.
 * Global schedule + per-asset close-to-close variation checks → Telegram.
 * Optional all-time return (ATR) P&L / % triggers when shares + avg cost set.
 * Processes inline (no queue) — watchlists stay small.
 */
import { isExchangeSessionOpen } from "../../../shared/exchangeHours";
import { createMarketDataService, type MarketEnv } from "../market/service";
import { listExchangeSessions } from "../scanners/repo";
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
  computeAtrPosition,
  evaluateCloseToClose,
  findBreachedAtrTrigger,
  isInCooldown,
  isSwatchDirection,
  moveBreachesThreshold,
  normalizeAtrTriggers,
  nowIso,
  parseAtrTriggersJson,
  serializeAtrTriggers,
  type SwatchAtrTrigger,
  type SwatchDirection,
  type SwatchRunTrigger,
} from "./types";

export interface SwatchEnv extends MarketEnv, TelegramEnv {}

const EXCHANGE_VALUES = new Set<string>(
  SWATCH_EXCHANGES.map((item) => item.value),
);

type AssetPositionBody = {
  shares?: number | null;
  avgCost?: number | null;
  totalInvested?: number | null;
  atrTriggers?: unknown;
};

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
  const shares = row.shares;
  const avgCost = row.avg_cost;
  const totalInvested =
    shares != null &&
    avgCost != null &&
    Number.isFinite(shares) &&
    Number.isFinite(avgCost)
      ? shares * avgCost
      : null;

  return {
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange,
    enabled: row.enabled === 1,
    thresholdPct: row.threshold_pct,
    windowHours: row.window_hours,
    direction: row.direction as SwatchDirection,
    cooldownMinutes: row.cooldown_minutes,
    shares,
    avgCost,
    totalInvested,
    atrTriggers: parseAtrTriggersJson(row.atr_triggers_json),
    lastCheckedAt: row.last_checked_at,
    lastClose: row.last_close,
    lastMovePct: row.last_move_pct,
    lastAtrPnl: row.last_atr_pnl,
    lastAtrPct: row.last_atr_pct,
    lastAlertedAt: row.last_alerted_at,
    lastAlertMovePct: row.last_alert_move_pct,
    lastAlertKind: row.last_alert_kind,
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

/**
 * Resolve shares + avg cost from body.
 * Accepts avgCost or totalInvested (total → avg = total / shares).
 * Explicit null shares clears the ATR position.
 */
function resolvePositionFields(
  body: AssetPositionBody,
  current?: { shares: number | null; avg_cost: number | null },
): {
  shares?: number | null;
  avg_cost?: number | null;
  atr_triggers_json?: string | null;
} {
  const touched =
    body.shares !== undefined ||
    body.avgCost !== undefined ||
    body.totalInvested !== undefined ||
    body.atrTriggers !== undefined;

  if (!touched) return {};

  let atrTriggers: SwatchAtrTrigger[] | undefined;
  if (body.atrTriggers !== undefined) {
    atrTriggers = normalizeAtrTriggers(body.atrTriggers);
  }

  if (body.shares === null) {
    if (atrTriggers != null && atrTriggers.length > 0) {
      throw new Error("atrTriggers require shares and cost basis");
    }
    return {
      shares: null,
      avg_cost: null,
      atr_triggers_json:
        body.atrTriggers !== undefined
          ? serializeAtrTriggers(atrTriggers ?? [])
          : null,
    };
  }

  if (body.avgCost !== undefined && body.totalInvested !== undefined) {
    throw new Error("Provide avgCost or totalInvested, not both");
  }

  if (body.shares !== undefined && body.shares !== null) {
    if (!Number.isFinite(body.shares) || body.shares <= 0) {
      throw new Error("shares must be > 0");
    }
  }

  const nextShares =
    body.shares !== undefined ? body.shares : (current?.shares ?? null);

  let nextAvg: number | null =
    body.avgCost === undefined && body.totalInvested === undefined
      ? (current?.avg_cost ?? null)
      : null;

  if (body.totalInvested !== undefined) {
    if (body.totalInvested === null) {
      nextAvg = null;
    } else if (!Number.isFinite(body.totalInvested) || body.totalInvested <= 0) {
      throw new Error("totalInvested must be > 0");
    } else if (nextShares == null || nextShares <= 0) {
      throw new Error("shares must be > 0 when setting totalInvested");
    } else {
      nextAvg = body.totalInvested / nextShares;
    }
  } else if (body.avgCost !== undefined) {
    if (body.avgCost === null) {
      nextAvg = null;
    } else if (!Number.isFinite(body.avgCost) || body.avgCost <= 0) {
      throw new Error("avgCost must be > 0");
    } else {
      nextAvg = body.avgCost;
    }
  }

  const wantsPosition =
    nextShares != null ||
    nextAvg != null ||
    (atrTriggers != null && atrTriggers.length > 0);

  if (
    wantsPosition &&
    (nextShares == null ||
      nextAvg == null ||
      !Number.isFinite(nextShares) ||
      !Number.isFinite(nextAvg) ||
      nextShares <= 0 ||
      nextAvg <= 0)
  ) {
    throw new Error(
      "ATR needs shares > 0 and a cost basis (avgCost or totalInvested)",
    );
  }

  const result: {
    shares?: number | null;
    avg_cost?: number | null;
    atr_triggers_json?: string | null;
  } = {};

  if (
    body.shares !== undefined ||
    body.avgCost !== undefined ||
    body.totalInvested !== undefined
  ) {
    result.shares = nextShares;
    result.avg_cost = nextAvg;
  }
  if (atrTriggers !== undefined) {
    result.atr_triggers_json = serializeAtrTriggers(atrTriggers);
  }

  return result;
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
  } & AssetPositionBody,
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

  const position = resolvePositionFields(body);

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
      shares: position.shares ?? null,
      avg_cost: position.avg_cost ?? null,
      atr_triggers_json: position.atr_triggers_json ?? null,
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
  } & AssetPositionBody,
) {
  const current = await getSwatchAsset(env.DB, id);
  if (!current) return null;

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

  const position = resolvePositionFields(body, {
    shares: current.shares,
    avg_cost: current.avg_cost,
  });
  if (position.shares !== undefined) patch.shares = position.shares;
  if (position.avg_cost !== undefined) patch.avg_cost = position.avg_cost;
  if (position.atr_triggers_json !== undefined) {
    patch.atr_triggers_json = position.atr_triggers_json;
  }

  // Final consistency: if triggers remain after patch, shares+cost must exist.
  const nextShares =
    patch.shares !== undefined ? patch.shares : current.shares;
  const nextAvg =
    patch.avg_cost !== undefined ? patch.avg_cost : current.avg_cost;
  const nextTriggers = parseAtrTriggersJson(
    patch.atr_triggers_json !== undefined
      ? patch.atr_triggers_json
      : current.atr_triggers_json,
  );
  if (
    nextTriggers.length > 0 &&
    (nextShares == null ||
      nextAvg == null ||
      nextShares <= 0 ||
      nextAvg <= 0)
  ) {
    throw new Error(
      "ATR triggers require shares > 0 and a cost basis (avgCost or totalInvested)",
    );
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

  const now = new Date();
  const [sessions, assets] = await Promise.all([
    listExchangeSessions(env.DB),
    listEnabledSwatchAssets(env.DB),
  ]);
  const anyOpen = assets.some((asset) => {
    const session = sessions.get(asset.exchange);
    return session ? isExchangeSessionOpen(session, now) : false;
  });
  if (!anyOpen) return 0;

  try {
    await startSwatchRun(env, "cron");
    return 1;
  } catch (error) {
    console.error("Failed to start SWATCH cron run:", error);
    return 0;
  }
}

type PendingAlert = SwatchAlertLine & { assetId: string };

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
    const [assets, sessions] = await Promise.all([
      listEnabledSwatchAssets(env.DB),
      listExchangeSessions(env.DB),
    ]);
    const pendingAlerts: PendingAlert[] = [];

    let succeeded = 0;
    let failed = 0;
    const asOf = nowIso();
    const nowMs = Date.now();
    const now = new Date(nowMs);

    for (const asset of assets) {
      const session = sessions.get(asset.exchange);
      if (!session || !isExchangeSessionOpen(session, now)) {
        continue;
      }

      try {
        const direction = isSwatchDirection(asset.direction)
          ? asset.direction
          : "either";
        const range = chartRangeForWindow(asset.window_hours);
        const chart = await market.getChart(
          { symbol: asset.symbol, exchange: asset.exchange },
          { interval: "1h", range },
        );
        const move = evaluateCloseToClose(chart.bars, asset.window_hours);
        if (!move) {
          throw new Error(
            chart.bars.length < 2
              ? `Yahoo returned ${chart.bars.length} hourly bar(s) — need at least 2 closes`
              : "Could not span the window with available hourly closes",
          );
        }

        const moveBreached = moveBreachesThreshold(
          move.movePct,
          asset.threshold_pct,
          direction,
        );
        const cooling = isInCooldown(
          asset.last_alerted_at,
          asset.cooldown_minutes,
          nowMs,
        );

        const triggers = parseAtrTriggersJson(asset.atr_triggers_json);
        const atrPosition =
          asset.shares != null && asset.avg_cost != null
            ? computeAtrPosition(asset.shares, asset.avg_cost, move.endClose)
            : null;
        const atrTrigger =
          atrPosition && triggers.length > 0
            ? findBreachedAtrTrigger(atrPosition, triggers)
            : null;

        await updateSwatchAsset(env.DB, asset.id, {
          last_checked_at: asOf,
          last_close: move.endClose,
          last_move_pct: move.movePct,
          last_atr_pnl: atrPosition?.pnl ?? null,
          last_atr_pct: atrPosition?.pct ?? null,
          last_error: null,
        });

        if (!cooling) {
          if (moveBreached) {
            pendingAlerts.push({
              assetId: asset.id,
              kind: "move",
              symbol: asset.symbol,
              exchange: asset.exchange,
              movePct: move.movePct,
              windowHours: asset.window_hours,
              thresholdPct: asset.threshold_pct,
            });
          }
          if (atrTrigger && atrPosition) {
            pendingAlerts.push({
              assetId: asset.id,
              kind: "atr",
              symbol: asset.symbol,
              exchange: asset.exchange,
              pnl: atrPosition.pnl,
              pct: atrPosition.pct,
              shares: atrPosition.shares,
              avgCost: atrPosition.avgCost,
              triggerUnit: atrTrigger.unit,
              triggerValue: atrTrigger.value,
            });
          }
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
        const byAsset = new Map<
          string,
          { movePct?: number; kinds: Set<string> }
        >();
        for (const line of pendingAlerts) {
          const entry = byAsset.get(line.assetId) ?? {
            kinds: new Set<string>(),
          };
          entry.kinds.add(line.kind);
          if (line.kind === "move") entry.movePct = line.movePct;
          byAsset.set(line.assetId, entry);
        }
        for (const [assetId, entry] of byAsset) {
          const kind =
            entry.kinds.has("move") && entry.kinds.has("atr")
              ? "both"
              : entry.kinds.has("atr")
                ? "atr"
                : "move";
          await updateSwatchAsset(env.DB, assetId, {
            last_alerted_at: asOf,
            last_alert_move_pct:
              entry.movePct !== undefined ? entry.movePct : undefined,
            last_alert_kind: kind,
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
