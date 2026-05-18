ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS refresh_rotated_at TIMESTAMPTZ NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_refresh_token_hash
  ON user_sessions(refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_expires_at
  ON user_sessions(refresh_expires_at)
  WHERE refresh_token_hash IS NOT NULL AND revoked_at IS NULL;
