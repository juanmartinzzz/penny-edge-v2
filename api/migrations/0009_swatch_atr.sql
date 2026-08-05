-- SWATCH all-time return (ATR): shares + avg cost + $/% trigger levels
ALTER TABLE swatch_assets ADD COLUMN shares REAL;
ALTER TABLE swatch_assets ADD COLUMN avg_cost REAL;
ALTER TABLE swatch_assets ADD COLUMN atr_triggers_json TEXT;
ALTER TABLE swatch_assets ADD COLUMN last_atr_pnl REAL;
ALTER TABLE swatch_assets ADD COLUMN last_atr_pct REAL;
ALTER TABLE swatch_assets ADD COLUMN last_alert_kind TEXT;
