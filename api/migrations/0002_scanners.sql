-- Exchange scanner configs (schedule + filters)
CREATE TABLE IF NOT EXISTS exchange_scanners (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  interval_hours INTEGER NOT NULL DEFAULT 24,
  min_avg_volume_10d REAL,
  min_approx_daily_value REAL,
  last_run_at TEXT,
  next_run_at TEXT,
  last_run_status TEXT,
  last_run_error TEXT,
  last_run_scanned INTEGER,
  last_run_matched INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exchange_scanners_due
  ON exchange_scanners (enabled, next_run_at);

INSERT OR IGNORE INTO exchange_scanners (
  id, code, label, enabled, interval_hours,
  min_avg_volume_10d, min_approx_daily_value,
  created_at, updated_at
) VALUES
  ('tor', 'TOR', 'TSX (Toronto)', 0, 24, 7777, 7777, datetime('now'), datetime('now')),
  ('van', 'VAN', 'TSXV (Venture)', 0, 24, 7777, 7777, datetime('now'), datetime('now')),
  ('nyq', 'NYQ', 'NYSE', 0, 24, 7777, 7777, datetime('now'), datetime('now')),
  ('nms', 'NMS', 'NASDAQ', 0, 24, 7777, 7777, datetime('now'), datetime('now')),
  ('ase', 'ASE', 'AMEX', 0, 24, 7777, 7777, datetime('now'), datetime('now')),
  ('pcx', 'PCX', 'Pacific Exchange', 0, 24, 7777, 7777, datetime('now'), datetime('now'));

-- Symbols that currently make the cut (and history of last scan values)
CREATE TABLE IF NOT EXISTS warm_symbols (
  id TEXT PRIMARY KEY NOT NULL,
  scanner_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  name TEXT,
  price REAL,
  change_percent REAL,
  volume REAL,
  avg_volume_10d REAL,
  avg_volume_3m REAL,
  fifty_day_average REAL,
  approx_daily_value REAL,
  currency TEXT,
  is_warm INTEGER NOT NULL DEFAULT 1,
  last_seen_run_id TEXT,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (scanner_id, symbol),
  FOREIGN KEY (scanner_id) REFERENCES exchange_scanners(id)
);

CREATE INDEX IF NOT EXISTS idx_warm_symbols_scanner_warm
  ON warm_symbols (scanner_id, is_warm);

CREATE INDEX IF NOT EXISTS idx_warm_symbols_run
  ON warm_symbols (last_seen_run_id);

-- Async scan runs (queued / running / ok / error)
CREATE TABLE IF NOT EXISTS scanner_runs (
  id TEXT PRIMARY KEY NOT NULL,
  scanner_id TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  offset INTEGER NOT NULL DEFAULT 0,
  page_size INTEGER NOT NULL DEFAULT 50,
  scanned INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (scanner_id) REFERENCES exchange_scanners(id)
);

CREATE INDEX IF NOT EXISTS idx_scanner_runs_scanner_status
  ON scanner_runs (scanner_id, status, created_at DESC);
