/** Preferred minimum temperature written to the HISS hot list. */
export const HISS_HOT_MIN_TEMPERATURE = 70;

/** If nobody meets the preferred min, drop the cutoff by this until the list is non-empty. */
export const HISS_HOT_THRESHOLD_STEP = 10;

/**
 * When the cutoff is below {@link HISS_HOT_MIN_TEMPERATURE}, keep at most this
 * many names (hottest first). Names at or above the preferred min are never capped.
 */
export const HISS_HOT_FALLBACK_MAX_ROWS = 10;

export function isHissHot(
  temperature: number | null | undefined,
  minTemperature = HISS_HOT_MIN_TEMPERATURE,
): boolean {
  return temperature != null && temperature >= minTemperature;
}

/**
 * Hottest cutoff that still yields at least one symbol.
 * Tries 70, then 60, 50, … down to 0. Null if no temperatures exist.
 */
export function resolveHissHotThreshold(
  temperatures: ReadonlyArray<number | null | undefined>,
): number | null {
  for (
    let min = HISS_HOT_MIN_TEMPERATURE;
    min >= 0;
    min -= HISS_HOT_THRESHOLD_STEP
  ) {
    for (const temperature of temperatures) {
      if (isHissHot(temperature, min)) return min;
    }
  }
  return null;
}

type HissHotRankable = {
  temperature: number | null;
  symbol?: string;
};

function rankHissHotRows<T extends HissHotRankable>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const delta =
      (b.temperature ?? Number.NEGATIVE_INFINITY) -
      (a.temperature ?? Number.NEGATIVE_INFINITY);
    if (delta !== 0) return delta;
    return (a.symbol ?? "").localeCompare(b.symbol ?? "");
  });
}

export function selectHissHotRows<T extends HissHotRankable>(rows: T[]): T[] {
  const preferred = rows.filter((row) => isHissHot(row.temperature));
  if (preferred.length > 0) return rankHissHotRows(preferred);

  const threshold = resolveHissHotThreshold(rows.map((row) => row.temperature));
  if (threshold == null) return [];

  const fallback = rows.filter((row) => isHissHot(row.temperature, threshold));
  return rankHissHotRows(fallback).slice(0, HISS_HOT_FALLBACK_MAX_ROWS);
}
