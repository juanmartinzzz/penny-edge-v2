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

## Design notes

Monochrome UI with bold Syne display type, IBM Plex Sans body, fully rounded buttons, and a collapsible left sidebar.
