CREATE TABLE IF NOT EXISTS demo_sessions (
  id TEXT PRIMARY KEY,
  player VARCHAR(40) NOT NULL DEFAULT '',
  balance NUMERIC(14, 2) NOT NULL CHECK (balance >= 0),
  spins BIGINT NOT NULL DEFAULT 0 CHECK (spins >= 0),
  created_at_ms BIGINT NOT NULL,
  last_seen_at_ms BIGINT NOT NULL,
  rotated_at_ms BIGINT NULL
);

CREATE INDEX IF NOT EXISTS demo_sessions_last_seen_idx
  ON demo_sessions (last_seen_at_ms);

CREATE INDEX IF NOT EXISTS demo_sessions_created_at_idx
  ON demo_sessions (created_at_ms);
