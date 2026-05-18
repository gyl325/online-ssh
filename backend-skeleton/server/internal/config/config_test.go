package config

import (
	"os"
	"testing"
)

func TestLoadFromEnvReadsHostConnectivityPollInterval(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/online_ssh?sslmode=disable")
	t.Setenv("CREDENTIAL_MASTER_KEY", "replace-with-32-bytes-or-longer-secret")
	t.Setenv("HOST_CONNECTIVITY_POLL_INTERVAL_SECONDS", "45")
	t.Setenv("CREDENTIAL_KEY_RING", "")
	t.Setenv("CREDENTIAL_ACTIVE_KEY_VERSION", "")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.HostConnectivityPollIntervalSeconds != 45 {
		t.Fatalf("expected host connectivity poll interval 45, got %d", cfg.HostConnectivityPollIntervalSeconds)
	}
}

func TestLoadFromEnvReadsAutoMigrateAndMigrationsDir(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/db?sslmode=disable")
	t.Setenv("CREDENTIAL_MASTER_KEY", "test-master-key")
	t.Setenv("AUTO_MIGRATE", "true")
	t.Setenv("MIGRATIONS_DIR", "/app/migrations")
	t.Setenv("CREDENTIAL_KEY_RING", "")
	t.Setenv("CREDENTIAL_ACTIVE_KEY_VERSION", "")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !cfg.AutoMigrate || cfg.MigrationsDir != "/app/migrations" {
		t.Fatalf("unexpected migration config: %#v", cfg)
	}
}

func TestLoadFromEnvReadsBootstrapSetupToken(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/db?sslmode=disable")
	t.Setenv("CREDENTIAL_MASTER_KEY", "test-master-key")
	t.Setenv("BOOTSTRAP_SETUP_TOKEN", " setup-token ")
	t.Setenv("CREDENTIAL_KEY_RING", "")
	t.Setenv("CREDENTIAL_ACTIVE_KEY_VERSION", "")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.BootstrapSetupToken != "setup-token" {
		t.Fatalf("expected bootstrap setup token to be trimmed, got %q", cfg.BootstrapSetupToken)
	}
}

func TestLoadFromEnvDefaultsTerminalSessionLimitsToSixteen(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/online_ssh?sslmode=disable")
	t.Setenv("CREDENTIAL_MASTER_KEY", "replace-with-32-bytes-or-longer-secret")
	t.Setenv("CREDENTIAL_KEY_RING", "")
	t.Setenv("CREDENTIAL_ACTIVE_KEY_VERSION", "")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.TerminalMaxSessionsPerUser != 16 || cfg.TerminalMaxSessionsTotal != 16 {
		t.Fatalf("expected terminal session limits to default to 16, got user=%d total=%d", cfg.TerminalMaxSessionsPerUser, cfg.TerminalMaxSessionsTotal)
	}
}

func TestLoadFromEnvAllowsTerminalSessionLimitOverride(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/online_ssh?sslmode=disable")
	t.Setenv("CREDENTIAL_MASTER_KEY", "replace-with-32-bytes-or-longer-secret")
	t.Setenv("CREDENTIAL_KEY_RING", "")
	t.Setenv("CREDENTIAL_ACTIVE_KEY_VERSION", "")
	t.Setenv("TERMINAL_MAX_SESSIONS_PER_USER", "8")
	t.Setenv("TERMINAL_MAX_SESSIONS_TOTAL", "24")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.TerminalMaxSessionsPerUser != 8 || cfg.TerminalMaxSessionsTotal != 24 {
		t.Fatalf("expected terminal session limits from env, got user=%d total=%d", cfg.TerminalMaxSessionsPerUser, cfg.TerminalMaxSessionsTotal)
	}
}

func TestLoadFromEnvReadsEmailVerificationConfig(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/online_ssh?sslmode=disable")
	t.Setenv("CREDENTIAL_MASTER_KEY", "replace-with-32-bytes-or-longer-secret")
	t.Setenv("CREDENTIAL_KEY_RING", "")
	t.Setenv("CREDENTIAL_ACTIVE_KEY_VERSION", "")
	t.Setenv("SMTP_HOST", "smtp.example.com")
	t.Setenv("SMTP_PORT", "465")
	t.Setenv("SMTP_USERNAME", "smtp-user")
	t.Setenv("SMTP_PASSWORD", "smtp-pass")
	t.Setenv("SMTP_FROM", "noreply@example.com")
	t.Setenv("SMTP_FROM_NAME", "Online SSH")
	t.Setenv("SMTP_USE_SSL", "true")
	t.Setenv("AUTH_ALLOWED_EMAILS", "admin@example.com, user@example.com")
	t.Setenv("AUTH_ALLOWED_EMAIL_DOMAINS", "example.org, example.net")
	t.Setenv("AUTH_EMAIL_CODE_LENGTH", "8")
	t.Setenv("AUTH_EMAIL_CODE_TTL_MINUTES", "10")
	t.Setenv("AUTH_EMAIL_CODE_MAX_ATTEMPTS", "4")
	t.Setenv("AUTH_EMAIL_CODE_RESEND_COOLDOWN_SECONDS", "30")
	t.Setenv("AUTH_EMAIL_CODE_EMAIL_WINDOW_MINUTES", "20")
	t.Setenv("AUTH_EMAIL_CODE_EMAIL_WINDOW_MAX_SENDS", "6")
	t.Setenv("AUTH_EMAIL_CODE_IP_WINDOW_MINUTES", "20")
	t.Setenv("AUTH_EMAIL_CODE_IP_WINDOW_MAX_SENDS", "12")
	t.Setenv("AUTH_EMAIL_CODE_HASH_SECRET", "email-code-secret")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.SMTPHost != "smtp.example.com" || cfg.SMTPPort != 465 || cfg.SMTPUseSSL != true {
		t.Fatalf("expected SMTP config to be loaded, got host=%q port=%d ssl=%v", cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUseSSL)
	}
	if cfg.SMTPUsername != "smtp-user" || cfg.SMTPPassword != "smtp-pass" {
		t.Fatalf("expected SMTP credentials to be loaded")
	}
	if cfg.SMTPFrom != "noreply@example.com" || cfg.SMTPFromName != "Online SSH" {
		t.Fatalf("expected SMTP sender config, got from=%q name=%q", cfg.SMTPFrom, cfg.SMTPFromName)
	}
	if cfg.AuthAllowedEmails != "admin@example.com, user@example.com" {
		t.Fatalf("expected allowed email list, got %q", cfg.AuthAllowedEmails)
	}
	if cfg.AuthAllowedEmailDomains != "example.org, example.net" {
		t.Fatalf("expected allowed domain list, got %q", cfg.AuthAllowedEmailDomains)
	}
	if cfg.AuthEmailCodeLength != 8 || cfg.AuthEmailCodeTTLMinutes != 10 || cfg.AuthEmailCodeMaxAttempts != 4 {
		t.Fatalf("expected email code length/ttl/attempts config, got length=%d ttl=%d attempts=%d", cfg.AuthEmailCodeLength, cfg.AuthEmailCodeTTLMinutes, cfg.AuthEmailCodeMaxAttempts)
	}
	if cfg.AuthEmailCodeResendCooldownSeconds != 30 ||
		cfg.AuthEmailCodeEmailWindowMinutes != 20 ||
		cfg.AuthEmailCodeEmailWindowMaxSends != 6 ||
		cfg.AuthEmailCodeIPWindowMinutes != 20 ||
		cfg.AuthEmailCodeIPWindowMaxSends != 12 {
		t.Fatalf("expected email code rate limit config, got %#v", cfg)
	}
	if cfg.AuthEmailCodeHashSecret != "email-code-secret" {
		t.Fatalf("expected email code hash secret to be loaded")
	}
}

func TestLoadFromEnvReadsLLMConfig(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/online_ssh?sslmode=disable")
	t.Setenv("CREDENTIAL_MASTER_KEY", "replace-with-32-bytes-or-longer-secret")
	t.Setenv("CREDENTIAL_KEY_RING", "")
	t.Setenv("CREDENTIAL_ACTIVE_KEY_VERSION", "")
	t.Setenv("LLM_ENABLED", "true")
	t.Setenv("LLM_PROTOCOL", "anthropic")
	t.Setenv("LLM_BASE_URL", "https://llm.example.com/anthropic")
	t.Setenv("LLM_MODEL", "mimo-v2.5-pro")
	t.Setenv("LLM_AUTH_HEADER", "bearer")
	t.Setenv("LLM_API_KEY", "example-api-key")
	t.Setenv("LLM_TIMEOUT_SECONDS", "45")
	t.Setenv("LLM_MAX_TOKENS", "2048")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !cfg.LLMEnabled || cfg.LLMProtocol != "anthropic" || cfg.LLMAuthHeader != "bearer" {
		t.Fatalf("expected llm protocol config, got %#v", cfg)
	}
	if cfg.LLMBaseURL != "https://llm.example.com/anthropic" || cfg.LLMModel != "mimo-v2.5-pro" || cfg.LLMAPIKey != "example-api-key" {
		t.Fatalf("expected llm endpoint config, got %#v", cfg)
	}
	if cfg.LLMTimeoutSeconds != 45 || cfg.LLMMaxTokens != 2048 {
		t.Fatalf("expected llm limits config, got timeout=%d max=%d", cfg.LLMTimeoutSeconds, cfg.LLMMaxTokens)
	}
}

func TestLoadFromEnvUsesMIMOAPIKeyAsLLMAlias(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/online_ssh?sslmode=disable")
	t.Setenv("CREDENTIAL_MASTER_KEY", "replace-with-32-bytes-or-longer-secret")
	t.Setenv("CREDENTIAL_KEY_RING", "")
	t.Setenv("CREDENTIAL_ACTIVE_KEY_VERSION", "")
	t.Setenv("LLM_API_KEY", "")
	t.Setenv("MIMO_API_KEY", "mimo-secret")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.LLMAPIKey != "mimo-secret" {
		t.Fatalf("expected MIMO_API_KEY to be used as LLM api key alias, got %q", cfg.LLMAPIKey)
	}
}

func TestLoadFromEnvRejectsInvalidEmailVerificationConfig(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/online_ssh?sslmode=disable")
	t.Setenv("CREDENTIAL_MASTER_KEY", "replace-with-32-bytes-or-longer-secret")
	t.Setenv("CREDENTIAL_KEY_RING", "")
	t.Setenv("CREDENTIAL_ACTIVE_KEY_VERSION", "")
	t.Setenv("AUTH_EMAIL_CODE_MAX_ATTEMPTS", "0")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid email code max attempts to fail")
	}
}

func TestLoadFromEnvRejectsInvalidHostConnectivityPollInterval(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@127.0.0.1:5432/online_ssh?sslmode=disable")
	t.Setenv("CREDENTIAL_MASTER_KEY", "replace-with-32-bytes-or-longer-secret")
	t.Setenv("HOST_CONNECTIVITY_POLL_INTERVAL_SECONDS", "0")
	t.Setenv("CREDENTIAL_KEY_RING", "")
	t.Setenv("CREDENTIAL_ACTIVE_KEY_VERSION", "")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected invalid host connectivity poll interval to fail")
	}
}

func TestMain(m *testing.M) {
	os.Exit(m.Run())
}
