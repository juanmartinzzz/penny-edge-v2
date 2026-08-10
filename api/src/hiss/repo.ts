/**
 * HISS D1 repository.
 */
import type { HissSymbolRow } from "./types";

export async function listHissSymbolsForExchange(
  db: D1Database,
  exchangeId: string,
): Promise<HissSymbolRow[]> {
  const result = await db
    .prepare(`SELECT * FROM hiss_symbols WHERE exchange_id = ?`)
    .bind(exchangeId)
    .all<HissSymbolRow>();
  return result.results ?? [];
}

export async function clearAllHissSymbols(db: D1Database): Promise<number> {
  const result = await db.prepare(`DELETE FROM hiss_symbols`).run();
  return result.meta.changes ?? 0;
}

export async function countHissSymbols(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM hiss_symbols`)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function countHissSymbolsByExchange(
  db: D1Database,
): Promise<Array<{ exchange_id: string; exchange_code: string; count: number }>> {
  const result = await db
    .prepare(
      `SELECT exchange_id, exchange_code, COUNT(*) AS count
       FROM hiss_symbols
       GROUP BY exchange_id, exchange_code
       ORDER BY exchange_code ASC`,
    )
    .all<{ exchange_id: string; exchange_code: string; count: number }>();
  return result.results ?? [];
}

export async function getHissLatestUpdatedAt(
  db: D1Database,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT MAX(updated_at) AS max_at FROM hiss_symbols`)
    .first<{ max_at: string | null }>();
  return row?.max_at ?? null;
}

export type HissListFilters = {
  exchangeId?: string;
  minAvgVolume10d?: number;
  minVolumeLastFullDay?: number;
  limit?: number;
  offset?: number;
};

export async function listHissSymbolsFiltered(
  db: D1Database,
  filters: HissListFilters,
): Promise<HissSymbolRow[]> {
  const clauses: string[] = [];
  const binds: Array<string | number> = [];

  if (filters.exchangeId) {
    clauses.push("exchange_id = ?");
    binds.push(filters.exchangeId);
  }
  if (
    filters.minAvgVolume10d != null &&
    Number.isFinite(filters.minAvgVolume10d)
  ) {
    clauses.push("avg_volume_10d IS NOT NULL AND avg_volume_10d >= ?");
    binds.push(filters.minAvgVolume10d);
  }
  if (
    filters.minVolumeLastFullDay != null &&
    Number.isFinite(filters.minVolumeLastFullDay)
  ) {
    clauses.push(
      "volume_last_full_day IS NOT NULL AND volume_last_full_day >= ?",
    );
    binds.push(filters.minVolumeLastFullDay);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filters.limit ?? 500, 1), 2000);
  const offset = Math.max(filters.offset ?? 0, 0);

  const result = await db
    .prepare(
      `SELECT * FROM hiss_symbols
       ${where}
       ORDER BY
         CASE WHEN temperature IS NULL THEN 1 ELSE 0 END,
         temperature DESC,
         exchange_code ASC,
         symbol ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all<HissSymbolRow>();
  return result.results ?? [];
}

export async function countHissSymbolsFiltered(
  db: D1Database,
  filters: Omit<HissListFilters, "limit" | "offset">,
): Promise<number> {
  const clauses: string[] = [];
  const binds: Array<string | number> = [];

  if (filters.exchangeId) {
    clauses.push("exchange_id = ?");
    binds.push(filters.exchangeId);
  }
  if (
    filters.minAvgVolume10d != null &&
    Number.isFinite(filters.minAvgVolume10d)
  ) {
    clauses.push("avg_volume_10d IS NOT NULL AND avg_volume_10d >= ?");
    binds.push(filters.minAvgVolume10d);
  }
  if (
    filters.minVolumeLastFullDay != null &&
    Number.isFinite(filters.minVolumeLastFullDay)
  ) {
    clauses.push(
      "volume_last_full_day IS NOT NULL AND volume_last_full_day >= ?",
    );
    binds.push(filters.minVolumeLastFullDay);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM hiss_symbols ${where}`)
    .bind(...binds)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export type HissUpsertInput = {
  id: string;
  exchangeId: string;
  exchangeCode: string;
  symbol: string;
  name: string | null;
  lastPrice: number | null;
  lastVolume: number | null;
  lastSampleAt: string;
  lastSampleId: string;
  volumeLastFullDay: number | null;
  avgVolume10d: number | null;
  volumeCoverageDays: number;
  temperature: number | null;
  temperatureComponentsJson: string | null;
  temperatureAt: string | null;
  memoryJson: string;
  createdAt: string;
  updatedAt: string;
};

const UPSERT_SQL = `INSERT INTO hiss_symbols (
  id, exchange_id, exchange_code, symbol, name,
  last_price, last_volume, last_sample_at, last_sample_id,
  volume_last_full_day, avg_volume_10d, volume_coverage_days,
  temperature, temperature_components_json, temperature_at,
  memory_json, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(exchange_id, symbol) DO UPDATE SET
  exchange_code = excluded.exchange_code,
  name = COALESCE(excluded.name, hiss_symbols.name),
  last_price = excluded.last_price,
  last_volume = excluded.last_volume,
  last_sample_at = excluded.last_sample_at,
  last_sample_id = excluded.last_sample_id,
  volume_last_full_day = excluded.volume_last_full_day,
  avg_volume_10d = excluded.avg_volume_10d,
  volume_coverage_days = excluded.volume_coverage_days,
  temperature = excluded.temperature,
  temperature_components_json = excluded.temperature_components_json,
  temperature_at = excluded.temperature_at,
  memory_json = excluded.memory_json,
  updated_at = excluded.updated_at`;

export async function upsertHissSymbolsBatch(
  db: D1Database,
  rows: HissUpsertInput[],
): Promise<void> {
  if (rows.length === 0) return;

  const CHUNK = 40;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const statements = chunk.map((row) =>
      db
        .prepare(UPSERT_SQL)
        .bind(
          row.id,
          row.exchangeId,
          row.exchangeCode,
          row.symbol,
          row.name,
          row.lastPrice,
          row.lastVolume,
          row.lastSampleAt,
          row.lastSampleId,
          row.volumeLastFullDay,
          row.avgVolume10d,
          row.volumeCoverageDays,
          row.temperature,
          row.temperatureComponentsJson,
          row.temperatureAt,
          row.memoryJson,
          row.createdAt,
          row.updatedAt,
        ),
    );
    await db.batch(statements);
  }
}
