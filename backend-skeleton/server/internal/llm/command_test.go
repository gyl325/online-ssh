package llm

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/settings"
)

type fakeCompleter struct {
	content string
	cfg     Config
	system  string
	user    string
	err     error
}

func (f *fakeCompleter) Complete(_ context.Context, cfg Config, system string, messages []Message) (string, error) {
	f.cfg = cfg
	f.system = system
	if len(messages) > 0 {
		f.user = messages[len(messages)-1].Content
	}
	return f.content, f.err
}

func TestServiceGenerateCommandParsesAndValidatesResult(t *testing.T) {
	completer := &fakeCompleter{content: `{
		"command_text":"find /var/log -type f -mtime -1 -size +100M -print",
		"name":"Find recent large log files",
		"category":"Logs",
		"description":"Lists recent large log files.",
		"risk_level":"low",
		"notes":["Review the path before running."]
	}`}
	service := NewService(completer, func() settings.General {
		return validLLMSettings()
	})

	response, err := service.GenerateCommand(context.Background(), CommandRequest{
		Prompt:           "find large logs",
		HostLabel:        "prod-web-1",
		ShellHint:        "bash",
		WorkingDirectory: "/var/log",
	})
	if err != nil {
		t.Fatalf("generate command: %v", err)
	}
	if response.Result == nil || response.Result.CommandText == "" || response.Result.Name == "" || response.Result.RiskLevel != "low" {
		t.Fatalf("unexpected result %#v", response)
	}
	if !strings.Contains(completer.system, "Output exactly one JSON object") ||
		!strings.Contains(completer.system, "Do not answer unrelated requests") ||
		!strings.Contains(completer.user, "prod-web-1") {
		t.Fatalf("expected prompt context, got system=%q user=%q", completer.system, completer.user)
	}
	if completer.cfg.BaseURL != "https://llm.example.com/v1" {
		t.Fatalf("expected settings-derived config, got %#v", completer.cfg)
	}
}

func TestServiceGenerateCommandEscalatesHighRiskCommand(t *testing.T) {
	service := NewService(&fakeCompleter{content: `{
		"command_text":"rm -rf ~",
		"name":"Delete home directory",
		"category":"Filesystem",
		"description":"Deletes the current user's home directory.",
		"risk_level":"low",
		"notes":["This permanently removes files."]
	}`}, func() settings.General {
		return validLLMSettings()
	})

	response, err := service.GenerateCommand(context.Background(), CommandRequest{Prompt: "delete my home directory"})
	if err != nil {
		t.Fatalf("generate command: %v", err)
	}
	if response.Result == nil {
		t.Fatalf("expected result, got %#v", response)
	}
	if response.Result.RiskLevel != "high" {
		t.Fatalf("expected backend to escalate high-risk command, got %#v", response.Result)
	}
}

func TestServiceGenerateCommandEscalatesHighRiskIntent(t *testing.T) {
	service := NewService(&fakeCompleter{content: `{
		"command_text":"ls -ld ~",
		"name":"Inspect home directory",
		"category":"Filesystem",
		"description":"Shows metadata for the current user's home directory.",
		"risk_level":"low",
		"notes":["This does not delete files."]
	}`}, func() settings.General {
		return validLLMSettings()
	})

	response, err := service.GenerateCommand(context.Background(), CommandRequest{Prompt: "如何删除我的用户目录？"})
	if err != nil {
		t.Fatalf("generate command: %v", err)
	}
	if response.Result == nil || response.Result.RiskLevel != "high" {
		t.Fatalf("expected destructive intent to be marked high risk, got %#v", response)
	}
}

func TestServiceGenerateCommandReturnsUnsupportedRequest(t *testing.T) {
	service := NewService(&fakeCompleter{content: `{
		"unsupported_request": true,
		"message": "这个请求和终端命令生成无关。",
		"suggested_prompt": "请描述希望在终端中完成的操作。"
	}`}, func() settings.General {
		return validLLMSettings()
	})

	response, err := service.GenerateCommand(context.Background(), CommandRequest{Prompt: "write me a poem"})
	if err != nil {
		t.Fatalf("expected unsupported response without error, got %v", err)
	}
	if !response.UnsupportedRequest || response.RefusalMessage == "" || response.Result != nil || response.InvalidResponse {
		t.Fatalf("expected unsupported request response, got %#v", response)
	}
}

func TestServiceGenerateCommandIncludesSystemInfoContext(t *testing.T) {
	completer := &fakeCompleter{content: `{
		"command_text":"apt list --upgradable",
		"name":"List Ubuntu package updates",
		"category":"Packages",
		"description":"Lists packages with available updates on Ubuntu.",
		"risk_level":"low",
		"notes":["Review packages before upgrading."]
	}`}
	service := NewService(completer, func() settings.General {
		return validLLMSettings()
	})

	_, err := service.GenerateCommand(context.Background(), CommandRequest{
		Prompt:     "show package updates",
		SystemInfo: "OS: Ubuntu 22.04.2 LTS\nKernel: 6.8.0-101-generic",
	})
	if err != nil {
		t.Fatalf("generate command: %v", err)
	}
	if !strings.Contains(completer.user, "System information:") || !strings.Contains(completer.user, "Ubuntu 22.04.2 LTS") {
		t.Fatalf("expected system info in prompt, got %q", completer.user)
	}
}

func TestServiceGenerateCommandReturnsRawResponseWhenParsingFails(t *testing.T) {
	raw := "你可以使用 top -b -n 1 | head -20 查看进程。"
	service := NewService(&fakeCompleter{content: raw}, func() settings.General {
		return validLLMSettings()
	})

	response, err := service.GenerateCommand(context.Background(), CommandRequest{Prompt: "list logs"})
	if err != nil {
		t.Fatalf("expected raw response without error, got %v", err)
	}
	if response.Result != nil || !response.InvalidResponse || response.RawResponse != raw {
		t.Fatalf("expected raw invalid response payload, got %#v", response)
	}
}

func TestServiceGenerateCommandReturnsRawResponseForInvalidFields(t *testing.T) {
	raw := `{"command_text":"","name":"Name","risk_level":"low"}`
	service := NewService(&fakeCompleter{content: `{"command_text":"","name":"Name","risk_level":"low"}`}, func() settings.General {
		return validLLMSettings()
	})

	response, err := service.GenerateCommand(context.Background(), CommandRequest{Prompt: "list logs"})
	if err != nil {
		t.Fatalf("expected raw response without error, got %v", err)
	}
	if response.Result != nil || !response.InvalidResponse || response.RawResponse != raw {
		t.Fatalf("expected raw invalid-field response payload, got %#v", response)
	}
}

func TestServiceGenerateCommandRequiresEnabledConfiguration(t *testing.T) {
	service := NewService(&fakeCompleter{}, func() settings.General {
		cfg := validLLMSettings()
		cfg.LLMEnabled = false
		return cfg
	})

	_, err := service.GenerateCommand(context.Background(), CommandRequest{Prompt: "list logs"})
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected not configured, got %v", err)
	}
}

func TestServiceTestConnectionAllowsDisabledConfiguration(t *testing.T) {
	completer := &fakeCompleter{content: `{"ok":true}`}
	service := NewService(completer, func() settings.General {
		return settings.General{}
	})
	cfg := validLLMSettings()
	cfg.LLMEnabled = false

	if err := service.TestConnection(context.Background(), cfg); err != nil {
		t.Fatalf("test connection should not require enabled setting: %v", err)
	}
	if completer.cfg.APIKey != "example-api-key" || completer.cfg.BaseURL != "https://llm.example.com/v1" {
		t.Fatalf("expected connection test config, got %#v", completer.cfg)
	}
}

func validLLMSettings() settings.General {
	return settings.General{
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
		LLMEnabled:                          true,
		LLMProtocol:                         settings.LLMProtocolOpenAI,
		LLMBaseURL:                          "https://llm.example.com/v1",
		LLMModel:                            "mimo-v2.5-pro",
		LLMAuthHeader:                       settings.LLMAuthHeaderAPIKey,
		LLMAPIKey:                           "example-api-key",
		LLMTimeoutSeconds:                   30,
		LLMMaxTokens:                        1024,
	}
}
