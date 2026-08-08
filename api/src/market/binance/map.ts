import type { Bar, Interval, Quote, Range } from "../types";
import { BINANCE_EXCHANGE_CODE } from "./constants";

/**
 * Global Binance public REST hosts.
 * Note: Cloudflare Worker egress is often geo/WAF blocked (451/403).
 * See docs/binance-market-data.md.
 */
export const BINANCE_REST_BASES = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
] as const;

/** @deprecated use BINANCE_REST_BASES */
export const BINANCE_REST_BASE = BINANCE_REST_BASES[0];

export type BinanceExchangeSymbol = {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
};

export type BinanceTicker24hr = {
  symbol: string;
  lastPrice: string;
  priceChange: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
};

/** Kline row: openTime, o, h, l, c, volume, closeTime, quoteVolume, ... */
export type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  ...unknown[],
];

export function mapBinanceInterval(interval: Interval): string {
  switch (interval) {
    case "1m":
      return "1m";
    case "5m":
      return "5m";
    case "15m":
      return "15m";
    case "1h":
      return "1h";
    case "1d":
      return "1d";
    case "1wk":
      return "1w";
    case "1mo":
      return "1M";
    default:
      return "1d";
  }
}

/** Approximate candle count for Yahoo-style range + interval. */
export function klineLimitFor(interval: Interval, range: Range): number {
  const rangeDays: Record<Range, number> = {
    "1d": 1,
    "5d": 5,
    "1mo": 31,
    "3mo": 93,
    "6mo": 186,
    "1y": 372,
    "2y": 744,
    "5y": 1860,
    max: 1000,
  };
  const days = rangeDays[range] ?? 31;
  const perDay: Record<Interval, number> = {
    "1m": 24 * 60,
    "5m": 24 * 12,
    "15m": 24 * 4,
    "1h": 24,
    "1d": 1,
    "1wk": 1 / 7,
    "1mo": 1 / 30,
  };
  const rate = perDay[interval] ?? 1;
  return Math.min(1000, Math.max(1, Math.ceil(days * rate) + 2));
}

export function mapKlinesToBars(klines: BinanceKline[]): Bar[] {
  const bars: Bar[] = [];
  for (const row of klines) {
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    const time = Number(row[0]);
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(time)
    ) {
      continue;
    }
    bars.push({
      time: Math.floor(time / 1000),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : undefined,
    });
  }
  return bars;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * Build a Quote from 24h ticker + optional daily klines for volume gates.
 * Volume filters use quote notional (quote asset units).
 */
export function mapBinanceQuote(opts: {
  ticker: BinanceTicker24hr;
  baseAsset?: string;
  quoteAsset?: string;
  dailyKlines?: BinanceKline[];
}): Quote {
  const { ticker, baseAsset, quoteAsset, dailyKlines } = opts;
  const price = Number(ticker.lastPrice);
  const change = Number(ticker.priceChange);
  const changePercent = Number(ticker.priceChangePercent);
  const volume = Number(ticker.volume);
  const quoteVolume24h = Number(ticker.quoteVolume);

  let averageVolume10d: number | null = null;
  let averageVolume3m: number | null = null;
  let fiftyDayAverage: number | null = null;
  let dailyQuoteNotional: number | null = null;

  if (dailyKlines && dailyKlines.length > 0) {
    const quoteVols = dailyKlines
      .map((row) => Number(row[7]))
      .filter((value) => Number.isFinite(value));
    const closes = dailyKlines
      .map((row) => Number(row[4]))
      .filter((value) => Number.isFinite(value));

    averageVolume10d = mean(quoteVols.slice(-10));
    averageVolume3m = mean(quoteVols.slice(-90));
    fiftyDayAverage = mean(closes.slice(-50));
    dailyQuoteNotional = averageVolume3m;
  } else if (Number.isFinite(quoteVolume24h)) {
    // Fallback when klines are unavailable: 24h quote volume as notional proxy.
    averageVolume10d = quoteVolume24h;
    averageVolume3m = quoteVolume24h;
    dailyQuoteNotional = quoteVolume24h;
    fiftyDayAverage = Number.isFinite(price) ? price : null;
  }

  return {
    symbol: ticker.symbol,
    exchange: BINANCE_EXCHANGE_CODE,
    name: baseAsset && quoteAsset ? `${baseAsset}/${quoteAsset}` : ticker.symbol,
    price: Number.isFinite(price) ? price : null,
    change: Number.isFinite(change) ? change : null,
    changePercent: Number.isFinite(changePercent) ? changePercent : null,
    volume: Number.isFinite(volume) ? volume : null,
    averageVolume10d,
    averageVolume3m,
    fiftyDayAverage,
    dailyQuoteNotional,
    currency: quoteAsset,
    asOf: new Date().toISOString(),
  };
}
