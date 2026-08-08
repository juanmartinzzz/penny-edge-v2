import type {
  ChartResult,
  InstrumentRef,
  Interval,
  MarketDataProvider,
  ProviderAuthStatus,
  Quote,
  Range,
  ScreenerQuery,
} from "./types";
import { BinanceMarketDataProvider } from "./binance/provider";
import { isBinanceExchange } from "./binance/constants";
import { YahooMarketDataProvider } from "./yahoo/provider";

export interface MarketEnv {
  DB: D1Database;
  MARKET_DATA_PROVIDER?: string;
  YAHOO_STALE_AFTER_MINUTES?: string;
}

/**
 * Routes by instrument/exchange: Binance.US codes → api.binance.us,
 * everything else → Yahoo.
 */
export class RoutingMarketDataProvider implements MarketDataProvider {
  readonly id = "routing" as const;

  constructor(
    private readonly yahoo: MarketDataProvider,
    private readonly binance: MarketDataProvider,
  ) {}

  private forExchange(exchange: string | undefined): MarketDataProvider {
    return isBinanceExchange(exchange) ? this.binance : this.yahoo;
  }

  getAuthStatus(): Promise<ProviderAuthStatus> {
    return this.yahoo.getAuthStatus();
  }

  refreshAuth(): Promise<ProviderAuthStatus> {
    return this.yahoo.refreshAuth();
  }

  async getQuotes(refs: InstrumentRef[]): Promise<Quote[]> {
    if (refs.length === 0) return [];

    const yahooRefs: InstrumentRef[] = [];
    const binanceRefs: InstrumentRef[] = [];
    for (const ref of refs) {
      if (isBinanceExchange(ref.exchange)) binanceRefs.push(ref);
      else yahooRefs.push(ref);
    }

    const [yahooQuotes, binanceQuotes] = await Promise.all([
      yahooRefs.length ? this.yahoo.getQuotes(yahooRefs) : Promise.resolve([]),
      binanceRefs.length
        ? this.binance.getQuotes(binanceRefs)
        : Promise.resolve([]),
    ]);

    return [...yahooQuotes, ...binanceQuotes];
  }

  getChart(
    ref: InstrumentRef,
    opts: { interval: Interval; range: Range },
  ): Promise<ChartResult> {
    return this.forExchange(ref.exchange).getChart(ref, opts);
  }

  screen(query: ScreenerQuery): Promise<Quote[]> {
    return this.forExchange(query.exchange).screen(query);
  }
}

export class MarketDataService {
  constructor(private readonly provider: MarketDataProvider) {}

  get providerId() {
    return this.provider.id;
  }

  getQuotes(refs: InstrumentRef[]): Promise<Quote[]> {
    return this.provider.getQuotes(refs);
  }

  getChart(
    ref: InstrumentRef,
    opts: { interval: Interval; range: Range },
  ): Promise<ChartResult> {
    return this.provider.getChart(ref, opts);
  }

  screen(query: ScreenerQuery): Promise<Quote[]> {
    return this.provider.screen(query);
  }

  getAuthStatus(): Promise<ProviderAuthStatus> {
    return this.provider.getAuthStatus();
  }

  refreshAuth(): Promise<ProviderAuthStatus> {
    return this.provider.refreshAuth();
  }
}

export function createMarketDataService(env: MarketEnv): MarketDataService {
  const providerName = (env.MARKET_DATA_PROVIDER ?? "yahoo").toLowerCase();
  const staleAfterMinutes = Number(env.YAHOO_STALE_AFTER_MINUTES ?? "60") || 60;

  if (providerName !== "yahoo" && providerName !== "routing") {
    throw new Error(`Unsupported MARKET_DATA_PROVIDER: ${providerName}`);
  }

  const yahoo = new YahooMarketDataProvider(env.DB, staleAfterMinutes);
  const binance = new BinanceMarketDataProvider();

  return new MarketDataService(new RoutingMarketDataProvider(yahoo, binance));
}
