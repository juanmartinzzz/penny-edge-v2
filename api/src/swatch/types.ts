/**
 * SWATCH (Sell Watch) — user-curated close-to-close variation alerts.
 */

import type { Bar } from "../market/types";

export type SwatchRunStatus = "queued" | "running" | "ok" | "error";
export type SwatchRunTrigger = "manual" | "cron";
export type SwatchDirection = "up" | "down" | "either";

export const SWATCH_DIRECTIONS = ["up", "down", "either"] as const;

/** Sensible form defaults — remembered in localStorage on the client, not in D1. */
export const SWATCH_FORM_DEFAULTS = {
  thresholdPct: 10,
  windowHours: 3,
  direction: "either" as SwatchDirection,
  cooldownMinutes: 30,
};

export const SWATCH_EXCHANGES = [
  { value: "TOR", label: "TSX (TOR)" },
  { value: "VAN", label: "TSXV (VAN)" },
  { value: "NYQ", label: "NYSE (NYQ)" },
  { value: "NMS", label: "NASDAQ (NMS)" },
  { value: "ASE", label: "AMEX (ASE)" },
  { value: "PCX", label: "Pacific (PCX)" },
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
  last_checked_at: string | null;
  last_close: number | null;
  last_move_pct: number | null;
  last_alerted_at: string | null;
  last_alert_move_pct: number | null;
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

/**
 * Close-to-close % move over `windowHours`.
 * Start = last hourly close at or before (now − window); end = latest hourly close.
 */
export function evaluateCloseToClose(
  bars: Bar[],
  windowHours: number,
  nowMs: number = Date.now(),
): CloseToCloseMove | null {
  const valid = bars.filter(
    (bar) =>
      Number.isFinite(bar.close) &&
      bar.close > 0 &&
      Number.isFinite(bar.time),
  );
  if (valid.length < 2) return null;
  if (!Number.isFinite(windowHours) || windowHours <= 0) return null;

  const cutoffSec = (nowMs - windowHours * 3600_000) / 1000;
  let start = valid[0]!;
  for (const bar of valid) {
    if (bar.time <= cutoffSec) start = bar;
    else break;
  }

  const end = valid[valid.length - 1]!;
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
