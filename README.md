# Penny Edge v2

React + Vite app for Penny Edge, deployed to Cloudflare Workers via Wrangler.

## Stack

- React + Vite + TypeScript
- Lucide icons
- Framer Motion
- Pure CSS (no Tailwind)
- Cloudflare Workers + Wrangler (`@cloudflare/vite-plugin`)

## Setup

```bash
npm install
cp .env.example .env
```

Fill in Cloudflare credentials in `.env` (see [Wrangler system environment variables](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/)):

```bash
CLOUDFLARE_API_TOKEN=your_token
CLOUDFLARE_ACCOUNT_ID=your_account_id
```

Create a token at [API Tokens](https://dash.cloudflare.com/profile/api-tokens) with Workers edit permissions.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Local Vite frontend (port 5292) → talks to prod API |
| `npm run build` | Typecheck + production frontend build |
| `npm run preview` | Preview the production frontend build |
| `npm run deploy` | Build and deploy the frontend Worker |
| `npm run deploy:api` | Deploy the API Worker (`api/`) |
| `npm run deploy:all` | Deploy API, then frontend |

## Backend

The API is a separate Worker in `api/`. Local frontend uses `VITE_API_URL` from `.env` and calls production directly (CORS allows localhost:5292).

### Market data

Provider-agnostic market service (Yahoo adapter today) with D1-backed cookie/crumb auth:

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/market/quotes?symbols=AAPL,SHOP.TO` | Batch quotes |
| `GET` | `/market/chart/:symbol?exchange=TO&interval=1d&range=3mo` | OHLCV bars |
| `POST` | `/market/screener` | Body: `{ "exchange": "TO", "limit": 25 }` |
| `GET` | `/market/auth/status` | Auth freshness (no secrets) |
| `POST` | `/market/auth/refresh` | Force Yahoo cookie/crumb refresh |

D1 database: `penny-edge-db` (tables `provider_auth`, `exchange_scanners`, `warm_symbols`, `scanner_runs`, `analysis_config`, `analysis_runs`, `temperature_config`, `temperature_runs`). Migrations: `npm run db:migrate:remote`.

### Exchangewide Volume Gate (EVG)

Product name for per-exchange warm-symbol jobs (10d volume + approx daily value filters). API paths remain `/scanners`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/scanners` | List exchanges + config + warm counts |
| `GET` | `/scanners/:id` | Detail + warm symbols |
| `PATCH` | `/scanners/:id` | Update filters / interval / enabled |
| `POST` | `/scanners/:id/run` | Queue an EVG run now |
| `GET` | `/scanners/runs/:runId` | Poll run progress |

Runs process via Queue `penny-edge-scanner-jobs` in pages of 50, upserting matches after each page. Cron `0 * * * *` starts due enabled EVG scanners (next run waits a full interval after enable).

### Trend Analysis for Symbols (TAS)

Product name for scheduled deep price analysis of all EVG-gated (`is_warm`) symbols. Uses Yahoo chart (`/v8/finance/chart`) for daily + hourly series; stores the **full** analysis JSON on `warm_symbols.analysis_json`, including **raw hourly closes** (`intraday.hourly`) and homemade roll-window averages (`intraday.points`).

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/analysis` | Config + warm/analyzed counts + active run |
| `GET` | `/analysis/symbols` | All warm symbols with full `analysis` payload |
| `PATCH` | `/analysis` | Update enabled / interval / lookbackDays / rollHours |
| `POST` | `/analysis/run` | Queue a TAS run now |
| `GET` | `/analysis/runs/:runId` | Poll run progress |

Runs process via Queue `penny-edge-analysis-jobs` in small pages (default 5). Same hourly cron as EVG; `next_run_at` gates work. Defaults: lookback 21 days, roll window 3 hours, price-only rolling averages.

### Heat and Interest Scale (HIS)

Product name for scheduled crash-heat scoring (0–100) of TAS snapshots. No Yahoo re-fetch — reads `analysis_json` hourly closes and writes `temperature` + component breakdown on `warm_symbols`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/temperature` | Config + params + scored/analyzed counts + active run |
| `GET` | `/temperature/symbols` | Warm symbols with temperature + components |
| `PATCH` | `/temperature` | Update enabled / intervalHours / scoring params |
| `POST` | `/temperature/run` | Queue a HIS run now |
| `GET` | `/temperature/runs/:runId` | Poll run progress |

Runs process via Queue `penny-edge-temperature-jobs`. Same hourly cron; `next_run_at` gates work. High scores = deep, sharp, recent drops; flat/rising names are dampened.

## Design notes

Monochrome UI with bold Manrope display type, IBM Plex Sans body, fully rounded buttons, and a collapsible left sidebar.
