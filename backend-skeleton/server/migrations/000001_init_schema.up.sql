BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  preferred_locale VARCHAR(10) NOT NULL DEFAULT 'zh-CN',
  theme VARCHAR(20) NOT NULL DEFAULT 'system',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_users_status CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL,
  refresh_token_hash TEXT NULL,
  client_ip INET NULL,
  user_agent TEXT NULL,
  device_label VARCHAR(255) NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE host_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_host_groups_user_name UNIQUE (user_id, name)
);

CREATE TABLE credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  auth_type VARCHAR(20) NOT NULL,
  encrypted_secret TEXT NULL,
  encrypted_private_key TEXT NULL,
  encrypted_passphrase TEXT NULL,
  key_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_credentials_auth_type CHECK (auth_type IN ('password', 'private_key'))
);

CREATE TABLE hosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID NULL REFERENCES host_groups(id) ON DELETE SET NULL,
  credential_id UUID NULL REFERENCES credentials(id) ON DELETE SET NULL,
  name VARCHAR(120) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL DEFAULT 22,
  username VARCHAR(120) NOT NULL,
  auth_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  last_connected_at TIMESTAMPTZ NULL,
  archived_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_hosts_port CHECK (port > 0 AND port <= 65535),
  CONSTRAINT chk_hosts_auth_type CHECK (auth_type IN ('password', 'private_key')),
  CONSTRAINT chk_hosts_status CHECK (status IN ('active', 'archived'))
);

CREATE TABLE host_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  algorithm VARCHAR(50) NOT NULL,
  fingerprint VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'trusted',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_host_fingerprints_status CHECK (status IN ('trusted', 'changed', 'revoked'))
);

CREATE TABLE terminal_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'connecting',
  remote_addr VARCHAR(255) NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_terminal_sessions_status CHECK (status IN ('connecting', 'connected', 'disconnected', 'failed'))
);

CREATE TABLE transfer_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_type VARCHAR(20) NOT NULL,
  source_type VARCHAR(20) NOT NULL,
  target_type VARCHAR(20) NOT NULL,
  source_host_id UUID NULL REFERENCES hosts(id) ON DELETE SET NULL,
  target_host_id UUID NULL REFERENCES hosts(id) ON DELETE SET NULL,
  source_path TEXT NULL,
  target_path TEXT NULL,
  tmp_path TEXT NULL,
  file_name TEXT NOT NULL,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  transferred_bytes BIGINT NOT NULL DEFAULT 0,
  chunk_size BIGINT NOT NULL DEFAULT 0,
  resumable BOOLEAN NOT NULL DEFAULT TRUE,
  retry_count INT NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  error_code VARCHAR(100) NULL,
  error_message TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_transfer_tasks_type CHECK (task_type IN ('upload', 'download')),
  CONSTRAINT chk_transfer_tasks_status CHECK (
    status IN (
      'pending',
      'uploading_to_platform',
      'queued_for_remote_transfer',
      'transferring',
      'paused',
      'failed',
      'completed',
      'canceled'
    )
  ),
  CONSTRAINT chk_transfer_tasks_nonnegative_bytes CHECK (
    total_bytes >= 0 AND transferred_bytes >= 0 AND chunk_size >= 0
  )
);

CREATE TABLE transfer_task_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES transfer_tasks(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  start_offset BIGINT NOT NULL,
  end_offset BIGINT NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum VARCHAR(128) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_transfer_task_chunks UNIQUE (task_id, chunk_index),
  CONSTRAINT chk_transfer_task_chunks_offsets CHECK (
    start_offset >= 0 AND end_offset >= start_offset AND size_bytes >= 0
  )
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terminal_session_id UUID NULL REFERENCES terminal_sessions(id) ON DELETE SET NULL,
  event_type VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NULL,
  resource_id UUID NULL,
  target_host_id UUID NULL REFERENCES hosts(id) ON DELETE SET NULL,
  target_path TEXT NULL,
  result VARCHAR(20) NOT NULL DEFAULT 'success',
  message TEXT NULL,
  client_ip INET NULL,
  user_agent TEXT NULL,
  audit_level VARCHAR(20) NOT NULL DEFAULT 'basic',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_audit_logs_result CHECK (result IN ('success', 'failure')),
  CONSTRAINT chk_audit_logs_audit_level CHECK (audit_level IN ('basic', 'command', 'full_io'))
);

CREATE TABLE saved_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  command_text TEXT NOT NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  layout_json JSONB NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX idx_user_sessions_last_seen_at ON user_sessions(last_seen_at);

CREATE INDEX idx_credentials_user_id ON credentials(user_id);
CREATE INDEX idx_hosts_user_id ON hosts(user_id);
CREATE INDEX idx_hosts_group_id ON hosts(group_id);
CREATE INDEX idx_hosts_credential_id ON hosts(credential_id);
CREATE INDEX idx_hosts_user_favorite ON hosts(user_id, is_favorite);
CREATE INDEX idx_host_fingerprints_host_id ON host_fingerprints(host_id);
CREATE UNIQUE INDEX uq_host_fingerprints_host_algorithm ON host_fingerprints(host_id, algorithm);

CREATE INDEX idx_terminal_sessions_user_id ON terminal_sessions(user_id);
CREATE INDEX idx_terminal_sessions_host_id ON terminal_sessions(host_id);
CREATE INDEX idx_terminal_sessions_started_at ON terminal_sessions(started_at DESC);

CREATE INDEX idx_transfer_tasks_user_id ON transfer_tasks(user_id);
CREATE INDEX idx_transfer_tasks_status ON transfer_tasks(status);
CREATE INDEX idx_transfer_tasks_source_host_id ON transfer_tasks(source_host_id);
CREATE INDEX idx_transfer_tasks_target_host_id ON transfer_tasks(target_host_id);
CREATE INDEX idx_transfer_tasks_created_at ON transfer_tasks(created_at DESC);

CREATE INDEX idx_transfer_task_chunks_task_id ON transfer_task_chunks(task_id);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_target_host_id ON audit_logs(target_host_id);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_occurred_at ON audit_logs(occurred_at DESC);

CREATE INDEX idx_saved_commands_user_id ON saved_commands(user_id);
CREATE INDEX idx_workspace_layouts_user_id ON workspace_layouts(user_id);

CREATE TRIGGER trg_users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_host_groups_set_updated_at
BEFORE UPDATE ON host_groups
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_credentials_set_updated_at
BEFORE UPDATE ON credentials
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_hosts_set_updated_at
BEFORE UPDATE ON hosts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_host_fingerprints_set_updated_at
BEFORE UPDATE ON host_fingerprints
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_terminal_sessions_set_updated_at
BEFORE UPDATE ON terminal_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_transfer_tasks_set_updated_at
BEFORE UPDATE ON transfer_tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_transfer_task_chunks_set_updated_at
BEFORE UPDATE ON transfer_task_chunks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_saved_commands_set_updated_at
BEFORE UPDATE ON saved_commands
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_workspace_layouts_set_updated_at
BEFORE UPDATE ON workspace_layouts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
