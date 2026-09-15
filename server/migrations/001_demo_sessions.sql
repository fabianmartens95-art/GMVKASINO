CREATE TABLE IF NOT EXISTS demo_sessions (
  id TEXT PRIMARY KEY,
  player VARCHAR(40) NOT NULL DEFAULT '',
  balance NUMERIC(18,2) NOT NULL,
  spins BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS demo_sessions_last_seen_idx
  ON demo_sessions (last_seen_at);

CREATE INDEX IF NOT EXISTS demo_sessions_created_at_idx
  ON demo_sessions (created_at);
