/**
 * Exchangewide Volume Gate (EVG) types and helpers.
 * Product alias for exchange_scanners / warm_symbols filtering.
 */
import type { Quote } from "../market/types";

export type ScannerRunStatus = "queued" | "running" | "ok" | "error";
export type ScannerRunTrigger = "manual" | "cron";

export interface ExchangeScannerRow {
  id: string;
  code: string;
  label: string;
  enabled: number;
  interval_hours: number;
  min_avg_volume_10d: number | null;
  min_approx_daily_value: number | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  last_run_scanned: number | null;
  last_run_matched: number | null;
  created_at: string;
  updated_at: string;
}

export interface ScannerRunRow {
  id: string;
  scanner_id: string;
  status: ScannerRunStatus;
  trigger: ScannerRunTrigger;
  offset: number;
  page_size: number;
  scanned: number;
  matched: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WarmSymbolRow {
  id: string;
  scanner_id: string;
  symbol: string;
  exchange: string;
  name: string | null;
  price: number | null;
  change_percent: number | null;
  volume: number | null;
  avg_volume_10d: number | null;
  avg_volume_3m: number | null;
  fifty_day_average: number | null;
  approx_daily_value: number | null;
  currency: string | null;
  is_warm: number;
  last_seen_run_id: string | null;
  last_seen_at: string;
  /** TAS snapshot JSON (full series); null until first analysis. */
  analysis_json?: string | null;
  analyzed_at?: string | null;
  analysis_run_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScannerJobMessage {
  type: "scan_page";
  runId: string;
  scannerId: string;
  offset: number;
}

export function approxDailyValue(quote: Quote): number | null {
  const vol3m = quote.averageVolume3m;
  const fiftyDay = quote.fiftyDayAverage;
  if (vol3m == null || fiftyDay == null) return null;
  return (vol3m * fiftyDay) / 90;
}

/** EVG volume gate: keep quotes that clear 10d avg volume + approx daily value. */
export function passesWarmFilters(
  quote: Quote,
  filters: {
    minAvgVolume10d: number | null;
    minApproxDailyValue: number | null;
  },
): boolean {
  if (filters.minAvgVolume10d != null) {
    const vol10d = quote.averageVolume10d ?? 0;
    if (vol10d < filters.minAvgVolume10d) return false;
  }

  if (filters.minApproxDailyValue != null) {
    const value = approxDailyValue(quote);
    if (value == null || value < filters.minApproxDailyValue) return false;
  }

  return true;
}

export function addHours(iso: string | Date, hours: number): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}
