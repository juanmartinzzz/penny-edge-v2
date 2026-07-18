-- Heat and Interest Scale (HIS): crash-heat scoring of TAS snapshots

CREATE TABLE IF NOT EXISTS temperature_config (
  id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  interval_hours INTEGER NOT NULL DEFAULT 1,
  page_size INTEGER NOT NULL DEFAULT 25,
  params_json TEXT NOT NULL,
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

INSERT OR IGNORE INTO temperature_config (
  id, enabled, interval_hours, page_size, params_json,
  created_at, updated_at
) VALUES (
  'default',
  0,
  1,
  25,
  '{"windowHours":6,"peakLookbackHours":12,"impulseHours":2,"depthRefPct":15,"depthCurve":1.2,"minDropPct":3,"wDepth":0.45,"wSharp":0.35,"wRecency":0.2,"recencyHalfLifeHours":4,"upsideFlatBand":0,"upsideScale":0.25,"upsideCap":35,"belowAvgBoostMax":10,"belowAvgRefPct":20,"minIntradayPoints":4}',
  datetime('now'),
  datetime('now')
);

CREATE TABLE IF NOT EXISTS temperature_runs (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  offset INTEGER NOT NULL DEFAULT 0,
  page_size INTEGER NOT NULL DEFAULT 25,
  scanned INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_temperature_runs_status
  ON temperature_runs (status, created_at DESC);

ALTER TABLE warm_symbols ADD COLUMN temperature REAL;
ALTER TABLE warm_symbols ADD COLUMN temperature_components_json TEXT;
ALTER TABLE warm_symbols ADD COLUMN temperature_at TEXT;
ALTER TABLE warm_symbols ADD COLUMN temperature_run_id TEXT;
