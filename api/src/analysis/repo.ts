import type {
  AnalysisConfigRow,
  AnalysisRunRow,
  AnalysisRunStatus,
  AnalysisRunTrigger,
} from "./types";
import { nowIso } from "./types";
import type { WarmSymbolRow } from "../scanners/types";

const CONFIG_ID = "default";

export async function getAnalysisConfig(
  db: D1Database,
): Promise<AnalysisConfigRow | null> {
  return db
    .prepare(`SELECT * FROM analysis_config WHERE id = ?`)
    .bind(CONFIG_ID)
    .first<AnalysisConfigRow>();
}

export async function updateAnalysisConfig(
  db: D1Database,
  patch: {
    enabled?: number;
    interval_hours?: number;
    lookback_days?: number;
    roll_hours?: number;
    page_size?: number;
    next_run_at?: string | null;
    last_run_at?: string | null;
    last_run_status?: string | null;
    last_run_error?: string | null;
    last_run_scanned?: number | null;
    last_run_ok?: number | null;
    last_run_failed?: number | null;
  },
): Promise<AnalysisConfigRow | null> {
  const current = await getAnalysisConfig(db);
  if (!current) return null;

  const updatedAt = nowIso();
  await db
    .prepare(
      `UPDATE analysis_config SET
         enabled = ?,
         interval_hours = ?,
         lookback_days = ?,
         roll_hours = ?,
         page_size = ?,
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
      patch.lookback_days ?? current.lookback_days,
      patch.roll_hours ?? current.roll_hours,
      patch.page_size ?? current.page_size,
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

  return getAnalysisConfig(db);
}

export async function countAllWarmSymbols(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM warm_symbols WHERE is_warm = 1`)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countAnalyzedWarmSymbols(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM warm_symbols
       WHERE is_warm = 1 AND analysis_json IS NOT NULL`,
    )
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listWarmSymbolsPage(
  db: D1Database,
  offset: number,
  limit: number,
): Promise<WarmSymbolRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM warm_symbols
       WHERE is_warm = 1
       ORDER BY exchange ASC, symbol ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<WarmSymbolRow>();
  return result.results ?? [];
}

export async function listAllWarmSymbolsWithAnalysis(
  db: D1Database,
): Promise<WarmSymbolRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM warm_symbols
       WHERE is_warm = 1
       ORDER BY exchange ASC, symbol ASC`,
    )
    .all<WarmSymbolRow>();
  return result.results ?? [];
}

export async function updateSymbolAnalysis(
  db: D1Database,
  symbolId: string,
  input: {
    analysisJson: string;
    analyzedAt: string;
    analysisRunId: string;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE warm_symbols SET
         analysis_json = ?,
         analyzed_at = ?,
         analysis_run_id = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.analysisJson,
      input.analyzedAt,
      input.analysisRunId,
      input.analyzedAt,
      symbolId,
    )
    .run();
}

export async function getActiveAnalysisRun(
  db: D1Database,
): Promise<AnalysisRunRow | null> {
  return db
    .prepare(
      `SELECT * FROM analysis_runs
       WHERE status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .first<AnalysisRunRow>();
}

export async function getAnalysisRun(
  db: D1Database,
  runId: string,
): Promise<AnalysisRunRow | null> {
  return db
    .prepare(`SELECT * FROM analysis_runs WHERE id = ?`)
    .bind(runId)
    .first<AnalysisRunRow>();
}

export async function createAnalysisRun(
  db: D1Database,
  input: {
    id: string;
    trigger: AnalysisRunTrigger;
    pageSize: number;
  },
): Promise<AnalysisRunRow> {
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO analysis_runs (
         id, status, trigger, offset, page_size,
         scanned, succeeded, failed, error, started_at, finished_at,
         created_at, updated_at
       ) VALUES (?, 'queued', ?, 0, ?, 0, 0, 0, NULL, NULL, NULL, ?, ?)`,
    )
    .bind(input.id, input.trigger, input.pageSize, createdAt, createdAt)
    .run();

  const run = await getAnalysisRun(db, input.id);
  if (!run) throw new Error("Failed to create analysis run");
  return run;
}

export async function updateAnalysisRun(
  db: D1Database,
  runId: string,
  patch: Partial<{
    status: AnalysisRunStatus;
    offset: number;
    scanned: number;
    succeeded: number;
    failed: number;
    error: string | null;
    started_at: string | null;
    finished_at: string | null;
  }>,
): Promise<void> {
  const current = await getAnalysisRun(db, runId);
  if (!current) return;

  await db
    .prepare(
      `UPDATE analysis_runs SET
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

export async function isAnalysisDue(
  db: D1Database,
  now: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM analysis_config
       WHERE id = ?
         AND enabled = 1
         AND next_run_at IS NOT NULL
         AND next_run_at <= ?`,
    )
    .bind(CONFIG_ID, now)
    .first<{ ok: number }>();
  return Boolean(row);
}
