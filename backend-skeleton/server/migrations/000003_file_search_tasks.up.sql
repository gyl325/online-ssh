CREATE TABLE IF NOT EXISTS file_search_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  base_path TEXT NOT NULL,
  keyword TEXT NOT NULL,
  match_mode VARCHAR(20) NOT NULL DEFAULT 'name',
  recursive BOOLEAN NOT NULL DEFAULT TRUE,
  include_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  max_depth INT NOT NULL DEFAULT 6,
  max_results INT NOT NULL DEFAULT 500,
  max_scanned_entries INT NOT NULL DEFAULT 50000,
  timeout_seconds INT NOT NULL DEFAULT 30,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  scanned_dirs INT NOT NULL DEFAULT 0,
  scanned_entries INT NOT NULL DEFAULT 0,
  matched_entries INT NOT NULL DEFAULT 0,
  skipped_errors_count INT NOT NULL DEFAULT 0,
  limit_reached BOOLEAN NOT NULL DEFAULT FALSE,
  error_code VARCHAR(100) NULL,
  error_message TEXT NULL,
  warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_file_search_tasks_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'canceled')),
  CONSTRAINT chk_file_search_tasks_match_mode CHECK (match_mode IN ('name', 'path')),
  CONSTRAINT chk_file_search_tasks_limits CHECK (
    max_depth >= 0
    AND max_results > 0
    AND max_scanned_entries > 0
    AND timeout_seconds > 0
    AND scanned_dirs >= 0
    AND scanned_entries >= 0
    AND matched_entries >= 0
    AND skipped_errors_count >= 0
  )
);

CREATE TABLE IF NOT EXISTS file_search_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES file_search_tasks(id) ON DELETE CASCADE,
  rank INT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  entry_type VARCHAR(20) NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  permissions VARCHAR(20) NOT NULL,
  owner TEXT NULL,
  group_name TEXT NULL,
  modified_at TIMESTAMPTZ NOT NULL,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_file_search_results_task_path UNIQUE (task_id, path),
  CONSTRAINT chk_file_search_results_rank CHECK (rank > 0),
  CONSTRAINT chk_file_search_results_size CHECK (size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_file_search_tasks_user_created_at ON file_search_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_search_tasks_status_created_at ON file_search_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_file_search_tasks_expires_at ON file_search_tasks(expires_at);
CREATE INDEX IF NOT EXISTS idx_file_search_results_task_rank ON file_search_results(task_id, rank);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_file_search_tasks_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_file_search_tasks_set_updated_at
    BEFORE UPDATE ON file_search_tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;
