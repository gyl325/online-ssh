CREATE TABLE terminal_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terminal_session_id UUID NOT NULL REFERENCES terminal_sessions(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  max_accesses INTEGER CHECK (max_accesses IS NULL OR max_accesses > 0),
  access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
  sensitive_prompt TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_terminal_shares_user_session_active
  ON terminal_shares(user_id, terminal_session_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE terminal_share_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES terminal_shares(id) ON DELETE CASCADE,
  terminal_session_id UUID NOT NULL REFERENCES terminal_sessions(id) ON DELETE CASCADE,
  client_ip INET,
  user_agent TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  failure_reason TEXT,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_terminal_share_access_logs_share_time
  ON terminal_share_access_logs(share_id, accessed_at DESC);

CREATE TABLE terminal_share_viewer_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES terminal_shares(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_terminal_share_viewer_tokens_share_time
  ON terminal_share_viewer_tokens(share_id, expires_at DESC);
