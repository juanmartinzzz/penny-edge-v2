-- Point EVG / SWATCH copy at Binance.US (api.binance.us market data).
UPDATE exchange_scanners
SET
  label = 'Binance.US',
  updated_at = datetime('now')
WHERE id = 'binance' OR code = 'BINANCE';
