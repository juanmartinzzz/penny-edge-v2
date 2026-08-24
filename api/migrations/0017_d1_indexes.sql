-- D1 free-plan rows-read: TAS / HIS / COBUTA query warm_symbols by is_warm
-- without scanner_id. idx_warm_symbols_scanner_warm cannot help those, so they
-- SCAN the whole table (including cooled-off rows). Partial indexes cover only
-- the live warm set.
--
-- idx_warm_symbols_run is unused as a lookup (last_seen_run_id is only written
-- and compared after scanner_id + is_warm) and costs a write on every EVG upsert.
--
-- ANALYZE populates sqlite_stat1 so the planner can pick existing HISS indexes
-- (e.g. idx_hiss_symbols_exchange_temp for ORDER BY temperature) instead of an
-- arbitrary exchange_id prefix.

CREATE INDEX IF NOT EXISTS idx_warm_symbols_warm_exchange_symbol
  ON warm_symbols (exchange, symbol)
  WHERE is_warm = 1;

CREATE INDEX IF NOT EXISTS idx_warm_symbols_warm_temperature
  ON warm_symbols (temperature DESC, exchange, symbol)
  WHERE is_warm = 1;

DROP INDEX IF EXISTS idx_warm_symbols_run;

ANALYZE;
PRAGMA optimize;
