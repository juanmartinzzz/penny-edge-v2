# Binance market data (EVG / TAS / HIS / SWATCH)

## Decision (2026-08)

Penny Edge uses **Binance.US** public REST (`https://api.binance.us`) for crypto market data — not global Binance (`api.binance.com` / `data-api.binance.vision`).

| Item | Choice |
| --- | --- |
| Host | `https://api.binance.us` |
| Auth for market data | None (public endpoints) |
| EVG exchange code | `BINANCE` (stable id in D1 / warm symbols) |
| EVG label | `Binance.US` |
| Default quote market | `USDT` |
| Available quote pills | `USDT`, `USD`, `USDC`, `BTC` |
| TradingView prefix | `BINANCEUS` |

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

If we need the **full global** USDT set while staying on Cloudflare:

1. Evaluate **Cloudflare Dedicated Egress IPs** (egress from a non-restricted city), or
2. Accept a small non-CF proxy in an eligible region (breaks the Cloudflare-only rule).

Until then, keep `BINANCE_REST_BASES` pointed at `api.binance.us` only.
