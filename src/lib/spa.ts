/**
 * Client for SPA — Symbol Price Archive.
 */
import { apiFetch } from "./api";

export type SpaRunStatus = "queued" | "running" | "ok" | "error";

export type SpaApiCall = {
  at: string;
  endpoint: string;
  pageOffset: number;
  pageSize: number;
  quoteCount: number;
  /** Actual Yahoo Finance / CoinGecko HTTP requests made for this symbol batch. */
  upstreamRequests?: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
};

export type SpaRun = {
  id: string;
  exchangeId: string;
  status: SpaRunStatus;
  trigger: "manual" | "cron";
  offset: number;
  pageSize: number;
  scanned: number;
  pages: number;
  sampleId: string | null;
  calls: SpaApiCall[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SpaSampleMeta = {
  id: string;
  exchangeId: string;
  runId: string;
  sampledAt: string;
  symbolCount: number;
  /** Calls made to Yahoo or CoinGecko. */
  priceFeedCalls: number;
  /** How many symbol batches were pulled to cover the exchange. */
  batchCount: number;
  createdAt: string;
};

export type SpaPrice = {
  symbol: string;
  price: number | null;
  volume: number | null;
  volumeQuote: number | null;
  name: string | null;
};

export type SpaSampleDetail = {
  id: string;
  exchangeId: string;
  exchangeCode: string | null;
  runId: string;
  sampledAt: string;
  symbolCount: number;
  calls: SpaApiCall[];
  prices: SpaPrice[];
  createdAt: string;
};

export type SpaExchange = {
  id: string;
  code: string;
  label: string;
  enabled: boolean;
  intervalMinutes: number;
  retentionDays: number;
  enabledQuoteAssets: string[] | null;
  sessionOpen: boolean;
  timezone: string;
  openLocal: string;
  closeLocal: string;
  includeWeekends: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastRunScanned: number | null;
  lastSampleId: string | null;
  updatedAt: string;
  sampleCount: number;
  activeRun: SpaRun | null;
  recentSamples: SpaSampleMeta[];
};

export function listSpaExchanges() {
  return apiFetch<{ exchanges: SpaExchange[] }>("/spa");
}

export function getSpaExchange(id: string) {
  return apiFetch<{ exchange: SpaExchange }>(`/spa/${id}`);
}

export function updateSpaExchange(
  id: string,
  body: {
    enabled?: boolean;
    intervalMinutes?: number;
    retentionDays?: number;
    enabledQuoteAssets?: string[];
    timezone?: string;
    openLocal?: string;
    closeLocal?: string;
    includeWeekends?: boolean;
  },
) {
  return apiFetch<{ exchange: SpaExchange }>(`/spa/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function runSpaExchange(id: string) {
  return apiFetch<{ run: SpaRun }>(`/spa/${id}/run`, { method: "POST" });
}

export function getSpaRun(runId: string) {
  return apiFetch<{ run: SpaRun }>(`/spa/runs/${runId}`);
}

export function getSpaSample(sampleId: string) {
  return apiFetch<{ sample: SpaSampleDetail }>(`/spa/samples/${sampleId}`);
}
