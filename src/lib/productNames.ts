/** Canonical product acronym expansions for UI labeling. */
export const PRODUCT_NAMES = {
  EVG: "Exchangewide Volume Gate",
  TAS: "Trend Analysis for Symbols",
  HIS: "Heat and Interest Scale",
} as const;

export type ProductAcronym = keyof typeof PRODUCT_NAMES;
