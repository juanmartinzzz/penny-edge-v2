import type { Exchange, InstrumentRef } from "../types";

/** Map friendly exchange codes to Yahoo chart suffixes. */
export function formatYahooSymbol(ref: InstrumentRef): string {
  const raw = ref.symbol.trim().toUpperCase();

  // Already Yahoo-formatted (SHOP.TO, VCE.V)
  if (raw.includes(".")) return raw;

  const exchange = (ref.exchange ?? "US").toUpperCase();

  if (exchange === "TO" || exchange === "TOR") return `${raw}.TO`;
  if (exchange === "V" || exchange === "VAN") return `${raw}.V`;

  return raw;
}

/** Map friendly exchange → Yahoo screener exchange code. */
export function toYahooScreenerExchange(exchange: Exchange): string {
  const code = exchange.trim().toUpperCase();

  switch (code) {
    case "TO":
    case "TSX":
      return "TOR";
    case "V":
    case "TSXV":
      return "VAN";
    case "US":
    case "NASDAQ":
      return "NMS";
    case "NYSE":
      return "NYQ";
    default:
      // Allow raw Yahoo codes: TOR, VAN, NYQ, NMS, ASE, PCX
      return code;
  }
}

export function parseSymbolList(input: string): InstrumentRef[] {
  return input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((token) => {
      // SHOP.TO / ABC.V
      const dotted = token.match(/^([A-Z0-9.-]+)\.(TO|V)$/i);
      if (dotted) {
        return { symbol: dotted[1].toUpperCase(), exchange: dotted[2].toUpperCase() };
      }

      // SHOP:TO style
      const colon = token.match(/^([A-Z0-9.-]+):(TO|V|US|TOR|VAN)$/i);
      if (colon) {
        return { symbol: colon[1].toUpperCase(), exchange: colon[2].toUpperCase() };
      }

      return { symbol: token.toUpperCase(), exchange: "US" };
    });
}
