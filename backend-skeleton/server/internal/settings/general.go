package settings

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ErrInvalidSettings = errors.New("invalid settings")

const (
	KeyAllowUserRegistration               = "allow_user_registration"
	KeySessionIdleTimeoutMinutes           = "session_idle_timeout_minutes"
	KeyRefreshTokenTTLHours                = "refresh_token_ttl_hours"
	KeyTerminalMaxSessionsPerUser          = "terminal_max_sessions_per_user"
	KeyTerminalMaxSessionsTotal            = "terminal_max_sessions_total"
	KeyTerminalKeepAliveHours              = "terminal_keep_alive_hours"
	KeyFileSFTPIdleTTLMinutes              = "file_sftp_idle_ttl_minutes"
	KeyHostConnectivityPollIntervalSeconds = "host_connectivity_poll_interval_seconds"
	KeySMTPHost                            = "smtp_host"
	KeySMTPPort                            = "smtp_port"
	KeySMTPFrom                            = "smtp_from"
	KeySMTPFromName                        = "smtp_from_name"
	KeySMTPUsername                        = "smtp_username"
	KeySMTPPassword                        = "smtp_password"
	KeySMTPUseSSL                          = "smtp_use_ssl"
	KeyAuthAllowedEmails                   = "auth_allowed_emails"
	KeyAuthAllowedEmailDomains             = "auth_allowed_email_domains"
	KeyAuthEmailCodeLength                 = "auth_email_code_length"
	KeyAuthEmailCodeTTLMinutes             = "auth_email_code_ttl_minutes"
	KeyAuthEmailCodeMaxAttempts            = "auth_email_code_max_attempts"
	KeyAuthEmailCodeResendCooldownSeconds  = "auth_email_code_resend_cooldown_seconds"
	KeyAuthEmailCodeEmailWindowMinutes     = "auth_email_code_email_window_minutes"
	KeyAuthEmailCodeEmailWindowMaxSends    = "auth_email_code_email_window_max_sends"
	KeyAuthEmailCodeIPWindowMinutes        = "auth_email_code_ip_window_minutes"
	KeyAuthEmailCodeIPWindowMaxSends       = "auth_email_code_ip_window_max_sends"
	KeyLLMEnabled                          = "llm_enabled"
	KeyLLMProtocol                         = "llm_protocol"
	KeyLLMBaseURL                          = "llm_base_url"
	KeyLLMModel                            = "llm_model"
	KeyLLMAuthHeader                       = "llm_auth_header"
	KeyLLMAPIKey                           = "llm_api_key"
	KeyLLMTimeoutSeconds                   = "llm_timeout_seconds"
	KeyLLMMaxTokens                        = "llm_max_tokens"
)

const (
	LLMProtocolOpenAI    = "openai"
	LLMProtocolAnthropic = "anthropic"
	LLMAuthHeaderAPIKey  = "api_key"
	LLMAuthHeaderBearer  = "bearer"
)

type General struct {
	AllowUserRegistration               bool   `json:"allow_user_registration"`
	SessionIdleTimeoutMinutes           int    `json:"session_idle_timeout_minutes"`
	RefreshTokenTTLHours                int    `json:"refresh_token_ttl_hours"`
	TerminalMaxSessionsPerUser          int    `json:"terminal_max_sessions_per_user"`
	TerminalMaxSessionsTotal            int    `json:"terminal_max_sessions_total"`
	TerminalKeepAliveHours              int    `json:"terminal_keep_alive_hours"`
	FileSFTPIdleTTLMinutes              int    `json:"file_sftp_idle_ttl_minutes"`
	HostConnectivityPollIntervalSeconds int    `json:"host_connectivity_poll_interval_seconds"`
	SMTPHost                            string `json:"smtp_host"`
	SMTPPort                            int    `json:"smtp_port"`
	SMTPFrom                            string `json:"smtp_from"`
	SMTPFromName                        string `json:"smtp_from_name"`
	SMTPUsername                        string `json:"smtp_username"`
	SMTPPassword                        string `json:"smtp_password,omitempty"`
	SMTPUseSSL                          bool   `json:"smtp_use_ssl"`
	AuthAllowedEmails                   string `json:"auth_allowed_emails"`
	AuthAllowedEmailDomains             string `json:"auth_allowed_email_domains"`
	AuthEmailCodeLength                 int    `json:"auth_email_code_length"`
	AuthEmailCodeTTLMinutes             int    `json:"auth_email_code_ttl_minutes"`
	AuthEmailCodeMaxAttempts            int    `json:"auth_email_code_max_attempts"`
	AuthEmailCodeResendCooldownSeconds  int    `json:"auth_email_code_resend_cooldown_seconds"`
	AuthEmailCodeEmailWindowMinutes     int    `json:"auth_email_code_email_window_minutes"`
	AuthEmailCodeEmailWindowMaxSends    int    `json:"auth_email_code_email_window_max_sends"`
	AuthEmailCodeIPWindowMinutes        int    `json:"auth_email_code_ip_window_minutes"`
	AuthEmailCodeIPWindowMaxSends       int    `json:"auth_email_code_ip_window_max_sends"`
	LLMEnabled                          bool   `json:"llm_enabled"`
	LLMProtocol                         string `json:"llm_protocol"`
	LLMBaseURL                          string `json:"llm_base_url"`
	LLMModel                            string `json:"llm_model"`
	LLMAuthHeader                       string `json:"llm_auth_header"`
	LLMAPIKey                           string `json:"llm_api_key,omitempty"`
	LLMTimeoutSeconds                   int    `json:"llm_timeout_seconds"`
	LLMMaxTokens                        int    `json:"llm_max_tokens"`
}

type Store struct {
	mu      sync.RWMutex
	current General
}

func NewStore(defaults General) *Store {
	normalized, err := Normalize(defaults)
	if err != nil {
		normalized = General{
			SessionIdleTimeoutMinutes:           120,
			RefreshTokenTTLHours:                168,
			TerminalMaxSessionsPerUser:          16,
			TerminalMaxSessionsTotal:            16,
			TerminalKeepAliveHours:              24,
			FileSFTPIdleTTLMinutes:              5,
			HostConnectivityPollIntervalSeconds: 30,
			SMTPPort:                            587,
			AuthEmailCodeLength:                 6,
			AuthEmailCodeTTLMinutes:             5,
			AuthEmailCodeMaxAttempts:            5,
			AuthEmailCodeResendCooldownSeconds:  60,
			AuthEmailCodeEmailWindowMinutes:     15,
			AuthEmailCodeEmailWindowMaxSends:    5,
			AuthEmailCodeIPWindowMinutes:        15,
			AuthEmailCodeIPWindowMaxSends:       10,
			LLMProtocol:                         LLMProtocolOpenAI,
			LLMModel:                            "mimo-v2.5-pro",
			LLMAuthHeader:                       LLMAuthHeaderAPIKey,
			LLMTimeoutSeconds:                   30,
			LLMMaxTokens:                        1024,
		}
	}
	return &Store{current: normalized}
}

func (s *Store) Snapshot() General {
	if s == nil {
		return General{}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.current
}

func (s *Store) Update(next General) error {
	if s == nil {
		return nil
	}
	normalized, err := Normalize(next)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.current = normalized
	s.mu.Unlock()
	return nil
}

func (g General) RefreshTTL() time.Duration {
	return time.Duration(g.RefreshTokenTTLHours) * time.Hour
}

func (g General) IdleTimeout() time.Duration {
	return time.Duration(g.SessionIdleTimeoutMinutes) * time.Minute
}

func (g General) EmailCodeTTL() time.Duration {
	return time.Duration(g.AuthEmailCodeTTLMinutes) * time.Minute
}

func (g General) EmailCodeResendCooldown() time.Duration {
	return time.Duration(g.AuthEmailCodeResendCooldownSeconds) * time.Second
}

func (g General) EmailCodeEmailWindow() time.Duration {
	return time.Duration(g.AuthEmailCodeEmailWindowMinutes) * time.Minute
}

func (g General) EmailCodeIPWindow() time.Duration {
	return time.Duration(g.AuthEmailCodeIPWindowMinutes) * time.Minute
}

func (g General) TerminalKeepAliveTTL() time.Duration {
	return time.Duration(g.TerminalKeepAliveHours) * time.Hour
}

func (g General) SFTPIdleTTL() time.Duration {
	return time.Duration(g.FileSFTPIdleTTLMinutes) * time.Minute
}

func (g General) HostConnectivityPollInterval() time.Duration {
	return time.Duration(g.HostConnectivityPollIntervalSeconds) * time.Second
}

func (g General) AllowedEmailList() []string {
	return splitNormalizedList(g.AuthAllowedEmails)
}

func (g General) AllowedDomainList() []string {
	return splitNormalizedList(g.AuthAllowedEmailDomains)
}

func Normalize(input General) (General, error) {
	result := input
	result.SMTPHost = strings.TrimSpace(result.SMTPHost)
	result.SMTPFrom = strings.TrimSpace(result.SMTPFrom)
	result.SMTPFromName = strings.TrimSpace(result.SMTPFromName)
	result.SMTPUsername = strings.TrimSpace(result.SMTPUsername)
	result.SMTPPassword = strings.TrimSpace(result.SMTPPassword)
	result.AuthAllowedEmails = normalizeList(result.AuthAllowedEmails, false)
	result.AuthAllowedEmailDomains = normalizeList(result.AuthAllowedEmailDomains, true)
	result.LLMProtocol = strings.ToLower(strings.TrimSpace(result.LLMProtocol))
	result.LLMBaseURL = strings.TrimSpace(result.LLMBaseURL)
	result.LLMModel = strings.TrimSpace(result.LLMModel)
	result.LLMAuthHeader = strings.ToLower(strings.TrimSpace(result.LLMAuthHeader))
	result.LLMAPIKey = strings.TrimSpace(result.LLMAPIKey)
	if result.LLMProtocol == "" {
		result.LLMProtocol = LLMProtocolOpenAI
	}
	if result.LLMModel == "" {
		result.LLMModel = "mimo-v2.5-pro"
	}
	if result.LLMAuthHeader == "" {
		result.LLMAuthHeader = LLMAuthHeaderAPIKey
	}
	if result.LLMTimeoutSeconds == 0 {
		result.LLMTimeoutSeconds = 30
	}
	if result.LLMMaxTokens == 0 {
		result.LLMMaxTokens = 1024
	}

	if result.SessionIdleTimeoutMinutes <= 0 ||
		result.RefreshTokenTTLHours <= 0 ||
		result.TerminalMaxSessionsPerUser <= 0 ||
		result.TerminalMaxSessionsTotal <= 0 ||
		result.TerminalKeepAliveHours <= 0 ||
		result.FileSFTPIdleTTLMinutes <= 0 ||
		result.HostConnectivityPollIntervalSeconds <= 0 ||
		result.SMTPPort <= 0 ||
		result.AuthEmailCodeLength <= 0 ||
		result.AuthEmailCodeTTLMinutes <= 0 ||
		result.AuthEmailCodeMaxAttempts <= 0 ||
		result.AuthEmailCodeResendCooldownSeconds <= 0 ||
		result.AuthEmailCodeEmailWindowMinutes <= 0 ||
		result.AuthEmailCodeEmailWindowMaxSends <= 0 ||
		result.AuthEmailCodeIPWindowMinutes <= 0 ||
		result.AuthEmailCodeIPWindowMaxSends <= 0 ||
		result.LLMTimeoutSeconds <= 0 ||
		result.LLMMaxTokens <= 0 {
		return General{}, ErrInvalidSettings
	}
	if result.SMTPHost != "" && result.SMTPFrom == "" {
		return General{}, ErrInvalidSettings
	}
	if result.LLMProtocol != LLMProtocolOpenAI && result.LLMProtocol != LLMProtocolAnthropic {
		return General{}, ErrInvalidSettings
	}
	if result.LLMAuthHeader != LLMAuthHeaderAPIKey && result.LLMAuthHeader != LLMAuthHeaderBearer {
		return General{}, ErrInvalidSettings
	}
	if result.LLMTimeoutSeconds < 5 || result.LLMTimeoutSeconds > 120 {
		return General{}, ErrInvalidSettings
	}
	if result.LLMMaxTokens < 256 || result.LLMMaxTokens > 4096 {
		return General{}, ErrInvalidSettings
	}
	if result.LLMEnabled {
		if result.LLMBaseURL == "" || result.LLMModel == "" || result.LLMAPIKey == "" {
			return General{}, ErrInvalidSettings
		}
		if !isHTTPBaseURL(result.LLMBaseURL) {
			return General{}, ErrInvalidSettings
		}
	}
	return result, nil
}

func Merge(defaults General, values map[string]string) (General, error) {
	result, err := Normalize(defaults)
	if err != nil {
		return General{}, err
	}
	for key, value := range values {
		if err := applyValue(&result, key, value); err != nil {
			return General{}, err
		}
	}
	return Normalize(result)
}

func Encode(g General) (map[string]string, error) {
	normalized, err := Normalize(g)
	if err != nil {
		return nil, err
	}
	return map[string]string{
		KeyAllowUserRegistration:               strconv.FormatBool(normalized.AllowUserRegistration),
		KeySessionIdleTimeoutMinutes:           strconv.Itoa(normalized.SessionIdleTimeoutMinutes),
		KeyRefreshTokenTTLHours:                strconv.Itoa(normalized.RefreshTokenTTLHours),
		KeyTerminalMaxSessionsPerUser:          strconv.Itoa(normalized.TerminalMaxSessionsPerUser),
		KeyTerminalMaxSessionsTotal:            strconv.Itoa(normalized.TerminalMaxSessionsTotal),
		KeyTerminalKeepAliveHours:              strconv.Itoa(normalized.TerminalKeepAliveHours),
		KeyFileSFTPIdleTTLMinutes:              strconv.Itoa(normalized.FileSFTPIdleTTLMinutes),
		KeyHostConnectivityPollIntervalSeconds: strconv.Itoa(normalized.HostConnectivityPollIntervalSeconds),
		KeySMTPHost:                            normalized.SMTPHost,
		KeySMTPPort:                            strconv.Itoa(normalized.SMTPPort),
		KeySMTPFrom:                            normalized.SMTPFrom,
		KeySMTPFromName:                        normalized.SMTPFromName,
		KeySMTPUsername:                        normalized.SMTPUsername,
		KeySMTPPassword:                        normalized.SMTPPassword,
		KeySMTPUseSSL:                          strconv.FormatBool(normalized.SMTPUseSSL),
		KeyAuthAllowedEmails:                   normalized.AuthAllowedEmails,
		KeyAuthAllowedEmailDomains:             normalized.AuthAllowedEmailDomains,
		KeyAuthEmailCodeLength:                 strconv.Itoa(normalized.AuthEmailCodeLength),
		KeyAuthEmailCodeTTLMinutes:             strconv.Itoa(normalized.AuthEmailCodeTTLMinutes),
		KeyAuthEmailCodeMaxAttempts:            strconv.Itoa(normalized.AuthEmailCodeMaxAttempts),
		KeyAuthEmailCodeResendCooldownSeconds:  strconv.Itoa(normalized.AuthEmailCodeResendCooldownSeconds),
		KeyAuthEmailCodeEmailWindowMinutes:     strconv.Itoa(normalized.AuthEmailCodeEmailWindowMinutes),
		KeyAuthEmailCodeEmailWindowMaxSends:    strconv.Itoa(normalized.AuthEmailCodeEmailWindowMaxSends),
		KeyAuthEmailCodeIPWindowMinutes:        strconv.Itoa(normalized.AuthEmailCodeIPWindowMinutes),
		KeyAuthEmailCodeIPWindowMaxSends:       strconv.Itoa(normalized.AuthEmailCodeIPWindowMaxSends),
		KeyLLMEnabled:                          strconv.FormatBool(normalized.LLMEnabled),
		KeyLLMProtocol:                         normalized.LLMProtocol,
		KeyLLMBaseURL:                          normalized.LLMBaseURL,
		KeyLLMModel:                            normalized.LLMModel,
		KeyLLMAuthHeader:                       normalized.LLMAuthHeader,
		KeyLLMAPIKey:                           normalized.LLMAPIKey,
		KeyLLMTimeoutSeconds:                   strconv.Itoa(normalized.LLMTimeoutSeconds),
		KeyLLMMaxTokens:                        strconv.Itoa(normalized.LLMMaxTokens),
	}, nil
}

func applyValue(result *General, key string, raw string) error {
	switch key {
	case KeyAllowUserRegistration:
		value, err := strconv.ParseBool(strings.TrimSpace(raw))
		if err != nil {
			return ErrInvalidSettings
		}
		result.AllowUserRegistration = value
	case KeySessionIdleTimeoutMinutes:
		return setPositiveInt(raw, &result.SessionIdleTimeoutMinutes)
	case KeyRefreshTokenTTLHours:
		return setPositiveInt(raw, &result.RefreshTokenTTLHours)
	case KeyTerminalMaxSessionsPerUser:
		return setPositiveInt(raw, &result.TerminalMaxSessionsPerUser)
	case KeyTerminalMaxSessionsTotal:
		return setPositiveInt(raw, &result.TerminalMaxSessionsTotal)
	case KeyTerminalKeepAliveHours:
		return setPositiveInt(raw, &result.TerminalKeepAliveHours)
	case KeyFileSFTPIdleTTLMinutes:
		return setPositiveInt(raw, &result.FileSFTPIdleTTLMinutes)
	case KeyHostConnectivityPollIntervalSeconds:
		return setPositiveInt(raw, &result.HostConnectivityPollIntervalSeconds)
	case KeySMTPHost:
		result.SMTPHost = strings.TrimSpace(raw)
	case KeySMTPPort:
		return setPositiveInt(raw, &result.SMTPPort)
	case KeySMTPFrom:
		result.SMTPFrom = strings.TrimSpace(raw)
	case KeySMTPFromName:
		result.SMTPFromName = strings.TrimSpace(raw)
	case KeySMTPUsername:
		result.SMTPUsername = strings.TrimSpace(raw)
	case KeySMTPPassword:
		result.SMTPPassword = strings.TrimSpace(raw)
	case KeySMTPUseSSL:
		value, err := strconv.ParseBool(strings.TrimSpace(raw))
		if err != nil {
			return ErrInvalidSettings
		}
		result.SMTPUseSSL = value
	case KeyAuthAllowedEmails:
		result.AuthAllowedEmails = raw
	case KeyAuthAllowedEmailDomains:
		result.AuthAllowedEmailDomains = raw
	case KeyAuthEmailCodeLength:
		return setPositiveInt(raw, &result.AuthEmailCodeLength)
	case KeyAuthEmailCodeTTLMinutes:
		return setPositiveInt(raw, &result.AuthEmailCodeTTLMinutes)
	case KeyAuthEmailCodeMaxAttempts:
		return setPositiveInt(raw, &result.AuthEmailCodeMaxAttempts)
	case KeyAuthEmailCodeResendCooldownSeconds:
		return setPositiveInt(raw, &result.AuthEmailCodeResendCooldownSeconds)
	case KeyAuthEmailCodeEmailWindowMinutes:
		return setPositiveInt(raw, &result.AuthEmailCodeEmailWindowMinutes)
	case KeyAuthEmailCodeEmailWindowMaxSends:
		return setPositiveInt(raw, &result.AuthEmailCodeEmailWindowMaxSends)
	case KeyAuthEmailCodeIPWindowMinutes:
		return setPositiveInt(raw, &result.AuthEmailCodeIPWindowMinutes)
	case KeyAuthEmailCodeIPWindowMaxSends:
		return setPositiveInt(raw, &result.AuthEmailCodeIPWindowMaxSends)
	case KeyLLMEnabled:
		value, err := strconv.ParseBool(strings.TrimSpace(raw))
		if err != nil {
			return ErrInvalidSettings
		}
		result.LLMEnabled = value
	case KeyLLMProtocol:
		result.LLMProtocol = strings.TrimSpace(raw)
	case KeyLLMBaseURL:
		result.LLMBaseURL = strings.TrimSpace(raw)
	case KeyLLMModel:
		result.LLMModel = strings.TrimSpace(raw)
	case KeyLLMAuthHeader:
		result.LLMAuthHeader = strings.TrimSpace(raw)
	case KeyLLMAPIKey:
		result.LLMAPIKey = strings.TrimSpace(raw)
	case KeyLLMTimeoutSeconds:
		return setPositiveInt(raw, &result.LLMTimeoutSeconds)
	case KeyLLMMaxTokens:
		return setPositiveInt(raw, &result.LLMMaxTokens)
	}
	return nil
}

func isHTTPBaseURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return false
	}
	return parsed.Scheme == "http" || parsed.Scheme == "https"
}

func setPositiveInt(raw string, target *int) error {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return ErrInvalidSettings
	}
	*target = value
	return nil
}

func normalizeList(raw string, stripDomainPrefix bool) string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r' || r == '\t' || r == ';'
	})
	items := make([]string, 0, len(parts))
	seen := make(map[string]struct{})
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if stripDomainPrefix {
			item = strings.TrimPrefix(item, "@")
		}
		item = strings.ToLower(item)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		items = append(items, item)
	}
	return strings.Join(items, ", ")
}

func splitNormalizedList(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item != "" {
			items = append(items, item)
		}
	}
	return items
}
