BEGIN;

DROP TRIGGER IF EXISTS trg_workspace_layouts_set_updated_at ON workspace_layouts;
DROP TRIGGER IF EXISTS trg_saved_commands_set_updated_at ON saved_commands;
DROP TRIGGER IF EXISTS trg_transfer_task_chunks_set_updated_at ON transfer_task_chunks;
DROP TRIGGER IF EXISTS trg_transfer_tasks_set_updated_at ON transfer_tasks;
DROP TRIGGER IF EXISTS trg_terminal_sessions_set_updated_at ON terminal_sessions;
DROP TRIGGER IF EXISTS trg_host_fingerprints_set_updated_at ON host_fingerprints;
DROP TRIGGER IF EXISTS trg_hosts_set_updated_at ON hosts;
DROP TRIGGER IF EXISTS trg_credentials_set_updated_at ON credentials;
DROP TRIGGER IF EXISTS trg_host_groups_set_updated_at ON host_groups;
DROP TRIGGER IF EXISTS trg_users_set_updated_at ON users;

DROP TABLE IF EXISTS workspace_layouts;
DROP TABLE IF EXISTS saved_commands;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS transfer_task_chunks;
DROP TABLE IF EXISTS transfer_tasks;
DROP TABLE IF EXISTS terminal_sessions;
DROP TABLE IF EXISTS host_fingerprints;
DROP TABLE IF EXISTS hosts;
DROP TABLE IF EXISTS credentials;
DROP TABLE IF EXISTS host_groups;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS users;

DROP FUNCTION IF EXISTS set_updated_at();

COMMIT;
