/** Preferred minimum temperature written to the HISS hot list. */
export const HISS_HOT_MIN_TEMPERATURE = 70;

/** If nobody meets the preferred min, drop the cutoff by this until the list is non-empty. */
export const HISS_HOT_THRESHOLD_STEP = 10;

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

export function selectHissHotRows<T extends { temperature: number | null }>(
  rows: T[],
): T[] {
  const threshold = resolveHissHotThreshold(rows.map((row) => row.temperature));
  if (threshold == null) return [];
  return rows.filter((row) => isHissHot(row.temperature, threshold));
}
