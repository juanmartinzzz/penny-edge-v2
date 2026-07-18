import type {
  TemperatureConfigRow,
  TemperatureParams,
  TemperatureRunRow,
  TemperatureRunStatus,
  TemperatureRunTrigger,
} from "./types";
import {
  nowIso,
  parseTemperatureParams,
  serializeTemperatureParams,
} from "./types";
import type { WarmSymbolRow } from "../scanners/types";

const CONFIG_ID = "default";

export async function getTemperatureConfig(
  db: D1Database,
): Promise<TemperatureConfigRow | null> {
  return db
    .prepare(`SELECT * FROM temperature_config WHERE id = ?`)
    .bind(CONFIG_ID)
    .first<TemperatureConfigRow>();
}

export async function updateTemperatureConfig(
  db: D1Database,
  patch: {
    enabled?: number;
    interval_hours?: number;
    page_size?: number;
    params?: TemperatureParams;
    next_run_at?: string | null;
    last_run_at?: string | null;
    last_run_status?: string | null;
    last_run_error?: string | null;
    last_run_scanned?: number | null;
    last_run_ok?: number | null;
    last_run_failed?: number | null;
  },
): Promise<TemperatureConfigRow | null> {
  const current = await getTemperatureConfig(db);
  if (!current) return null;

  const updatedAt = nowIso();
  const paramsJson = patch.params
    ? serializeTemperatureParams(patch.params)
    : current.params_json;

  await db
    .prepare(
      `UPDATE temperature_config SET
         enabled = ?,
         interval_hours = ?,
         page_size = ?,
         params_json = ?,
         next_run_at = ?,
         last_run_at = ?,
         last_run_status = ?,
         last_run_error = ?,
         last_run_scanned = ?,
         last_run_ok = ?,
         last_run_failed = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.enabled ?? current.enabled,
      patch.interval_hours ?? current.interval_hours,
      patch.page_size ?? current.page_size,
      paramsJson,
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
      updatedAt,
      CONFIG_ID,
    )
    .run();

  return getTemperatureConfig(db);
}

export function configParams(config: TemperatureConfigRow): TemperatureParams {
  return parseTemperatureParams(config.params_json);
}

export async function countScoredWarmSymbols(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM warm_symbols
       WHERE is_warm = 1 AND temperature IS NOT NULL`,
    )
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countWarmWithAnalysis(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM warm_symbols
       WHERE is_warm = 1 AND analysis_json IS NOT NULL`,
    )
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listWarmSymbolsWithAnalysisPage(
  db: D1Database,
  offset: number,
  limit: number,
): Promise<WarmSymbolRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM warm_symbols
       WHERE is_warm = 1 AND analysis_json IS NOT NULL
       ORDER BY exchange ASC, symbol ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<WarmSymbolRow>();
  return result.results ?? [];
}

export async function listAllWarmSymbolsWithTemperature(
  db: D1Database,
): Promise<WarmSymbolRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM warm_symbols
       WHERE is_warm = 1
       ORDER BY
         CASE WHEN temperature IS NULL THEN 1 ELSE 0 END,
         temperature DESC,
         exchange ASC,
         symbol ASC`,
    )
    .all<WarmSymbolRow>();
  return result.results ?? [];
}

export async function updateSymbolTemperature(
  db: D1Database,
  symbolId: string,
  input: {
    temperature: number | null;
    componentsJson: string;
    temperatureAt: string;
    temperatureRunId: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE warm_symbols SET
         temperature = ?,
         temperature_components_json = ?,
         temperature_at = ?,
         temperature_run_id = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.temperature,
      input.componentsJson,
      input.temperatureAt,
      input.temperatureRunId,
      input.temperatureAt,
      symbolId,
    )
    .run();
}

export async function getActiveTemperatureRun(
  db: D1Database,
): Promise<TemperatureRunRow | null> {
  return db
    .prepare(
      `SELECT * FROM temperature_runs
       WHERE status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .first<TemperatureRunRow>();
}

export async function getTemperatureRun(
  db: D1Database,
  runId: string,
): Promise<TemperatureRunRow | null> {
  return db
    .prepare(`SELECT * FROM temperature_runs WHERE id = ?`)
    .bind(runId)
    .first<TemperatureRunRow>();
}

export async function createTemperatureRun(
  db: D1Database,
  input: {
    id: string;
    trigger: TemperatureRunTrigger;
    pageSize: number;
  },
): Promise<TemperatureRunRow> {
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO temperature_runs (
         id, status, trigger, offset, page_size,
         scanned, succeeded, failed, error, started_at, finished_at,
         created_at, updated_at
       ) VALUES (?, 'queued', ?, 0, ?, 0, 0, 0, NULL, NULL, NULL, ?, ?)`,
    )
    .bind(input.id, input.trigger, input.pageSize, createdAt, createdAt)
    .run();

  const run = await getTemperatureRun(db, input.id);
  if (!run) throw new Error("Failed to create temperature run");
  return run;
}

export async function updateTemperatureRun(
  db: D1Database,
  runId: string,
  patch: Partial<{
    status: TemperatureRunStatus;
    offset: number;
    scanned: number;
    succeeded: number;
    failed: number;
    error: string | null;
    started_at: string | null;
    finished_at: string | null;
  }>,
): Promise<void> {
  const current = await getTemperatureRun(db, runId);
  if (!current) return;

  await db
    .prepare(
      `UPDATE temperature_runs SET
         status = ?,
         offset = ?,
         scanned = ?,
         succeeded = ?,
         failed = ?,
         error = ?,
         started_at = ?,
         finished_at = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.status ?? current.status,
      patch.offset ?? current.offset,
      patch.scanned ?? current.scanned,
      patch.succeeded ?? current.succeeded,
      patch.failed ?? current.failed,
      patch.error !== undefined ? patch.error : current.error,
      patch.started_at !== undefined ? patch.started_at : current.started_at,
      patch.finished_at !== undefined ? patch.finished_at : current.finished_at,
      nowIso(),
      runId,
    )
    .run();
}

export async function isTemperatureDue(
  db: D1Database,
  now: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM temperature_config
       WHERE id = ?
         AND enabled = 1
         AND next_run_at IS NOT NULL
         AND next_run_at <= ?`,
    )
    .bind(CONFIG_ID, now)
    .first<{ ok: number }>();
  return Boolean(row);
}
