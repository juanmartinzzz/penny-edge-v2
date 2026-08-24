/**
 * SPA — Symbol Price Archive types and helpers.
 */
export type SpaRunStatus = "queued" | "running" | "ok" | "error";
export type SpaRunTrigger = "manual" | "cron";

export interface SpaExchangeRow {
  id: string;
  code: string;
  label: string;
  enabled: number;
  interval_minutes: number;
  retention_days: number;
  enabled_quote_assets: string | null;
  timezone: string;
  open_local: string;
  close_local: string;
  include_weekends: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  last_run_scanned: number | null;
  last_sample_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpaRunRow {
  id: string;
  exchange_id: string;
  status: SpaRunStatus;
  trigger: SpaRunTrigger;
  offset: number;
  page_size: number;
  scanned: number;
  pages: number;
  sample_id: string | null;
  calls_json: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SpaRunPageRow {
  id: string;
  run_id: string;
  page_offset: number;
  quotes_json: string;
  call_json: string | null;
  created_at: string;
}

export interface SpaSampleRow {
  id: string;
  exchange_id: string;
  run_id: string;
  sampled_at: string;
  symbol_count: number;
  prices_json: string;
  calls_json: string | null;
  created_at: string;
}

/**
 * D1 max row is 2MB. Cap is on uncompressed JSON (Worker memory).
 * On disk we gzip prices_json; repeated notebook keys shrink a lot.
 */
export const SPA_SAMPLE_JSON_MAX_BYTES = 1_800_000;

/**
 * One symbol in a SPA photo.
 * Thin (legacy): `{s,p,v?,vq?,n?}`.
 * Fat: also carries the rolling notebook so the next photo is
 * previous photo + new API quotes (no HISS table, no album walk).
 */
export type SpaPricePoint = {
  s: string;
  p: number | null;
  /** Share/base volume when available. */
  v?: number | null;
  /**
   * Quote-asset / USD notional volume (Binance → USDT/$ for HISS filters).
   * Optional; older samples may omit it.
   */
  vq?: number | null;
  n?: string | null;
  /** Rolling HISS notebook (price series, volume buckets). */
  m?: unknown;
  /** Last graded temperature from this photo. */
  t?: number | null;
  /** Volume last full UTC day. */
  vd?: number | null;
  /** Avg volume over sealed 10d buckets. */
  va?: number | null;
  /** How many sealed volume days exist. */
  vc?: number;
};

export function sampleHasNotebooks(prices: SpaPricePoint[]): boolean {
  return prices.some((point) => point.m != null);
}

export function assertSpaPricesJsonSize(json: string): void {
  if (json.length > SPA_SAMPLE_JSON_MAX_BYTES) {
    throw new Error(
      `SPA sample JSON is ${json.length} bytes (max ${SPA_SAMPLE_JSON_MAX_BYTES}). Compact notebooks or split the venue.`,
    );
  }
}

export type SpaApiCall = {
  at: string;
  endpoint: string;
  pageOffset: number;
  pageSize: number;
  quoteCount: number;
  /**
   * Actual Yahoo / CoinGecko HTTP requests made for this SPA job chunk.
   * Older samples may omit this; treat missing as 1 per chunk when summing.
   */
  upstreamRequests?: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
};

export interface SpaJobMessage {
  type: "spa_page";
  runId: string;
  exchangeId: string;
  offset: number;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addMinutes(iso: string | Date, minutes: number): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

export function parseCallsJson(raw: string | null): SpaApiCall[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SpaApiCall[]) : [];
  } catch {
    return [];
  }
}

/** Sum vendor HTTP requests; fall back to 1 per job chunk for legacy logs. */
export function sumUpstreamRequests(calls: SpaApiCall[]): number {
  return calls.reduce((sum, call) => sum + (call.upstreamRequests ?? 1), 0);
}

export function parsePricesJson(raw: string | null): SpaPricePoint[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SpaPricePoint[]) : [];
  } catch {
    return [];
  }
}
