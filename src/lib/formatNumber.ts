/**
 * Number display helpers.
 * Adaptive decimals keep equities readable while tiny crypto prices stay non-zero.
 */

export function formatFixedNumber(
  value: number | null | undefined,
  maximumFractionDigits = 2,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

/** Enough fraction digits to show ~4 significant figures for |value| < 1. */
export function adaptiveFractionDigits(value: number): number {
  const abs = Math.abs(value);
  if (abs === 0 || abs >= 1) return 2;
  const order = Math.floor(Math.log10(abs));
  // order -1 → 0.1…; want a few digits past the first significant place.
  return Math.min(10, Math.max(2, -order + 3));
}

export function formatAdaptiveNumber(
  value: number | null | undefined,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (value === 0) return "0";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: adaptiveFractionDigits(value),
  }).format(value);
}
