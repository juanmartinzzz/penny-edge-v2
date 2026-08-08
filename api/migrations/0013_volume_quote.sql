-- Quote-denominated volume alongside base/share volume.
-- volume / avg_volume_10d stay in base units; *_quote columns are money activity.
ALTER TABLE warm_symbols ADD COLUMN volume_quote REAL;
ALTER TABLE warm_symbols ADD COLUMN avg_volume_10d_quote REAL;
