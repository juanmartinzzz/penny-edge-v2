/** Minimum temperature written to the HISS hot list (SPA photos keep everyone). */
export const HISS_HOT_MIN_TEMPERATURE = 70;

export function isHissHot(temperature: number | null | undefined): boolean {
  return temperature != null && temperature >= HISS_HOT_MIN_TEMPERATURE;
}
