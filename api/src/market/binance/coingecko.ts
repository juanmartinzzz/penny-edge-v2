/**
 * CoinGecko Binance venue tickers (Worker-reachable stand-in for blocked Binance REST).
 * Docs: https://docs.coingecko.com/reference/exchanges-id-tickers
 */

export const COINGECKO_BINANCE_TICKERS_URL =
  "https://api.coingecko.com/api/v3/exchanges/binance/tickers";

/** CoinGecko returns up to 100 tickers per page. */
export const COINGECKO_TICKERS_PAGE_SIZE = 100;

/** Safety cap so a runaway screen cannot burn the Demo monthly credit. */
export const COINGECKO_MAX_PAGES = 40;

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

export async function fetchCoinGeckoBinanceTickerPage(
  apiKey: string,
  page: number,
): Promise<CoinGeckoBinanceTicker[]> {
  const url = new URL(COINGECKO_BINANCE_TICKERS_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("order", "volume_desc");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (compatible; PennyEdge/1.0; +https://github.com/juanmartinzzz/penny-edge-v2)",
      "x-cg-demo-api-key": apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `CoinGecko Binance tickers failed (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  const body = (await response.json()) as CoinGeckoTickersResponse;
  return Array.isArray(body.tickers) ? body.tickers : [];
}
