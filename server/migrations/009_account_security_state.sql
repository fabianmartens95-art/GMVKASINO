ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS email_verified_at BIGINT,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at BIGINT;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_email_verified_at_nonnegative,
  ADD CONSTRAINT accounts_email_verified_at_nonnegative
    CHECK (email_verified_at IS NULL OR email_verified_at >= 0);

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_mfa_enrolled_at_nonnegative,
  ADD CONSTRAINT accounts_mfa_enrolled_at_nonnegative
    CHECK (mfa_enrolled_at IS NULL OR mfa_enrolled_at >= 0);
