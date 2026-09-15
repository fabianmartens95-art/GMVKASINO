ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS email VARCHAR(254),
  ADD COLUMN IF NOT EXISTS password_scheme TEXT,
  ADD COLUMN IF NOT EXISTS password_salt BYTEA,
  ADD COLUMN IF NOT EXISTS password_hash BYTEA,
  ADD COLUMN IF NOT EXISTS updated_at BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_unique_idx
  ON accounts (email)
  WHERE email IS NOT NULL;

ALTER TABLE demo_sessions
  ADD COLUMN IF NOT EXISTS auth_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  revoked_at BIGINT,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS auth_sessions_account_idx
  ON auth_sessions (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx
  ON auth_sessions (expires_at, last_seen_at)
  WHERE revoked_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accounts_credentials_complete'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_credentials_complete CHECK (
        (email IS NULL AND password_scheme IS NULL AND password_salt IS NULL AND password_hash IS NULL)
        OR
        (email IS NOT NULL AND password_scheme IS NOT NULL AND password_salt IS NOT NULL AND password_hash IS NOT NULL)
      );
  END IF;
END $$;
