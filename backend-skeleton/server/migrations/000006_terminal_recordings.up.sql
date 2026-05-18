CREATE TABLE IF NOT EXISTS terminal_recording_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  retention_days INT NOT NULL DEFAULT 7,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_terminal_recording_settings_retention CHECK (retention_days BETWEEN 1 AND 30)
);

CREATE TABLE IF NOT EXISTS terminal_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terminal_session_id UUID NULL REFERENCES terminal_sessions(id) ON DELETE SET NULL,
  host_id UUID NULL REFERENCES hosts(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  input_bytes BIGINT NOT NULL DEFAULT 0,
  output_bytes BIGINT NOT NULL DEFAULT 0,
  dropped_bytes BIGINT NOT NULL DEFAULT 0,
  key_version INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_terminal_recordings_status CHECK (status IN ('active', 'completed', 'failed')),
  CONSTRAINT chk_terminal_recordings_counts CHECK (input_bytes >= 0 AND output_bytes >= 0 AND dropped_bytes >= 0)
);

CREATE TABLE IF NOT EXISTS terminal_recording_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES terminal_recordings(id) ON DELETE CASCADE,
  sequence INT NOT NULL,
  direction VARCHAR(10) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_enc TEXT NOT NULL,
  byte_count BIGINT NOT NULL,
  key_version INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_terminal_recording_chunks_direction CHECK (direction IN ('input', 'output')),
  CONSTRAINT chk_terminal_recording_chunks_byte_count CHECK (byte_count >= 0),
  CONSTRAINT uq_terminal_recording_chunks_sequence UNIQUE (recording_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_terminal_recordings_user_started_at ON terminal_recordings(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_terminal_recordings_session_id ON terminal_recordings(terminal_session_id);
CREATE INDEX IF NOT EXISTS idx_terminal_recordings_expires_at ON terminal_recordings(expires_at);
CREATE INDEX IF NOT EXISTS idx_terminal_recording_chunks_recording_sequence ON terminal_recording_chunks(recording_id, sequence);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_terminal_recording_settings_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_terminal_recording_settings_set_updated_at
    BEFORE UPDATE ON terminal_recording_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_terminal_recordings_set_updated_at'
  ) THEN
    CREATE TRIGGER trg_terminal_recordings_set_updated_at
    BEFORE UPDATE ON terminal_recordings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;
