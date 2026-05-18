package webutil

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteJSON(t *testing.T) {
	recorder := httptest.NewRecorder()

	WriteJSON(recorder, http.StatusCreated, map[string]string{"status": "created"})

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("unexpected content type: %q", got)
	}

	var payload map[string]string
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload["status"] != "created" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestWriteNoContent(t *testing.T) {
	recorder := httptest.NewRecorder()

	WriteNoContent(recorder)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected status %d, got %d", http.StatusNoContent, recorder.Code)
	}
	if recorder.Body.Len() != 0 {
		t.Fatalf("expected empty body, got %q", recorder.Body.String())
	}
}

func TestWriteError(t *testing.T) {
	recorder := httptest.NewRecorder()

	WriteError(recorder, http.StatusBadRequest, "BAD_REQUEST", "invalid input")

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, recorder.Code)
	}

	var payload ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Code != "BAD_REQUEST" || payload.Message != "invalid input" {
		t.Fatalf("unexpected error payload: %#v", payload)
	}
}

func TestRequestLoggingWritesStructuredSafeAccessLog(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	handler := RequestLogging(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = r.Body.Read(make([]byte, 4))
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("accepted"))
	}))
	request := httptest.NewRequest(http.MethodPost, "/api/files/content?token=secret-token&path=/home/user/.ssh/id_rsa", strings.NewReader("password=super-secret"))
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected response status %d, got %d", http.StatusAccepted, recorder.Code)
	}
	var entry map[string]any
	if err := json.Unmarshal(output.Bytes(), &entry); err != nil {
		t.Fatalf("decode structured access log: %v; log=%s", err, output.String())
	}
	if entry["msg"] != "http request completed" ||
		entry["component"] != "http" ||
		entry["event"] != "http_request_completed" ||
		entry["method"] != http.MethodPost ||
		entry["path"] != "/api/files/content" ||
		entry["status"] != float64(http.StatusAccepted) {
		t.Fatalf("unexpected access log entry: %#v", entry)
	}
	duration, ok := entry["duration_ms"].(float64)
	if !ok || duration < 0 {
		t.Fatalf("expected non-negative duration_ms, got %#v", entry["duration_ms"])
	}
	logLine := output.String()
	for _, forbidden := range []string{"secret-token", ".ssh/id_rsa", "super-secret"} {
		if strings.Contains(logLine, forbidden) {
			t.Fatalf("access log leaked %q: %s", forbidden, logLine)
		}
	}
}

func TestRequestLoggingDoesNotExposeUnsupportedHijacker(t *testing.T) {
	handler := RequestLogging(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := w.(http.Hijacker); ok {
			t.Fatal("wrapped response writer should not expose Hijacker when the underlying writer does not support it")
		}
		WriteNoContent(w)
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/healthz", nil))
}
