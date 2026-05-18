ALTER TABLE terminal_shares
  ADD COLUMN IF NOT EXISTS public_token TEXT;

UPDATE terminal_shares
SET public_token = 'legacy-' || id::text,
    revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
WHERE public_token IS NULL OR public_token = '';

ALTER TABLE terminal_shares
  ALTER COLUMN public_token SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE terminal_shares
    ADD CONSTRAINT terminal_shares_public_token_not_empty CHECK (public_token <> '');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_terminal_shares_public_token
  ON terminal_shares(public_token);

DO $$
BEGIN
  ALTER TABLE terminal_shares
    ADD CONSTRAINT terminal_shares_max_accesses_range
    CHECK (max_accesses IS NULL OR (max_accesses > 0 AND max_accesses <= 1000)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE terminal_shares
    ADD CONSTRAINT terminal_shares_sensitive_prompt_length
    CHECK (char_length(sensitive_prompt) <= 500) NOT VALID;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
