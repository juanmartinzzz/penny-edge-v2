/** Canonical product acronym expansions for UI labeling. */
export const PRODUCT_NAMES = {
  EVG: "Exchangewide Volume Gate",
  TAS: "Trend Analysis for Symbols",
  HIS: "Heat and Interest Scale",
  COBUTA: "Consider Buying These Assets",
} as const;

export type ProductAcronym = keyof typeof PRODUCT_NAMES;
