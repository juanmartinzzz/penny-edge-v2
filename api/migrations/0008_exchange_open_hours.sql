-- Per-exchange regular session hours for cron gates (EVG / TAS / SWATCH).
ALTER TABLE exchange_scanners ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE exchange_scanners ADD COLUMN open_local TEXT NOT NULL DEFAULT '09:30';
ALTER TABLE exchange_scanners ADD COLUMN close_local TEXT NOT NULL DEFAULT '16:00';

UPDATE exchange_scanners SET
  timezone = 'America/Toronto',
  open_local = '09:30',
  close_local = '16:00',
  updated_at = datetime('now')
WHERE code IN ('TOR', 'VAN');

UPDATE exchange_scanners SET
  timezone = 'America/New_York',
  open_local = '09:30',
  close_local = '16:00',
  updated_at = datetime('now')
WHERE code IN ('NYQ', 'NMS', 'ASE', 'PCX');
