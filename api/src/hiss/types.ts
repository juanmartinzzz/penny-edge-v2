/**
 * HISS — Heat Interest SPA Scores.
 * Live per-symbol ledger folded from SPA samples (not current HIS).
 */

/** Scoring knobs — code constants only (no hiss_config). Changing them needs a rescan. */
export type HissTemperatureParams = {
  windowHours: number;
  peakLookbackHours: number;
  impulseHours: number;
  depthRefPct: number;
  depthCurve: number;
  minDropPct: number;
  wDepth: number;
  wSharp: number;
  wRecency: number;
  recencyHalfLifeHours: number;
  upsideFlatBand: number;
  upsideScale: number;
  upsideCap: number;
  belowAvgBoostMax: number;
  belowAvgRefPct: number;
  minIntradayPoints: number;
};

export const DEFAULT_HISS_TEMPERATURE_PARAMS: HissTemperatureParams = {
  windowHours: 6,
  peakLookbackHours: 12,
  impulseHours: 2,
  depthRefPct: 15,
  depthCurve: 1.2,
  minDropPct: 3,
  wDepth: 0.45,
  wSharp: 0.35,
  wRecency: 0.2,
  recencyHalfLifeHours: 4,
  upsideFlatBand: 0,
  upsideScale: 0.25,
  upsideCap: 35,
  belowAvgBoostMax: 10,
  belowAvgRefPct: 20,
  minIntradayPoints: 4,
};

/** How many completed calendar-day volume buckets feed avg_volume_10d. */
export const HISS_VOLUME_LOOKBACK_DAYS = 10;

/** Keep a few extra sealed days so the 10d window can skip gaps. */
export const HISS_DAILY_BUCKET_RETENTION = 14;

/**
 * Cap SPA price points retained for temperature.
 * At 20m SPA: 12h peak lookback ≈ 36 points; keep margin for denser intervals.
 */
export const HISS_PRICE_MEMORY_MAX_POINTS = 120;

export type HissPricePoint = { t: number; c: number };

/**
 * Carried-forward memory. Must be enough to fold the next SPA tick
 * without re-reading spa_samples history.
 */
export type HissSymbolMemory = {
  v: 1;
  /** Sealed UTC calendar-day volumes: date → max volume seen that day. */
  dailyVolumes: Record<string, number>;
  /** UTC YYYY-MM-DD currently being built (not yet sealed). */
  currentDay: string | null;
  /** Max volume observed on currentDay. */
  currentDayMaxVol: number | null;
  /** Recent closes for temperature (unix seconds). */
  prices: HissPricePoint[];
  /** Last close per sealed/current UTC day for below-avg lookback. */
  dailyCloses: Record<string, number>;
};

export function emptyHissMemory(): HissSymbolMemory {
  return {
    v: 1,
    dailyVolumes: {},
    currentDay: null,
    currentDayMaxVol: null,
    prices: [],
    dailyCloses: {},
  };
}

export type HissTemperatureComponents = {
  retW: number | null;
  dd: number | null;
  impulseDrop: number | null;
  hoursSinceImpulse: number | null;
  depth: number | null;
  sharpness: number | null;
  recency: number | null;
  belowAvgBoost: number | null;
  raw: number | null;
  dampened: boolean;
  source: "spa" | "none";
  error?: string;
};

export type HissTemperatureScore = {
  temperature: number | null;
  components: HissTemperatureComponents;
};

export interface HissSymbolRow {
  id: string;
  exchange_id: string;
  exchange_code: string;
  symbol: string;
  name: string | null;
  last_price: number | null;
  last_volume: number | null;
  last_sample_at: string | null;
  last_sample_id: string | null;
  volume_last_full_day: number | null;
  avg_volume_10d: number | null;
  volume_coverage_days: number;
  temperature: number | null;
  temperature_components_json: string | null;
  temperature_at: string | null;
  memory_json: string;
  created_at: string;
  updated_at: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** UTC calendar day key YYYY-MM-DD. */
export function utcDayKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return d.toISOString().slice(0, 10);
}

export function parseMemoryJson(raw: string | null | undefined): HissSymbolMemory {
  if (!raw) return emptyHissMemory();
  try {
    const parsed = JSON.parse(raw) as Partial<HissSymbolMemory>;
    if (parsed.v !== 1) return emptyHissMemory();
    return {
      v: 1,
      dailyVolumes:
        parsed.dailyVolumes && typeof parsed.dailyVolumes === "object"
          ? parsed.dailyVolumes
          : {},
      currentDay: typeof parsed.currentDay === "string" ? parsed.currentDay : null,
      currentDayMaxVol:
        typeof parsed.currentDayMaxVol === "number" &&
        Number.isFinite(parsed.currentDayMaxVol)
          ? parsed.currentDayMaxVol
          : null,
      prices: Array.isArray(parsed.prices)
        ? parsed.prices.filter(
            (p): p is HissPricePoint =>
              p != null &&
              typeof p === "object" &&
              typeof (p as HissPricePoint).t === "number" &&
              typeof (p as HissPricePoint).c === "number" &&
              Number.isFinite((p as HissPricePoint).t) &&
              Number.isFinite((p as HissPricePoint).c),
          )
        : [],
      dailyCloses:
        parsed.dailyCloses && typeof parsed.dailyCloses === "object"
          ? parsed.dailyCloses
          : {},
    };
  } catch {
    return emptyHissMemory();
  }
}

export function serializeMemory(memory: HissSymbolMemory): string {
  return JSON.stringify(memory);
}
