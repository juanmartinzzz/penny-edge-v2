import {
  nowIso,
  type SwatchAssetRow,
  type SwatchConfigRow,
  type SwatchRunRow,
  type SwatchRunStatus,
  type SwatchRunTrigger,
} from "./types";

const CONFIG_ID = "default";

export async function getSwatchConfig(
  db: D1Database,
): Promise<SwatchConfigRow | null> {
  return db
    .prepare(`SELECT * FROM swatch_config WHERE id = ?`)
    .bind(CONFIG_ID)
    .first<SwatchConfigRow>();
}

export async function updateSwatchConfig(
  db: D1Database,
  patch: {
    enabled?: number;
    interval_hours?: number;
    next_run_at?: string | null;
    last_run_at?: string | null;
    last_run_status?: string | null;
    last_run_error?: string | null;
    last_run_scanned?: number | null;
    last_run_ok?: number | null;
    last_run_failed?: number | null;
    last_run_alerted?: number | null;
  },
): Promise<SwatchConfigRow | null> {
  const current = await getSwatchConfig(db);
  if (!current) return null;

  const updatedAt = nowIso();
  await db
    .prepare(
      `UPDATE swatch_config SET
         enabled = ?,
         interval_hours = ?,
         next_run_at = ?,
         last_run_at = ?,
         last_run_status = ?,
         last_run_error = ?,
         last_run_scanned = ?,
         last_run_ok = ?,
         last_run_failed = ?,
         last_run_alerted = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.enabled ?? current.enabled,
      patch.interval_hours ?? current.interval_hours,
      patch.next_run_at !== undefined ? patch.next_run_at : current.next_run_at,
      patch.last_run_at !== undefined ? patch.last_run_at : current.last_run_at,
      patch.last_run_status !== undefined
        ? patch.last_run_status
        : current.last_run_status,
      patch.last_run_error !== undefined
        ? patch.last_run_error
        : current.last_run_error,
      patch.last_run_scanned !== undefined
        ? patch.last_run_scanned
        : current.last_run_scanned,
      patch.last_run_ok !== undefined ? patch.last_run_ok : current.last_run_ok,
      patch.last_run_failed !== undefined
        ? patch.last_run_failed
        : current.last_run_failed,
      patch.last_run_alerted !== undefined
        ? patch.last_run_alerted
        : current.last_run_alerted,
      updatedAt,
      CONFIG_ID,
    )
    .run();

  return getSwatchConfig(db);
}

export async function isSwatchDue(
  db: D1Database,
  asOf: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM swatch_config
       WHERE id = ?
         AND enabled = 1
         AND next_run_at IS NOT NULL
         AND next_run_at <= ?`,
    )
    .bind(CONFIG_ID, asOf)
    .first<{ id: string }>();
  return Boolean(row);
}

export async function listSwatchAssets(
  db: D1Database,
): Promise<SwatchAssetRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM swatch_assets
       ORDER BY enabled DESC, symbol ASC, exchange ASC`,
    )
    .all<SwatchAssetRow>();
  return result.results ?? [];
}

export async function listEnabledSwatchAssets(
  db: D1Database,
): Promise<SwatchAssetRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM swatch_assets
       WHERE enabled = 1
       ORDER BY symbol ASC, exchange ASC`,
    )
    .all<SwatchAssetRow>();
  return result.results ?? [];
}

export async function getSwatchAsset(
  db: D1Database,
  id: string,
): Promise<SwatchAssetRow | null> {
  return db
    .prepare(`SELECT * FROM swatch_assets WHERE id = ?`)
    .bind(id)
    .first<SwatchAssetRow>();
}

export async function insertSwatchAsset(
  db: D1Database,
  input: {
    id: string;
    symbol: string;
    exchange: string;
    enabled: number;
    threshold_pct: number;
    window_hours: number;
    direction: string;
    cooldown_minutes: number;
    shares?: number | null;
    avg_cost?: number | null;
    atr_triggers_json?: string | null;
  },
): Promise<SwatchAssetRow> {
  const at = nowIso();
  await db
    .prepare(
      `INSERT INTO swatch_assets (
         id, symbol, exchange, enabled,
         threshold_pct, window_hours, direction, cooldown_minutes,
         shares, avg_cost, atr_triggers_json,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.symbol,
      input.exchange,
      input.enabled,
      input.threshold_pct,
      input.window_hours,
      input.direction,
      input.cooldown_minutes,
      input.shares ?? null,
      input.avg_cost ?? null,
      input.atr_triggers_json ?? null,
      at,
      at,
    )
    .run();

  const row = await getSwatchAsset(db, input.id);
  if (!row) throw new Error("Failed to create SWATCH asset");
  return row;
}

export async function updateSwatchAsset(
  db: D1Database,
  id: string,
  patch: {
    enabled?: number;
    threshold_pct?: number;
    window_hours?: number;
    direction?: string;
    cooldown_minutes?: number;
    shares?: number | null;
    avg_cost?: number | null;
    atr_triggers_json?: string | null;
    last_checked_at?: string | null;
    last_close?: number | null;
    last_move_pct?: number | null;
    last_atr_pnl?: number | null;
    last_atr_pct?: number | null;
    last_alerted_at?: string | null;
    last_alert_move_pct?: number | null;
    last_alert_kind?: string | null;
    last_error?: string | null;
  },
): Promise<SwatchAssetRow | null> {
  const current = await getSwatchAsset(db, id);
  if (!current) return null;

  const updatedAt = nowIso();
  await db
    .prepare(
      `UPDATE swatch_assets SET
         enabled = ?,
         threshold_pct = ?,
         window_hours = ?,
         direction = ?,
         cooldown_minutes = ?,
         shares = ?,
         avg_cost = ?,
         atr_triggers_json = ?,
         last_checked_at = ?,
         last_close = ?,
         last_move_pct = ?,
         last_atr_pnl = ?,
         last_atr_pct = ?,
         last_alerted_at = ?,
         last_alert_move_pct = ?,
         last_alert_kind = ?,
         last_error = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.enabled ?? current.enabled,
      patch.threshold_pct ?? current.threshold_pct,
      patch.window_hours ?? current.window_hours,
      patch.direction ?? current.direction,
      patch.cooldown_minutes ?? current.cooldown_minutes,
      patch.shares !== undefined ? patch.shares : current.shares,
      patch.avg_cost !== undefined ? patch.avg_cost : current.avg_cost,
      patch.atr_triggers_json !== undefined
        ? patch.atr_triggers_json
        : current.atr_triggers_json,
      patch.last_checked_at !== undefined
        ? patch.last_checked_at
        : current.last_checked_at,
      patch.last_close !== undefined ? patch.last_close : current.last_close,
      patch.last_move_pct !== undefined
        ? patch.last_move_pct
        : current.last_move_pct,
      patch.last_atr_pnl !== undefined
        ? patch.last_atr_pnl
        : current.last_atr_pnl,
      patch.last_atr_pct !== undefined
        ? patch.last_atr_pct
        : current.last_atr_pct,
      patch.last_alerted_at !== undefined
        ? patch.last_alerted_at
        : current.last_alerted_at,
      patch.last_alert_move_pct !== undefined
        ? patch.last_alert_move_pct
        : current.last_alert_move_pct,
      patch.last_alert_kind !== undefined
        ? patch.last_alert_kind
        : current.last_alert_kind,
      patch.last_error !== undefined ? patch.last_error : current.last_error,
      updatedAt,
      id,
    )
    .run();

  return getSwatchAsset(db, id);
}

export async function deleteSwatchAsset(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM swatch_assets WHERE id = ?`)
    .bind(id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function countSwatchAssets(db: D1Database): Promise<{
  total: number;
  enabled: number;
}> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) AS enabled
       FROM swatch_assets`,
    )
    .first<{ total: number; enabled: number }>();
  return {
    total: Number(row?.total ?? 0),
    enabled: Number(row?.enabled ?? 0),
  };
}

export async function getActiveSwatchRun(
  db: D1Database,
): Promise<SwatchRunRow | null> {
  return db
    .prepare(
      `SELECT * FROM swatch_runs
       WHERE status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .first<SwatchRunRow>();
}

export async function getSwatchRun(
  db: D1Database,
  id: string,
): Promise<SwatchRunRow | null> {
  return db
    .prepare(`SELECT * FROM swatch_runs WHERE id = ?`)
    .bind(id)
    .first<SwatchRunRow>();
}

export async function createSwatchRun(
  db: D1Database,
  input: { id: string; trigger: SwatchRunTrigger },
): Promise<SwatchRunRow> {
  const at = nowIso();
  await db
    .prepare(
      `INSERT INTO swatch_runs (
         id, status, trigger, scanned, succeeded, failed, alerted,
         created_at, updated_at
       ) VALUES (?, 'queued', ?, 0, 0, 0, 0, ?, ?)`,
    )
    .bind(input.id, input.trigger, at, at)
    .run();

  const row = await getSwatchRun(db, input.id);
  if (!row) throw new Error("Failed to create SWATCH run");
  return row;
}

export async function updateSwatchRun(
  db: D1Database,
  id: string,
  patch: {
    status?: SwatchRunStatus;
    scanned?: number;
    succeeded?: number;
    failed?: number;
    alerted?: number;
    error?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
  },
): Promise<SwatchRunRow | null> {
  const current = await getSwatchRun(db, id);
  if (!current) return null;

  const updatedAt = nowIso();
  await db
    .prepare(
      `UPDATE swatch_runs SET
         status = ?,
         scanned = ?,
         succeeded = ?,
         failed = ?,
         alerted = ?,
         error = ?,
         started_at = ?,
         finished_at = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.status ?? current.status,
      patch.scanned ?? current.scanned,
      patch.succeeded ?? current.succeeded,
      patch.failed ?? current.failed,
      patch.alerted ?? current.alerted,
      patch.error !== undefined ? patch.error : current.error,
      patch.started_at !== undefined ? patch.started_at : current.started_at,
      patch.finished_at !== undefined ? patch.finished_at : current.finished_at,
      updatedAt,
      id,
    )
    .run();

  return getSwatchRun(db, id);
}
