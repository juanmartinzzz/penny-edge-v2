# Binance market data (EVG / TAS / HIS / SWATCH)

## Decision (2026-08)

Penny Edge treats **Binance** as an EVG exchange. Direct Binance REST is **blocked** from Cloudflare Worker egress, so Phase 1 market data uses **CoinGecko Binance venue tickers**.

| Item | Choice |
| --- | --- |
| Venue data source | CoinGecko `GET /api/v3/exchanges/binance/tickers` |
| Auth | Demo key `COINGECKO_DEMO_API_KEY` (`x-cg-demo-api-key`) |
| EVG exchange code | `BINANCE` |
| EVG label | `Binance` |
| Default quote market | `USDT` |
| Available quote pills | `USDT`, `USDC`, `BTC`, `ETH`, `BNB`, `FDUSD`, `EUR`, `TRY`, `BRL`, `JPY` |
| TradingView prefix | `BINANCE` |
| Charts (TAS / SWATCH) | **Not yet** — `getChart` throws until Phase 2 |

### Why not direct Binance REST?

Worker → Binance hosts fail (egress IP / WAF / eligibility):

| Host | From Worker | Typical signal |
| --- | --- | --- |
| `api.binance.com` | Blocked | **451** |
| `data-api.binance.vision` | Blocked | **403** HTML |
| `api.binance.us` | Blocked | **403** HTML WAF |

API keys do not unlock public market data from a restricted egress IP.

### Phase 1 — CoinGecko for EVG (2026-08-08)

Validated from Worker egress with Demo key: **200**, paginated Binance pairs, `converted_volume.usd` present. Keyless throttles quickly.

| Provider method | Behavior |
| --- | --- |
| `screen` | Paginate CG tickers (`order=volume_desc`), filter `target` ∈ enabled quote assets, map to `BTCUSDT`-style symbols |
| `getQuotes` | Look up symbols on CG ticker pages; EVG skips this when screen already set `dailyQuoteNotional` |
| Volume gate fields | `dailyQuoteNotional` / avg volumes ← 24h `converted_volume.usd` (no true 10d klines yet) |
| `getChart` | Throws — deferred |

Demo plan budget: ~100 calls/min, **10k calls/month**. Keep Binance EVG intervals sane.

## Code map

| Area | Path |
| --- | --- |
| Shared constants / quote pills | `shared/binance.ts` |
| CoinGecko fetch | `api/src/market/binance/coingecko.ts` |
| Ticker → Quote mapping | `api/src/market/binance/map.ts` |
| Provider | `api/src/market/binance/provider.ts` |
| Routing (Yahoo vs Binance) | `api/src/market/service.ts` |
| Secret | `COINGECKO_DEMO_API_KEY` in `api/.dev.vars` + `wrangler secret put` |

## Phase 2 (later)

True Binance (or aggregator) **klines** for TAS / SWATCH charts — CoinAPI / Kaiko, Dedicated Egress IPs, or accept CoinGecko coin-level OHLC as approximate.
