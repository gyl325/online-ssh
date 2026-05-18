CREATE TABLE IF NOT EXISTS audit_export_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filter_event_type TEXT NOT NULL DEFAULT '',
  filter_target_host_id UUID NULL REFERENCES hosts(id) ON DELETE SET NULL,
  filter_result TEXT NOT NULL DEFAULT '',
  filter_start_time TIMESTAMPTZ NULL,
  filter_end_time TIMESTAMPTZ NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  total_rows INT NOT NULL DEFAULT 0,
  exported_rows INT NOT NULL DEFAULT 0,
  result_csv TEXT NOT NULL DEFAULT '',
  error_code VARCHAR(100) NULL,
  error_message TEXT NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_audit_export_tasks_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'canceled')),
  CONSTRAINT chk_audit_export_tasks_result CHECK (filter_result IN ('', 'success', 'failure')),
  CONSTRAINT chk_audit_export_tasks_counts CHECK (total_rows >= 0 AND exported_rows >= 0)
);

CREATE INDEX IF NOT EXISTS idx_audit_export_tasks_user_created_at ON audit_export_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_export_tasks_status_created_at ON audit_export_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_export_tasks_expires_at ON audit_export_tasks(expires_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_audit_export_tasks_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_audit_export_tasks_set_updated_at
    BEFORE UPDATE ON audit_export_tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;
