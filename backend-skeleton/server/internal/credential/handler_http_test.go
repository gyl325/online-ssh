package credential

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/auth"
)

func TestCredentialHandlerGenerateKeyPair(t *testing.T) {
	handler := NewHandler(&Service{})

	t.Run("requires session", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/credentials/keypairs", bytes.NewBufferString(`{"algorithm":"ed25519"}`))
		recorder := httptest.NewRecorder()

		handler.GenerateKeyPair(recorder, req)

		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("rejects invalid json", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/credentials/keypairs", bytes.NewBufferString(`{invalid`))
		req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
		recorder := httptest.NewRecorder()

		handler.GenerateKeyPair(recorder, req)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("generates requested key pair", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/credentials/keypairs", bytes.NewBufferString(`{"algorithm":"ecdsa","comment":"meng3080@Termix"}`))
		req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
		recorder := httptest.NewRecorder()

		handler.GenerateKeyPair(recorder, req)

		if recorder.Code != http.StatusCreated {
			t.Fatalf("expected 201, got %d body=%s", recorder.Code, recorder.Body.String())
		}
		var payload struct {
			KeyPair GeneratedKeyPair `json:"key_pair"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if payload.KeyPair.Algorithm != "ecdsa" {
			t.Fatalf("unexpected algorithm: %#v", payload.KeyPair)
		}
		if !strings.HasPrefix(payload.KeyPair.AuthorizedKeyLine, "ecdsa-sha2-nistp256 ") {
			t.Fatalf("unexpected authorized key line: %q", payload.KeyPair.AuthorizedKeyLine)
		}
		if !strings.Contains(payload.KeyPair.PrivateKey, "BEGIN TEST OPENSSH PRIVATE KEY") {
			t.Fatalf("expected private key in response")
		}
	})
}
