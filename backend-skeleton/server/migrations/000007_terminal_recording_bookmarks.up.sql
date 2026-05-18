ALTER TABLE terminal_recordings
  ADD COLUMN IF NOT EXISTS is_bookmarked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_terminal_recordings_user_bookmarked_started_at
  ON terminal_recordings(user_id, is_bookmarked, started_at DESC);
