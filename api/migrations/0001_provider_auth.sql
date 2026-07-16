-- Provider session credentials (e.g. Yahoo cookie + crumb)
CREATE TABLE IF NOT EXISTS provider_auth (
  provider TEXT PRIMARY KEY NOT NULL,
  cookie TEXT NOT NULL,
  crumb TEXT NOT NULL,
  obtained_at TEXT NOT NULL,
  stale_after_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TEXT NOT NULL,
  meta_json TEXT
);
