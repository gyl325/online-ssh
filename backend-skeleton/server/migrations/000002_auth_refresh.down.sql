DROP INDEX IF EXISTS idx_user_sessions_refresh_expires_at;
DROP INDEX IF EXISTS idx_user_sessions_refresh_token_hash;

ALTER TABLE user_sessions
  DROP COLUMN IF EXISTS refresh_rotated_at,
  DROP COLUMN IF EXISTS refresh_expires_at;
