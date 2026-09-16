CREATE TABLE IF NOT EXISTS account_roles (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('player', 'support', 'compliance', 'finance', 'admin', 'provider')),
  granted_at BIGINT NOT NULL,
  PRIMARY KEY (account_id, role)
);

CREATE INDEX IF NOT EXISTS account_roles_role_idx
  ON account_roles (role, account_id);

INSERT INTO account_roles (account_id, role, granted_at)
SELECT id, 'player', created_at
FROM accounts
ON CONFLICT (account_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION gmvkasino_assign_default_account_role()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO account_roles (account_id, role, granted_at)
  VALUES (NEW.id, 'player', NEW.created_at)
  ON CONFLICT (account_id, role) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounts_default_role ON accounts;
CREATE TRIGGER accounts_default_role
AFTER INSERT ON accounts
FOR EACH ROW EXECUTE FUNCTION gmvkasino_assign_default_account_role();
