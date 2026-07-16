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
import { YahooMarketDataProvider } from "./yahoo/provider";

export interface MarketEnv {
  DB: D1Database;
  MARKET_DATA_PROVIDER?: string;
  YAHOO_STALE_AFTER_MINUTES?: string;
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

  if (providerName !== "yahoo") {
    throw new Error(`Unsupported MARKET_DATA_PROVIDER: ${providerName}`);
  }

  return new MarketDataService(
    new YahooMarketDataProvider(env.DB, staleAfterMinutes),
  );
}
