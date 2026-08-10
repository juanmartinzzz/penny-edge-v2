-- HISS — Heat Interest SPA Scores
-- Per-symbol live ledger folded from each SPA sample.
-- Independent of current HIS (temperature_* / warm_symbols scoring).

CREATE TABLE IF NOT EXISTS hiss_symbols (
  id TEXT PRIMARY KEY NOT NULL,
  exchange_id TEXT NOT NULL,
  exchange_code TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  last_price REAL,
  last_volume REAL,
  last_sample_at TEXT,
  last_sample_id TEXT,
  volume_last_full_day REAL,
  avg_volume_10d REAL,
  volume_coverage_days INTEGER NOT NULL DEFAULT 0,
  temperature REAL,
  temperature_components_json TEXT,
  temperature_at TEXT,
  memory_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (exchange_id, symbol),
  FOREIGN KEY (exchange_id) REFERENCES spa_exchanges(id)
);

CREATE INDEX IF NOT EXISTS idx_hiss_symbols_exchange_temp
  ON hiss_symbols (exchange_id, temperature DESC);

CREATE INDEX IF NOT EXISTS idx_hiss_symbols_exchange_avg_vol
  ON hiss_symbols (exchange_id, avg_volume_10d DESC);

CREATE INDEX IF NOT EXISTS idx_hiss_symbols_exchange_day_vol
  ON hiss_symbols (exchange_id, volume_last_full_day DESC);

CREATE INDEX IF NOT EXISTS idx_hiss_symbols_updated
  ON hiss_symbols (updated_at DESC);
