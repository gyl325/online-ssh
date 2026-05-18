BEGIN;

DROP INDEX IF EXISTS idx_user_mfa_tokens_client_ip_created;
DROP INDEX IF EXISTS idx_user_mfa_tokens_user_created;
DROP TABLE IF EXISTS user_mfa_tokens;

DROP INDEX IF EXISTS idx_user_mfa_recovery_codes_user_unused;
DROP TABLE IF EXISTS user_mfa_recovery_codes;

DROP TRIGGER IF EXISTS trg_user_mfa_settings_updated_at ON user_mfa_settings;
DROP TABLE IF EXISTS user_mfa_settings;

COMMIT;
