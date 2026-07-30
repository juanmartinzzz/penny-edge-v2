-- Future features backlog (capability-oriented ideas for later execution)
CREATE TABLE IF NOT EXISTS future_features (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea',
  priority INTEGER NOT NULL DEFAULT 0,
  tags_json TEXT,
  payload_json TEXT,
  execution_notes TEXT,
  executed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_future_features_status_priority
  ON future_features (status, priority DESC);

CREATE INDEX IF NOT EXISTS idx_future_features_type_status
  ON future_features (type, status);
