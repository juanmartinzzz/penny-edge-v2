/**
 * HISS volume fold — simplest UTC calendar-day buckets.
 * See docs/hiss.md for pitfalls and future improvements.
 */
import {
  HISS_DAILY_BUCKET_RETENTION,
  HISS_VOLUME_LOOKBACK_DAYS,
  type HissSymbolMemory,
  utcDayKey,
} from "./types";

export type VolumeFoldResult = {
  memory: HissSymbolMemory;
  volumeLastFullDay: number | null;
  avgVolume10d: number | null;
  volumeCoverageDays: number;
};

function pruneDailyMap(
  map: Record<string, number>,
  keep: number,
): Record<string, number> {
  const keys = Object.keys(map).sort();
  if (keys.length <= keep) return map;
  const drop = keys.slice(0, keys.length - keep);
  const next = { ...map };
  for (const key of drop) delete next[key];
  return next;
}

function sealedDayKeys(memory: HissSymbolMemory): string[] {
  return Object.keys(memory.dailyVolumes).sort();
}

/**
 * Fold one SPA volume observation into memory.
 * Uses max volume within a UTC calendar day (good enough for cumulative session volume).
 * When the calendar day rolls, the previous day's max is sealed as a full-day bucket.
 */
export function foldVolumeObservation(
  memory: HissSymbolMemory,
  sampledAtIso: string,
  volume: number | null,
): VolumeFoldResult {
  const day = utcDayKey(sampledAtIso);
  const next: HissSymbolMemory = {
    ...memory,
    dailyVolumes: { ...memory.dailyVolumes },
    dailyCloses: { ...memory.dailyCloses },
  };

  if (
    volume != null &&
    Number.isFinite(volume) &&
    volume >= 0
  ) {
    if (next.currentDay == null) {
      next.currentDay = day;
      next.currentDayMaxVol = volume;
    } else if (next.currentDay === day) {
      next.currentDayMaxVol =
        next.currentDayMaxVol == null
          ? volume
          : Math.max(next.currentDayMaxVol, volume);
    } else {
      // Seal previous calendar day.
      if (
        next.currentDayMaxVol != null &&
        Number.isFinite(next.currentDayMaxVol)
      ) {
        next.dailyVolumes[next.currentDay] = next.currentDayMaxVol;
      }
      next.currentDay = day;
      next.currentDayMaxVol = volume;
    }
  } else if (next.currentDay != null && next.currentDay !== day) {
    // Day rolled with no volume on the new sample — still seal prior day.
    if (
      next.currentDayMaxVol != null &&
      Number.isFinite(next.currentDayMaxVol)
    ) {
      next.dailyVolumes[next.currentDay] = next.currentDayMaxVol;
    }
    next.currentDay = day;
    next.currentDayMaxVol = null;
  }

  next.dailyVolumes = pruneDailyMap(
    next.dailyVolumes,
    HISS_DAILY_BUCKET_RETENTION,
  );
  next.dailyCloses = pruneDailyMap(
    next.dailyCloses,
    HISS_DAILY_BUCKET_RETENTION,
  );

  const sealed = sealedDayKeys(next);
  const coverage = sealed.length;
  const lastFull =
    coverage > 0 ? (next.dailyVolumes[sealed[sealed.length - 1]!] ?? null) : null;

  const window = sealed.slice(-HISS_VOLUME_LOOKBACK_DAYS);
  let avg: number | null = null;
  if (window.length > 0) {
    const sum = window.reduce((acc, key) => acc + (next.dailyVolumes[key] ?? 0), 0);
    avg = sum / window.length;
  }

  return {
    memory: next,
    volumeLastFullDay: lastFull,
    avgVolume10d: avg,
    volumeCoverageDays: coverage,
  };
}

/** Record the day's last close (for below-avg boost). */
export function recordDailyClose(
  memory: HissSymbolMemory,
  sampledAtIso: string,
  price: number | null,
): HissSymbolMemory {
  if (price == null || !Number.isFinite(price)) return memory;
  const day = utcDayKey(sampledAtIso);
  return {
    ...memory,
    dailyCloses: {
      ...memory.dailyCloses,
      [day]: price,
    },
  };
}

/** % vs mean of recent sealed/current daily closes (negative = below avg). */
export function closeVsLookbackAvgPct(memory: HissSymbolMemory): number | null {
  const keys = Object.keys(memory.dailyCloses).sort();
  if (keys.length < 2) return null;
  const window = keys.slice(-HISS_VOLUME_LOOKBACK_DAYS);
  const values = window
    .map((k) => memory.dailyCloses[k])
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (values.length < 2) return null;
  const last = values[values.length - 1]!;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (avg <= 0) return null;
  return ((last - avg) / avg) * 100;
}
