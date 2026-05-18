package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func TestPermissionMiddleware(t *testing.T) {
	t.Run("rejects request without session", func(t *testing.T) {
		called := false
		handler := NewPermissionMiddleware(model.PermissionTerminalConnect)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			called = true
		}))
		req := httptest.NewRequest(http.MethodGet, "/api/terminal/sessions", nil)
		recorder := httptest.NewRecorder()

		handler.ServeHTTP(recorder, req)

		if called {
			t.Fatalf("permission middleware must not call next handler without a session")
		}
		assertPermissionError(t, recorder, http.StatusUnauthorized, "UNAUTHORIZED")
	})

	t.Run("rejects request when session lacks permission", func(t *testing.T) {
		called := false
		handler := NewPermissionMiddleware(model.PermissionTerminalConnect)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
			called = true
		}))
		req := httptest.NewRequest(http.MethodGet, "/api/terminal/sessions", nil)
		req = req.WithContext(WithSession(req.Context(), AuthenticatedSession{
			SessionID: "session-1",
			UserID:    "user-1",
			User:      model.User{ID: "user-1", Permissions: []string{model.PermissionFilesManage}},
		}))
		recorder := httptest.NewRecorder()

		handler.ServeHTTP(recorder, req)

		if called {
			t.Fatalf("permission middleware must not call next handler without required permission")
		}
		assertPermissionError(t, recorder, http.StatusForbidden, "FORBIDDEN")
	})

	t.Run("allows request with required permission and preserves session", func(t *testing.T) {
		handler := NewPermissionMiddleware(model.PermissionTerminalConnect)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session, ok := SessionFromContext(r.Context())
			if !ok || session.UserID != "user-1" {
				t.Fatalf("expected original session in context, got %#v", session)
			}
			w.WriteHeader(http.StatusNoContent)
		}))
		req := httptest.NewRequest(http.MethodGet, "/api/terminal/sessions", nil)
		req = req.WithContext(WithSession(req.Context(), AuthenticatedSession{
			SessionID: "session-1",
			UserID:    "user-1",
			User:      model.User{ID: "user-1", Permissions: []string{model.PermissionTerminalConnect}},
		}))
		recorder := httptest.NewRecorder()

		handler.ServeHTTP(recorder, req)

		if recorder.Code != http.StatusNoContent {
			t.Fatalf("expected 204, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})
}

func assertPermissionError(t *testing.T, recorder *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if recorder.Code != status {
		t.Fatalf("expected %d, got %d body=%s", status, recorder.Code, recorder.Body.String())
	}
	var payload webutil.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Code != code {
		t.Fatalf("expected error code %q, got %#v", code, payload)
	}
}
