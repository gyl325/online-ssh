package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/settings"
)

func TestClientCompleteOpenAI(t *testing.T) {
	var gotPath string
	var gotAuth string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("api-key")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"ok\":true}"}}]}`))
	}))
	defer server.Close()

	client := NewClient(server.Client())
	content, err := client.Complete(context.Background(), Config{
		Protocol:   settings.LLMProtocolOpenAI,
		BaseURL:    server.URL,
		Model:      "mimo-v2.5-pro",
		AuthHeader: settings.LLMAuthHeaderAPIKey,
		APIKey:     "example-api-key",
		Timeout:    time.Second,
		MaxTokens:  1024,
	}, "system prompt", []Message{{Role: "user", Content: "hello"}})
	if err != nil {
		t.Fatalf("complete openai: %v", err)
	}
	if gotPath != "/chat/completions" {
		t.Fatalf("expected openai path, got %q", gotPath)
	}
	if gotAuth != "example-api-key" {
		t.Fatalf("expected api-key auth, got %q", gotAuth)
	}
	if content != `{"ok":true}` {
		t.Fatalf("unexpected content %q", content)
	}
	if gotBody["model"] != "mimo-v2.5-pro" || gotBody["max_completion_tokens"].(float64) != 1024 {
		t.Fatalf("unexpected openai body %#v", gotBody)
	}
}

func TestClientCompleteAnthropic(t *testing.T) {
	var gotPath string
	var gotAuth string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"{\"ok\":true}"}]}`))
	}))
	defer server.Close()

	client := NewClient(server.Client())
	content, err := client.Complete(context.Background(), Config{
		Protocol:   settings.LLMProtocolAnthropic,
		BaseURL:    server.URL,
		Model:      "mimo-v2.5-pro",
		AuthHeader: settings.LLMAuthHeaderBearer,
		APIKey:     "example-api-key",
		Timeout:    time.Second,
		MaxTokens:  1024,
	}, "system prompt", []Message{{Role: "user", Content: "hello"}})
	if err != nil {
		t.Fatalf("complete anthropic: %v", err)
	}
	if gotPath != "/v1/messages" {
		t.Fatalf("expected anthropic path, got %q", gotPath)
	}
	if gotAuth != "Bearer example-api-key" {
		t.Fatalf("expected bearer auth, got %q", gotAuth)
	}
	if content != `{"ok":true}` {
		t.Fatalf("unexpected content %q", content)
	}
	if gotBody["model"] != "mimo-v2.5-pro" || gotBody["max_tokens"].(float64) != 1024 {
		t.Fatalf("unexpected anthropic body %#v", gotBody)
	}
	if gotBody["stream"] != false || gotBody["temperature"].(float64) != 1.0 || gotBody["top_p"].(float64) != 0.95 {
		t.Fatalf("expected MiMo-compatible anthropic generation options, got %#v", gotBody)
	}
	if gotBody["stop_sequences"] != nil {
		t.Fatalf("expected explicit null stop_sequences, got %#v", gotBody["stop_sequences"])
	}
	thinking, ok := gotBody["thinking"].(map[string]any)
	if !ok || thinking["type"] != "disabled" {
		t.Fatalf("expected disabled anthropic thinking, got %#v", gotBody["thinking"])
	}
}

func TestClientCompleteProviderErrorRedactsAPIKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad token example-api-key", http.StatusUnauthorized)
	}))
	defer server.Close()

	client := NewClient(server.Client())
	_, err := client.Complete(context.Background(), Config{
		Protocol:   settings.LLMProtocolOpenAI,
		BaseURL:    server.URL,
		Model:      "mimo-v2.5-pro",
		AuthHeader: settings.LLMAuthHeaderAPIKey,
		APIKey:     "example-api-key",
		Timeout:    time.Second,
		MaxTokens:  1024,
	}, "system", []Message{{Role: "user", Content: "hello"}})
	if err == nil {
		t.Fatal("expected provider error")
	}
	if strings.Contains(err.Error(), "example-api-key") {
		t.Fatalf("provider error leaked api key: %v", err)
	}
}
