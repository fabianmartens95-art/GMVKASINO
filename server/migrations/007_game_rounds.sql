CREATE TABLE IF NOT EXISTS game_rounds (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  game_id TEXT NOT NULL,
  asset_code VARCHAR(16) NOT NULL REFERENCES assets(code) ON DELETE RESTRICT,
  bet_atomic NUMERIC(78,0) NOT NULL CHECK (bet_atomic > 0),
  payout_atomic NUMERIC(78,0) NOT NULL CHECK (payout_atomic >= 0),
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'settled' CHECK (status IN ('settled')),
  settlement_reference_id TEXT NOT NULL,
  first_request_id TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS game_rounds_account_created_idx
  ON game_rounds (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS game_rounds_settlement_reference_idx
  ON game_rounds (settlement_reference_id);
