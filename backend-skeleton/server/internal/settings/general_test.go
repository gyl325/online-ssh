package settings

import (
	"errors"
	"testing"
)

func TestNewStoreFallbackDefaultsTerminalSessionLimitsToSixteen(t *testing.T) {
	store := NewStore(General{})
	snapshot := store.Snapshot()

	if snapshot.TerminalMaxSessionsPerUser != 16 || snapshot.TerminalMaxSessionsTotal != 16 {
		t.Fatalf("expected terminal session limits to default to 16, got user=%d total=%d", snapshot.TerminalMaxSessionsPerUser, snapshot.TerminalMaxSessionsTotal)
	}
}

func TestGeneralLLMSettingsDefaultsNormalizeAndEncode(t *testing.T) {
	input := validGeneralForTest()
	input.LLMEnabled = true
	input.LLMProtocol = " openai "
	input.LLMBaseURL = " https://llm.example.com/v1 "
	input.LLMModel = " mimo-v2.5-pro "
	input.LLMAuthHeader = " api_key "
	input.LLMAPIKey = " example-api-key "
	input.LLMTimeoutSeconds = 30
	input.LLMMaxTokens = 1024

	normalized, err := Normalize(input)
	if err != nil {
		t.Fatalf("normalize llm settings: %v", err)
	}
	if normalized.LLMProtocol != LLMProtocolOpenAI || normalized.LLMBaseURL != "https://llm.example.com/v1" {
		t.Fatalf("unexpected normalized llm config: %#v", normalized)
	}
	values, err := Encode(normalized)
	if err != nil {
		t.Fatalf("encode llm settings: %v", err)
	}
	if values[KeyLLMAPIKey] != "example-api-key" || values[KeyLLMAuthHeader] != LLMAuthHeaderAPIKey {
		t.Fatalf("expected encoded llm values, got %#v", values)
	}
}

func TestGeneralSMTPSettingsNormalizeMergeAndEncodeCredentials(t *testing.T) {
	input := validGeneralForTest()
	input.SMTPHost = " smtp.example.com "
	input.SMTPPort = 465
	input.SMTPFrom = " noreply@example.com "
	input.SMTPFromName = " Online SSH "
	input.SMTPUsername = " smtp-user "
	input.SMTPPassword = " smexample-api-key "
	input.SMTPUseSSL = true

	normalized, err := Normalize(input)
	if err != nil {
		t.Fatalf("normalize smtp settings: %v", err)
	}
	if normalized.SMTPUsername != "smtp-user" || normalized.SMTPPassword != "smexample-api-key" {
		t.Fatalf("expected trimmed smtp credentials, got %#v", normalized)
	}
	values, err := Encode(normalized)
	if err != nil {
		t.Fatalf("encode smtp settings: %v", err)
	}
	if values[KeySMTPUsername] != "smtp-user" || values[KeySMTPPassword] != "smexample-api-key" {
		t.Fatalf("expected encoded smtp credentials, got %#v", values)
	}

	merged, err := Merge(validGeneralForTest(), map[string]string{
		KeySMTPHost:     "smtp.internal",
		KeySMTPFrom:     "noreply@internal",
		KeySMTPUsername: "db-user",
		KeySMTPPassword: "db-secret",
	})
	if err != nil {
		t.Fatalf("merge smtp credentials: %v", err)
	}
	if merged.SMTPUsername != "db-user" || merged.SMTPPassword != "db-secret" {
		t.Fatalf("expected merged smtp credentials, got %#v", merged)
	}
}

func TestGeneralLLMSettingsValidation(t *testing.T) {
	input := validGeneralForTest()
	input.LLMEnabled = true
	input.LLMProtocol = LLMProtocolOpenAI
	input.LLMBaseURL = "ftp://example.com"
	input.LLMModel = "mimo-v2.5-pro"
	input.LLMAuthHeader = LLMAuthHeaderAPIKey
	input.LLMAPIKey = "example-api-key"
	input.LLMTimeoutSeconds = 30
	input.LLMMaxTokens = 1024

	if _, err := Normalize(input); !errors.Is(err, ErrInvalidSettings) {
		t.Fatalf("expected invalid base url, got %v", err)
	}
	input.LLMBaseURL = "https://llm.example.com/v1"
	input.LLMProtocol = "unknown"
	if _, err := Normalize(input); !errors.Is(err, ErrInvalidSettings) {
		t.Fatalf("expected invalid protocol, got %v", err)
	}
	input.LLMProtocol = LLMProtocolOpenAI
	input.LLMAuthHeader = "unknown"
	if _, err := Normalize(input); !errors.Is(err, ErrInvalidSettings) {
		t.Fatalf("expected invalid auth header, got %v", err)
	}
	input.LLMAuthHeader = LLMAuthHeaderAPIKey
	input.LLMTimeoutSeconds = 4
	if _, err := Normalize(input); !errors.Is(err, ErrInvalidSettings) {
		t.Fatalf("expected invalid timeout, got %v", err)
	}
	input.LLMTimeoutSeconds = 30
	input.LLMMaxTokens = 128
	if _, err := Normalize(input); !errors.Is(err, ErrInvalidSettings) {
		t.Fatalf("expected invalid max tokens, got %v", err)
	}
}

func validGeneralForTest() General {
	return General{
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
	}
}
