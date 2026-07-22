-- COBUTA Telegram alerts: one-shot flag while a symbol stays in the ≥90 band

ALTER TABLE warm_symbols ADD COLUMN cobuta_alerted INTEGER NOT NULL DEFAULT 0;
