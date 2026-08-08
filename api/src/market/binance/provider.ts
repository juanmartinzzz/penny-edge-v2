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
  fetchCoinGeckoBinanceTickerPage,
} from "./coingecko";
import {
  mapCoinGeckoTickerToQuote,
  splitBinanceSymbol,
} from "./map";

/**
 * Binance venue market data via CoinGecko exchange tickers.
 * Direct Binance REST is blocked from Cloudflare Worker egress (403/451).
 * Phase 1: screen + quotes for EVG. Charts deferred (getChart throws).
 */
export class BinanceMarketDataProvider implements MarketDataProvider {
  readonly id = "binance" as const;

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
    _opts: { interval: Interval; range: Range },
  ): Promise<ChartResult> {
    throw new Error(
      `Binance charts are not available yet for ${ref.symbol.trim().toUpperCase()} (Phase 1 uses CoinGecko tickers for EVG only; klines deferred)`,
    );
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
        "COINGECKO_DEMO_API_KEY is missing — required for Binance EVG via CoinGecko",
      );
    }
  }
}
