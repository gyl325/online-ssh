BEGIN;

CREATE TABLE user_mfa_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret_encrypted TEXT NULL,
  totp_secret_key_version INT NULL,
  totp_confirmed_at TIMESTAMPTZ NULL,
  pending_totp_secret_encrypted TEXT NULL,
  pending_totp_secret_key_version INT NULL,
  pending_totp_expires_at TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_user_mfa_settings_updated_at
BEFORE UPDATE ON user_mfa_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_mfa_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_mfa_recovery_codes_user_unused
ON user_mfa_recovery_codes(user_id)
WHERE used_at IS NULL;

CREATE TABLE user_mfa_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  login_method VARCHAR(20) NOT NULL,
  client_ip INET NULL,
  user_agent TEXT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_mfa_tokens_user_created
ON user_mfa_tokens(user_id, created_at DESC);

CREATE INDEX idx_user_mfa_tokens_client_ip_created
ON user_mfa_tokens(client_ip, created_at DESC)
WHERE client_ip IS NOT NULL;

COMMIT;
