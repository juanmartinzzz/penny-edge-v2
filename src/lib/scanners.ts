/**
 * Client for Exchangewide Volume Gate (EVG).
 * Product name for the `/scanners` API — exchange scan + volume filter batch.
 */
import { apiFetch } from "./api";

export type ScannerRunStatus = "queued" | "running" | "ok" | "error";

export type ScannerRun = {
  id: string;
  scannerId: string;
  status: ScannerRunStatus;
  trigger: "manual" | "cron";
  offset: number;
  pageSize: number;
  scanned: number;
  matched: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WarmSymbol = {
  id: string;
  scannerId: string;
  symbol: string;
  exchange: string;
  name: string | null;
  price: number | null;
  changePercent: number | null;
  volume: number | null;
  avgVolume10d: number | null;
  avgVolume3m: number | null;
  fiftyDayAverage: number | null;
  approxDailyValue: number | null;
  currency: string | null;
  lastSeenAt: string;
  analyzedAt?: string | null;
  analysisRunId?: string | null;
  analysis?: unknown;
};

export type Scanner = {
  id: string;
  code: string;
  label: string;
  enabled: boolean;
  intervalHours: number;
  minAvgVolume10d: number | null;
  minApproxDailyValue: number | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastRunScanned: number | null;
  lastRunMatched: number | null;
  updatedAt: string;
  warmCount: number;
  activeRun: ScannerRun | null;
  symbols?: WarmSymbol[];
};

export function listScanners() {
  return apiFetch<{ scanners: Scanner[] }>("/scanners");
}

export function getScanner(id: string) {
  return apiFetch<{ scanner: Scanner }>(`/scanners/${id}`);
}

export function updateScanner(
  id: string,
  body: {
    enabled?: boolean;
    intervalHours?: number;
    minAvgVolume10d?: number | null;
    minApproxDailyValue?: number | null;
  },
) {
  return apiFetch<{ scanner: Scanner }>(`/scanners/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function runScanner(id: string) {
  return apiFetch<{ run: ScannerRun }>(`/scanners/${id}/run`, {
    method: "POST",
  });
}

export function getScannerRun(runId: string) {
  return apiFetch<{ run: ScannerRun }>(`/scanners/runs/${runId}`);
}
