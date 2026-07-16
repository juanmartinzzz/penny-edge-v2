export type ProviderId = "yahoo" | (string & {});

export type Exchange = "US" | "TO" | "V" | string;

export type Interval = "1m" | "5m" | "15m" | "1h" | "1d" | "1wk" | "1mo";

export type Range = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" | "max";

export interface InstrumentRef {
  symbol: string;
  exchange?: Exchange;
}

export interface Quote {
  symbol: string;
  exchange?: string;
  name?: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  averageVolume10d?: number | null;
  averageVolume3m?: number | null;
  fiftyDayAverage?: number | null;
  marketCap?: number | null;
  currency?: string;
  asOf: string;
}

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ChartResult {
  symbol: string;
  interval: Interval;
  range: Range;
  currency?: string;
  bars: Bar[];
}

export interface ScreenerQuery {
  exchange: Exchange;
  offset?: number;
  limit?: number;
}

export interface ProviderAuthStatus {
  provider: ProviderId;
  present: boolean;
  fresh: boolean;
  obtainedAt: string | null;
  staleAfterMinutes: number | null;
}

export interface MarketDataProvider {
  readonly id: ProviderId;
  getQuotes(refs: InstrumentRef[]): Promise<Quote[]>;
  getChart(
    ref: InstrumentRef,
    opts: { interval: Interval; range: Range },
  ): Promise<ChartResult>;
  screen(query: ScreenerQuery): Promise<Quote[]>;
  getAuthStatus(): Promise<ProviderAuthStatus>;
  refreshAuth(): Promise<ProviderAuthStatus>;
}
