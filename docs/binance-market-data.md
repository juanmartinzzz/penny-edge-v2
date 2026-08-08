# Binance market data (EVG / TAS / HIS / SWATCH)

## Decision (2026-08)

Penny Edge is wired for **global Binance** public REST:

| Item | Choice |
| --- | --- |
| Hosts | `https://data-api.binance.vision`, then `https://api.binance.com` |
| Auth for market data | None (public endpoints) |
| EVG exchange code | `BINANCE` |
| EVG label | `Binance` |
| Default quote market | `USDT` |
| Available quote pills | `USDT`, `USDC`, `BTC`, `ETH`, `BNB`, `FDUSD`, `EUR`, `TRY`, `BRL`, `JPY` |
| TradingView prefix | `BINANCE` |

### Tried Binance.US — also blocked from Workers (2026-08-08)

We briefly switched to `https://api.binance.us`. Production EVG still failed:

```text
Binance /api/v3/exchangeInfo failed (403) via https://api.binance.us
(HTML WAF / ERROR page — not a JSON API error)
```

Code was reverted to **global** hosts. Both venues reject typical Cloudflare Worker outbound IPs:

| Host | From Worker | Typical signal |
| --- | --- | --- |
| `api.binance.com` | Blocked | **451** eligibility / restricted location |
| `data-api.binance.vision` | Blocked | **403** HTML Forbidden |
| `api.binance.us` | Blocked | **403** HTML WAF (`ERROR` page) |

The same URLs often return **200** from a normal residential/laptop IP. This is an **egress IP / WAF / eligibility** problem, not a wrong path or missing API key.

**Implication under a Cloudflare-only constraint:** direct Worker → Binance (global or US) market data is not currently viable. Next options: Cloudflare Dedicated Egress IPs, a non-CF proxy, or an **aggregator that serves Binance venue data** (e.g. CoinGecko `/exchanges/binance/tickers`, CoinAPI) reachable from Workers.

## Why not global Binance?

The API Worker runs on **Cloudflare Workers**. Outbound `fetch()` uses Cloudflare egress IPs. Global Binance returns:

- **451** — `Service unavailable from a restricted location according to 'b. Eligibility'…` on `api.binance.com`
- **403** — HTML Forbidden on `data-api.binance.vision` from the same Worker egress

This is an **IP / eligibility** gate, not a missing-API-key problem.

### API keys do not help for EVG

Public market endpoints (`exchangeInfo`, `ticker/24hr`, `klines`) are security type `NONE`. A personal global Binance API key:

- Does **not** unlock market data from a restricted egress IP
- Only unlocks private trading / account endpoints (which EVG does not need)
- Still fails with the same 451 from restricted locations (including keyed calls like account info)

So wiring a user API key into the Worker would not restore the full global USDT universe.

### Cloudflare-only constraint

Staying on Cloudflare only (no third-party VPS/proxy):

| Approach | Outcome |
| --- | --- |
| Workers + direct `fetch` to global Binance | Blocked (451/403) |
| Worker “in another region” / Placement hints | Moves isolate for latency; does **not** reliably change how Binance geo-sees CF egress |
| Cloudflare Dedicated Egress IPs (Zero Trust) | Possible CF-native path later; paid / not a free Worker tweak |
| External proxy/VPS in an eligible country | Would work for global Binance, but leaves Cloudflare-only |

**Binance.US** is the practical Cloudflare-only path today.

## Global vs Binance.US universe (live snapshot, Aug 2026)

Approximate TRADING spot pairs from each `exchangeInfo`:

| | Global | Binance.US |
| --- | ---: | ---: |
| Trading pairs | ~1,377 | ~266 |
| USDT pairs | ~489 | ~203 |
| USD pairs | ~7 | ~54 |
| Other quotes (TRY, EUR, ETH, …) | Many | Effectively none |

Majors (`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, etc.) exist on both. Long-tail USDT alts and non-USDT quote markets are thinner or missing on US.

## Code map

| Area | Path |
| --- | --- |
| Shared constants / quote pills | `shared/binance.ts` |
| REST host(s) | `api/src/market/binance/map.ts` → `BINANCE_REST_BASES` |
| Provider | `api/src/market/binance/provider.ts` |
| Routing (Yahoo vs Binance) | `api/src/market/service.ts` |
| EVG seed / label migrations | `api/migrations/0010_binance_and_session_weekends.sql`, `0011_binance_us_label.sql` |
| TradingView | `shared/tradingView.ts` → `BINANCEUS` |

## Revisit later

Direct Worker → Binance (global **or** US) is blocked as of 2026-08-08.

If we need Binance USDT venue volume while staying on Cloudflare:

1. **Aggregator with Binance venue data** reachable from Workers (CoinGecko `/exchanges/binance/tickers`, CoinAPI `BINANCE_SPOT_*`, etc.), or
2. **Cloudflare Dedicated Egress IPs** (Zero Trust), or
3. A small non-CF proxy in an eligible region.

Until one of those lands, keep `BINANCE_REST_BASES` on global hosts; EVG Binance runs will keep failing at fetch even though product wiring is correct.
