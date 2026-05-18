package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv                              string
	HTTPAddr                            string
	StaticDir                           string
	AutoMigrate                         bool
	MigrationsDir                       string
	BootstrapSetupToken                 string
	DatabaseURL                         string
	RedisAddr                           string
	RedisPassword                       string
	CredentialMasterKey                 string
	CredentialKeyRing                   string
	CredentialActiveKeyVersion          int
	SessionCookieName                   string
	RefreshCookieName                   string
	SessionCookieSecure                 bool
	SessionTTLHours                     int
	SessionTTLMinutes                   int
	SessionIdleTimeoutMinutes           int
	RefreshTokenTTLHours                int
	AllowUserRegistration               bool
	TerminalMaxSessionsPerUser          int
	TerminalMaxSessionsTotal            int
	TerminalKeepAliveHours              int
	FileSFTPIdleTTLMinutes              int
	HostConnectivityPollIntervalSeconds int
	SMTPHost                            string
	SMTPPort                            int
	SMTPUsername                        string
	SMTPPassword                        string
	SMTPFrom                            string
	SMTPFromName                        string
	SMTPUseSSL                          bool
	AuthAllowedEmails                   string
	AuthAllowedEmailDomains             string
	AuthEmailCodeLength                 int
	AuthEmailCodeTTLMinutes             int
	AuthEmailCodeMaxAttempts            int
	AuthEmailCodeResendCooldownSeconds  int
	AuthEmailCodeEmailWindowMinutes     int
	AuthEmailCodeEmailWindowMaxSends    int
	AuthEmailCodeIPWindowMinutes        int
	AuthEmailCodeIPWindowMaxSends       int
	AuthEmailCodeHashSecret             string
	LLMEnabled                          bool
	LLMProtocol                         string
	LLMBaseURL                          string
	LLMModel                            string
	LLMAuthHeader                       string
	LLMAPIKey                           string
	LLMTimeoutSeconds                   int
	LLMMaxTokens                        int
}

func LoadFromEnv() (Config, error) {
	if err := loadDotEnv(".env.local"); err != nil {
		return Config{}, err
	}

	credentialActiveKeyVersion, err := getenvOptionalInt("CREDENTIAL_ACTIVE_KEY_VERSION")
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		AppEnv:                              getenv("APP_ENV", "development"),
		HTTPAddr:                            getenv("HTTP_ADDR", ":8080"),
		StaticDir:                           os.Getenv("STATIC_DIR"),
		AutoMigrate:                         getenvBool("AUTO_MIGRATE", false),
		MigrationsDir:                       os.Getenv("MIGRATIONS_DIR"),
		BootstrapSetupToken:                 strings.TrimSpace(os.Getenv("BOOTSTRAP_SETUP_TOKEN")),
		DatabaseURL:                         os.Getenv("DATABASE_URL"),
		RedisAddr:                           os.Getenv("REDIS_ADDR"),
		RedisPassword:                       os.Getenv("REDIS_PASSWORD"),
		CredentialMasterKey:                 os.Getenv("CREDENTIAL_MASTER_KEY"),
		CredentialKeyRing:                   os.Getenv("CREDENTIAL_KEY_RING"),
		CredentialActiveKeyVersion:          credentialActiveKeyVersion,
		SessionCookieName:                   getenv("SESSION_COOKIE_NAME", "online_ssh_session"),
		RefreshCookieName:                   getenv("REFRESH_COOKIE_NAME", "online_ssh_refresh"),
		SessionCookieSecure:                 getenvBool("SESSION_COOKIE_SECURE", false),
		SessionTTLHours:                     getenvInt("SESSION_TTL_HOURS", 168),
		SessionTTLMinutes:                   getenvInt("SESSION_TTL_MINUTES", 30),
		SessionIdleTimeoutMinutes:           getenvInt("SESSION_IDLE_TIMEOUT_MINUTES", 120),
		RefreshTokenTTLHours:                getenvInt("REFRESH_TOKEN_TTL_HOURS", 168),
		AllowUserRegistration:               getenvBool("ALLOW_USER_REGISTRATION", false),
		TerminalMaxSessionsPerUser:          getenvInt("TERMINAL_MAX_SESSIONS_PER_USER", 16),
		TerminalMaxSessionsTotal:            getenvInt("TERMINAL_MAX_SESSIONS_TOTAL", 16),
		TerminalKeepAliveHours:              getenvInt("TERMINAL_KEEP_ALIVE_HOURS", 24),
		FileSFTPIdleTTLMinutes:              getenvInt("FILE_SFTP_IDLE_TTL_MINUTES", 5),
		HostConnectivityPollIntervalSeconds: getenvInt("HOST_CONNECTIVITY_POLL_INTERVAL_SECONDS", 30),
		SMTPHost:                            os.Getenv("SMTP_HOST"),
		SMTPPort:                            getenvInt("SMTP_PORT", 587),
		SMTPUsername:                        os.Getenv("SMTP_USERNAME"),
		SMTPPassword:                        os.Getenv("SMTP_PASSWORD"),
		SMTPFrom:                            os.Getenv("SMTP_FROM"),
		SMTPFromName:                        os.Getenv("SMTP_FROM_NAME"),
		SMTPUseSSL:                          getenvBool("SMTP_USE_SSL", false),
		AuthAllowedEmails:                   os.Getenv("AUTH_ALLOWED_EMAILS"),
		AuthAllowedEmailDomains:             os.Getenv("AUTH_ALLOWED_EMAIL_DOMAINS"),
		AuthEmailCodeLength:                 getenvInt("AUTH_EMAIL_CODE_LENGTH", 6),
		AuthEmailCodeTTLMinutes:             getenvInt("AUTH_EMAIL_CODE_TTL_MINUTES", 5),
		AuthEmailCodeMaxAttempts:            getenvInt("AUTH_EMAIL_CODE_MAX_ATTEMPTS", 5),
		AuthEmailCodeResendCooldownSeconds:  getenvInt("AUTH_EMAIL_CODE_RESEND_COOLDOWN_SECONDS", 60),
		AuthEmailCodeEmailWindowMinutes:     getenvInt("AUTH_EMAIL_CODE_EMAIL_WINDOW_MINUTES", 15),
		AuthEmailCodeEmailWindowMaxSends:    getenvInt("AUTH_EMAIL_CODE_EMAIL_WINDOW_MAX_SENDS", 5),
		AuthEmailCodeIPWindowMinutes:        getenvInt("AUTH_EMAIL_CODE_IP_WINDOW_MINUTES", 15),
		AuthEmailCodeIPWindowMaxSends:       getenvInt("AUTH_EMAIL_CODE_IP_WINDOW_MAX_SENDS", 10),
		AuthEmailCodeHashSecret:             os.Getenv("AUTH_EMAIL_CODE_HASH_SECRET"),
		LLMEnabled:                          getenvBool("LLM_ENABLED", false),
		LLMProtocol:                         getenv("LLM_PROTOCOL", "openai"),
		LLMBaseURL:                          os.Getenv("LLM_BASE_URL"),
		LLMModel:                            getenv("LLM_MODEL", "mimo-v2.5-pro"),
		LLMAuthHeader:                       getenv("LLM_AUTH_HEADER", "api_key"),
		LLMAPIKey:                           getenvFirst("LLM_API_KEY", "MIMO_API_KEY"),
		LLMTimeoutSeconds:                   getenvInt("LLM_TIMEOUT_SECONDS", 30),
		LLMMaxTokens:                        getenvInt("LLM_MAX_TOKENS", 1024),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if cfg.CredentialMasterKey == "" && cfg.CredentialKeyRing == "" {
		return Config{}, errors.New("CREDENTIAL_MASTER_KEY or CREDENTIAL_KEY_RING is required")
	}
	if cfg.CredentialKeyRing != "" && cfg.CredentialActiveKeyVersion <= 0 {
		return Config{}, errors.New("CREDENTIAL_ACTIVE_KEY_VERSION is required when CREDENTIAL_KEY_RING is set")
	}
	if cfg.SessionTTLHours <= 0 {
		return Config{}, errors.New("SESSION_TTL_HOURS must be greater than 0")
	}
	if cfg.SessionTTLMinutes <= 0 {
		return Config{}, errors.New("SESSION_TTL_MINUTES must be greater than 0")
	}
	if cfg.SessionIdleTimeoutMinutes <= 0 {
		return Config{}, errors.New("SESSION_IDLE_TIMEOUT_MINUTES must be greater than 0")
	}
	if cfg.RefreshTokenTTLHours <= 0 {
		return Config{}, errors.New("REFRESH_TOKEN_TTL_HOURS must be greater than 0")
	}
	if cfg.TerminalMaxSessionsPerUser <= 0 {
		return Config{}, errors.New("TERMINAL_MAX_SESSIONS_PER_USER must be greater than 0")
	}
	if cfg.TerminalMaxSessionsTotal <= 0 {
		return Config{}, errors.New("TERMINAL_MAX_SESSIONS_TOTAL must be greater than 0")
	}
	if cfg.TerminalKeepAliveHours <= 0 {
		return Config{}, errors.New("TERMINAL_KEEP_ALIVE_HOURS must be greater than 0")
	}
	if cfg.FileSFTPIdleTTLMinutes <= 0 {
		return Config{}, errors.New("FILE_SFTP_IDLE_TTL_MINUTES must be greater than 0")
	}
	if cfg.HostConnectivityPollIntervalSeconds <= 0 {
		return Config{}, errors.New("HOST_CONNECTIVITY_POLL_INTERVAL_SECONDS must be greater than 0")
	}
	if cfg.SMTPHost != "" && cfg.SMTPFrom == "" {
		return Config{}, errors.New("SMTP_FROM is required when SMTP_HOST is set")
	}
	if cfg.SMTPPort <= 0 {
		return Config{}, errors.New("SMTP_PORT must be greater than 0")
	}
	if cfg.AuthEmailCodeLength <= 0 {
		return Config{}, errors.New("AUTH_EMAIL_CODE_LENGTH must be greater than 0")
	}
	if cfg.AuthEmailCodeTTLMinutes <= 0 {
		return Config{}, errors.New("AUTH_EMAIL_CODE_TTL_MINUTES must be greater than 0")
	}
	if cfg.AuthEmailCodeMaxAttempts <= 0 {
		return Config{}, errors.New("AUTH_EMAIL_CODE_MAX_ATTEMPTS must be greater than 0")
	}
	if cfg.AuthEmailCodeResendCooldownSeconds <= 0 {
		return Config{}, errors.New("AUTH_EMAIL_CODE_RESEND_COOLDOWN_SECONDS must be greater than 0")
	}
	if cfg.AuthEmailCodeEmailWindowMinutes <= 0 {
		return Config{}, errors.New("AUTH_EMAIL_CODE_EMAIL_WINDOW_MINUTES must be greater than 0")
	}
	if cfg.AuthEmailCodeEmailWindowMaxSends <= 0 {
		return Config{}, errors.New("AUTH_EMAIL_CODE_EMAIL_WINDOW_MAX_SENDS must be greater than 0")
	}
	if cfg.AuthEmailCodeIPWindowMinutes <= 0 {
		return Config{}, errors.New("AUTH_EMAIL_CODE_IP_WINDOW_MINUTES must be greater than 0")
	}
	if cfg.AuthEmailCodeIPWindowMaxSends <= 0 {
		return Config{}, errors.New("AUTH_EMAIL_CODE_IP_WINDOW_MAX_SENDS must be greater than 0")
	}
	if cfg.LLMTimeoutSeconds <= 0 {
		return Config{}, errors.New("LLM_TIMEOUT_SECONDS must be greater than 0")
	}
	if cfg.LLMMaxTokens <= 0 {
		return Config{}, errors.New("LLM_MAX_TOKENS must be greater than 0")
	}

	return cfg, nil
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getenvFirst(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func getenvInt(key string, fallback int) int {
	if value := os.Getenv(key); value != "" {
		parsed, err := strconv.Atoi(value)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func getenvOptionalInt(key string) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return 0, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer", key)
	}
	return parsed, nil
}

func getenvBool(key string, fallback bool) bool {
	if value := os.Getenv(key); value != "" {
		parsed, err := strconv.ParseBool(value)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func loadDotEnv(filename string) error {
	wd, err := os.Getwd()
	if err != nil {
		return err
	}

	for dir := wd; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, filename)
		if _, statErr := os.Stat(candidate); statErr == nil {
			content, readErr := os.ReadFile(candidate)
			if readErr != nil {
				return readErr
			}

			envMap, parseErr := godotenv.Unmarshal(normalizeDotEnvContent(string(content)))
			if parseErr != nil {
				return parseErr
			}
			for key, value := range envMap {
				if _, exists := os.LookupEnv(key); !exists {
					if setErr := os.Setenv(key, value); setErr != nil {
						return setErr
					}
				}
			}
			return nil
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return statErr
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return nil
		}
	}
}

func normalizeDotEnvContent(content string) string {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "```") {
		return content
	}

	lines := strings.Split(trimmed, "\n")
	if len(lines) == 0 {
		return content
	}
	if strings.HasPrefix(strings.TrimSpace(lines[0]), "```") {
		lines = lines[1:]
	}
	if len(lines) > 0 && strings.HasPrefix(strings.TrimSpace(lines[len(lines)-1]), "```") {
		lines = lines[:len(lines)-1]
	}
	return strings.Join(lines, "\n")
}
