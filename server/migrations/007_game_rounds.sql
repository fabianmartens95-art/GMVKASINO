CREATE TABLE IF NOT EXISTS game_rounds (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  session_ref VARCHAR(64) NOT NULL,
  game_id TEXT NOT NULL,
  asset_code VARCHAR(16) NOT NULL REFERENCES assets(code) ON DELETE RESTRICT,
  bet_atomic NUMERIC(78,0) NOT NULL CHECK (bet_atomic > 0),
  idempotency_key TEXT NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  request_id TEXT,
  status TEXT NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED', 'AUTHORIZED', 'RESULT_CREATED', 'SETTLED', 'AUDITED')),
  response JSONB,
  created_at BIGINT NOT NULL,
  settled_at BIGINT,
  UNIQUE (account_id, idempotency_key),
  CHECK (
    (status IN ('REQUESTED', 'AUTHORIZED', 'RESULT_CREATED') AND response IS NULL AND settled_at IS NULL)
    OR (status IN ('SETTLED', 'AUDITED') AND response IS NOT NULL AND settled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS game_rounds_account_created_idx
  ON game_rounds (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS game_rounds_game_created_idx
  ON game_rounds (game_id, created_at DESC);

CREATE INDEX IF NOT EXISTS game_rounds_request_id_idx
  ON game_rounds (request_id)
  WHERE request_id IS NOT NULL;
