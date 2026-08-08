import type {
  ExchangeScannerRow,
  ScannerRunRow,
  ScannerRunStatus,
  ScannerRunTrigger,
  WarmSymbolRow,
} from "./types";
import { nowIso } from "./types";

export async function listScanners(db: D1Database): Promise<ExchangeScannerRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM exchange_scanners
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
    .all<ExchangeScannerRow>();
  return result.results ?? [];
}

export async function getScanner(
  db: D1Database,
  id: string,
): Promise<ExchangeScannerRow | null> {
  return db
    .prepare(`SELECT * FROM exchange_scanners WHERE id = ?`)
    .bind(id)
    .first<ExchangeScannerRow>();
}

export async function updateScanner(
  db: D1Database,
  id: string,
  patch: {
    enabled?: number;
    interval_hours?: number;
    min_avg_volume_10d?: number | null;
    min_approx_daily_value?: number | null;
    timezone?: string;
    open_local?: string;
    close_local?: string;
    include_weekends?: number;
    enabled_quote_assets?: string | null;
    next_run_at?: string | null;
    last_run_at?: string | null;
    last_run_status?: string | null;
    last_run_error?: string | null;
    last_run_scanned?: number | null;
    last_run_matched?: number | null;
  },
): Promise<ExchangeScannerRow | null> {
  const current = await getScanner(db, id);
  if (!current) return null;

  const updatedAt = nowIso();
  const enabled = patch.enabled ?? current.enabled;
  const intervalHours = patch.interval_hours ?? current.interval_hours;
  const minVol =
    patch.min_avg_volume_10d !== undefined
      ? patch.min_avg_volume_10d
      : current.min_avg_volume_10d;
  const minValue =
    patch.min_approx_daily_value !== undefined
      ? patch.min_approx_daily_value
      : current.min_approx_daily_value;
  const timezone = patch.timezone ?? current.timezone;
  const openLocal = patch.open_local ?? current.open_local;
  const closeLocal = patch.close_local ?? current.close_local;
  const includeWeekends =
    patch.include_weekends !== undefined
      ? patch.include_weekends
      : (current.include_weekends ?? 0);
  const enabledQuoteAssets =
    patch.enabled_quote_assets !== undefined
      ? patch.enabled_quote_assets
      : (current.enabled_quote_assets ?? null);
  const nextRunAt =
    patch.next_run_at !== undefined ? patch.next_run_at : current.next_run_at;
  const lastRunAt =
    patch.last_run_at !== undefined ? patch.last_run_at : current.last_run_at;
  const lastRunStatus =
    patch.last_run_status !== undefined
      ? patch.last_run_status
      : current.last_run_status;
  const lastRunError =
    patch.last_run_error !== undefined
      ? patch.last_run_error
      : current.last_run_error;
  const lastRunScanned =
    patch.last_run_scanned !== undefined
      ? patch.last_run_scanned
      : current.last_run_scanned;
  const lastRunMatched =
    patch.last_run_matched !== undefined
      ? patch.last_run_matched
      : current.last_run_matched;

  await db
    .prepare(
      `UPDATE exchange_scanners SET
         enabled = ?,
         interval_hours = ?,
         min_avg_volume_10d = ?,
         min_approx_daily_value = ?,
         timezone = ?,
         open_local = ?,
         close_local = ?,
         include_weekends = ?,
         enabled_quote_assets = ?,
         next_run_at = ?,
         last_run_at = ?,
         last_run_status = ?,
         last_run_error = ?,
         last_run_scanned = ?,
         last_run_matched = ?,
         updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      enabled,
      intervalHours,
      minVol,
      minValue,
      timezone,
      openLocal,
      closeLocal,
      includeWeekends,
      enabledQuoteAssets,
      nextRunAt,
      lastRunAt,
      lastRunStatus,
      lastRunError,
      lastRunScanned,
      lastRunMatched,
      updatedAt,
      id,
    )
    .run();

  return getScanner(db, id);
}

/** code → session hours for TAS / SWATCH gates. */
export async function listExchangeSessions(
  db: D1Database,
): Promise<
  Map<
    string,
    {
      timezone: string;
      openLocal: string;
      closeLocal: string;
      includeWeekends: boolean;
    }
  >
> {
  const result = await db
    .prepare(
      `SELECT code, timezone, open_local, close_local, include_weekends
       FROM exchange_scanners`,
    )
    .all<{
      code: string;
      timezone: string;
      open_local: string;
      close_local: string;
      include_weekends: number;
    }>();

  const map = new Map<
    string,
    {
      timezone: string;
      openLocal: string;
      closeLocal: string;
      includeWeekends: boolean;
    }
  >();
  for (const row of result.results ?? []) {
    map.set(row.code, {
      timezone: row.timezone,
      openLocal: row.open_local,
      closeLocal: row.close_local,
      includeWeekends: Boolean(row.include_weekends),
    });
  }
  return map;
}

export async function listDistinctWarmExchanges(
  db: D1Database,
): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT exchange AS exchange FROM warm_symbols WHERE is_warm = 1`,
    )
    .all<{ exchange: string }>();
  return (result.results ?? []).map((row) => row.exchange);
}

export async function countWarmSymbols(
  db: D1Database,
  scannerId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM warm_symbols
       WHERE scanner_id = ? AND is_warm = 1`,
    )
    .bind(scannerId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function listWarmSymbols(
  db: D1Database,
  scannerId: string,
): Promise<WarmSymbolRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM warm_symbols
       WHERE scanner_id = ? AND is_warm = 1
       ORDER BY (approx_daily_value IS NULL), approx_daily_value DESC, symbol ASC`,
    )
    .bind(scannerId)
    .all<WarmSymbolRow>();
  return result.results ?? [];
}

export async function getActiveRun(
  db: D1Database,
  scannerId: string,
): Promise<ScannerRunRow | null> {
  return db
    .prepare(
      `SELECT * FROM scanner_runs
       WHERE scanner_id = ? AND status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(scannerId)
    .first<ScannerRunRow>();
}

export async function getRun(
  db: D1Database,
  runId: string,
): Promise<ScannerRunRow | null> {
  return db
    .prepare(`SELECT * FROM scanner_runs WHERE id = ?`)
    .bind(runId)
    .first<ScannerRunRow>();
}

export async function createRun(
  db: D1Database,
  input: {
    id: string;
    scannerId: string;
    trigger: ScannerRunTrigger;
    pageSize: number;
  },
): Promise<ScannerRunRow> {
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO scanner_runs (
         id, scanner_id, status, trigger, offset, page_size,
         scanned, matched, error, started_at, finished_at, created_at, updated_at
       ) VALUES (?, ?, 'queued', ?, 0, ?, 0, 0, NULL, NULL, NULL, ?, ?)`,
    )
    .bind(
      input.id,
      input.scannerId,
      input.trigger,
      input.pageSize,
      createdAt,
      createdAt,
    )
    .run();

  const run = await getRun(db, input.id);
  if (!run) throw new Error("Failed to create scanner run");
  return run;
}

export async function updateRun(
  db: D1Database,
  runId: string,
  patch: Partial<{
    status: ScannerRunStatus;
    offset: number;
    scanned: number;
    matched: number;
    error: string | null;
    started_at: string | null;
    finished_at: string | null;
  }>,
): Promise<void> {
  const current = await getRun(db, runId);
  if (!current) return;

  await db
    .prepare(
      `UPDATE scanner_runs SET
         status = ?,
         offset = ?,
         scanned = ?,
         matched = ?,
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
      patch.matched ?? current.matched,
      patch.error !== undefined ? patch.error : current.error,
      patch.started_at !== undefined ? patch.started_at : current.started_at,
      patch.finished_at !== undefined ? patch.finished_at : current.finished_at,
      nowIso(),
      runId,
    )
    .run();
}

export async function listDueScanners(
  db: D1Database,
  now: string,
): Promise<ExchangeScannerRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM exchange_scanners
       WHERE enabled = 1
         AND next_run_at IS NOT NULL
         AND next_run_at <= ?`,
    )
    .bind(now)
    .all<ExchangeScannerRow>();
  return result.results ?? [];
}

export async function upsertWarmSymbols(
  db: D1Database,
  rows: Array<{
    id: string;
    scannerId: string;
    symbol: string;
    exchange: string;
    name: string | null;
    price: number | null;
    changePercent: number | null;
    volume: number | null;
    avgVolume10d: number | null;
    avgVolume3m: number | null;
    fiftyDayAverage: number | null;
    approxDailyValue: number | null;
    currency: string | null;
    runId: string;
    seenAt: string;
  }>,
): Promise<void> {
  if (rows.length === 0) return;

  const statements = rows.map((row) =>
    db
      .prepare(
        `INSERT INTO warm_symbols (
           id, scanner_id, symbol, exchange, name, price, change_percent,
           volume, avg_volume_10d, avg_volume_3m, fifty_day_average,
           approx_daily_value, currency, is_warm, last_seen_run_id,
           last_seen_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(scanner_id, symbol) DO UPDATE SET
           exchange = excluded.exchange,
           name = excluded.name,
           price = excluded.price,
           change_percent = excluded.change_percent,
           volume = excluded.volume,
           avg_volume_10d = excluded.avg_volume_10d,
           avg_volume_3m = excluded.avg_volume_3m,
           fifty_day_average = excluded.fifty_day_average,
           approx_daily_value = excluded.approx_daily_value,
           currency = excluded.currency,
           is_warm = 1,
           last_seen_run_id = excluded.last_seen_run_id,
           last_seen_at = excluded.last_seen_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        row.id,
        row.scannerId,
        row.symbol,
        row.exchange,
        row.name,
        row.price,
        row.changePercent,
        row.volume,
        row.avgVolume10d,
        row.avgVolume3m,
        row.fiftyDayAverage,
        row.approxDailyValue,
        row.currency,
        row.runId,
        row.seenAt,
        row.seenAt,
        row.seenAt,
      ),
  );

  await db.batch(statements);
}

export async function clearStaleWarmSymbols(
  db: D1Database,
  scannerId: string,
  runId: string,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE warm_symbols
       SET is_warm = 0, updated_at = ?
       WHERE scanner_id = ?
         AND is_warm = 1
         AND (last_seen_run_id IS NULL OR last_seen_run_id != ?)`,
    )
    .bind(nowIso(), scannerId, runId)
    .run();

  return result.meta.changes ?? 0;
}
