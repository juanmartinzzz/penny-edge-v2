import type { ProviderAuthRow } from "../auth-store";
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
  getValidYahooAuth,
  refreshYahooAuth,
  toAuthStatus,
  YahooAuthError,
} from "./auth";
import {
  mapYahooChartBars,
  mapYahooQuote,
  yahooHeaders,
  type YahooChartResult,
  type YahooQuoteRaw,
} from "./map";
import { formatYahooSymbol, toYahooScreenerExchange } from "./symbol";
import { getProviderAuth } from "../auth-store";

function isUnauthorized(status: number, body: string): boolean {
  if (status === 401 || status === 403) return true;
  const lower = body.toLowerCase();
  return lower.includes("invalid crumb") || lower.includes("unauthorized");
}

export class YahooMarketDataProvider implements MarketDataProvider {
  readonly id = "yahoo" as const;

  constructor(
    private readonly db: D1Database,
    private readonly staleAfterMinutes: number,
  ) {}

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    const row = await getProviderAuth(this.db, this.id);
    return toAuthStatus(row);
  }

  async refreshAuth(): Promise<ProviderAuthStatus> {
    const row = await refreshYahooAuth(this.db, this.staleAfterMinutes);
    return toAuthStatus(row);
  }

  async getQuotes(refs: InstrumentRef[]): Promise<Quote[]> {
    if (refs.length === 0) return [];

    const symbols = refs.map((ref) => formatYahooSymbol(ref));
    return this.withAuthRetry(async (auth) => {
      const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
      url.searchParams.set("symbols", symbols.join(","));
      url.searchParams.set("crumb", auth.crumb);

      const response = await fetch(url.toString(), {
        headers: yahooHeaders(auth.cookie),
      });
      const text = await response.text();

      if (!response.ok) {
        if (isUnauthorized(response.status, text)) {
          throw new YahooAuthError(`Yahoo quote unauthorized (${response.status})`);
        }
        throw new Error(`Yahoo quote failed (${response.status}): ${text.slice(0, 200)}`);
      }

      const data = JSON.parse(text) as {
        quoteResponse?: { result?: YahooQuoteRaw[]; error?: unknown };
      };

      return (data.quoteResponse?.result ?? []).map(mapYahooQuote);
    });
  }

  async getChart(
    ref: InstrumentRef,
    opts: { interval: Interval; range: Range },
  ): Promise<ChartResult> {
    const symbol = formatYahooSymbol(ref);
    const url = new URL(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
    );
    url.searchParams.set("interval", opts.interval);
    url.searchParams.set("range", opts.range);

    // Chart often works without crumb; still attach auth when available.
    const auth = await getProviderAuth(this.db, this.id);
    const response = await fetch(url.toString(), {
      headers: yahooHeaders(auth?.cookie),
    });

    if (!response.ok) {
      throw new Error(`Yahoo chart failed (${response.status}) for ${symbol}`);
    }

    const data = (await response.json()) as {
      chart?: { result?: YahooChartResult[]; error?: { description?: string } };
    };

    if (data.chart?.error?.description) {
      throw new Error(data.chart.error.description);
    }

    const result = data.chart?.result?.[0];
    if (!result) {
      throw new Error(`No chart data for ${symbol}`);
    }

    return {
      symbol: result.meta?.symbol ?? symbol,
      interval: opts.interval,
      range: opts.range,
      currency: result.meta?.currency,
      bars: mapYahooChartBars(result),
    };
  }

  async screen(query: ScreenerQuery): Promise<Quote[]> {
    const exchange = toYahooScreenerExchange(query.exchange);
    const offset = query.offset ?? 0;
    const limit = Math.min(query.limit ?? 25, 250);

    return this.withAuthRetry(async (auth) => {
      const url = new URL("https://query1.finance.yahoo.com/v1/finance/screener");
      url.searchParams.set("crumb", auth.crumb);

      const payload = {
        size: limit,
        offset,
        sortField: "intradaymarketcap",
        sortType: "DESC",
        quoteType: "EQUITY",
        query: {
          operator: "eq",
          operands: ["exchange", exchange],
        },
      };

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          ...yahooHeaders(auth.cookie),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();

      if (!response.ok) {
        if (isUnauthorized(response.status, text)) {
          throw new YahooAuthError(`Yahoo screener unauthorized (${response.status})`);
        }
        throw new Error(`Yahoo screener failed (${response.status}): ${text.slice(0, 200)}`);
      }

      const data = JSON.parse(text) as {
        finance?: { result?: Array<{ quotes?: YahooQuoteRaw[] }> };
      };

      const quotes = data.finance?.result?.[0]?.quotes ?? [];
      return quotes.map(mapYahooQuote);
    });
  }

  private async withAuthRetry<T>(
    operation: (auth: ProviderAuthRow) => Promise<T>,
  ): Promise<T> {
    let auth = await getValidYahooAuth(this.db, this.staleAfterMinutes);

    try {
      return await operation(auth);
    } catch (error) {
      if (!(error instanceof YahooAuthError)) throw error;

      auth = await refreshYahooAuth(this.db, this.staleAfterMinutes);
      return operation(auth);
    }
  }
}
