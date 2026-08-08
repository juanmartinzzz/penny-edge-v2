/** Binance.US spot exchange code used in EVG / warm_symbols / SWATCH. */
export const BINANCE_EXCHANGE_CODE = "BINANCE";

/**
 * Quote assets offered as EVG multi-select pills for Binance.US.
 * Live universe is mainly USDT / USD (plus sparse USDC / BTC).
 * Only USDT is enabled by default on the scanner seed.
 */
export const BINANCE_QUOTE_ASSET_OPTIONS = [
  "USDT",
  "USD",
  "USDC",
  "BTC",
] as const;

export type BinanceQuoteAsset = (typeof BINANCE_QUOTE_ASSET_OPTIONS)[number];

export const DEFAULT_BINANCE_QUOTE_ASSETS: BinanceQuoteAsset[] = ["USDT"];

export function isBinanceExchange(exchange: string | null | undefined): boolean {
  if (!exchange) return false;
  const code = exchange.trim().toUpperCase();
  return code === BINANCE_EXCHANGE_CODE || code === "BIN";
}

export function parseEnabledQuoteAssets(
  raw: string | null | undefined,
): string[] {
  if (raw == null || !raw.trim()) return [...DEFAULT_BINANCE_QUOTE_ASSETS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_BINANCE_QUOTE_ASSETS];
    const assets = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
    return assets.length > 0 ? [...new Set(assets)] : [...DEFAULT_BINANCE_QUOTE_ASSETS];
  } catch {
    return [...DEFAULT_BINANCE_QUOTE_ASSETS];
  }
}

export function serializeEnabledQuoteAssets(assets: string[]): string {
  const normalized = [
    ...new Set(
      assets
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  return JSON.stringify(normalized);
}
