import { PRODUCT_NAMES, type ProductAcronym } from "../lib/productNames";
import "./AcronymLabel.css";

type AcronymLabelProps = {
  acronym: ProductAcronym;
  /** stack = acronym above name (default); inline = acronym · name on one line */
  layout?: "stack" | "inline";
  className?: string;
};

/**
 * Bold acronym with full product name in smaller type.
 * Required for EVG / TAS / HIS / COBUTA and any other product acronyms in UI.
 */
export function AcronymLabel({
  acronym,
  layout = "stack",
  className = "",
}: AcronymLabelProps) {
  const name = PRODUCT_NAMES[acronym];

  return (
    <span
      className={["acronym-label", `is-${layout}`, className].filter(Boolean).join(" ")}
    >
      <span className="acronym-label-short">{acronym}</span>
      <span className="acronym-label-full">{name}</span>
    </span>
  );
}
