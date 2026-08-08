import type { Quote } from "../types";
import {
  BINANCE_EXCHANGE_CODE,
  BINANCE_QUOTE_ASSET_OPTIONS,
} from "./constants";
import type { CoinGeckoBinanceTicker } from "./coingecko";

/** Longest-first so FDUSD wins over USD-like suffixes. */
const QUOTE_SUFFIXES = [...BINANCE_QUOTE_ASSET_OPTIONS].sort(
  (a, b) => b.length - a.length,
);

/** Build Binance-style symbol from CoinGecko base/target (e.g. BTC + USDT → BTCUSDT). */
export function pairSymbol(base: string, target: string): string {
  return `${base.trim().toUpperCase()}${target.trim().toUpperCase()}`;
}

/** Split BTCUSDT → { base: BTC, quote: USDT } using known quote pills. */
export function splitBinanceSymbol(
  symbol: string,
): { base: string; quote: string } | null {
  const normalized = symbol.trim().toUpperCase();
  for (const quote of QUOTE_SUFFIXES) {
    if (normalized.length <= quote.length) continue;
    if (!normalized.endsWith(quote)) continue;
    const base = normalized.slice(0, -quote.length);
    if (!base) continue;
    return { base, quote };
  }
  return null;
}

export function mapCoinGeckoTickerToQuote(
  ticker: CoinGeckoBinanceTicker,
): Quote | null {
  const base = ticker.base?.trim().toUpperCase();
  const target = ticker.target?.trim().toUpperCase();
  if (!base || !target) return null;
  if (ticker.is_stale || ticker.is_anomaly) return null;

  const symbol = pairSymbol(base, target);
  const price = typeof ticker.last === "number" ? ticker.last : null;
  const baseVolume = typeof ticker.volume === "number" ? ticker.volume : null;
  const convertedUsd =
    typeof ticker.converted_volume?.usd === "number"
      ? ticker.converted_volume.usd
      : null;

  // Prefer USD converted volume for EVG dollar gates; fall back to base*last.
  let dailyQuoteNotional = convertedUsd;
  if (
    dailyQuoteNotional == null &&
    baseVolume != null &&
    price != null &&
    Number.isFinite(baseVolume * price)
  ) {
    dailyQuoteNotional = baseVolume * price;
  }

  if (dailyQuoteNotional == null || !Number.isFinite(dailyQuoteNotional)) {
    return null;
  }

  const safeBase =
    baseVolume != null && Number.isFinite(baseVolume) ? baseVolume : null;

  return {
    symbol,
    exchange: BINANCE_EXCHANGE_CODE,
    name: `${base}/${target}`,
    price: price != null && Number.isFinite(price) ? price : null,
    change: null,
    changePercent: null,
    // Base units — quote/$ activity lives on dailyQuoteNotional / volumeQuote().
    volume: safeBase,
    // Phase 1: 24h base volume as stand-in for 10d / 3m averages (no klines).
    averageVolume10d: safeBase,
    averageVolume3m: safeBase,
    fiftyDayAverage: price != null && Number.isFinite(price) ? price : null,
    dailyQuoteNotional,
    currency: target,
    asOf: ticker.timestamp ?? ticker.last_traded_at ?? new Date().toISOString(),
  };
}
