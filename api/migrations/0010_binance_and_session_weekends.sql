-- Weekends are configurable for every exchange (crypto and future 24/7 venues).
ALTER TABLE exchange_scanners ADD COLUMN include_weekends INTEGER NOT NULL DEFAULT 0;

-- Binance-only: JSON array of enabled quote assets, e.g. ["USDT","BTC"].
-- NULL for equity scanners (ignored).
ALTER TABLE exchange_scanners ADD COLUMN enabled_quote_assets TEXT;

-- Binance EVG scanner: equity-like hours by default; USDT quote market only.
INSERT OR IGNORE INTO exchange_scanners (
  id, code, label, enabled, interval_hours,
  min_avg_volume_10d, min_approx_daily_value,
  timezone, open_local, close_local, include_weekends,
  enabled_quote_assets,
  created_at, updated_at
) VALUES (
  'binance',
  'BINANCE',
  'Binance',
  0,
  24,
  7777,
  7777,
  'America/New_York',
  '09:30',
  '16:00',
  0,
  '["USDT"]',
  datetime('now'),
  datetime('now')
);
