-- Trend Analysis for Symbols (TAS): global config + runs + per-symbol JSON snapshot

CREATE TABLE IF NOT EXISTS analysis_config (
  id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  interval_hours INTEGER NOT NULL DEFAULT 6,
  lookback_days INTEGER NOT NULL DEFAULT 21,
  roll_hours INTEGER NOT NULL DEFAULT 3,
  page_size INTEGER NOT NULL DEFAULT 5,
  last_run_at TEXT,
  next_run_at TEXT,
  last_run_status TEXT,
  last_run_error TEXT,
  last_run_scanned INTEGER,
  last_run_ok INTEGER,
  last_run_failed INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO analysis_config (
  id, enabled, interval_hours, lookback_days, roll_hours, page_size,
  created_at, updated_at
) VALUES (
  'default', 0, 6, 21, 3, 5, datetime('now'), datetime('now')
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  offset INTEGER NOT NULL DEFAULT 0,
  page_size INTEGER NOT NULL DEFAULT 5,
  scanned INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_runs_status
  ON analysis_runs (status, created_at DESC);

ALTER TABLE warm_symbols ADD COLUMN analysis_json TEXT;
ALTER TABLE warm_symbols ADD COLUMN analyzed_at TEXT;
ALTER TABLE warm_symbols ADD COLUMN analysis_run_id TEXT;
