CREATE TABLE IF NOT EXISTS payment_operations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  asset_code VARCHAR(16) NOT NULL REFERENCES assets(code) ON DELETE RESTRICT CHECK (asset_code = 'DEMO'),
  amount_atomic NUMERIC(78,0) NOT NULL CHECK (amount_atomic > 0),
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  first_request_id TEXT,
  reservation_transaction_id TEXT REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  settlement_transaction_id TEXT REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  reversal_transaction_id TEXT REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (
    (kind = 'deposit' AND status IN ('pending', 'completed', 'failed'))
    OR
    (kind = 'withdrawal' AND status IN ('reserved', 'approved', 'completed', 'rejected', 'failed'))
  ),
  UNIQUE (account_id, kind, idempotency_key)
);

CREATE INDEX IF NOT EXISTS payment_operations_account_created_idx
  ON payment_operations (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_operations_status_idx
  ON payment_operations (kind, status, created_at);

CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY,
  payment_operation_id TEXT NOT NULL REFERENCES payment_operations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  request_id TEXT,
  actor_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at BIGINT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS payment_events_operation_idx
  ON payment_events (payment_operation_id, created_at);

INSERT INTO ledger_accounts (
  id, system_key, asset_code, purpose, allow_negative, balance_atomic, created_at
) VALUES (
  'sys_demo_payment_clearing',
  'demo_payment_clearing',
  'DEMO',
  'payment_clearing',
  TRUE,
  0,
  0
)
ON CONFLICT (id) DO NOTHING;
