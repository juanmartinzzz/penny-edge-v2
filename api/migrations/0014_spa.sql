-- SPA — Symbol Price Archive
-- Per-exchange config + runs + staging pages + compact sample snapshots.

CREATE TABLE IF NOT EXISTS spa_exchanges (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  interval_minutes INTEGER NOT NULL DEFAULT 20,
  retention_days INTEGER NOT NULL DEFAULT 7,
  -- JSON array of Binance quote assets (e.g. ["USDT"]); NULL for equities.
  enabled_quote_assets TEXT,
  last_run_at TEXT,
  next_run_at TEXT,
  last_run_status TEXT,
  last_run_error TEXT,
  last_run_scanned INTEGER,
  last_sample_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spa_exchanges_due
  ON spa_exchanges (enabled, next_run_at);

CREATE TABLE IF NOT EXISTS spa_runs (
  id TEXT PRIMARY KEY NOT NULL,
  exchange_id TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  offset INTEGER NOT NULL DEFAULT 0,
  page_size INTEGER NOT NULL DEFAULT 200,
  scanned INTEGER NOT NULL DEFAULT 0,
  pages INTEGER NOT NULL DEFAULT 0,
  sample_id TEXT,
  calls_json TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (exchange_id) REFERENCES spa_exchanges(id)
);

CREATE INDEX IF NOT EXISTS idx_spa_runs_exchange_status
  ON spa_runs (exchange_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS spa_run_pages (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL,
  page_offset INTEGER NOT NULL,
  quotes_json TEXT NOT NULL,
  call_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, page_offset),
  FOREIGN KEY (run_id) REFERENCES spa_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_spa_run_pages_run
  ON spa_run_pages (run_id, page_offset);

CREATE TABLE IF NOT EXISTS spa_samples (
  id TEXT PRIMARY KEY NOT NULL,
  exchange_id TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  sampled_at TEXT NOT NULL,
  symbol_count INTEGER NOT NULL,
  prices_json TEXT NOT NULL,
  calls_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (exchange_id) REFERENCES spa_exchanges(id),
  FOREIGN KEY (run_id) REFERENCES spa_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_spa_samples_exchange_time
  ON spa_samples (exchange_id, sampled_at DESC);

-- One SPA venue per EVG exchange (same ids/codes); off by default.
INSERT OR IGNORE INTO spa_exchanges (
  id, code, label, enabled, interval_minutes, retention_days,
  enabled_quote_assets, created_at, updated_at
)
SELECT
  id,
  code,
  label,
  0,
  20,
  7,
  enabled_quote_assets,
  datetime('now'),
  datetime('now')
FROM exchange_scanners;
