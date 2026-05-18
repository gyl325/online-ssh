ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS login_method VARCHAR(20) NOT NULL DEFAULT 'password';

ALTER TABLE user_sessions
  DROP CONSTRAINT IF EXISTS chk_user_sessions_login_method;

ALTER TABLE user_sessions
  ADD CONSTRAINT chk_user_sessions_login_method
  CHECK (login_method IN ('password', 'email_code'));
