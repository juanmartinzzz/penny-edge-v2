import type {
  ChartResult,
  InstrumentRef,
  Interval,
  MarketDataProvider,
  ProviderAuthStatus,
  Quote,
  Range,
  ScreenerQuery,
} from "../types";
import {
  BINANCE_EXCHANGE_CODE,
  DEFAULT_BINANCE_QUOTE_ASSETS,
} from "./constants";
import {
  COINGECKO_MAX_PAGES,
  COINGECKO_TICKERS_PAGE_SIZE,
  coinGeckoDaysForRange,
  fetchCoinGeckoBinanceTickerPage,
  fetchCoinGeckoMarketChart,
  mapMarketChartPricesToBars,
  marketChartIntervalFor,
  resolveCoinGeckoCoinId,
} from "./coingecko";
import {
  mapCoinGeckoTickerToQuote,
  splitBinanceSymbol,
} from "./map";

/**
 * Binance venue market data via CoinGecko.
 * - EVG: Binance exchange tickers (venue volume)
 * - TAS/SWATCH charts: coin-level market_chart (not Binance-exact klines)
 * Direct Binance REST is blocked from Cloudflare Worker egress (403/451).
 */
export class BinanceMarketDataProvider implements MarketDataProvider {
  readonly id = "binance" as const;

  private readonly coinIdCache = new Map<string, string>();

  constructor(private readonly coinGeckoDemoApiKey: string) {}

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    const present = Boolean(this.coinGeckoDemoApiKey.trim());
    return {
      provider: this.id,
      present,
      fresh: present,
      obtainedAt: null,
      staleAfterMinutes: null,
    };
  }

  async refreshAuth(): Promise<ProviderAuthStatus> {
    return this.getAuthStatus();
  }

  async getQuotes(refs: InstrumentRef[]): Promise<Quote[]> {
    if (refs.length === 0) return [];
    this.requireKey();

    const wanted = new Map<string, InstrumentRef>();
    for (const ref of refs) {
      const symbol = ref.symbol.trim().toUpperCase();
      if (symbol) wanted.set(symbol, ref);
    }

    const found = new Map<string, Quote>();
    for (let page = 1; page <= COINGECKO_MAX_PAGES; page++) {
      if (found.size >= wanted.size) break;

      const tickers = await fetchCoinGeckoBinanceTickerPage(
        this.coinGeckoDemoApiKey,
        page,
      );
      if (tickers.length === 0) break;

      for (const ticker of tickers) {
        const quote = mapCoinGeckoTickerToQuote(ticker);
        if (!quote) continue;
        if (!wanted.has(quote.symbol)) continue;
        found.set(quote.symbol, quote);
        if (ticker.coin_id && ticker.base) {
          this.coinIdCache.set(ticker.base.trim().toUpperCase(), ticker.coin_id);
        }
      }

      if (tickers.length < COINGECKO_TICKERS_PAGE_SIZE) break;
    }

    const asOf = new Date().toISOString();
    return refs.map((ref) => {
      const symbol = ref.symbol.trim().toUpperCase();
      const hit = found.get(symbol);
      if (hit) return hit;

      const parts = splitBinanceSymbol(symbol);
      return {
        symbol,
        exchange: BINANCE_EXCHANGE_CODE,
        name: parts ? `${parts.base}/${parts.quote}` : symbol,
        price: null,
        change: null,
        changePercent: null,
        volume: null,
        currency: parts?.quote,
        asOf,
      } satisfies Quote;
    });
  }

  async getChart(
    ref: InstrumentRef,
    opts: { interval: Interval; range: Range },
  ): Promise<ChartResult> {
    this.requireKey();

    const symbol = ref.symbol.trim().toUpperCase();
    const parts = splitBinanceSymbol(symbol);
    if (!parts) {
      throw new Error(
        `Cannot map ${symbol} to a CoinGecko coin (unknown quote suffix)`,
      );
    }

    const coinId = await resolveCoinGeckoCoinId(
      this.coinGeckoDemoApiKey,
      parts.base,
      this.coinIdCache,
    );

    const days = coinGeckoDaysForRange(opts.range);
    const interval = marketChartIntervalFor(opts.interval);
    // For 1-day windows, hourly interval is unnecessary; auto ~5m is fine.
    const chartInterval =
      days === "1" && interval === "hourly" ? undefined : interval;

    const chart = await fetchCoinGeckoMarketChart(
      this.coinGeckoDemoApiKey,
      coinId,
      { days, interval: chartInterval },
    );

    const bars = mapMarketChartPricesToBars(chart.prices);
    if (bars.length === 0) {
      throw new Error(
        `No CoinGecko market chart data for ${symbol} (${coinId}, ${days}d)`,
      );
    }

    return {
      symbol,
      interval: opts.interval,
      range: opts.range,
      currency: "USD",
      bars,
    };
  }

  /**
   * Paginate CoinGecko Binance tickers (volume desc), filter by quote asset,
   * return EVG offset/limit window as Quotes with dailyQuoteNotional.
   */
  async screen(query: ScreenerQuery): Promise<Quote[]> {
    this.requireKey();

    const offset = query.offset ?? 0;
    const limit = Math.min(query.limit ?? 50, 200);
    const quoteAssets = (
      query.quoteAssets?.length
        ? query.quoteAssets
        : DEFAULT_BINANCE_QUOTE_ASSETS
    ).map((asset) => asset.toUpperCase());
    const quoteSet = new Set(quoteAssets);
    if (quoteSet.size === 0 || limit <= 0) return [];

    const collected: Quote[] = [];
    let skipped = 0;

    for (let page = 1; page <= COINGECKO_MAX_PAGES; page++) {
      const tickers = await fetchCoinGeckoBinanceTickerPage(
        this.coinGeckoDemoApiKey,
        page,
      );
      if (tickers.length === 0) break;

      for (const ticker of tickers) {
        const target = ticker.target?.trim().toUpperCase();
        if (!target || !quoteSet.has(target)) continue;

        const quote = mapCoinGeckoTickerToQuote(ticker);
        if (!quote) continue;

        if (ticker.coin_id && ticker.base) {
          this.coinIdCache.set(ticker.base.trim().toUpperCase(), ticker.coin_id);
        }

        if (skipped < offset) {
          skipped += 1;
          continue;
        }

        collected.push(quote);
        if (collected.length >= limit) return collected;
      }

      if (tickers.length < COINGECKO_TICKERS_PAGE_SIZE) break;
    }

    return collected;
  }

  private requireKey(): void {
    if (!this.coinGeckoDemoApiKey.trim()) {
      throw new Error(
        "COINGECKO_DEMO_API_KEY is missing — required for Binance via CoinGecko",
      );
    }
  }
}
