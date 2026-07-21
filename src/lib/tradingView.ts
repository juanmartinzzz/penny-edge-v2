/**
 * TradingView chart URLs — ported from legacy penny-edge utils.
 * Maps Yahoo/scanner exchange codes to TradingView exchange prefixes.
 */

export type TradingViewSymbol = {
  symbol: string;
  exchange: string | null;
};

function tradingViewExchange(exchange: string | null): string {
  if (!exchange) return "TSX";

  switch (exchange.toUpperCase()) {
    case "TO":
    case "TOR":
      return "TSX";
    case "V":
    case "VAN":
    case "CNQ":
      return "TSXV";
    case "NMS":
      return "NASDAQ";
    case "NYQ":
      return "NYSE";
    case "ASE":
      return "AMEX";
    case "PCX":
      return "NASDAQ";
    default:
      return exchange.toUpperCase();
  }
}

/** Chart URL for a symbol, opening the TradingView chart page. */
export function generateTradingViewUrl({
  symbol,
  exchange,
}: TradingViewSymbol): string {
  const baseSymbol = symbol.includes(".") ? symbol.split(".")[0]! : symbol;
  const tvSymbol = `${tradingViewExchange(exchange)}:${baseSymbol}`;
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
}
