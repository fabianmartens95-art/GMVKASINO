CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 3 AND 120),
  occurred_at TIMESTAMPTZ NOT NULL,
  account_id TEXT,
  request_id TEXT,
  session_ref TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_events_occurred_at_idx
  ON audit_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_type_occurred_at_idx
  ON audit_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_account_occurred_at_idx
  ON audit_events (account_id, occurred_at DESC)
  WHERE account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION gmvkasino_reject_audit_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION gmvkasino_reject_audit_event_mutation();

COMMENT ON TABLE audit_events IS
  'Append-only operational audit trail. Financial truth remains in the ledger; audit events provide security and operational traceability.';
