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
  /** IANA timezone for regular session checks. */
  timezone: string;
  /** Local open HH:MM (24h). */
  open_local: string;
  /** Local close HH:MM (24h), exclusive. "24:00" = end of day. */
  close_local: string;
  /** 1 = Sat/Sun eligible for cron/TAS/SWATCH gates. */
  include_weekends: number;
  /**
   * JSON array of Binance quote assets to screen (e.g. `["USDT"]`).
   * NULL for equity scanners.
   */
  enabled_quote_assets: string | null;
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
  /** Today's activity in quote/$ (crypto notional or shares × price). */
  volume_quote?: number | null;
  avg_volume_10d: number | null;
  /** 10d average activity in quote/$ (crypto: 24h stand-in until real 10d). */
  avg_volume_10d_quote?: number | null;
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
  /** HIS temperature 0–100; null until first score. */
  temperature?: number | null;
  temperature_components_json?: string | null;
  temperature_at?: string | null;
  temperature_run_id?: string | null;
  /**
   * 1 after a COBUTA Telegram alert was sent for this stay in the ≥90 band.
   * Cleared when temperature drops below COBUTA.
   */
  cobuta_alerted?: number;
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
  if (quote.dailyQuoteNotional != null) {
    return quote.dailyQuoteNotional;
  }
  const vol3m = quote.averageVolume3m;
  const fiftyDay = quote.fiftyDayAverage;
  if (vol3m == null || fiftyDay == null) return null;
  return (vol3m * fiftyDay) / 90;
}

function productOrNull(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  if (a == null || b == null) return null;
  const value = a * b;
  return Number.isFinite(value) ? value : null;
}

/** Today's traded value in quote currency / USD. */
export function volumeQuote(quote: Quote): number | null {
  if (
    quote.dailyQuoteNotional != null &&
    Number.isFinite(quote.dailyQuoteNotional)
  ) {
    return quote.dailyQuoteNotional;
  }
  return productOrNull(quote.volume, quote.price);
}

/**
 * ~10d average traded value in quote currency / USD.
 * Crypto phase 1: 24h venue notional stands in until multi-day averages exist.
 */
export function avgVolume10dQuote(quote: Quote): number | null {
  if (
    quote.dailyQuoteNotional != null &&
    Number.isFinite(quote.dailyQuoteNotional)
  ) {
    return quote.dailyQuoteNotional;
  }
  const price = quote.price ?? quote.fiftyDayAverage ?? null;
  return productOrNull(quote.averageVolume10d, price);
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
    // Crypto (dailyQuoteNotional set): gate on quote-denominated 10d.
    // Equities: gate on base/share averageVolume10d (existing thresholds).
    const vol10d =
      quote.dailyQuoteNotional != null
        ? (avgVolume10dQuote(quote) ?? 0)
        : (quote.averageVolume10d ?? 0);
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
