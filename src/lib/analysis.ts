/**
 * Client for Trend Analysis for Symbols (TAS).
 * Product name for the `/analysis` API — deep price analysis of EVG warm symbols.
 */
import { apiFetch } from "./api";

export type AnalysisRunStatus = "queued" | "running" | "ok" | "error";

export type AnalysisRun = {
  id: string;
  status: AnalysisRunStatus;
  trigger: "manual" | "cron";
  offset: number;
  pageSize: number;
  scanned: number;
  succeeded: number;
  failed: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SymbolAnalysis = {
  asOf: string;
  lookbackDays: number;
  rollHours: number;
  daily: {
    bars: Array<{ t: number; o: number; h: number; l: number; c: number; v?: number }>;
    avgClose: number | null;
  };
  intraday: {
    sourceInterval: "1h";
    points: Array<{ t: number; c: number; rollingAvgClose: number }>;
  };
  summary: {
    lastClose: number | null;
    closeVsLookbackAvgPct: number | null;
    rollingAvgClose: number | null;
  };
  error?: string;
};

export type AnalysisSymbol = {
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
  analyzedAt: string | null;
  analysisRunId: string | null;
  analysis: SymbolAnalysis | null;
};

export type AnalysisConfig = {
  id: string;
  enabled: boolean;
  intervalHours: number;
  lookbackDays: number;
  rollHours: number;
  pageSize: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastRunScanned: number | null;
  lastRunOk: number | null;
  lastRunFailed: number | null;
  updatedAt: string;
};

export type AnalysisOverview = {
  config: AnalysisConfig;
  warmCount: number;
  analyzedCount: number;
  activeRun: AnalysisRun | null;
};

export function getAnalysis() {
  return apiFetch<AnalysisOverview>("/analysis");
}

export function getAnalysisSymbols() {
  return apiFetch<{ count: number; symbols: AnalysisSymbol[] }>("/analysis/symbols");
}

export function updateAnalysis(body: {
  enabled?: boolean;
  intervalHours?: number;
  lookbackDays?: number;
  rollHours?: number;
  pageSize?: number;
}) {
  return apiFetch<AnalysisOverview>("/analysis", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function runAnalysis() {
  return apiFetch<{ run: AnalysisRun }>("/analysis/run", {
    method: "POST",
  });
}

export function getAnalysisRun(runId: string) {
  return apiFetch<{ run: AnalysisRun }>(`/analysis/runs/${runId}`);
}
