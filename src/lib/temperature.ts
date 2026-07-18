/**
 * Client for Heat and Interest Scale (HIS).
 * Product name for the `/temperature` API — crash-heat scoring of TAS snapshots.
 */
import { apiFetch } from "./api";

export type TemperatureRunStatus = "queued" | "running" | "ok" | "error";

export type TemperatureRun = {
  id: string;
  status: TemperatureRunStatus;
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

export type TemperatureParams = {
  windowHours: number;
  peakLookbackHours: number;
  impulseHours: number;
  depthRefPct: number;
  depthCurve: number;
  minDropPct: number;
  wDepth: number;
  wSharp: number;
  wRecency: number;
  recencyHalfLifeHours: number;
  upsideFlatBand: number;
  upsideScale: number;
  upsideCap: number;
  belowAvgBoostMax: number;
  belowAvgRefPct: number;
  minIntradayPoints: number;
};

export type TemperatureComponents = {
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
  source: "hourly" | "points" | "none";
  error?: string;
};

export type TemperatureSymbol = {
  id: string;
  scannerId: string;
  symbol: string;
  exchange: string;
  name: string | null;
  price: number | null;
  changePercent: number | null;
  analyzedAt: string | null;
  temperature: number | null;
  temperatureAt: string | null;
  temperatureRunId: string | null;
  components: TemperatureComponents | null;
  analysis: unknown;
};

export type TemperatureConfig = {
  id: string;
  enabled: boolean;
  intervalHours: number;
  pageSize: number;
  params: TemperatureParams;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastRunScanned: number | null;
  lastRunOk: number | null;
  lastRunFailed: number | null;
  updatedAt: string;
};

export type TemperatureOverview = {
  config: TemperatureConfig;
  analyzedCount: number;
  scoredCount: number;
  defaults: TemperatureParams;
  activeRun: TemperatureRun | null;
};

export function getTemperature() {
  return apiFetch<TemperatureOverview>("/temperature");
}

export function getTemperatureSymbols() {
  return apiFetch<{ count: number; symbols: TemperatureSymbol[] }>(
    "/temperature/symbols",
  );
}

export function updateTemperature(body: {
  enabled?: boolean;
  intervalHours?: number;
  pageSize?: number;
  params?: Partial<TemperatureParams>;
}) {
  return apiFetch<TemperatureOverview>("/temperature", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function runTemperature() {
  return apiFetch<{ run: TemperatureRun }>("/temperature/run", {
    method: "POST",
  });
}

export function getTemperatureRun(runId: string) {
  return apiFetch<{ run: TemperatureRun }>(`/temperature/runs/${runId}`);
}

/** Foolproof knob metadata for the HIS settings UI. */
export type TemperatureKnobMeta = {
  key: keyof TemperatureParams | "intervalHours";
  label: string;
  help: string;
  min: number;
  max?: number;
  step: number;
  section: "schedule" | "windows" | "blend" | "cooloff" | "upside" | "boost";
  /** main = always visible; advanced = collapsed by default. */
  tier: "main" | "advanced";
};

export const TEMPERATURE_KNOBS: TemperatureKnobMeta[] = [
  {
    key: "intervalHours",
    label: "How often to re-score",
    help: "How many hours between automatic runs. Think: “check the oven every X hours.” Smaller = fresher temperatures. Doesn’t change the math — only when we re-run it.",
    min: 1,
    step: 1,
    section: "schedule",
    tier: "main",
  },
  {
    key: "windowHours",
    label: "Recent-move window (hours)",
    help: "Only look at price action inside this many hours. “Did it crash in the last N hours?” Bigger window = catches slower dumps; smaller = only sudden stuff.",
    min: 1,
    step: 1,
    section: "windows",
    tier: "main",
  },
  {
    key: "impulseHours",
    label: '"All-in-one-go" chunk (hours)',
    help: "Size of the “wham” chunk. We ask: “did most of the drop happen inside this short burst?” 2 means a two-hour freefall counts as sharp; 6 means a slow slide can still look sharp.",
    min: 1,
    step: 1,
    section: "windows",
    tier: "main",
  },
  {
    key: "depthRefPct",
    label: "“Deep” means this % drop",
    help: "A fall of this many percent from the recent peak counts as “fully deep” (depth score maxed). 15 means a −15% dump is deep; 30 means you’re pickier and only huge crashes feel deep.",
    min: 0.1,
    step: 0.5,
    section: "blend",
    tier: "main",
  },
  {
    key: "recencyHalfLifeHours",
    label: "Cool-off half-life (hours)",
    help: "After the dump ends, heat fades. This is how many hours until that “freshness” part is about half as strong. 4 ≈ half cool in 4 hours.",
    min: 0.1,
    step: 0.5,
    section: "cooloff",
    tier: "advanced",
  },
  {
    key: "upsideCap",
    label: "Max temp when flat/up",
    help: "Hard ceiling for rising/stable names. Even if math wants 90, they can’t go above this. Keeps green candles out of the hot zone.",
    min: 0,
    step: 1,
    section: "upside",
    tier: "advanced",
  },
  {
    key: "belowAvgBoostMax",
    label: "Extra heat if already cheap",
    help: "Bonus points (up to this many) if the stock is already below its TAS lookback average. “It didn’t just dip — it’s also cheap vs recent history.” Set 0 to turn the bonus off.",
    min: 0,
    step: 1,
    section: "boost",
    tier: "advanced",
  },
  {
    key: "peakLookbackHours",
    label: "Peak search window (hours)",
    help: "How far back we look for the highest price before measuring the fall. Like: “from the top of the hill, how far down are we now?” Usually same or longer than the recent-move window.",
    min: 1,
    step: 1,
    section: "windows",
    tier: "advanced",
  },
  {
    key: "minIntradayPoints",
    label: "Min hourly dots needed",
    help: "Need at least this many hourly price dots or we skip scoring (not enough info). Like refusing to guess from one data point.",
    min: 2,
    step: 1,
    section: "windows",
    tier: "advanced",
  },
  {
    key: "depthCurve",
    label: "Depth curve (bend)",
    help: "How we bend the depth score. 1 = straight line. Above 1 = small dips stay cooler longer; only big falls get hot. Leave near 1.2 unless you’re tuning hard.",
    min: 0.01,
    step: 0.05,
    section: "blend",
    tier: "advanced",
  },
  {
    key: "minDropPct",
    label: "Noise floor (% drop)",
    help: "Tiny wiggles below this % don’t count as “sharp.” Stops random 1% noise from looking like a crash.",
    min: 0,
    step: 0.5,
    section: "blend",
    tier: "advanced",
  },
  {
    key: "wDepth",
    label: "Weight: how deep",
    help: "How much “how far did it fall?” matters vs the other two weights. Bigger = deep falls score hotter even if they weren’t super sudden.",
    min: 0,
    step: 0.05,
    section: "blend",
    tier: "advanced",
  },
  {
    key: "wSharp",
    label: "Weight: all in one go",
    help: "How much “did it dump in a short burst?” matters. Bigger = slow bleeds stay cooler; sudden cliffs get hotter.",
    min: 0,
    step: 0.05,
    section: "blend",
    tier: "advanced",
  },
  {
    key: "wRecency",
    label: "Weight: how recent",
    help: "How much “did it just happen?” matters. Bigger = yesterday’s crash cools off faster in the score.",
    min: 0,
    step: 0.05,
    section: "blend",
    tier: "advanced",
  },
  {
    key: "upsideFlatBand",
    label: "Flat/up if return ≥ this %",
    help: "If the short-window return is at least this %, we treat the name as stable or rising and crush the heat. 0 = anything not falling gets dampened. −1 = even a tiny dip still counts as “not rising.”",
    min: -20,
    step: 0.5,
    section: "upside",
    tier: "advanced",
  },
  {
    key: "upsideScale",
    label: "Crush factor when flat/up",
    help: "When price is flat/up, multiply the raw heat by this. 0.25 means keep only a quarter of the heat. 0 = force them ice cold.",
    min: 0,
    step: 0.05,
    section: "upside",
    tier: "advanced",
  },
  {
    key: "belowAvgRefPct",
    label: "Cheap = this % below avg",
    help: "How far below the lookback average earns the full cheapness bonus. 20 means −20% vs average = full bonus.",
    min: 0.1,
    step: 1,
    section: "boost",
    tier: "advanced",
  },
];

export const TEMPERATURE_SECTIONS: Record<
  TemperatureKnobMeta["section"],
  { title: string; blurb: string }
> = {
  schedule: {
    title: "Schedule",
    blurb: "When the oven timer dings — not the recipe.",
  },
  windows: {
    title: "What “recent” means",
    blurb: "How far back we look, and how big a “sudden” chunk is.",
  },
  blend: {
    title: "What makes it hot",
    blurb: "Depth + sharpness + how we mix those ingredients.",
  },
  cooloff: {
    title: "Cooling off",
    blurb: "Old crashes shouldn’t stay spicy forever.",
  },
  upside: {
    title: "Keep winners cool",
    blurb: "Flat or rising names get their heat crushed on purpose.",
  },
  boost: {
    title: "Already-cheap bonus",
    blurb: "Optional nudge if TAS says it’s below the lookback average.",
  },
};
