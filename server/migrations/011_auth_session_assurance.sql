ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS assurance_level TEXT NOT NULL DEFAULT 'base',
  ADD COLUMN IF NOT EXISTS assurance_at BIGINT;

ALTER TABLE auth_sessions
  DROP CONSTRAINT IF EXISTS auth_sessions_assurance_level_valid,
  ADD CONSTRAINT auth_sessions_assurance_level_valid
    CHECK (assurance_level IN ('base', 'verified_email', 'mfa'));

ALTER TABLE auth_sessions
  DROP CONSTRAINT IF EXISTS auth_sessions_assurance_at_valid,
  ADD CONSTRAINT auth_sessions_assurance_at_valid
    CHECK (assurance_at IS NULL OR assurance_at >= created_at);

ALTER TABLE auth_sessions
  DROP CONSTRAINT IF EXISTS auth_sessions_assurance_timestamp_consistent,
  ADD CONSTRAINT auth_sessions_assurance_timestamp_consistent
    CHECK (
      (assurance_level = 'base' AND assurance_at IS NULL)
      OR
      (assurance_level IN ('verified_email', 'mfa') AND assurance_at IS NOT NULL)
    );
