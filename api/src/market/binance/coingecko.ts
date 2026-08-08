/**
 * CoinGecko helpers for Binance venue tickers + coin-level market charts.
 * Docs:
 * - https://docs.coingecko.com/reference/exchanges-id-tickers
 * - https://docs.coingecko.com/reference/coins-id-market-chart
 * - https://docs.coingecko.com/reference/search-data
 */

import type { Bar, Interval, Range } from "../types";
import type { CoinGeckoRateLimiterStub } from "./rate-limiter";

export const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";

export const COINGECKO_BINANCE_TICKERS_URL = `${COINGECKO_API_BASE}/exchanges/binance/tickers`;

/** CoinGecko returns up to 100 tickers per page. */
export const COINGECKO_TICKERS_PAGE_SIZE = 100;

/** Safety cap so a runaway screen cannot burn the Demo monthly credit. */
export const COINGECKO_MAX_PAGES = 40;

/** Max attempts for a single CoinGecko call (includes first try). */
const COINGECKO_MAX_ATTEMPTS = 6;

const UA =
  "Mozilla/5.0 (compatible; PennyEdge/1.0; +https://github.com/juanmartinzzz/penny-edge-v2)";

/** Common base → CoinGecko id (avoids a search call for majors). */
export const WELL_KNOWN_COIN_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  DOGE: "dogecoin",
  ADA: "cardano",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  LTC: "litecoin",
  BCH: "bitcoin-cash",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  SUI: "sui",
  PEPE: "pepe",
  SHIB: "shiba-inu",
  TRX: "tron",
  TON: "the-open-network",
  UNI: "uniswap",
  AAVE: "aave",
  MATIC: "matic-network",
  POL: "polygon-ecosystem-token",
  USDC: "usd-coin",
  USDT: "tether",
  FDUSD: "first-digital-usd",
};

export type CoinGeckoBinanceTicker = {
  base?: string;
  target?: string;
  last?: number;
  volume?: number;
  converted_volume?: { usd?: number; btc?: number };
  bid_ask_spread_percentage?: number | null;
  timestamp?: string;
  last_traded_at?: string;
  is_anomaly?: boolean;
  is_stale?: boolean;
  trade_url?: string;
  coin_id?: string;
  target_coin_id?: string;
  trust_score?: string | null;
};

type CoinGeckoTickersResponse = {
  name?: string;
  tickers?: CoinGeckoBinanceTicker[];
};

type CoinGeckoMarketChartResponse = {
  prices?: Array<[number, number]>;
  market_caps?: Array<[number, number]>;
  total_volumes?: Array<[number, number]>;
};

type CoinGeckoSearchCoin = {
  id?: string;
  symbol?: string;
  name?: string;
  market_cap_rank?: number | null;
};

export type CoinGeckoFetchOptions = {
  rateLimiter?: CoinGeckoRateLimiterStub;
};

function demoHeaders(apiKey: string): HeadersInit {
  return {
    Accept: "application/json",
    "User-Agent": UA,
    "x-cg-demo-api-key": apiKey,
  };
}

/** Parse Retry-After as seconds or HTTP-date; returns wait ms (capped). */
export function retryAfterMs(
  header: string | null,
  attempt: number,
): number {
  const fallback = Math.min(30_000, 1_000 * 2 ** attempt);
  if (!header) return fallback;

  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(60_000, Math.ceil(asSeconds * 1_000));
  }

  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.min(60_000, Math.max(0, asDate - Date.now()));
  }

  return fallback;
}

async function fetchCoinGeckoJson<T>(
  apiKey: string,
  path: string,
  params?: Record<string, string>,
  opts?: CoinGeckoFetchOptions,
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${COINGECKO_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < COINGECKO_MAX_ATTEMPTS; attempt++) {
    if (opts?.rateLimiter) {
      await opts.rateLimiter.acquire();
    }

    const response = await fetch(url.toString(), { headers: demoHeaders(apiKey) });

    if (response.status === 429) {
      const text = await response.text();
      const waitMs =
        retryAfterMs(response.headers.get("retry-after"), attempt) +
        Math.floor(Math.random() * 250);
      lastError = new Error(
        `CoinGecko ${url.pathname} rate limited (429): ${text.slice(0, 200)}`,
      );
      console.warn(
        `CoinGecko 429 on ${url.pathname}; backing off ${waitMs}ms (attempt ${attempt + 1}/${COINGECKO_MAX_ATTEMPTS})`,
      );
      if (opts?.rateLimiter) {
        await opts.rateLimiter.penalize(waitMs);
      }
      await scheduler.wait(waitMs);
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `CoinGecko ${url.pathname} failed (${response.status}): ${text.slice(0, 200)}`,
      );
    }

    return (await response.json()) as T;
  }

  throw lastError ?? new Error(`CoinGecko ${url.pathname} retries exhausted`);
}

export async function fetchCoinGeckoBinanceTickerPage(
  apiKey: string,
  page: number,
  opts?: CoinGeckoFetchOptions,
): Promise<CoinGeckoBinanceTicker[]> {
  const body = await fetchCoinGeckoJson<CoinGeckoTickersResponse>(
    apiKey,
    "/exchanges/binance/tickers",
    { page: String(page), order: "volume_desc" },
    opts,
  );
  return Array.isArray(body.tickers) ? body.tickers : [];
}

/**
 * Resolve Binance base asset (e.g. BTC) to a CoinGecko coin id (bitcoin).
 * Uses a small well-known map, then /search with exact symbol match.
 */
export async function resolveCoinGeckoCoinId(
  apiKey: string,
  baseAsset: string,
  cache?: Map<string, string>,
  opts?: CoinGeckoFetchOptions,
): Promise<string> {
  const base = baseAsset.trim().toUpperCase();
  if (!base) throw new Error("Missing base asset for CoinGecko coin id");

  const cached = cache?.get(base);
  if (cached) return cached;

  const known = WELL_KNOWN_COIN_IDS[base];
  if (known) {
    cache?.set(base, known);
    return known;
  }

  const body = await fetchCoinGeckoJson<{ coins?: CoinGeckoSearchCoin[] }>(
    apiKey,
    "/search",
    { query: base },
    opts,
  );

  const exact = (body.coins ?? []).filter(
    (coin) => (coin.symbol ?? "").toUpperCase() === base && Boolean(coin.id),
  );
  exact.sort((a, b) => {
    const ar = a.market_cap_rank ?? Number.POSITIVE_INFINITY;
    const br = b.market_cap_rank ?? Number.POSITIVE_INFINITY;
    return ar - br;
  });

  const id = exact[0]?.id;
  if (!id) {
    throw new Error(
      `No CoinGecko coin id for base asset ${base} (search returned no exact symbol match)`,
    );
  }

  cache?.set(base, id);
  return id;
}

/** Map Yahoo-style range to CoinGecko `days` param. */
export function coinGeckoDaysForRange(range: Range): string {
  switch (range) {
    case "1d":
      return "1";
    case "5d":
      return "5";
    case "1mo":
      return "30";
    case "3mo":
      return "90";
    case "6mo":
      return "180";
    case "1y":
      return "365";
    case "2y":
      return "365";
    case "5y":
      return "max";
    case "max":
      return "max";
    default:
      return "30";
  }
}

export async function fetchCoinGeckoMarketChart(
  apiKey: string,
  coinId: string,
  chartOpts: { days: string; interval?: "daily" | "hourly" },
  fetchOpts?: CoinGeckoFetchOptions,
): Promise<CoinGeckoMarketChartResponse> {
  const params: Record<string, string> = {
    vs_currency: "usd",
    days: chartOpts.days,
  };
  if (chartOpts.interval) params.interval = chartOpts.interval;

  return fetchCoinGeckoJson<CoinGeckoMarketChartResponse>(
    apiKey,
    `/coins/${encodeURIComponent(coinId)}/market_chart`,
    params,
    fetchOpts,
  );
}

/** Price points → synthetic OHLC bars (o=h=l=c). Enough for TAS close-based math. */
export function mapMarketChartPricesToBars(
  prices: Array<[number, number]> | undefined,
): Bar[] {
  if (!prices?.length) return [];
  const bars: Bar[] = [];
  for (const row of prices) {
    const ms = row[0];
    const price = row[1];
    if (!Number.isFinite(ms) || !Number.isFinite(price)) continue;
    bars.push({
      time: Math.floor(ms / 1000),
      open: price,
      high: price,
      low: price,
      close: price,
    });
  }
  return bars;
}

export function marketChartIntervalFor(
  interval: Interval,
): "daily" | "hourly" | undefined {
  if (interval === "1d" || interval === "1wk" || interval === "1mo") {
    return "daily";
  }
  if (
    interval === "1h" ||
    interval === "15m" ||
    interval === "5m" ||
    interval === "1m"
  ) {
    // Demo auto-granularity is already hourly for multi-day windows; explicit
    // hourly is supported and keeps SWATCH/TAS aligned.
    return "hourly";
  }
  return undefined;
}
