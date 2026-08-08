/**
 * SWATCH (Sell Watch) — user-curated close-to-close variation alerts
 * plus optional all-time return (ATR) P&L triggers.
 */

import type { Bar } from "../market/types";

export type SwatchRunStatus = "queued" | "running" | "ok" | "error";
export type SwatchRunTrigger = "manual" | "cron";
export type SwatchDirection = "up" | "down" | "either";
export type SwatchAtrUnit = "usd" | "pct";
export type SwatchAlertKind = "move" | "atr" | "both";
export type SwatchCostInputMode = "total" | "avg";

export type SwatchAtrTrigger = {
  unit: SwatchAtrUnit;
  /** Positive = alert when metric ≥ value; negative = when metric ≤ value. */
  value: number;
};

export const SWATCH_DIRECTIONS = ["up", "down", "either"] as const;
export const SWATCH_ATR_UNITS = ["usd", "pct"] as const;

/** Sensible form defaults — remembered in localStorage on the client, not in D1. */
export const SWATCH_FORM_DEFAULTS = {
  thresholdPct: 10,
  windowHours: 3,
  direction: "either" as SwatchDirection,
  cooldownMinutes: 30,
  /** Default total invested when cost input mode is "total". */
  totalInvested: 3000,
  costInputMode: "total" as SwatchCostInputMode,
};

export const SWATCH_EXCHANGES = [
  { value: "TOR", label: "TSX (TOR)" },
  { value: "VAN", label: "TSXV (VAN)" },
  { value: "NYQ", label: "NYSE (NYQ)" },
  { value: "NMS", label: "NASDAQ (NMS)" },
  { value: "ASE", label: "AMEX (ASE)" },
  { value: "PCX", label: "Pacific (PCX)" },
  { value: "BINANCE", label: "Binance" },
] as const;

export interface SwatchConfigRow {
  id: string;
  enabled: number;
  interval_hours: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  last_run_scanned: number | null;
  last_run_ok: number | null;
  last_run_failed: number | null;
  last_run_alerted: number | null;
  created_at: string;
  updated_at: string;
}

export interface SwatchAssetRow {
  id: string;
  symbol: string;
  exchange: string;
  enabled: number;
  threshold_pct: number;
  window_hours: number;
  direction: string;
  cooldown_minutes: number;
  shares: number | null;
  avg_cost: number | null;
  atr_triggers_json: string | null;
  last_checked_at: string | null;
  last_close: number | null;
  last_move_pct: number | null;
  last_atr_pnl: number | null;
  last_atr_pct: number | null;
  last_alerted_at: string | null;
  last_alert_move_pct: number | null;
  last_alert_kind: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SwatchRunRow {
  id: string;
  status: string;
  trigger: string;
  scanned: number;
  succeeded: number;
  failed: number;
  alerted: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CloseToCloseMove = {
  startClose: number;
  endClose: number;
  startTime: number;
  endTime: number;
  movePct: number;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function addHours(iso: string, hours: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return nowIso();
  return new Date(ms + hours * 3600_000).toISOString();
}

export function isSwatchDirection(value: string): value is SwatchDirection {
  return (SWATCH_DIRECTIONS as readonly string[]).includes(value);
}

export function isSwatchAtrUnit(value: string): value is SwatchAtrUnit {
  return (SWATCH_ATR_UNITS as readonly string[]).includes(value);
}

export function parseAtrTriggersJson(
  raw: string | null | undefined,
): SwatchAtrTrigger[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: SwatchAtrTrigger[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const unit = (item as { unit?: unknown }).unit;
      const value = (item as { value?: unknown }).value;
      if (!isSwatchAtrUnit(String(unit))) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
        continue;
      }
      out.push({ unit, value });
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeAtrTriggers(triggers: SwatchAtrTrigger[]): string | null {
  if (triggers.length === 0) return null;
  return JSON.stringify(triggers);
}

/** Normalize / validate trigger list from API body. */
export function normalizeAtrTriggers(
  raw: unknown,
): SwatchAtrTrigger[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("atrTriggers must be an array");
  }
  const out: SwatchAtrTrigger[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      throw new Error("each atrTrigger must be { unit, value }");
    }
    const unitRaw = (item as { unit?: unknown }).unit;
    const value = Number((item as { value?: unknown }).value);
    if (!isSwatchAtrUnit(String(unitRaw))) {
      throw new Error("atrTrigger.unit must be usd or pct");
    }
    if (!Number.isFinite(value) || value === 0) {
      throw new Error("atrTrigger.value must be a non-zero number");
    }
    if (unitRaw === "pct" && Math.abs(value) > 1000) {
      throw new Error("atrTrigger pct value looks unreasonable (|value| ≤ 1000)");
    }
    const key = `${unitRaw}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ unit: unitRaw, value });
  }
  return out;
}

export type AtrPosition = {
  shares: number;
  avgCost: number;
  pnl: number;
  pct: number;
};

export function computeAtrPosition(
  shares: number,
  avgCost: number,
  price: number,
): AtrPosition | null {
  if (
    !Number.isFinite(shares) ||
    shares <= 0 ||
    !Number.isFinite(avgCost) ||
    avgCost <= 0 ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }
  const pnl = shares * (price - avgCost);
  const pct = ((price - avgCost) / avgCost) * 100;
  if (!Number.isFinite(pnl) || !Number.isFinite(pct)) return null;
  return { shares, avgCost, pnl, pct };
}

/**
 * Among breached triggers, prefer the largest |value| so the alert cites
 * the strongest level the position has cleared.
 */
export function findBreachedAtrTrigger(
  position: AtrPosition,
  triggers: SwatchAtrTrigger[],
): SwatchAtrTrigger | null {
  const breached = triggers.filter((trigger) => {
    const metric = trigger.unit === "usd" ? position.pnl : position.pct;
    if (trigger.value > 0) return metric >= trigger.value;
    if (trigger.value < 0) return metric <= trigger.value;
    return false;
  });
  if (breached.length === 0) return null;
  return [...breached].sort(
    (a, b) => Math.abs(b.value) - Math.abs(a.value),
  )[0]!;
}

/**
 * Close-to-close % move over `windowHours`.
 *
 * End = latest hourly close we have.
 * Start = last hourly close at or before (end − window).
 *
 * The window is anchored on the latest bar — not wall-clock "now" — so
 * after-hours / weekends still compare two real prints instead of failing
 * when every bar falls before (now − window).
 */
export function evaluateCloseToClose(
  bars: Bar[],
  windowHours: number,
): CloseToCloseMove | null {
  const valid = bars.filter(
    (bar) =>
      Number.isFinite(bar.close) &&
      bar.close > 0 &&
      Number.isFinite(bar.time),
  );
  if (valid.length < 2) return null;
  if (!Number.isFinite(windowHours) || windowHours <= 0) return null;

  const end = valid[valid.length - 1]!;
  const cutoffSec = end.time - windowHours * 3600;
  let start = valid[0]!;
  for (const bar of valid) {
    if (bar.time <= cutoffSec) start = bar;
    else break;
  }

  if (start.time >= end.time) return null;

  const movePct = ((end.close - start.close) / start.close) * 100;
  if (!Number.isFinite(movePct)) return null;

  return {
    startClose: start.close,
    endClose: end.close,
    startTime: start.time,
    endTime: end.time,
    movePct,
  };
}

export function moveBreachesThreshold(
  movePct: number,
  thresholdPct: number,
  direction: SwatchDirection,
): boolean {
  if (!Number.isFinite(movePct) || !Number.isFinite(thresholdPct)) return false;
  if (thresholdPct <= 0) return false;

  if (direction === "up") return movePct >= thresholdPct;
  if (direction === "down") return movePct <= -thresholdPct;
  return Math.abs(movePct) >= thresholdPct;
}

export function isInCooldown(
  lastAlertedAt: string | null,
  cooldownMinutes: number,
  nowMs: number = Date.now(),
): boolean {
  if (!lastAlertedAt) return false;
  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes <= 0) return false;
  const alertedMs = Date.parse(lastAlertedAt);
  if (!Number.isFinite(alertedMs)) return false;
  return nowMs - alertedMs < cooldownMinutes * 60_000;
}

/** Yahoo chart range that covers the window with room for sparse hours. */
export function chartRangeForWindow(windowHours: number): "5d" | "1mo" {
  return windowHours > 72 ? "1mo" : "5d";
}
