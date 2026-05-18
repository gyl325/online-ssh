ALTER TABLE email_verification_codes
DROP CONSTRAINT chk_email_verification_codes_purpose;

ALTER TABLE email_verification_codes
ADD CONSTRAINT chk_email_verification_codes_purpose
CHECK (purpose IN ('register', 'login'));
