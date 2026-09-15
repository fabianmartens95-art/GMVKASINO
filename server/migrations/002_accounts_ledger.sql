CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  display_name VARCHAR(40) NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  code VARCHAR(16) PRIMARY KEY,
  decimals SMALLINT NOT NULL CHECK (decimals BETWEEN 0 AND 30),
  kind TEXT NOT NULL CHECK (kind IN ('demo', 'crypto', 'fiat')),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
);

INSERT INTO assets (code, decimals, kind, enabled, created_at)
VALUES ('DEMO', 2, 'demo', TRUE, 0)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  system_key TEXT,
  asset_code VARCHAR(16) NOT NULL REFERENCES assets(code) ON DELETE RESTRICT,
  purpose TEXT NOT NULL,
  allow_negative BOOLEAN NOT NULL DEFAULT FALSE,
  balance_atomic NUMERIC(78,0) NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  CHECK ((account_id IS NOT NULL) <> (system_key IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_user_unique_idx
  ON ledger_accounts (account_id, asset_code, purpose)
  WHERE account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_accounts_system_unique_idx
  ON ledger_accounts (system_key, asset_code, purpose)
  WHERE system_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  asset_code VARCHAR(16) NOT NULL REFERENCES assets(code) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  ledger_account_id TEXT NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  amount_atomic NUMERIC(78,0) NOT NULL CHECK (amount_atomic <> 0),
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_entries_transaction_idx
  ON ledger_entries (transaction_id);

CREATE INDEX IF NOT EXISTS ledger_entries_account_idx
  ON ledger_entries (ledger_account_id, id);

CREATE OR REPLACE FUNCTION gmvkasino_validate_ledger_transaction()
RETURNS TRIGGER AS $$
DECLARE
  tx_id TEXT;
  tx_asset VARCHAR(16);
  entry_sum NUMERIC(78,0);
BEGIN
  tx_id := COALESCE(NEW.transaction_id, OLD.transaction_id);

  SELECT asset_code INTO tx_asset
  FROM ledger_transactions
  WHERE id = tx_id;

  IF tx_asset IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ledger_entries e
    JOIN ledger_accounts a ON a.id = e.ledger_account_id
    WHERE e.transaction_id = tx_id
      AND a.asset_code <> tx_asset
  ) THEN
    RAISE EXCEPTION 'ledger transaction % contains mixed assets', tx_id;
  END IF;

  SELECT COALESCE(SUM(amount_atomic), 0)
  INTO entry_sum
  FROM ledger_entries
  WHERE transaction_id = tx_id;

  IF entry_sum <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % is not balanced', tx_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_balance_guard ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balance_guard
AFTER INSERT OR UPDATE OR DELETE ON ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION gmvkasino_validate_ledger_transaction();

INSERT INTO ledger_accounts (
  id, system_key, asset_code, purpose, allow_negative, balance_atomic, created_at
) VALUES
  ('sys_demo_issuance', 'demo_issuance', 'DEMO', 'issuance', TRUE, 0, 0),
  ('sys_demo_house', 'demo_house', 'DEMO', 'house', TRUE, 0, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE demo_sessions
  ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT;

INSERT INTO accounts (id, display_name, status, created_at)
SELECT
  'acct_' || md5(id),
  player,
  'active',
  created_at
FROM demo_sessions
WHERE account_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE demo_sessions
SET account_id = 'acct_' || md5(id)
WHERE account_id IS NULL;

INSERT INTO ledger_accounts (
  id, account_id, asset_code, purpose, allow_negative, balance_atomic, created_at
)
SELECT
  'wallet_' || md5(account_id || ':DEMO:available'),
  account_id,
  'DEMO',
  'available',
  FALSE,
  ROUND(balance * 100),
  created_at
FROM demo_sessions
ON CONFLICT DO NOTHING;

INSERT INTO ledger_transactions (
  id, asset_code, type, reference_type, reference_id, idempotency_key, metadata, created_at
)
SELECT
  'txn_' || md5('bootstrap:' || id),
  'DEMO',
  'INITIAL_CREDIT',
  'demo_session',
  id,
  'bootstrap:' || id,
  '{"migration":"002_accounts_ledger.sql"}'::jsonb,
  created_at
FROM demo_sessions
WHERE balance <> 0
ON CONFLICT (id) DO NOTHING;

INSERT INTO ledger_entries (transaction_id, ledger_account_id, amount_atomic, created_at)
SELECT
  'txn_' || md5('bootstrap:' || s.id),
  'wallet_' || md5(s.account_id || ':DEMO:available'),
  ROUND(s.balance * 100),
  s.created_at
FROM demo_sessions s
WHERE s.balance <> 0
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries e
    WHERE e.transaction_id = 'txn_' || md5('bootstrap:' || s.id)
      AND e.ledger_account_id = 'wallet_' || md5(s.account_id || ':DEMO:available')
  );

INSERT INTO ledger_entries (transaction_id, ledger_account_id, amount_atomic, created_at)
SELECT
  'txn_' || md5('bootstrap:' || s.id),
  'sys_demo_issuance',
  -ROUND(s.balance * 100),
  s.created_at
FROM demo_sessions s
WHERE s.balance <> 0
  AND NOT EXISTS (
    SELECT 1 FROM ledger_entries e
    WHERE e.transaction_id = 'txn_' || md5('bootstrap:' || s.id)
      AND e.ledger_account_id = 'sys_demo_issuance'
  );

UPDATE ledger_accounts
SET balance_atomic = -COALESCE((
  SELECT SUM(balance_atomic)
  FROM ledger_accounts
  WHERE account_id IS NOT NULL
    AND asset_code = 'DEMO'
    AND purpose = 'available'
), 0)
WHERE id = 'sys_demo_issuance';

ALTER TABLE demo_sessions
  ALTER COLUMN account_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS demo_sessions_account_idx
  ON demo_sessions (account_id);
