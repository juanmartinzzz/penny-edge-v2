/**
 * Trend Analysis for Symbols (TAS) types and helpers.
 * Product alias for deep price-trend analysis of EVG warm symbols.
 */
import type { Bar } from "../market/types";

export type AnalysisRunStatus = "queued" | "running" | "ok" | "error";
export type AnalysisRunTrigger = "manual" | "cron";

export interface AnalysisConfigRow {
  id: string;
  enabled: number;
  interval_hours: number;
  lookback_days: number;
  roll_hours: number;
  page_size: number;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  last_run_scanned: number | null;
  last_run_ok: number | null;
  last_run_failed: number | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisRunRow {
  id: string;
  status: AnalysisRunStatus;
  trigger: AnalysisRunTrigger;
  offset: number;
  page_size: number;
  scanned: number;
  succeeded: number;
  failed: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisDailyBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

/** Raw hourly close from Yahoo (source series for impulse / temperature). */
export interface AnalysisHourlyClose {
  t: number;
  c: number;
}

export interface AnalysisIntradayPoint {
  t: number;
  c: number;
  rollingAvgClose: number;
}

export interface SymbolAnalysis {
  asOf: string;
  lookbackDays: number;
  rollHours: number;
  daily: {
    bars: AnalysisDailyBar[];
    avgClose: number | null;
  };
  intraday: {
    sourceInterval: "1h";
    /** Raw hourly closes (full source series). */
    hourly: AnalysisHourlyClose[];
    /** Roll-window buckets (homemade averages over `rollHours`). */
    points: AnalysisIntradayPoint[];
  };
  summary: {
    lastClose: number | null;
    closeVsLookbackAvgPct: number | null;
    rollingAvgClose: number | null;
  };
  error?: string;
}

export interface AnalysisJobMessage {
  type: "analysis_page";
  runId: string;
  offset: number;
}

export function addHours(iso: string | Date, hours: number): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Map lookback days to a Yahoo chart range that covers it. */
export function dailyRangeForLookback(lookbackDays: number): "1mo" | "3mo" | "6mo" {
  if (lookbackDays <= 28) return "1mo";
  if (lookbackDays <= 90) return "3mo";
  return "6mo";
}

/** Build TAS analysis JSON from daily + hourly Yahoo bars (price-only). */
export function buildSymbolAnalysis(input: {
  asOf: string;
  lookbackDays: number;
  rollHours: number;
  dailyBars: Bar[];
  hourlyBars: Bar[];
}): SymbolAnalysis {
  const lookbackDays = Math.max(1, Math.floor(input.lookbackDays));
  const rollHours = Math.max(1, Math.floor(input.rollHours));

  const dailyBars = input.dailyBars.slice(-lookbackDays).map((bar) => ({
    t: bar.time,
    o: bar.open,
    h: bar.high,
    l: bar.low,
    c: bar.close,
    v: bar.volume,
  }));

  const avgClose = mean(dailyBars.map((bar) => bar.c));
  const lastClose =
    dailyBars.length > 0 ? dailyBars[dailyBars.length - 1]!.c : null;

  const hourly: AnalysisHourlyClose[] = input.hourlyBars
    .slice()
    .sort((a, b) => a.time - b.time)
    .map((bar) => ({ t: bar.time, c: bar.close }));

  const bucketMs = rollHours * 60 * 60 * 1000;
  const buckets = new Map<number, number[]>();

  for (const bar of input.hourlyBars) {
    const bucketStart = Math.floor((bar.time * 1000) / bucketMs) * bucketMs;
    const closes = buckets.get(bucketStart) ?? [];
    closes.push(bar.close);
    buckets.set(bucketStart, closes);
  }

  const points: AnalysisIntradayPoint[] = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketStart, closes]) => {
      const rollingAvgClose = mean(closes)!;
      return {
        t: Math.floor(bucketStart / 1000) + rollHours * 3600,
        c: closes[closes.length - 1]!,
        rollingAvgClose,
      };
    });

  const rollingAvgClose =
    points.length > 0 ? points[points.length - 1]!.rollingAvgClose : null;

  let closeVsLookbackAvgPct: number | null = null;
  if (lastClose != null && avgClose != null && avgClose !== 0) {
    closeVsLookbackAvgPct = ((lastClose - avgClose) / avgClose) * 100;
  }

  return {
    asOf: input.asOf,
    lookbackDays,
    rollHours,
    daily: { bars: dailyBars, avgClose },
    intraday: { sourceInterval: "1h", hourly, points },
    summary: {
      lastClose,
      closeVsLookbackAvgPct,
      rollingAvgClose,
    },
  };
}

export function parseAnalysisJson(raw: string | null): SymbolAnalysis | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SymbolAnalysis;
    if (!parsed.intraday) return parsed;
    if (!Array.isArray(parsed.intraday.hourly)) {
      parsed.intraday.hourly = [];
    }
    if (!Array.isArray(parsed.intraday.points)) {
      parsed.intraday.points = [];
    }
    return parsed;
  } catch {
    return null;
  }
}
