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
  BINANCE_REST_BASES,
  klineLimitFor,
  mapBinanceInterval,
  mapBinanceQuote,
  mapKlinesToBars,
  type BinanceExchangeSymbol,
  type BinanceKline,
  type BinanceTicker24hr,
} from "./map";

const KLINE_CONCURRENCY = 8;

const BINANCE_HEADERS: HeadersInit = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (compatible; PennyEdge/1.0; +https://github.com/juanmartinzzz/penny-edge-v2)",
};

async function fetchJson<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  let lastError: Error | null = null;

  for (const base of BINANCE_REST_BASES) {
    const url = new URL(path, base);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    try {
      const response = await fetch(url.toString(), {
        headers: BINANCE_HEADERS,
      });

      if (!response.ok) {
        const text = await response.text();
        lastError = new Error(
          `Binance ${path} failed (${response.status}) via ${base}: ${text.slice(0, 200)}`,
        );
        // Try next host on geo/WAF style blocks.
        if (response.status === 403 || response.status === 451) {
          console.error(lastError.message);
          continue;
        }
        throw lastError;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error !== lastError) {
        lastError = error;
        console.error(
          `Binance ${path} network error via ${base}:`,
          error.message,
        );
        continue;
      }
      throw error;
    }
  }

  throw lastError ?? new Error(`Binance ${path} failed on all hosts`);
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]!);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export class BinanceMarketDataProvider implements MarketDataProvider {
  readonly id = "binance" as const;

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    return {
      provider: this.id,
      present: true,
      fresh: true,
      obtainedAt: null,
      staleAfterMinutes: null,
    };
  }

  async refreshAuth(): Promise<ProviderAuthStatus> {
    return this.getAuthStatus();
  }

  async getQuotes(refs: InstrumentRef[]): Promise<Quote[]> {
    if (refs.length === 0) return [];

    const symbols = refs.map((ref) => ref.symbol.trim().toUpperCase());
    const unique = [...new Set(symbols)];

    const tickers = await this.fetchTickers(unique);
    const bySymbol = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));

    const quotes = await mapPool(refs, KLINE_CONCURRENCY, async (ref) => {
      const symbol = ref.symbol.trim().toUpperCase();
      const ticker = bySymbol.get(symbol);
      if (!ticker) {
        return {
          symbol,
          exchange: BINANCE_EXCHANGE_CODE,
          price: null,
          change: null,
          changePercent: null,
          volume: null,
          asOf: new Date().toISOString(),
        } satisfies Quote;
      }

      let dailyKlines: BinanceKline[] | undefined;
      try {
        dailyKlines = await fetchJson<BinanceKline[]>("/api/v3/klines", {
          symbol,
          interval: "1d",
          limit: "90",
        });
      } catch {
        dailyKlines = undefined;
      }

      return mapBinanceQuote({ ticker, dailyKlines });
    });

    return quotes;
  }

  async getChart(
    ref: InstrumentRef,
    opts: { interval: Interval; range: Range },
  ): Promise<ChartResult> {
    const symbol = ref.symbol.trim().toUpperCase();
    const interval = mapBinanceInterval(opts.interval);
    const limit = String(klineLimitFor(opts.interval, opts.range));

    const klines = await fetchJson<BinanceKline[]>("/api/v3/klines", {
      symbol,
      interval,
      limit,
    });

    return {
      symbol,
      interval: opts.interval,
      range: opts.range,
      currency: undefined,
      bars: mapKlinesToBars(klines),
    };
  }

  /**
   * Paginate TRADING pairs for enabled quote assets, sorted by 24h quote volume.
   * `query.quoteAssets` defaults to USDT when omitted.
   */
  async screen(query: ScreenerQuery): Promise<Quote[]> {
    const offset = query.offset ?? 0;
    const limit = Math.min(query.limit ?? 50, 200);
    const quoteAssets = (
      query.quoteAssets?.length
        ? query.quoteAssets
        : DEFAULT_BINANCE_QUOTE_ASSETS
    ).map((asset) => asset.toUpperCase());
    const quoteSet = new Set(quoteAssets);

    if (quoteSet.size === 0) return [];

    const [info, tickers] = await Promise.all([
      fetchJson<{ symbols: BinanceExchangeSymbol[] }>("/api/v3/exchangeInfo"),
      fetchJson<BinanceTicker24hr[]>("/api/v3/ticker/24hr"),
    ]);

    const metaBySymbol = new Map<string, BinanceExchangeSymbol>();
    for (const item of info.symbols ?? []) {
      if (item.status !== "TRADING") continue;
      if (!quoteSet.has(item.quoteAsset.toUpperCase())) continue;
      metaBySymbol.set(item.symbol, item);
    }

    const ranked: Array<{
      ticker: BinanceTicker24hr;
      meta: BinanceExchangeSymbol;
      quoteVolume: number;
    }> = [];

    for (const ticker of tickers) {
      const meta = metaBySymbol.get(ticker.symbol);
      if (!meta) continue;
      const quoteVolume = Number(ticker.quoteVolume);
      ranked.push({
        ticker,
        meta,
        quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0,
      });
    }

    ranked.sort((a, b) => b.quoteVolume - a.quoteVolume);

    return ranked.slice(offset, offset + limit).map(({ ticker, meta }) =>
      mapBinanceQuote({
        ticker,
        baseAsset: meta.baseAsset,
        quoteAsset: meta.quoteAsset,
      }),
    );
  }

  private async fetchTickers(symbols: string[]): Promise<BinanceTicker24hr[]> {
    if (symbols.length === 0) return [];
    if (symbols.length === 1) {
      return [
        await fetchJson<BinanceTicker24hr>("/api/v3/ticker/24hr", {
          symbol: symbols[0]!,
        }),
      ];
    }

    if (symbols.length <= 100) {
      return fetchJson<BinanceTicker24hr[]>("/api/v3/ticker/24hr", {
        symbols: JSON.stringify(symbols),
      });
    }

    const all = await fetchJson<BinanceTicker24hr[]>("/api/v3/ticker/24hr");
    const wanted = new Set(symbols);
    return all.filter((ticker) => wanted.has(ticker.symbol));
  }
}
