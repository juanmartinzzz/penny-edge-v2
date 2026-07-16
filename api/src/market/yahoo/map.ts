import type { Bar, Quote } from "../types";

const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function yahooHeaders(cookie?: string): HeadersInit {
  const headers: Record<string, string> = {
    "User-Agent": YAHOO_UA,
    Accept: "application/json,text/plain,*/*",
  };

  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}

interface YahooQuoteRaw {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  averageDailyVolume10Day?: number;
  averageDailyVolume3Month?: number;
  fiftyDayAverage?: number;
  marketCap?: number;
  currency?: string;
  exchange?: string;
  regularMarketTime?: number;
}

export function mapYahooQuote(raw: YahooQuoteRaw): Quote {
  const asOf = raw.regularMarketTime
    ? new Date(raw.regularMarketTime * 1000).toISOString()
    : new Date().toISOString();

  return {
    symbol: raw.symbol ?? "",
    exchange: raw.exchange,
    name: raw.longName ?? raw.shortName,
    price: raw.regularMarketPrice ?? null,
    change: raw.regularMarketChange ?? null,
    changePercent: raw.regularMarketChangePercent ?? null,
    volume: raw.regularMarketVolume ?? null,
    averageVolume10d: raw.averageDailyVolume10Day ?? null,
    averageVolume3m: raw.averageDailyVolume3Month ?? null,
    fiftyDayAverage: raw.fiftyDayAverage ?? null,
    marketCap: raw.marketCap ?? null,
    currency: raw.currency,
    asOf,
  };
}

interface YahooChartResult {
  meta?: { currency?: string; symbol?: string };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
}

export function mapYahooChartBars(result: YahooChartResult): Bar[] {
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  if (!quote) return [];

  const bars: Bar[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    if (
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      !timestamps[i]
    ) {
      continue;
    }

    bars.push({
      time: timestamps[i],
      open,
      high,
      low,
      close,
      volume: quote.volume?.[i] ?? undefined,
    });
  }

  return bars;
}

export type { YahooQuoteRaw, YahooChartResult };
