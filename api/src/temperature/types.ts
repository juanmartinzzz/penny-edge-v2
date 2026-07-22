/**
 * Heat and Interest Scale (HIS) types and scoring.
 * Product alias for crash-heat scoring of TAS price snapshots.
 */
import type { SymbolAnalysis } from "../analysis/types";

export type TemperatureRunStatus = "queued" | "running" | "ok" | "error";
export type TemperatureRunTrigger = "manual" | "cron";

/**
 * Minimum temperature for COBUTA (Consider Buying These Assets).
 * Keep in sync with `src/lib/temperature.ts` on the client.
 */
export const COBUTA_TEMP_THRESHOLD = 90;

export function isCobutaTemperature(value: number | null | undefined): boolean {
  return value != null && value >= COBUTA_TEMP_THRESHOLD;
}

/** Tunable scoring knobs (stored as JSON on temperature_config). */
export type TemperatureParams = {
  /** How far back (hours) we measure the recent move. */
  windowHours: number;
  /** How far back (hours) we search for the local peak to measure depth from. */
  peakLookbackHours: number;
  /** Sub-window (hours) that defines an "all in one go" dump. */
  impulseHours: number;
  /** Drawdown % that maps to a full depth score. */
  depthRefPct: number;
  /** Curve on depth (1 = linear; >1 punishes shallow dips more gently). */
  depthCurve: number;
  /** Ignore sharpness unless drawdown clears this %. */
  minDropPct: number;
  /** Blend weight for depth. */
  wDepth: number;
  /** Blend weight for sharpness. */
  wSharp: number;
  /** Blend weight for recency. */
  wRecency: number;
  /** Hours for heat to cool to ~half after the dump ends. */
  recencyHalfLifeHours: number;
  /** If short-window return ≥ this %, treat as flat/up (dampen heat). */
  upsideFlatBand: number;
  /** Multiply raw heat by this when flat/up. */
  upsideScale: number;
  /** Hard cap when flat/up. */
  upsideCap: number;
  /** Extra points if already below TAS lookback average. */
  belowAvgBoostMax: number;
  /** % below lookback avg that earns the full below-avg boost. */
  belowAvgRefPct: number;
  /** Need at least this many hourly closes to score. */
  minIntradayPoints: number;
};

export const DEFAULT_TEMPERATURE_PARAMS: TemperatureParams = {
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

export interface TemperatureConfigRow {
  id: string;
  enabled: number;
  interval_hours: number;
  page_size: number;
  params_json: string;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  last_run_scanned: number | null;
  last_run_ok: number | null;
  last_run_failed: number | null;
  created_at: string;
  updated_at: string;
}

export interface TemperatureRunRow {
  id: string;
  status: TemperatureRunStatus;
  trigger: TemperatureRunTrigger;
  offset: number;
  page_size: number;
  scanned: number;
  succeeded: number;
  failed: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemperatureJobMessage {
  type: "temperature_page";
  runId: string;
  offset: number;
}

export type TemperatureComponents = {
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
  source: "hourly" | "points" | "none";
  error?: string;
};

export type TemperatureScore = {
  temperature: number | null;
  components: TemperatureComponents;
};

export function addHours(iso: string | Date, hours: number): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function emptyComponents(
  partial: Partial<TemperatureComponents> & { error?: string },
): TemperatureComponents {
  return {
    retW: null,
    dd: null,
    impulseDrop: null,
    hoursSinceImpulse: null,
    depth: null,
    sharpness: null,
    recency: null,
    belowAvgBoost: null,
    raw: null,
    dampened: false,
    source: "none",
    ...partial,
  };
}

/** Merge stored JSON with defaults; ignore unknown / invalid keys. */
export function parseTemperatureParams(raw: string | null | undefined): TemperatureParams {
  const base = { ...DEFAULT_TEMPERATURE_PARAMS };
  if (!raw) return base;

  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof TemperatureParams, unknown>>;
    for (const key of Object.keys(base) as Array<keyof TemperatureParams>) {
      const value = parsed[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        base[key] = value;
      }
    }
  } catch {
    // keep defaults
  }

  return base;
}

export function serializeTemperatureParams(params: TemperatureParams): string {
  return JSON.stringify(params);
}

type ClosePoint = { t: number; c: number };

function resolveHourlySeries(analysis: SymbolAnalysis): {
  points: ClosePoint[];
  source: "hourly" | "points" | "none";
} {
  const hourly = analysis.intraday.hourly;
  if (Array.isArray(hourly) && hourly.length > 0) {
    return {
      points: hourly
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.c))
        .sort((a, b) => a.t - b.t),
      source: "hourly",
    };
  }

  const buckets = analysis.intraday.points;
  if (Array.isArray(buckets) && buckets.length > 0) {
    return {
      points: buckets
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.c))
        .map((p) => ({ t: p.t, c: p.c }))
        .sort((a, b) => a.t - b.t),
      source: "points",
    };
  }

  return { points: [], source: "none" };
}

/**
 * Score crash-heat 0–100 from a TAS snapshot.
 * High = deep, sharp, recent drop. Mid/low = stable or rising.
 */
export function scoreTemperature(
  analysis: SymbolAnalysis | null,
  params: TemperatureParams,
): TemperatureScore {
  if (!analysis || analysis.error) {
    return {
      temperature: null,
      components: emptyComponents({
        error: analysis?.error ?? "missing TAS analysis",
      }),
    };
  }

  const { points, source } = resolveHourlySeries(analysis);
  if (points.length < params.minIntradayPoints) {
    return {
      temperature: null,
      components: emptyComponents({
        source,
        error: `need ≥ ${params.minIntradayPoints} hourly closes`,
      }),
    };
  }

  const last = points[points.length - 1]!;
  const asOfSec = last.t;
  const peakCutoff = asOfSec - Math.max(params.peakLookbackHours, params.windowHours) * 3600;
  const windowCutoff = asOfSec - params.windowHours * 3600;

  const peakSeries = points.filter((p) => p.t >= peakCutoff);
  const windowSeries = points.filter((p) => p.t >= windowCutoff);

  if (windowSeries.length < 2 || peakSeries.length < 2) {
    return {
      temperature: null,
      components: emptyComponents({
        source,
        error: "not enough points in scoring window",
      }),
    };
  }

  const firstInWindow = windowSeries[0]!;
  const retW =
    firstInWindow.c !== 0
      ? ((last.c - firstInWindow.c) / firstInWindow.c) * 100
      : 0;

  const peak = Math.max(...peakSeries.map((p) => p.c));
  const dd = peak > 0 ? Math.max(0, ((peak - last.c) / peak) * 100) : 0;

  const impulseSec = Math.max(1, params.impulseHours) * 3600;
  let impulseDrop = 0;
  let impulseEndT = last.t;

  for (const end of windowSeries) {
    const startT = end.t - impulseSec;
    const slice = windowSeries.filter((p) => p.t >= startT && p.t <= end.t);
    if (slice.length < 2) continue;
    const localPeak = Math.max(...slice.map((p) => p.c));
    if (localPeak <= 0) continue;
    const drop = ((localPeak - end.c) / localPeak) * 100;
    if (drop > impulseDrop) {
      impulseDrop = drop;
      impulseEndT = end.t;
    }
  }

  const hoursSinceImpulse = Math.max(0, (asOfSec - impulseEndT) / 3600);

  const depthRef = Math.max(params.depthRefPct, 1e-6);
  const depthCurve = Math.max(params.depthCurve, 0.01);
  const depth = 100 * clamp01(Math.pow(dd / depthRef, depthCurve));

  let sharpness = 0;
  if (dd >= params.minDropPct) {
    sharpness = 100 * clamp01(impulseDrop / Math.max(dd, 1e-9));
  }

  const halfLife = Math.max(params.recencyHalfLifeHours, 0.01);
  const recency = 100 * Math.exp(-hoursSinceImpulse / halfLife);

  const closeVs = analysis.summary.closeVsLookbackAvgPct;
  let belowAvgBoost = 0;
  if (closeVs != null && closeVs < 0) {
    const ref = Math.max(params.belowAvgRefPct, 1e-6);
    belowAvgBoost = params.belowAvgBoostMax * clamp01(-closeVs / ref);
  }

  const wSum = Math.max(params.wDepth + params.wSharp + params.wRecency, 1e-9);
  const raw =
    (params.wDepth / wSum) * depth +
    (params.wSharp / wSum) * sharpness +
    (params.wRecency / wSum) * recency +
    belowAvgBoost;

  const dampened = retW >= params.upsideFlatBand;
  const temperature = dampened
    ? Math.min(raw * params.upsideScale, params.upsideCap)
    : clamp(raw, 0, 100);

  return {
    temperature: Math.round(temperature * 10) / 10,
    components: {
      retW: round1(retW),
      dd: round1(dd),
      impulseDrop: round1(impulseDrop),
      hoursSinceImpulse: round1(hoursSinceImpulse),
      depth: round1(depth),
      sharpness: round1(sharpness),
      recency: round1(recency),
      belowAvgBoost: round1(belowAvgBoost),
      raw: round1(raw),
      dampened,
      source,
    },
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Validate and normalize a partial params patch from the UI/API. */
export function normalizeTemperatureParamsPatch(
  body: Partial<TemperatureParams>,
): Partial<TemperatureParams> {
  const out: Partial<TemperatureParams> = {};

  const requirePositive = (key: keyof TemperatureParams, min = 0.01) => {
    const value = body[key];
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
      throw new Error(`${key} must be >= ${min}`);
    }
    out[key] = value;
  };

  const requireNonNeg = (key: keyof TemperatureParams) => {
    const value = body[key];
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${key} must be >= 0`);
    }
    out[key] = value;
  };

  requirePositive("windowHours", 1);
  requirePositive("peakLookbackHours", 1);
  requirePositive("impulseHours", 1);
  requirePositive("depthRefPct", 0.1);
  requirePositive("depthCurve", 0.01);
  requireNonNeg("minDropPct");
  requireNonNeg("wDepth");
  requireNonNeg("wSharp");
  requireNonNeg("wRecency");
  requirePositive("recencyHalfLifeHours", 0.1);
  // upsideFlatBand can be negative (treat mild dips as "not rising")
  if (body.upsideFlatBand !== undefined) {
    if (typeof body.upsideFlatBand !== "number" || !Number.isFinite(body.upsideFlatBand)) {
      throw new Error("upsideFlatBand must be a finite number");
    }
    out.upsideFlatBand = body.upsideFlatBand;
  }
  requireNonNeg("upsideScale");
  requireNonNeg("upsideCap");
  requireNonNeg("belowAvgBoostMax");
  requirePositive("belowAvgRefPct", 0.1);
  requirePositive("minIntradayPoints", 2);

  if (out.windowHours !== undefined) out.windowHours = Math.floor(out.windowHours);
  if (out.peakLookbackHours !== undefined) {
    out.peakLookbackHours = Math.floor(out.peakLookbackHours);
  }
  if (out.impulseHours !== undefined) out.impulseHours = Math.floor(out.impulseHours);
  if (out.minIntradayPoints !== undefined) {
    out.minIntradayPoints = Math.floor(out.minIntradayPoints);
  }

  return out;
}
