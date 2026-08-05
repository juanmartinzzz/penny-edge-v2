/**
 * Client for SWATCH (Sell Watch) — close-to-close variation alerts
 * plus optional all-time return (ATR) P&L triggers.
 */
import { apiFetch } from "./api";

export type SwatchRunStatus = "queued" | "running" | "ok" | "error";
export type SwatchDirection = "up" | "down" | "either";
export type SwatchAtrUnit = "usd" | "pct";
export type SwatchCostInputMode = "total" | "avg";

export type SwatchAtrTrigger = {
  unit: SwatchAtrUnit;
  value: number;
};

export type SwatchRun = {
  id: string;
  status: SwatchRunStatus;
  trigger: "manual" | "cron";
  scanned: number;
  succeeded: number;
  failed: number;
  alerted: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SwatchAsset = {
  id: string;
  symbol: string;
  exchange: string;
  enabled: boolean;
  thresholdPct: number;
  windowHours: number;
  direction: SwatchDirection;
  cooldownMinutes: number;
  shares: number | null;
  avgCost: number | null;
  totalInvested: number | null;
  atrTriggers: SwatchAtrTrigger[];
  lastCheckedAt: string | null;
  lastClose: number | null;
  lastMovePct: number | null;
  lastAtrPnl: number | null;
  lastAtrPct: number | null;
  lastAlertedAt: string | null;
  lastAlertMovePct: number | null;
  lastAlertKind: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SwatchConfig = {
  id: string;
  enabled: boolean;
  intervalHours: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastRunScanned: number | null;
  lastRunOk: number | null;
  lastRunFailed: number | null;
  lastRunAlerted: number | null;
  updatedAt: string;
};

export type SwatchFormDefaults = {
  thresholdPct: number;
  windowHours: number;
  direction: SwatchDirection;
  cooldownMinutes: number;
  totalInvested: number;
  costInputMode: SwatchCostInputMode;
};

export type SwatchExchangeOption = {
  value: string;
  label: string;
};

export type SwatchOverview = {
  config: SwatchConfig;
  assetCount: number;
  enabledCount: number;
  defaults: SwatchFormDefaults;
  exchanges: SwatchExchangeOption[];
  assets: SwatchAsset[];
  activeRun: SwatchRun | null;
};

const DEFAULTS_STORAGE_KEY = "penny-edge.swatch.form-defaults";

export const BUILTIN_SWATCH_DEFAULTS: SwatchFormDefaults = {
  thresholdPct: 10,
  windowHours: 3,
  direction: "either",
  cooldownMinutes: 30,
  totalInvested: 3000,
  costInputMode: "total",
};

export function loadSwatchFormDefaults(
  serverDefaults?: Partial<SwatchFormDefaults>,
): SwatchFormDefaults {
  const base: SwatchFormDefaults = {
    ...BUILTIN_SWATCH_DEFAULTS,
    ...serverDefaults,
    costInputMode:
      serverDefaults?.costInputMode === "avg" ||
      serverDefaults?.costInputMode === "total"
        ? serverDefaults.costInputMode
        : BUILTIN_SWATCH_DEFAULTS.costInputMode,
  };
  try {
    const raw = localStorage.getItem(DEFAULTS_STORAGE_KEY);
    if (!raw) return { ...base };
    const parsed = JSON.parse(raw) as Partial<SwatchFormDefaults>;
    return {
      thresholdPct:
        typeof parsed.thresholdPct === "number"
          ? parsed.thresholdPct
          : base.thresholdPct,
      windowHours:
        typeof parsed.windowHours === "number"
          ? parsed.windowHours
          : base.windowHours,
      direction:
        parsed.direction === "up" ||
        parsed.direction === "down" ||
        parsed.direction === "either"
          ? parsed.direction
          : base.direction,
      cooldownMinutes:
        typeof parsed.cooldownMinutes === "number"
          ? parsed.cooldownMinutes
          : base.cooldownMinutes,
      totalInvested:
        typeof parsed.totalInvested === "number" && parsed.totalInvested > 0
          ? parsed.totalInvested
          : base.totalInvested,
      costInputMode:
        parsed.costInputMode === "avg" || parsed.costInputMode === "total"
          ? parsed.costInputMode
          : base.costInputMode,
    };
  } catch {
    return { ...base };
  }
}

export function saveSwatchFormDefaults(defaults: SwatchFormDefaults): void {
  localStorage.setItem(DEFAULTS_STORAGE_KEY, JSON.stringify(defaults));
}

export type SwatchAssetWriteBody = {
  enabled?: boolean;
  thresholdPct?: number;
  windowHours?: number;
  direction?: SwatchDirection;
  cooldownMinutes?: number;
  shares?: number | null;
  avgCost?: number | null;
  totalInvested?: number | null;
  atrTriggers?: SwatchAtrTrigger[];
};

export function getSwatch() {
  return apiFetch<SwatchOverview>("/swatch");
}

export function updateSwatch(body: {
  enabled?: boolean;
  intervalHours?: number;
}) {
  return apiFetch<SwatchOverview>("/swatch", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function createSwatchAsset(
  body: {
    symbol: string;
    exchange: string;
  } & SwatchAssetWriteBody,
) {
  return apiFetch<{ asset: SwatchAsset }>("/swatch/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateSwatchAsset(id: string, body: SwatchAssetWriteBody) {
  return apiFetch<{ asset: SwatchAsset }>(`/swatch/assets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function deleteSwatchAsset(id: string) {
  return apiFetch<{ ok: boolean }>(`/swatch/assets/${id}`, {
    method: "DELETE",
  });
}

export function runSwatch() {
  return apiFetch<{ run: SwatchRun }>("/swatch/run", {
    method: "POST",
  });
}

export function getSwatchRun(runId: string) {
  return apiFetch<{ run: SwatchRun }>(`/swatch/runs/${runId}`);
}

export const DIRECTION_OPTIONS: { value: SwatchDirection; label: string }[] = [
  { value: "either", label: "Either way" },
  { value: "down", label: "Down only" },
  { value: "up", label: "Up only" },
];

export const COST_MODE_OPTIONS: {
  value: SwatchCostInputMode;
  label: string;
}[] = [
  { value: "total", label: "Total invested" },
  { value: "avg", label: "Avg cost / share" },
];

export const ATR_UNIT_OPTIONS: { value: SwatchAtrUnit; label: string }[] = [
  { value: "usd", label: "$" },
  { value: "pct", label: "%" },
];
