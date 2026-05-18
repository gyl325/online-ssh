BEGIN;

CREATE TABLE IF NOT EXISTS roles (
  key VARCHAR(50) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_key VARCHAR(50) NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  permission VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_key, permission)
);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS chk_users_role;

ALTER TABLE users
  ALTER COLUMN role TYPE VARCHAR(50) USING role::varchar(50);

INSERT INTO roles (key, name, description, is_system, is_active)
VALUES
  ('admin', 'Administrator', 'Full administrative access', TRUE, TRUE),
  ('user', 'User', 'Default application user', TRUE, TRUE)
ON CONFLICT (key) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = TRUE,
  is_active = TRUE;

INSERT INTO role_permissions (role_key, permission)
VALUES
  ('admin', 'admin.access'),
  ('admin', 'admin.users.manage'),
  ('admin', 'admin.sessions.manage'),
  ('admin', 'admin.roles.manage'),
  ('admin', 'admin.database.manage'),
  ('admin', 'hosts.manage'),
  ('admin', 'credentials.manage'),
  ('admin', 'terminal.connect'),
  ('admin', 'files.manage'),
  ('admin', 'transfers.manage'),
  ('admin', 'audit.read'),
  ('user', 'hosts.manage'),
  ('user', 'credentials.manage'),
  ('user', 'terminal.connect'),
  ('user', 'files.manage'),
  ('user', 'transfers.manage'),
  ('user', 'audit.read')
ON CONFLICT (role_key, permission) DO NOTHING;

ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'user';

ALTER TABLE users
  ADD CONSTRAINT fk_users_role FOREIGN KEY (role) REFERENCES roles(key);

CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission);

CREATE TRIGGER trg_roles_set_updated_at
BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
