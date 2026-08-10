/**
 * HISS — Heat Interest SPA Scores service.
 * Folds each SPA sample into the per-symbol ledger. Does not touch current HIS.
 */
import { isBinanceExchange } from "../market/binance/constants";
import type { SpaPricePoint } from "../spa/types";
import { getSpaExchange, getSpaSample } from "../spa/repo";
import { parsePricesJson } from "../spa/types";
import {
  foldPriceObservation,
  scoreHissTemperature,
} from "./temperature";
import {
  countHissSymbols,
  countHissSymbolsByExchange,
  countHissSymbolsFiltered,
  getHissLatestUpdatedAt,
  listHissSymbolsFiltered,
  listHissSymbolsForExchange,
  upsertHissSymbolsBatch,
  type HissListFilters,
} from "./repo";
import {
  emptyHissMemory,
  nowIso,
  parseMemoryJson,
  serializeMemory,
  type HissSymbolRow,
} from "./types";
import {
  foldVolumeObservation,
  recordDailyClose,
} from "./volume";

export type HissFoldInput = {
  exchangeId: string;
  exchangeCode: string;
  sampleId: string;
  sampledAt: string;
  prices: SpaPricePoint[];
};

/**
 * Volume used for HISS metrics.
 * Equities: SPA share volume `v`.
 * Binance: prefer quote notional `vq` (USDT/$); fallback price×base.
 */
export function volumeForHiss(
  point: SpaPricePoint,
  exchangeCode: string,
): number | null {
  if (isBinanceExchange(exchangeCode)) {
    if (point.vq != null && Number.isFinite(point.vq) && point.vq >= 0) {
      return point.vq;
    }
    if (
      point.v != null &&
      point.p != null &&
      Number.isFinite(point.v) &&
      Number.isFinite(point.p)
    ) {
      return point.v * point.p;
    }
    return null;
  }
  if (point.v != null && Number.isFinite(point.v) && point.v >= 0) {
    return point.v;
  }
  return null;
}

export async function foldHissFromSample(
  db: D1Database,
  input: HissFoldInput,
): Promise<{ updated: number }> {
  const existing = await listHissSymbolsForExchange(db, input.exchangeId);
  const bySymbol = new Map(existing.map((row) => [row.symbol, row]));
  const at = nowIso();
  const upserts = [];

  for (const point of input.prices) {
    const symbol = point.s?.trim().toUpperCase();
    if (!symbol) continue;

    const prev = bySymbol.get(symbol);
    let memory = prev ? parseMemoryJson(prev.memory_json) : emptyHissMemory();
    const vol = volumeForHiss(point, input.exchangeCode);

    const volFold = foldVolumeObservation(memory, input.sampledAt, vol);
    memory = volFold.memory;
    memory = foldPriceObservation(memory, input.sampledAt, point.p);
    memory = recordDailyClose(memory, input.sampledAt, point.p);

    const score = scoreHissTemperature(memory);
    const createdAt = prev?.created_at ?? at;

    upserts.push({
      id: prev?.id ?? crypto.randomUUID(),
      exchangeId: input.exchangeId,
      exchangeCode: input.exchangeCode,
      symbol,
      name: point.n?.trim() || prev?.name || null,
      lastPrice: point.p,
      lastVolume: vol,
      lastSampleAt: input.sampledAt,
      lastSampleId: input.sampleId,
      volumeLastFullDay: volFold.volumeLastFullDay,
      avgVolume10d: volFold.avgVolume10d,
      volumeCoverageDays: volFold.volumeCoverageDays,
      temperature: score.temperature,
      temperatureComponentsJson: JSON.stringify(score.components),
      temperatureAt: score.temperature != null ? at : prev?.temperature_at ?? null,
      memoryJson: serializeMemory(memory),
      createdAt,
      updatedAt: at,
    });
  }

  // Missing-from-sample: keep last (no delete / no touch).
  await upsertHissSymbolsBatch(db, upserts);
  return { updated: upserts.length };
}

/** Manual / ops fold from a stored SPA sample. */
export async function foldHissFromStoredSample(
  db: D1Database,
  exchangeId: string,
  sampleId?: string,
): Promise<{ updated: number; sampleId: string }> {
  const exchange = await getSpaExchange(db, exchangeId);
  if (!exchange) throw new Error("SPA exchange not found");

  const resolvedSampleId = sampleId ?? exchange.last_sample_id;
  if (!resolvedSampleId) {
    throw new Error("No SPA sample available to fold");
  }

  const sample = await getSpaSample(db, resolvedSampleId);
  if (!sample) throw new Error("SPA sample not found");
  if (sample.exchange_id !== exchangeId) {
    throw new Error("SPA sample does not belong to this exchange");
  }

  const prices = parsePricesJson(sample.prices_json);
  const result = await foldHissFromSample(db, {
    exchangeId: exchange.id,
    exchangeCode: exchange.code,
    sampleId: sample.id,
    sampledAt: sample.sampled_at,
    prices,
  });

  return { updated: result.updated, sampleId: sample.id };
}

export async function getHissOverview(db: D1Database) {
  const [totalSymbols, byExchange, lastUpdatedAt] = await Promise.all([
    countHissSymbols(db),
    countHissSymbolsByExchange(db),
    getHissLatestUpdatedAt(db),
  ]);

  return {
    totalSymbols,
    lastUpdatedAt,
    exchanges: byExchange.map((row) => ({
      exchangeId: row.exchange_id,
      exchangeCode: row.exchange_code,
      symbolCount: row.count,
    })),
  };
}

export async function getHissSymbols(
  db: D1Database,
  query: {
    exchangeId?: string;
    minAvgVolume10d?: string | null;
    minVolumeLastFullDay?: string | null;
    limit?: string | null;
    offset?: string | null;
  },
) {
  const filters: HissListFilters = {
    exchangeId: query.exchangeId || undefined,
    minAvgVolume10d: parseOptionalNumber(query.minAvgVolume10d),
    minVolumeLastFullDay: parseOptionalNumber(query.minVolumeLastFullDay),
    limit: parseOptionalInt(query.limit, 500),
    offset: parseOptionalInt(query.offset, 0),
  };

  const [symbols, total] = await Promise.all([
    listHissSymbolsFiltered(db, filters),
    countHissSymbolsFiltered(db, filters),
  ]);

  return {
    total,
    symbols: symbols.map(serializeHissSymbol),
  };
}

function parseOptionalNumber(raw: string | null | undefined): number | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Volume filters must be finite numbers ≥ 0");
  }
  return n;
}

function parseOptionalInt(
  raw: string | null | undefined,
  fallback: number,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function serializeHissSymbol(row: HissSymbolRow) {
  let components = null;
  if (row.temperature_components_json) {
    try {
      components = JSON.parse(row.temperature_components_json);
    } catch {
      components = null;
    }
  }

  return {
    id: row.id,
    exchangeId: row.exchange_id,
    exchangeCode: row.exchange_code,
    symbol: row.symbol,
    name: row.name,
    lastPrice: row.last_price,
    lastVolume: row.last_volume,
    lastSampleAt: row.last_sample_at,
    lastSampleId: row.last_sample_id,
    volumeLastFullDay: row.volume_last_full_day,
    avgVolume10d: row.avg_volume_10d,
    volumeCoverageDays: row.volume_coverage_days,
    temperature: row.temperature,
    components,
    temperatureAt: row.temperature_at,
    updatedAt: row.updated_at,
  };
}
