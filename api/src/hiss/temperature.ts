/**
 * HISS temperature scoring from SPA-derived close series.
 * Forked from HIS math; do not edit current HIS when changing this.
 */
import { closeVsLookbackAvgPct } from "./volume";
import {
  DEFAULT_HISS_TEMPERATURE_PARAMS,
  HISS_PRICE_MEMORY_MAX_POINTS,
  type HissSymbolMemory,
  type HissTemperatureComponents,
  type HissTemperatureParams,
  type HissTemperatureScore,
} from "./types";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function emptyComponents(
  partial: Partial<HissTemperatureComponents> & { error?: string },
): HissTemperatureComponents {
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

/** Append latest close and trim to max points / peak lookback window. */
export function foldPriceObservation(
  memory: HissSymbolMemory,
  sampledAtIso: string,
  price: number | null,
  params: HissTemperatureParams = DEFAULT_HISS_TEMPERATURE_PARAMS,
): HissSymbolMemory {
  if (price == null || !Number.isFinite(price)) return memory;

  const t = Math.floor(new Date(sampledAtIso).getTime() / 1000);
  if (!Number.isFinite(t)) return memory;

  const prices = [...memory.prices, { t, c: price }].sort((a, b) => a.t - b.t);
  const cutoff =
    t - Math.max(params.peakLookbackHours, params.windowHours) * 3600 * 2;
  const trimmed = prices.filter((p) => p.t >= cutoff);
  const capped =
    trimmed.length > HISS_PRICE_MEMORY_MAX_POINTS
      ? trimmed.slice(-HISS_PRICE_MEMORY_MAX_POINTS)
      : trimmed;

  return { ...memory, prices: capped };
}

export function scoreHissTemperature(
  memory: HissSymbolMemory,
  params: HissTemperatureParams = DEFAULT_HISS_TEMPERATURE_PARAMS,
): HissTemperatureScore {
  const points = memory.prices.filter(
    (p) => Number.isFinite(p.t) && Number.isFinite(p.c),
  );

  if (points.length < params.minIntradayPoints) {
    return {
      temperature: null,
      components: emptyComponents({
        source: points.length > 0 ? "spa" : "none",
        error: `need ≥ ${params.minIntradayPoints} SPA closes`,
      }),
    };
  }

  const last = points[points.length - 1]!;
  const asOfSec = last.t;
  const peakCutoff =
    asOfSec - Math.max(params.peakLookbackHours, params.windowHours) * 3600;
  const windowCutoff = asOfSec - params.windowHours * 3600;

  const peakSeries = points.filter((p) => p.t >= peakCutoff);
  const windowSeries = points.filter((p) => p.t >= windowCutoff);

  if (windowSeries.length < 2 || peakSeries.length < 2) {
    return {
      temperature: null,
      components: emptyComponents({
        source: "spa",
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

  const closeVs = closeVsLookbackAvgPct(memory);
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
      source: "spa",
    },
  };
}
