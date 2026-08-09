-- SPA owns its own session hours (independent of EVG).
-- One-time seed from exchange_scanners, then Binance → 24/7.

ALTER TABLE spa_exchanges ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE spa_exchanges ADD COLUMN open_local TEXT NOT NULL DEFAULT '09:30';
ALTER TABLE spa_exchanges ADD COLUMN close_local TEXT NOT NULL DEFAULT '16:00';
ALTER TABLE spa_exchanges ADD COLUMN include_weekends INTEGER NOT NULL DEFAULT 0;

-- Copy current EVG hours once as a starting point.
UPDATE spa_exchanges
SET
  timezone = (
    SELECT s.timezone FROM exchange_scanners s WHERE s.id = spa_exchanges.id
  ),
  open_local = (
    SELECT s.open_local FROM exchange_scanners s WHERE s.id = spa_exchanges.id
  ),
  close_local = (
    SELECT s.close_local FROM exchange_scanners s WHERE s.id = spa_exchanges.id
  ),
  include_weekends = (
    SELECT s.include_weekends FROM exchange_scanners s WHERE s.id = spa_exchanges.id
  )
WHERE EXISTS (
  SELECT 1 FROM exchange_scanners s WHERE s.id = spa_exchanges.id
);

-- SPA Binance samples around the clock (own config, not EVG's night gate).
UPDATE spa_exchanges
SET
  timezone = 'America/New_York',
  open_local = '00:00',
  close_local = '24:00',
  include_weekends = 1,
  updated_at = datetime('now')
WHERE code = 'BINANCE';
