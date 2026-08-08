# Binance vs CoinGecko (crypto market data)

Read this when you’re unsure **which source we mean** and **why**.

## The short version

| Question | Whose answer? | Source today |
| --- | --- | --- |
| Which pairs are liquid / **WARM** on **Binance**? | Must be **Binance venue** volume | CoinGecko **exchange tickers for Binance** (not “crypto in general”) |
| How has price been **trending** for TAS / charts? | **Coin-level** trend is enough (product decision 2026-08) | CoinGecko **coin** `market_chart` (**Phase 2 done**) |
| Equities (TSX, NYSE, …)? | Unrelated to Binance | Yahoo (unchanged) |

**Binance** = the exchange we care about for the warm list.  
**CoinGecko** = the pipe we use from Cloudflare Workers, because **direct Binance APIs are blocked** from Worker egress.

We are **not** replacing “Binance” with “CoinGecko” as the product venue. EVG still means “warm on Binance.” CoinGecko is how we *read* Binance (and later, coin trends).

## Mental model

```text
EVG (volume gate)
  “Is this pair busy enough ON BINANCE?”
  → Binance-specific venue data
  → today: CoinGecko /exchanges/binance/tickers
  → fields like converted_volume.usd per pair (BTC/USDT, …)

TAS / SWATCH-style price path (Phase 2)
  “How did this coin’s price move over days/hours?”
  → coin trend is enough (BTC trend ≈ BTCUSDT for our use)
  → not required to be Binance’s own candles
  → CoinGecko `/coins/{id}/market_chart` (USD)
```

## When to insist on Binance-specific data

Use **Binance venue** data when the decision is about **that exchange**:

- EVG warm / cold
- Rank / filter by liquidity **on Binance**
- Quote-market pills (USDT, USDC, …) as Binance pairs
- Anything that would be wrong if we used “global crypto volume” or another exchange’s volume

## When coin-level (non–Binance-exact) is OK

Use **coin-level** price history when the decision is about **trend / shape of price**, and we’ve already picked symbols via EVG:

- TAS deep analysis on warm symbols
- Rolling averages, lookbacks, “is it trending up/down”
- SWATCH-style path checks that need bars over time

Product call (2026-08): we do **not** need candles that are guaranteed to be Binance’s tape. Same warm coins, general market price path is fine.

## What is still blocked / deferred

| Need | Status |
| --- | --- |
| Direct Worker → `api.binance.com` / `.vision` / `.us` | Blocked (451/403). Don’t plan on it. |
| EVG via CoinGecko Binance tickers | **Done (Phase 1)** |
| TAS/SWATCH charts via CoinGecko coin `market_chart` | **Done (Phase 2)** |
| True Binance klines (if we ever need tape-exact) | Optional later (CoinAPI / Kaiko / egress IPs) — not required |

## Phase 1 details (EVG)

| Item | Choice |
| --- | --- |
| Venue data | CoinGecko `GET /api/v3/exchanges/binance/tickers` |
| Auth | Demo key `COINGECKO_DEMO_API_KEY` (`x-cg-demo-api-key`) |
| EVG exchange code / label | `BINANCE` / `Binance` |
| Default quote | `USDT` |
| Quote pills | `USDT`, `USDC`, `BTC`, `ETH`, `BNB`, `FDUSD`, `EUR`, `TRY`, `BRL`, `JPY` |
| TradingView prefix | `BINANCE` |
| Volume gate | Quote notional from 24h `converted_volume.usd` (stored as `volume_quote` / `avg_volume_10d_quote`; base coin volume kept separately) |

Demo budget: ~100 calls/min, **10k calls/month** — keep Binance EVG cadence sane.

**Rate limiting:** all CoinGecko calls (EVG tickers, TAS/SWATCH charts, coin id search)
go through a shared Durable Object token bucket (`CoinGeckoRateLimiter`, ~80/min with
burst 8) plus 429 retry with `Retry-After` / exponential backoff. See
`api/src/market/binance/rate-limiter.ts`.

### Why not direct Binance REST?

| Host | From Worker |
| --- | --- |
| `api.binance.com` | **451** |
| `data-api.binance.vision` | **403** HTML |
| `api.binance.us` | **403** HTML WAF |

API keys do not unlock public market data from a restricted egress IP.

## Phase 2 details (TAS / SWATCH charts)

| Item | Choice |
| --- | --- |
| Endpoint | `GET /api/v3/coins/{id}/market_chart?vs_currency=usd` |
| Symbol map | `BTCUSDT` → base `BTC` → coin id `bitcoin` (well-known map + `/search`) |
| Daily series | `interval=daily`, days from range (`1mo`→30, `3mo`→90, …) |
| Hourly series | `interval=hourly` (Demo is hourly for multi-day windows) |
| Bar shape | Synthetic OHLC with `o=h=l=c` from price points (TAS is close-based) |
| Currency on chart | `USD` |

~2 chart calls per warm symbol per TAS run (daily + hourly). Fine for a small warm set
when paced by the shared DO limiter; still watch the **10k/month** Demo credit.

## Code map

| Area | Path |
| --- | --- |
| Shared constants / quote pills | `shared/binance.ts` |
| CoinGecko tickers + market_chart + coin id | `api/src/market/binance/coingecko.ts` |
| Shared Demo rate limiter (DO) | `api/src/market/binance/rate-limiter.ts` |
| Ticker → Quote mapping | `api/src/market/binance/map.ts` |
| Provider (`screen` / `getQuotes` / `getChart`) | `api/src/market/binance/provider.ts` |
| Yahoo vs Binance routing | `api/src/market/service.ts` |
| Secret | `COINGECKO_DEMO_API_KEY` in `api/.dev.vars` + `wrangler secret put` |
| DO binding | `COINGECKO_RATE_LIMITER` → `CoinGeckoRateLimiter` in `api/wrangler.jsonc` |
