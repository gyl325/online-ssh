DROP INDEX IF EXISTS idx_terminal_recordings_user_bookmarked_started_at;

ALTER TABLE terminal_recordings
  DROP COLUMN IF EXISTS is_bookmarked;
