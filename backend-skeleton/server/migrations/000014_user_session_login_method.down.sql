ALTER TABLE user_sessions
  DROP CONSTRAINT IF EXISTS chk_user_sessions_login_method;

ALTER TABLE user_sessions
  DROP COLUMN IF EXISTS login_method;
