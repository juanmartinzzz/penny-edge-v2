import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMarketDataService, type MarketEnv } from "./market/service";
import type { Interval, Range } from "./market/types";
import { parseSymbolList } from "./market/yahoo/symbol";

type AppEnv = {
  Bindings: MarketEnv;
};

const ALLOWED_ORIGINS = [
  "http://localhost:5292",
  "https://penny-edge-v2.juan-martinzzz.workers.dev",
];

const INTERVALS = new Set<Interval>(["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"]);
const RANGES = new Set<Range>(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"]);

const app = new Hono<AppEnv>();

app.use(
  "*",
  cors({
    origin: (origin) => (origin && ALLOWED_ORIGINS.includes(origin) ? origin : ""),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "penny-edge-api",
    time: new Date().toISOString(),
  }),
);

app.get("/", (c) =>
  c.json({
    name: "penny-edge-api",
    message: "Production API for Penny Edge",
    routes: [
      "/health",
      "/market/quotes",
      "/market/chart/:symbol",
      "/market/screener",
      "/market/auth/status",
      "/market/auth/refresh",
    ],
  }),
);

app.get("/market/auth/status", async (c) => {
  const market = createMarketDataService(c.env);
  const status = await market.getAuthStatus();
  return c.json({ provider: market.providerId, ...status });
});

app.post("/market/auth/refresh", async (c) => {
  const market = createMarketDataService(c.env);
  const status = await market.refreshAuth();
  return c.json({ provider: market.providerId, ...status });
});

app.get("/market/quotes", async (c) => {
  const symbols = c.req.query("symbols");
  if (!symbols) {
    return c.json({ error: "Query param 'symbols' is required" }, 400);
  }

  const refs = parseSymbolList(symbols);
  if (refs.length === 0) {
    return c.json({ error: "No valid symbols provided" }, 400);
  }

  const market = createMarketDataService(c.env);
  const quotes = await market.getQuotes(refs);
  return c.json({ provider: market.providerId, count: quotes.length, quotes });
});

app.get("/market/chart/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const exchange = c.req.query("exchange") ?? undefined;
  const interval = (c.req.query("interval") ?? "1d") as Interval;
  const range = (c.req.query("range") ?? "3mo") as Range;

  if (!INTERVALS.has(interval)) {
    return c.json({ error: `Invalid interval. Allowed: ${[...INTERVALS].join(", ")}` }, 400);
  }
  if (!RANGES.has(range)) {
    return c.json({ error: `Invalid range. Allowed: ${[...RANGES].join(", ")}` }, 400);
  }

  const market = createMarketDataService(c.env);
  const chart = await market.getChart({ symbol, exchange }, { interval, range });
  return c.json({ provider: market.providerId, chart });
});

app.post("/market/screener", async (c) => {
  const body = await c.req.json<{
    exchange?: string;
    offset?: number;
    limit?: number;
  }>();

  if (!body.exchange) {
    return c.json({ error: "Body field 'exchange' is required (e.g. TO, V, US, TOR, NYQ)" }, 400);
  }

  const market = createMarketDataService(c.env);
  const quotes = await market.screen({
    exchange: body.exchange,
    offset: body.offset,
    limit: body.limit,
  });

  return c.json({
    provider: market.providerId,
    exchange: body.exchange,
    count: quotes.length,
    quotes,
  });
});

app.onError((error, c) => {
  console.error("API error:", error);
  return c.json(
    {
      error: error instanceof Error ? error.message : "Unknown error",
    },
    500,
  );
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
