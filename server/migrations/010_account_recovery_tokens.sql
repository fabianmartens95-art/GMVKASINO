CREATE TABLE IF NOT EXISTS account_recovery_tokens (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  token_hash CHAR(64) NOT NULL UNIQUE,
  request_id TEXT,
  created_at BIGINT NOT NULL CHECK (created_at >= 0),
  expires_at BIGINT NOT NULL CHECK (expires_at > created_at),
  consumed_at BIGINT CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  invalidated_at BIGINT CHECK (invalidated_at IS NULL OR invalidated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS account_recovery_tokens_account_idx
  ON account_recovery_tokens (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS account_recovery_tokens_active_idx
  ON account_recovery_tokens (expires_at)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;
