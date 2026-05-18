ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'admin';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS chk_users_role;

ALTER TABLE users
  ADD CONSTRAINT chk_users_role CHECK (role IN ('admin', 'user'));

ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
