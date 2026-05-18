CREATE TABLE email_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  client_ip INET NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_email_verification_codes_purpose CHECK (purpose IN ('register', 'login')),
  CONSTRAINT chk_email_verification_codes_attempts CHECK (attempts >= 0),
  CONSTRAINT chk_email_verification_codes_max_attempts CHECK (max_attempts > 0)
);

CREATE INDEX idx_email_verification_codes_email_purpose_created_at
ON email_verification_codes(email, purpose, created_at DESC);

CREATE INDEX idx_email_verification_codes_client_ip_created_at
ON email_verification_codes(client_ip, created_at DESC)
WHERE client_ip IS NOT NULL;
