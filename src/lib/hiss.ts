/**
 * Client for HISS — Heat Interest SPA Scores.
 */
import { apiFetch } from "./api";

export type HissTemperatureComponents = {
  retW: number | null;
  dd: number | null;
  impulseDrop: number | null;
  hoursSinceImpulse: number | null;
  depth: number | null;
  sharpness: number | null;
  recency: number | null;
  belowAvgBoost: number | null;
  raw: number | null;
  dampened: boolean;
  source: "spa" | "none";
  error?: string;
};

export type HissSymbol = {
  id: string;
  exchangeId: string;
  exchangeCode: string;
  symbol: string;
  name: string | null;
  lastPrice: number | null;
  lastVolume: number | null;
  lastSampleAt: string | null;
  lastSampleId: string | null;
  volumeLastFullDay: number | null;
  avgVolume10d: number | null;
  volumeCoverageDays: number;
  temperature: number | null;
  components: HissTemperatureComponents | null;
  temperatureAt: string | null;
  updatedAt: string;
};

export type HissOverview = {
  totalSymbols: number;
  lastUpdatedAt: string | null;
  exchanges: Array<{
    exchangeId: string;
    exchangeCode: string;
    symbolCount: number;
  }>;
};

export type HissSymbolsQuery = {
  exchangeId?: string;
  minAvgVolume10d?: number;
  minVolumeLastFullDay?: number;
  limit?: number;
  offset?: number;
};

export function getHissOverview() {
  return apiFetch<HissOverview>("/hiss");
}

export function listHissSymbols(query: HissSymbolsQuery = {}) {
  const params = new URLSearchParams();
  if (query.exchangeId) params.set("exchangeId", query.exchangeId);
  if (query.minAvgVolume10d != null) {
    params.set("minAvgVolume10d", String(query.minAvgVolume10d));
  }
  if (query.minVolumeLastFullDay != null) {
    params.set("minVolumeLastFullDay", String(query.minVolumeLastFullDay));
  }
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  const qs = params.toString();
  return apiFetch<{ total: number; symbols: HissSymbol[] }>(
    `/hiss/symbols${qs ? `?${qs}` : ""}`,
  );
}

export function foldHiss(body: { exchangeId: string; sampleId?: string }) {
  return apiFetch<{ updated: number; sampleId: string }>("/hiss/fold", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function isHotHissTemperature(value: number | null | undefined): boolean {
  return value != null && value >= 70;
}

const FILTERS_STORAGE_KEY = "penny-edge.hiss.filters";

/** Default volume gate mins (USDT). */
export const DEFAULT_HISS_MIN_AVG_VOLUME_10D = 1_000_000;
export const DEFAULT_HISS_MIN_VOLUME_LAST_FULL_DAY = 2_000_000;

export type HissFilterDefaults = {
  exchangeId: string;
  minAvg10d: string;
  minLastDay: string;
};

export function loadHissFilterDefaults(
  allExchangesValue: string,
): HissFilterDefaults {
  const base: HissFilterDefaults = {
    exchangeId: allExchangesValue,
    minAvg10d: String(DEFAULT_HISS_MIN_AVG_VOLUME_10D),
    minLastDay: String(DEFAULT_HISS_MIN_VOLUME_LAST_FULL_DAY),
  };
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<HissFilterDefaults>;
    return {
      exchangeId:
        typeof parsed.exchangeId === "string" && parsed.exchangeId.trim()
          ? parsed.exchangeId
          : base.exchangeId,
      minAvg10d:
        typeof parsed.minAvg10d === "string" ? parsed.minAvg10d : base.minAvg10d,
      minLastDay:
        typeof parsed.minLastDay === "string"
          ? parsed.minLastDay
          : base.minLastDay,
    };
  } catch {
    return base;
  }
}

export function saveHissFilterDefaults(filters: HissFilterDefaults): void {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // ignore quota / private mode
  }
}
