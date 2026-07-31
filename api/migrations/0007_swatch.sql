-- SWATCH (Sell Watch): user-curated assets with close-to-close variation alerts

CREATE TABLE IF NOT EXISTS swatch_config (
  id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  interval_hours INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  last_run_status TEXT,
  last_run_error TEXT,
  last_run_scanned INTEGER,
  last_run_ok INTEGER,
  last_run_failed INTEGER,
  last_run_alerted INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO swatch_config (
  id, enabled, interval_hours, created_at, updated_at
) VALUES (
  'default',
  0,
  1,
  datetime('now'),
  datetime('now')
);

CREATE TABLE IF NOT EXISTS swatch_assets (
  id TEXT PRIMARY KEY NOT NULL,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  threshold_pct REAL NOT NULL,
  window_hours REAL NOT NULL,
  direction TEXT NOT NULL,
  cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  last_checked_at TEXT,
  last_close REAL,
  last_move_pct REAL,
  last_alerted_at TEXT,
  last_alert_move_pct REAL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (exchange, symbol)
);

CREATE INDEX IF NOT EXISTS idx_swatch_assets_enabled
  ON swatch_assets (enabled, symbol);

CREATE TABLE IF NOT EXISTS swatch_runs (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  scanned INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  alerted INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_swatch_runs_status
  ON swatch_runs (status, created_at DESC);
