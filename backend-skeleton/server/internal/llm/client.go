package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/settings"
)

var ErrProviderUnavailable = errors.New("llm provider unavailable")

type Config struct {
	Protocol   string
	BaseURL    string
	Model      string
	AuthHeader string
	APIKey     string
	Timeout    time.Duration
	MaxTokens  int
}

type Message struct {
	Role    string
	Content string
}

type Client struct {
	httpClient *http.Client
}

func NewClient(httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Client{httpClient: httpClient}
}

func (c *Client) Complete(ctx context.Context, cfg Config, system string, messages []Message) (string, error) {
	if cfg.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, cfg.Timeout)
		defer cancel()
	}
	body, endpoint, err := buildCompletionRequest(cfg, system, messages)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("%w: create request", ErrProviderUnavailable)
	}
	req.Header.Set("Content-Type", "application/json")
	switch cfg.AuthHeader {
	case settings.LLMAuthHeaderBearer:
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	default:
		req.Header.Set("api-key", cfg.APIKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: request failed", ErrProviderUnavailable)
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", fmt.Errorf("%w: read response", ErrProviderUnavailable)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("%w: provider returned status %d", ErrProviderUnavailable, resp.StatusCode)
	}
	content, err := extractCompletionContent(cfg.Protocol, payload)
	if err != nil {
		return "", err
	}
	return content, nil
}

func buildCompletionRequest(cfg Config, system string, messages []Message) ([]byte, string, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	switch cfg.Protocol {
	case settings.LLMProtocolAnthropic:
		type anthropicContent struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		type anthropicMessage struct {
			Role    string             `json:"role"`
			Content []anthropicContent `json:"content"`
		}
		body := struct {
			Model         string             `json:"model"`
			MaxTokens     int                `json:"max_tokens"`
			System        string             `json:"system"`
			Messages      []anthropicMessage `json:"messages"`
			TopP          float64            `json:"top_p"`
			Stream        bool               `json:"stream"`
			Temperature   float64            `json:"temperature"`
			StopSequences any                `json:"stop_sequences"`
			Thinking      struct {
				Type string `json:"type"`
			} `json:"thinking"`
		}{
			Model:       cfg.Model,
			MaxTokens:   cfg.MaxTokens,
			System:      system,
			TopP:        0.95,
			Stream:      false,
			Temperature: 1.0,
		}
		body.Thinking.Type = "disabled"
		for _, message := range messages {
			role := message.Role
			if role == "" || role == "system" {
				role = "user"
			}
			body.Messages = append(body.Messages, anthropicMessage{
				Role: role,
				Content: []anthropicContent{{
					Type: "text",
					Text: message.Content,
				}},
			})
		}
		payload, err := json.Marshal(body)
		return payload, baseURL + "/v1/messages", err
	default:
		type openAIMessage struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		}
		body := struct {
			Model               string          `json:"model"`
			Messages            []openAIMessage `json:"messages"`
			MaxCompletionTokens int             `json:"max_completion_tokens"`
		}{
			Model:               cfg.Model,
			MaxCompletionTokens: cfg.MaxTokens,
			Messages:            []openAIMessage{{Role: "system", Content: system}},
		}
		for _, message := range messages {
			role := message.Role
			if role == "" {
				role = "user"
			}
			body.Messages = append(body.Messages, openAIMessage{Role: role, Content: message.Content})
		}
		payload, err := json.Marshal(body)
		return payload, baseURL + "/chat/completions", err
	}
}

func extractCompletionContent(protocol string, payload []byte) (string, error) {
	switch protocol {
	case settings.LLMProtocolAnthropic:
		var response struct {
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		}
		if err := json.Unmarshal(payload, &response); err != nil {
			return "", fmt.Errorf("%w: decode anthropic response", ErrInvalidProviderResponse)
		}
		for _, part := range response.Content {
			if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
				return part.Text, nil
			}
		}
	default:
		var response struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(payload, &response); err != nil {
			return "", fmt.Errorf("%w: decode openai response", ErrInvalidProviderResponse)
		}
		if len(response.Choices) > 0 && strings.TrimSpace(response.Choices[0].Message.Content) != "" {
			return response.Choices[0].Message.Content, nil
		}
	}
	return "", ErrInvalidProviderResponse
}
