import type { JobRunKind, JobRunListRow, JobRunStatus } from "./types";

export type JobRunListFilters = {
  kind?: JobRunKind;
  status?: JobRunStatus;
  limit: number;
  offset: number;
};

const UNION_SQL = `
  SELECT
    r.id AS id,
    'evg' AS kind,
    'evg:' || lower(s.code) AS slug,
    s.code AS exchange_code,
    s.label AS exchange_label,
    r.scanner_id AS scanner_id,
    r.status AS status,
    r.trigger AS trigger,
    r.offset AS offset,
    r.page_size AS page_size,
    r.scanned AS scanned,
    r.matched AS matched,
    NULL AS succeeded,
    NULL AS failed,
    r.error AS error,
    r.started_at AS started_at,
    r.finished_at AS finished_at,
    r.created_at AS created_at
  FROM scanner_runs r
  JOIN exchange_scanners s ON s.id = r.scanner_id

  UNION ALL

  SELECT
    id,
    'tas' AS kind,
    'tas' AS slug,
    NULL AS exchange_code,
    NULL AS exchange_label,
    NULL AS scanner_id,
    status,
    trigger,
    offset,
    page_size,
    scanned,
    NULL AS matched,
    succeeded,
    failed,
    error,
    started_at,
    finished_at,
    created_at
  FROM analysis_runs

  UNION ALL

  SELECT
    id,
    'his' AS kind,
    'his' AS slug,
    NULL AS exchange_code,
    NULL AS exchange_label,
    NULL AS scanner_id,
    status,
    trigger,
    offset,
    page_size,
    scanned,
    NULL AS matched,
    succeeded,
    failed,
    error,
    started_at,
    finished_at,
    created_at
  FROM temperature_runs
`;

export async function listJobRuns(
  db: D1Database,
  filters: JobRunListFilters,
): Promise<{ rows: JobRunListRow[]; total: number }> {
  const where: string[] = [];
  const binds: Array<string | number> = [];

  if (filters.kind) {
    where.push("kind = ?");
    binds.push(filters.kind);
  }
  if (filters.status) {
    where.push("status = ?");
    binds.push(filters.status);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const countResult = await db
    .prepare(`SELECT COUNT(*) AS count FROM (${UNION_SQL}) AS job_runs ${whereSql}`)
    .bind(...binds)
    .first<{ count: number }>();

  const total = Number(countResult?.count ?? 0);

  const listBinds = [...binds, filters.limit, filters.offset];
  const result = await db
    .prepare(
      `SELECT * FROM (${UNION_SQL}) AS job_runs
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...listBinds)
    .all<JobRunListRow>();

  return { rows: result.results ?? [], total };
}
