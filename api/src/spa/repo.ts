import type {
  SpaApiCall,
  SpaExchangeRow,
  SpaPricePoint,
  SpaRunPageRow,
  SpaRunRow,
  SpaRunStatus,
  SpaRunTrigger,
  SpaSampleRow,
} from "./types";
import { decodeSpaPricesColumn, encodeSpaPricesColumn } from "./gzip";
import { assertSpaPricesJsonSize, nowIso } from "./types";

export async function listSpaExchanges(
  db: D1Database,
): Promise<SpaExchangeRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM spa_exchanges
       ORDER BY CASE code
         WHEN 'BINANCE' THEN 1
         WHEN 'TOR' THEN 2
         WHEN 'VAN' THEN 3
         WHEN 'NYQ' THEN 4
         WHEN 'NMS' THEN 5
         WHEN 'ASE' THEN 6
         WHEN 'PCX' THEN 7
         ELSE 99
       END`,
    )
    .all<SpaExchangeRow>();
  return result.results ?? [];
}

export async function getSpaExchange(
  db: D1Database,
  id: string,
): Promise<SpaExchangeRow | null> {
  return db
    .prepare(`SELECT * FROM spa_exchanges WHERE id = ?`)
    .bind(id)
    .first<SpaExchangeRow>();
}

export async function updateSpaExchange(
  db: D1Database,
  id: string,
  patch: {
    enabled?: number;
    interval_minutes?: number;
    retention_days?: number;
    enabled_quote_assets?: string | null;
    timezone?: string;
    open_local?: string;
    close_local?: string;
    include_weekends?: number;
    next_run_at?: string | null;
    last_run_at?: string | null;
    last_run_status?: string | null;
    last_run_error?: string | null;
    last_run_scanned?: number | null;
    last_sample_id?: string | null;
  },
): Promise<SpaExchangeRow | null> {
  const current = await getSpaExchange(db, id);
  if (!current) return null;

  const updatedAt = nowIso();
  await db
    .prepare(
      `UPDATE spa_exchanges SET
         enabled = ?,
         interval_minutes = ?,
         retention_days = ?,
         enabled_quote_assets = ?,
         timezone = ?,
         open_local = ?,
         close_local = ?,
         include_weekends = ?,
         next_run_at = ?,
         last_run_at = ?,
         last_run_status = ?,
         last_run_error = ?,
         last_run_scanned = ?,
         last_sample_id = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      patch.enabled ?? current.enabled,
      patch.interval_minutes ?? current.interval_minutes,
      patch.retention_days ?? current.retention_days,
      patch.enabled_quote_assets !== undefined
        ? patch.enabled_quote_assets
        : current.enabled_quote_assets,
      patch.timezone ?? current.timezone,
      patch.open_local ?? current.open_local,
      patch.close_local ?? current.close_local,
      patch.include_weekends !== undefined
        ? patch.include_weekends
        : current.include_weekends,
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
      patch.last_sample_id !== undefined
        ? patch.last_sample_id
        : current.last_sample_id,
      updatedAt,
      id,
    )
    .run();

  return getSpaExchange(db, id);
}

export async function listDueSpaExchanges(
  db: D1Database,
  now: string,
): Promise<SpaExchangeRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM spa_exchanges
       WHERE enabled = 1
         AND next_run_at IS NOT NULL
         AND next_run_at <= ?`,
    )
    .bind(now)
    .all<SpaExchangeRow>();
  return result.results ?? [];
}

export async function getActiveSpaRun(
  db: D1Database,
  exchangeId: string,
): Promise<SpaRunRow | null> {
  return db
    .prepare(
      `SELECT * FROM spa_runs
       WHERE exchange_id = ? AND status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(exchangeId)
    .first<SpaRunRow>();
}

export async function getSpaRun(
  db: D1Database,
  runId: string,
): Promise<SpaRunRow | null> {
  return db
    .prepare(`SELECT * FROM spa_runs WHERE id = ?`)
    .bind(runId)
    .first<SpaRunRow>();
}

export async function createSpaRun(
  db: D1Database,
  input: {
    id: string;
    exchangeId: string;
    trigger: SpaRunTrigger;
    pageSize: number;
  },
): Promise<SpaRunRow> {
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO spa_runs (
         id, exchange_id, status, trigger, offset, page_size,
         scanned, pages, sample_id, calls_json, error,
         started_at, finished_at, created_at, updated_at
       ) VALUES (?, ?, 'queued', ?, 0, ?, 0, 0, NULL, '[]', NULL, NULL, NULL, ?, ?)`,
    )
    .bind(
      input.id,
      input.exchangeId,
      input.trigger,
      input.pageSize,
      createdAt,
      createdAt,
    )
    .run();

  const run = await getSpaRun(db, input.id);
  if (!run) throw new Error("Failed to create SPA run");
  return run;
}

export async function updateSpaRun(
  db: D1Database,
  runId: string,
  patch: Partial<{
    status: SpaRunStatus;
    offset: number;
    scanned: number;
    pages: number;
    sample_id: string | null;
    calls_json: string | null;
    error: string | null;
    started_at: string | null;
    finished_at: string | null;
  }>,
): Promise<void> {
  const current = await getSpaRun(db, runId);
  if (!current) return;

  await db
    .prepare(
      `UPDATE spa_runs SET
         status = ?,
         offset = ?,
         scanned = ?,
         pages = ?,
         sample_id = ?,
         calls_json = ?,
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
      patch.pages ?? current.pages,
      patch.sample_id !== undefined ? patch.sample_id : current.sample_id,
      patch.calls_json !== undefined ? patch.calls_json : current.calls_json,
      patch.error !== undefined ? patch.error : current.error,
      patch.started_at !== undefined ? patch.started_at : current.started_at,
      patch.finished_at !== undefined ? patch.finished_at : current.finished_at,
      nowIso(),
      runId,
    )
    .run();
}

export async function insertSpaRunPage(
  db: D1Database,
  input: {
    id: string;
    runId: string;
    pageOffset: number;
    quotes: SpaPricePoint[];
    call: SpaApiCall;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO spa_run_pages (
         id, run_id, page_offset, quotes_json, call_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, page_offset) DO UPDATE SET
         quotes_json = excluded.quotes_json,
         call_json = excluded.call_json`,
    )
    .bind(
      input.id,
      input.runId,
      input.pageOffset,
      JSON.stringify(input.quotes),
      JSON.stringify(input.call),
      nowIso(),
    )
    .run();
}

export async function listSpaRunPages(
  db: D1Database,
  runId: string,
): Promise<SpaRunPageRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM spa_run_pages
       WHERE run_id = ?
       ORDER BY page_offset ASC`,
    )
    .bind(runId)
    .all<SpaRunPageRow>();
  return result.results ?? [];
}

export async function deleteSpaRunPages(
  db: D1Database,
  runId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM spa_run_pages WHERE run_id = ?`)
    .bind(runId)
    .run();
}

export async function insertSpaSample(
  db: D1Database,
  input: {
    id: string;
    exchangeId: string;
    runId: string;
    sampledAt: string;
    prices: SpaPricePoint[];
    calls: SpaApiCall[];
  },
): Promise<SpaSampleRow> {
  const createdAt = nowIso();
  const pricesJson = JSON.stringify(input.prices);
  assertSpaPricesJsonSize(pricesJson);
  const pricesColumn = await encodeSpaPricesColumn(pricesJson);
  await db
    .prepare(
      `INSERT INTO spa_samples (
         id, exchange_id, run_id, sampled_at, symbol_count,
         prices_json, calls_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.exchangeId,
      input.runId,
      input.sampledAt,
      input.prices.length,
      pricesColumn,
      JSON.stringify(input.calls),
      createdAt,
    )
    .run();

  const row = await getSpaSample(db, input.id);
  if (!row) throw new Error("Failed to create SPA sample");
  return row;
}

export async function getSpaSample(
  db: D1Database,
  sampleId: string,
): Promise<SpaSampleRow | null> {
  const row = await db
    .prepare(`SELECT * FROM spa_samples WHERE id = ?`)
    .bind(sampleId)
    .first<SpaSampleRow>();
  return inflateSamplePrices(row);
}

export async function getLatestSpaSample(
  db: D1Database,
  exchangeId: string,
): Promise<SpaSampleRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM spa_samples
       WHERE exchange_id = ?
       ORDER BY sampled_at DESC, created_at DESC
       LIMIT 1`,
    )
    .bind(exchangeId)
    .first<SpaSampleRow>();
  return inflateSamplePrices(row);
}

async function inflateSamplePrices(
  row: SpaSampleRow | null,
): Promise<SpaSampleRow | null> {
  if (!row) return null;
  const json = await decodeSpaPricesColumn(row.prices_json);
  return { ...row, prices_json: json ?? "[]" };
}

/** Write notebooks (and gzip) onto an existing sample. */
export async function updateSpaSamplePrices(
  db: D1Database,
  sampleId: string,
  prices: SpaPricePoint[],
): Promise<void> {
  const pricesJson = JSON.stringify(prices);
  assertSpaPricesJsonSize(pricesJson);
  const pricesColumn = await encodeSpaPricesColumn(pricesJson);
  await db
    .prepare(
      `UPDATE spa_samples SET prices_json = ?, symbol_count = ? WHERE id = ?`,
    )
    .bind(pricesColumn, prices.length, sampleId)
    .run();
}

export async function listSpaSamples(
  db: D1Database,
  exchangeId: string,
  limit = 20,
): Promise<SpaSampleRow[]> {
  const result = await db
    .prepare(
      `SELECT id, exchange_id, run_id, sampled_at, symbol_count,
              NULL AS prices_json, calls_json, created_at
       FROM spa_samples
       WHERE exchange_id = ?
       ORDER BY sampled_at DESC
       LIMIT ?`,
    )
    .bind(exchangeId, Math.min(Math.max(limit, 1), 100))
    .all<SpaSampleRow>();
  return result.results ?? [];
}

/** Full samples oldest→newest (includes prices_json). For HISS archive replay. */
export async function listSpaSamplesChronological(
  db: D1Database,
  exchangeId: string,
): Promise<SpaSampleRow[]> {
  const result = await db
    .prepare(
      `SELECT id, exchange_id, run_id, sampled_at, symbol_count,
              prices_json, calls_json, created_at
       FROM spa_samples
       WHERE exchange_id = ?
       ORDER BY sampled_at ASC, created_at ASC`,
    )
    .bind(exchangeId)
    .all<SpaSampleRow>();
  const rows = result.results ?? [];
  return Promise.all(
    rows.map(async (row) => (await inflateSamplePrices(row)) ?? row),
  );
}

export async function countSpaSamples(
  db: D1Database,
  exchangeId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM spa_samples WHERE exchange_id = ?`,
    )
    .bind(exchangeId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** Drop samples older than retention window for one exchange. */
export async function purgeOldSpaSamples(
  db: D1Database,
  exchangeId: string,
  cutoffIso: string,
): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM spa_samples
       WHERE exchange_id = ?
         AND sampled_at < ?`,
    )
    .bind(exchangeId, cutoffIso)
    .run();
  return result.meta.changes ?? 0;
}
