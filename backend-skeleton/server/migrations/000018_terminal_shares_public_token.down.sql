DROP INDEX IF EXISTS uq_terminal_shares_public_token;

ALTER TABLE terminal_shares
  DROP CONSTRAINT IF EXISTS terminal_shares_sensitive_prompt_length;

ALTER TABLE terminal_shares
  DROP CONSTRAINT IF EXISTS terminal_shares_max_accesses_range;

ALTER TABLE terminal_shares
  DROP CONSTRAINT IF EXISTS terminal_shares_public_token_not_empty;

ALTER TABLE terminal_shares
  DROP COLUMN IF EXISTS public_token;
