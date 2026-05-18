CREATE UNIQUE INDEX IF NOT EXISTS uq_users_display_name_lower
ON users (lower(display_name));
