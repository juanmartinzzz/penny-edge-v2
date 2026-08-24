/**
 * HISS — Heat Interest SPA Scores service.
 * Grades live on each SPA photo. The table is a hot list (prefers ≥70), not notebooks.
 */
import { selectHissHotRows } from "../../../shared/hiss";
import { isBinanceExchange } from "../market/binance/constants";
import {
  getLatestSpaSample,
  getSpaExchange,
  getSpaSample,
  listSpaExchanges,
  updateSpaSamplePrices,
} from "../spa/repo";
import {
  parsePricesJson,
  sampleHasNotebooks,
  type SpaPricePoint,
} from "../spa/types";
import { foldPriceObservation, scoreHissTemperature } from "./temperature";
import {
  countHissSymbols,
  countHissSymbolsByExchange,
  countHissSymbolsFiltered,
  deleteHissSymbolsOutsideIds,
  getHissLatestUpdatedAt,
  listHissSymbolsFiltered,
  listHissSymbolsForExchange,
  upsertHissSymbolsBatch,
  type HissListFilters,
  type HissUpsertInput,
} from "./repo";
import {
  emptyHissMemory,
  nowIso,
  parseMemoryJson,
  type HissSymbolMemory,
  type HissSymbolRow,
} from "./types";
import { foldVolumeObservation, recordDailyClose } from "./volume";

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
      point.p != null &&
      point.v != null &&
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

function memoryFromPoint(point: SpaPricePoint | undefined): HissSymbolMemory {
  if (point?.m == null) return emptyHissMemory();
  return parseMemoryJson(point.m);
}

function hissRowsBySymbol(rows: HissSymbolRow[]): Map<string, HissSymbolRow> {
  const map = new Map<string, HissSymbolRow>();
  for (const row of rows) {
    map.set(row.symbol.trim().toUpperCase(), row);
  }
  return map;
}

/** Copy existing HISS notebooks onto a thin SPA photo (no extra fold). */
export function attachHissNotebooksToPrices(
  prices: SpaPricePoint[],
  hissRows: HissSymbolRow[],
): SpaPricePoint[] {
  const bySymbol = hissRowsBySymbol(hissRows);
  return prices.map((point) => {
    const symbol = point.s?.trim().toUpperCase();
    const row = symbol ? bySymbol.get(symbol) : undefined;
    if (!row) return point;
    return {
      ...point,
      m: parseMemoryJson(row.memory_json),
      t: row.temperature,
      vd: row.volume_last_full_day,
      va: row.avg_volume_10d,
      vc: row.volume_coverage_days,
    };
  });
}

function fatPointFromQuote(input: {
  quote: SpaPricePoint;
  previous: SpaPricePoint | undefined;
  bootstrap: HissSymbolRow | undefined;
  exchangeId: string;
  exchangeCode: string;
  sampleId: string;
  sampledAt: string;
  at: string;
}): { point: SpaPricePoint; hot: HissUpsertInput | null } {
  const symbol = input.quote.s?.trim().toUpperCase() ?? "";
  let memory = memoryFromPoint(input.previous);
  if (input.previous?.m == null && input.bootstrap) {
    memory = parseMemoryJson(input.bootstrap.memory_json);
  }
  const vol = volumeForHiss(input.quote, input.exchangeCode);
  const volFold = foldVolumeObservation(memory, input.sampledAt, vol);
  memory = volFold.memory;
  memory = foldPriceObservation(memory, input.sampledAt, input.quote.p);
  memory = recordDailyClose(memory, input.sampledAt, input.quote.p);
  const score = scoreHissTemperature(memory);
  const name = input.quote.n?.trim() || input.bootstrap?.name || null;
  const temperatureAt =
    score.temperature != null
      ? input.at
      : (input.bootstrap?.temperature_at ?? null);

  const point: SpaPricePoint = {
    s: input.quote.s,
    p: input.quote.p,
    ...(input.quote.v != null ? { v: input.quote.v } : {}),
    ...(input.quote.vq != null ? { vq: input.quote.vq } : {}),
    ...(name ? { n: name } : {}),
    m: memory,
    t: score.temperature,
    vd: volFold.volumeLastFullDay,
    va: volFold.avgVolume10d,
    vc: volFold.volumeCoverageDays,
  };

  if (!symbol || score.temperature == null) {
    return { point, hot: null };
  }

  return {
    point,
    hot: {
      id: input.bootstrap?.id ?? crypto.randomUUID(),
      exchangeId: input.exchangeId,
      exchangeCode: input.exchangeCode,
      symbol,
      name,
      lastPrice: input.quote.p,
      lastVolume: vol,
      lastSampleAt: input.sampledAt,
      lastSampleId: input.sampleId,
      volumeLastFullDay: volFold.volumeLastFullDay,
      avgVolume10d: volFold.avgVolume10d,
      volumeCoverageDays: volFold.volumeCoverageDays,
      temperature: score.temperature,
      temperatureComponentsJson: JSON.stringify(score.components),
      temperatureAt,
      memoryJson: "{}",
      createdAt: input.bootstrap?.created_at ?? input.at,
      updatedAt: input.at,
    },
  };
}

/** Previous photo (or HISS bootstrap) + this run's API quotes → fat photo + hot list. */
export function advanceSpaQuotes(input: {
  previous: SpaPricePoint[];
  quotes: SpaPricePoint[];
  bootstrap: HissSymbolRow[];
  exchangeId: string;
  exchangeCode: string;
  sampleId: string;
  sampledAt: string;
}): { prices: SpaPricePoint[]; hot: HissUpsertInput[] } {
  const prevBySymbol = new Map<string, SpaPricePoint>();
  for (const point of input.previous) {
    const symbol = point.s?.trim().toUpperCase();
    if (symbol) prevBySymbol.set(symbol, point);
  }
  const bootstrapBySymbol = hissRowsBySymbol(input.bootstrap);
  const at = nowIso();
  const prices: SpaPricePoint[] = [];
  const hot: HissUpsertInput[] = [];

  for (const quote of input.quotes) {
    const symbol = quote.s?.trim().toUpperCase();
    const { point, hot: hotRow } = fatPointFromQuote({
      quote,
      previous: symbol ? prevBySymbol.get(symbol) : undefined,
      bootstrap: symbol ? bootstrapBySymbol.get(symbol) : undefined,
      exchangeId: input.exchangeId,
      exchangeCode: input.exchangeCode,
      sampleId: input.sampleId,
      sampledAt: input.sampledAt,
      at,
    });
    prices.push(point);
    if (hotRow) hot.push(hotRow);
  }

  return { prices, hot: selectHissHotRows(hot) };
}

export async function publishHissHotList(
  db: D1Database,
  exchangeId: string,
  hot: HissUpsertInput[],
): Promise<{ updated: number; removed: number }> {
  // An empty publish deletes the whole venue. Keep the previous list when
  // this photo produced no temperatures (failed fold, first ticks, empty sample).
  if (hot.length === 0) {
    return { updated: 0, removed: 0 };
  }
  if (hot.length > 90) {
    const removed = await deleteHissSymbolsOutsideIds(db, exchangeId, []);
    await upsertHissSymbolsBatch(db, hot);
    return { updated: hot.length, removed };
  }
  await upsertHissSymbolsBatch(db, hot);
  const removed = await deleteHissSymbolsOutsideIds(
    db,
    exchangeId,
    hot.map((row) => row.id),
  );
  return { updated: hot.length, removed };
}

function hotFromFatPrices(
  input: HissFoldInput,
  bootstrap: HissSymbolRow[],
): HissUpsertInput[] {
  const bootstrapBySymbol = hissRowsBySymbol(bootstrap);
  const at = nowIso();
  const hot: HissUpsertInput[] = [];
  for (const point of input.prices) {
    const symbol = point.s?.trim().toUpperCase();
    if (!symbol || point.t == null) continue;
    const row = bootstrapBySymbol.get(symbol);
    const vol = volumeForHiss(point, input.exchangeCode);
    hot.push({
      id: row?.id ?? crypto.randomUUID(),
      exchangeId: input.exchangeId,
      exchangeCode: input.exchangeCode,
      symbol,
      name: point.n?.trim() || row?.name || null,
      lastPrice: point.p,
      lastVolume: vol,
      lastSampleAt: input.sampledAt,
      lastSampleId: input.sampleId,
      volumeLastFullDay: point.vd ?? null,
      avgVolume10d: point.va ?? null,
      volumeCoverageDays: point.vc ?? 0,
      temperature: point.t ?? null,
      temperatureComponentsJson: row?.temperature_components_json ?? null,
      temperatureAt: row?.temperature_at ?? at,
      memoryJson: "{}",
      createdAt: row?.created_at ?? at,
      updatedAt: at,
    });
  }
  return selectHissHotRows(hot);
}

/**
 * Build the next fat photo from the latest sample + this run's thin API quotes.
 * If the previous photo is still thin, notebooks come from hiss_symbols once.
 */
export async function fattenQuotesForNewSample(
  db: D1Database,
  input: {
    exchangeId: string;
    exchangeCode: string;
    sampleId: string;
    sampledAt: string;
    quotes: SpaPricePoint[];
  },
): Promise<{ prices: SpaPricePoint[]; hot: HissUpsertInput[] }> {
  let previous: SpaPricePoint[] = [];
  try {
    const previousRow = await getLatestSpaSample(db, input.exchangeId);
    previous = parsePricesJson(previousRow?.prices_json ?? null);
  } catch (error) {
    console.error(
      `Failed to decode previous SPA photo for ${input.exchangeId}; starting notebooks fresh`,
      error,
    );
  }
  const bootstrap = await listHissSymbolsForExchange(db, input.exchangeId);
  return advanceSpaQuotes({
    previous,
    quotes: input.quotes,
    bootstrap,
    exchangeId: input.exchangeId,
    exchangeCode: input.exchangeCode,
    sampleId: input.sampleId,
    sampledAt: input.sampledAt,
  });
}

export async function foldHissFromSample(
  db: D1Database,
  input: HissFoldInput,
): Promise<{ updated: number }> {
  const bootstrap = await listHissSymbolsForExchange(db, input.exchangeId);
  const hot = sampleHasNotebooks(input.prices)
    ? hotFromFatPrices(input, bootstrap)
    : advanceSpaQuotes({
        previous: [],
        quotes: input.prices,
        bootstrap,
        exchangeId: input.exchangeId,
        exchangeCode: input.exchangeCode,
        sampleId: input.sampleId,
        sampledAt: input.sampledAt,
      }).hot;
  const result = await publishHissHotList(db, input.exchangeId, hot);
  return { updated: result.updated };
}

/** Manual / ops: seed notebooks onto the latest thin photo, then publish the hot list. */
export async function foldHissFromStoredSample(
  db: D1Database,
  exchangeId: string,
  sampleId?: string,
): Promise<{ updated: number; sampleId: string; seeded: boolean }> {
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

  let prices = parsePricesJson(sample.prices_json);
  let seeded = false;
  if (!sampleHasNotebooks(prices)) {
    const hissRows = await listHissSymbolsForExchange(db, exchangeId);
    prices = attachHissNotebooksToPrices(prices, hissRows);
    seeded = true;
  }
  await updateSpaSamplePrices(db, sample.id, prices);

  const result = await foldHissFromSample(db, {
    exchangeId: exchange.id,
    exchangeCode: exchange.code,
    sampleId: sample.id,
    sampledAt: sample.sampled_at,
    prices,
  });

  return { updated: result.updated, sampleId: sample.id, seeded };
}

/**
 * Publish the hot list from each venue's latest SPA photo.
 * Seeds thin latest photos from remaining hiss_symbols rows first.
 */
export async function backfillHissFromSpaArchive(db: D1Database): Promise<{
  cleared: number;
  exchanges: Array<{
    exchangeCode: string;
    samples: number;
    symbols: number;
  }>;
}> {
  const exchanges = await listSpaExchanges(db);
  const report: Array<{
    exchangeCode: string;
    samples: number;
    symbols: number;
  }> = [];

  for (const exchange of exchanges) {
    if (!exchange.last_sample_id) {
      report.push({
        exchangeCode: exchange.code,
        samples: 0,
        symbols: 0,
      });
      continue;
    }
    const result = await foldHissFromStoredSample(db, exchange.id);
    report.push({
      exchangeCode: exchange.code,
      samples: 1,
      symbols: result.updated,
    });
  }

  return { cleared: 0, exchanges: report };
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
