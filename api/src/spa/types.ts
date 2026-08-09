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

/** Compact archived quote (keeps JSON small). */
export type SpaPricePoint = {
  s: string;
  p: number | null;
  v?: number | null;
  n?: string | null;
};

export type SpaApiCall = {
  at: string;
  endpoint: string;
  pageOffset: number;
  pageSize: number;
  quoteCount: number;
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

export function parsePricesJson(raw: string | null): SpaPricePoint[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SpaPricePoint[]) : [];
  } catch {
    return [];
  }
}
