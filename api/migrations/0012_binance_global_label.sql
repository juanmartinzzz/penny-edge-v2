-- Revert EVG / SWATCH label to global Binance (api.binance.us did not work from Workers).
UPDATE exchange_scanners
SET
  label = 'Binance',
  updated_at = datetime('now')
WHERE id = 'binance' OR code = 'BINANCE';
