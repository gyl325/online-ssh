BEGIN;

DROP TRIGGER IF EXISTS trg_roles_set_updated_at ON roles;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS fk_users_role;

DELETE FROM users WHERE role NOT IN ('admin', 'user');

ALTER TABLE users
  ALTER COLUMN role TYPE VARCHAR(20) USING role::varchar(20);

ALTER TABLE users
  ADD CONSTRAINT chk_users_role CHECK (role IN ('admin', 'user'));

ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'user';

DROP INDEX IF EXISTS idx_role_permissions_permission;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS roles;

COMMIT;
