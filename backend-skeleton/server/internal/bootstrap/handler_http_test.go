package bootstrap

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func TestHandlerStatus(t *testing.T) {
	service := &serviceStub{
		statusResult: Status{SetupRequired: true},
	}
	handler := NewHandler(service, "session_cookie", false, time.Hour, HandlerOptions{})

	req := httptest.NewRequest(http.MethodGet, "/api/bootstrap/status", nil)
	recorder := httptest.NewRecorder()
	handler.Status(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload Status
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode status response: %v", err)
	}
	if !payload.SetupRequired {
		t.Fatalf("expected setup_required true, got %#v", payload)
	}
}

func TestHandlerStatusReportsSetupTokenRequired(t *testing.T) {
	service := &serviceStub{
		statusResult: Status{SetupRequired: true},
	}
	handler := NewHandler(service, "session_cookie", false, time.Hour, HandlerOptions{
		SetupToken: "setup-token",
	})

	req := httptest.NewRequest(http.MethodGet, "/api/bootstrap/status", nil)
	recorder := httptest.NewRecorder()
	handler.Status(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload Status
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode status response: %v", err)
	}
	if !payload.SetupTokenRequired {
		t.Fatalf("expected setup_token_required true, got %#v", payload)
	}
}

func TestHandlerSetupCreatesSessionCookies(t *testing.T) {
	expiresAt := time.Now().Add(time.Hour)
	refreshExpiresAt := time.Now().Add(24 * time.Hour)
	user := model.User{ID: "user-1", Email: "admin@example.com", DisplayName: "Admin"}
	session := auth.SessionInfo{ID: "session-1", LoginMethod: "password", ExpiresAt: expiresAt}
	service := &serviceStub{
		setupResult: SetupResult{User: user},
		loginResult: auth.LoginResult{
			Status:           auth.LoginStatusSuccess,
			User:             user,
			Session:          session,
			SessionToken:     "session-token",
			RefreshToken:     "refresh-token",
			ExpiresAt:        expiresAt,
			RefreshExpiresAt: refreshExpiresAt,
		},
	}
	handler := NewHandler(service, "session_cookie", false, time.Hour, HandlerOptions{
		RefreshCookieName: "refresh_cookie",
		RefreshCookieTTL:  24 * time.Hour,
	})

	body := bytes.NewBufferString(`{"email":"admin@example.com","display_name":"Admin","password":"password123","password_confirm":"password123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/bootstrap/setup", body)
	req.RemoteAddr = "192.0.2.10:12345"
	req.Header.Set("User-Agent", "bootstrap-test")
	req.Header.Set("X-Forwarded-For", "203.0.113.20, 198.51.100.10")
	recorder := httptest.NewRecorder()
	handler.Setup(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if service.setupInput.Email != "admin@example.com" || service.loginInput.Email != "admin@example.com" {
		t.Fatalf("expected setup/login to use request email, got setup=%#v login=%#v", service.setupInput, service.loginInput)
	}
	if service.loginInput.Password != "password123" {
		t.Fatalf("expected login to use setup password, got %#v", service.loginInput)
	}
	if service.loginInput.ClientIP != "203.0.113.20" {
		t.Fatalf("expected forwarded client ip, got %q", service.loginInput.ClientIP)
	}
	if service.loginInput.UserAgent != "bootstrap-test" {
		t.Fatalf("expected user agent forwarded, got %q", service.loginInput.UserAgent)
	}

	cookies := recorder.Result().Cookies()
	if cookieValue(cookies, "session_cookie") != "session-token" {
		t.Fatalf("expected session cookie, got %#v", cookies)
	}
	if cookieValue(cookies, "refresh_cookie") != "refresh-token" {
		t.Fatalf("expected refresh cookie, got %#v", cookies)
	}

	var payload struct {
		User    model.User       `json:"user"`
		Session auth.SessionInfo `json:"session"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode setup response: %v", err)
	}
	if payload.User.ID != user.ID || payload.Session.ID != session.ID {
		t.Fatalf("unexpected setup response: %#v", payload)
	}
}

func TestHandlerSetupRequiresConfiguredToken(t *testing.T) {
	service := &serviceStub{}
	handler := NewHandler(service, "session_cookie", false, time.Hour, HandlerOptions{
		SetupToken: "setup-token",
	})

	body := bytes.NewBufferString(`{"email":"admin@example.com","display_name":"Admin","password":"password123","password_confirm":"password123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/bootstrap/setup", body)
	recorder := httptest.NewRecorder()
	handler.Setup(recorder, req)

	assertBootstrapError(t, recorder, http.StatusForbidden, "BOOTSTRAP_SETUP_TOKEN_REQUIRED")
	if service.setupInput.Email != "" || service.loginCalled {
		t.Fatalf("expected setup/login not to be called, setup=%#v loginCalled=%v", service.setupInput, service.loginCalled)
	}
}

func TestHandlerSetupAcceptsConfiguredToken(t *testing.T) {
	expiresAt := time.Now().Add(time.Hour)
	user := model.User{ID: "user-1", Email: "admin@example.com", DisplayName: "Admin"}
	service := &serviceStub{
		setupResult: SetupResult{User: user},
		loginResult: auth.LoginResult{
			Status:           auth.LoginStatusSuccess,
			User:             user,
			Session:          auth.SessionInfo{ID: "session-1", LoginMethod: "password", ExpiresAt: expiresAt},
			SessionToken:     "session-token",
			RefreshToken:     "refresh-token",
			ExpiresAt:        expiresAt,
			RefreshExpiresAt: expiresAt.Add(time.Hour),
		},
	}
	handler := NewHandler(service, "session_cookie", false, time.Hour, HandlerOptions{
		SetupToken: "setup-token",
	})

	body := bytes.NewBufferString(`{"email":"admin@example.com","display_name":"Admin","password":"password123","password_confirm":"password123","setup_token":"setup-token"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/bootstrap/setup", body)
	recorder := httptest.NewRecorder()
	handler.Setup(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if service.setupInput.Email != "admin@example.com" || !service.loginCalled {
		t.Fatalf("expected setup/login to be called, setup=%#v loginCalled=%v", service.setupInput, service.loginCalled)
	}
}

func TestHandlerSetupRejectsAlreadyInitialized(t *testing.T) {
	service := &serviceStub{setupErr: ErrAlreadyInitialized}
	handler := NewHandler(service, "session_cookie", false, time.Hour, HandlerOptions{})

	body := bytes.NewBufferString(`{"email":"admin@example.com","display_name":"Admin","password":"password123","password_confirm":"password123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/bootstrap/setup", body)
	recorder := httptest.NewRecorder()
	handler.Setup(recorder, req)

	assertBootstrapError(t, recorder, http.StatusConflict, "BOOTSTRAP_ALREADY_INITIALIZED")
	if service.loginCalled {
		t.Fatal("expected login not to be called")
	}
}

func TestHandlerSetupMapsLoginFailure(t *testing.T) {
	service := &serviceStub{
		setupResult: SetupResult{User: model.User{ID: "user-1"}},
		loginErr:    errors.New("login failed"),
	}
	handler := NewHandler(service, "session_cookie", false, time.Hour, HandlerOptions{})

	body := bytes.NewBufferString(`{"email":"admin@example.com","display_name":"Admin","password":"password123","password_confirm":"password123"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/bootstrap/setup", body)
	recorder := httptest.NewRecorder()
	handler.Setup(recorder, req)

	assertBootstrapError(t, recorder, http.StatusInternalServerError, "BOOTSTRAP_LOGIN_FAILED")
}

type serviceStub struct {
	statusResult Status
	statusErr    error
	setupResult  SetupResult
	setupErr     error
	loginResult  auth.LoginResult
	loginErr     error
	setupInput   SetupInput
	loginInput   auth.LoginInput
	loginCalled  bool
}

func (s *serviceStub) Status(ctx context.Context) (Status, error) {
	return s.statusResult, s.statusErr
}

func (s *serviceStub) Setup(ctx context.Context, input SetupInput) (SetupResult, error) {
	s.setupInput = input
	return s.setupResult, s.setupErr
}

func (s *serviceStub) Login(ctx context.Context, input auth.LoginInput) (auth.LoginResult, error) {
	s.loginCalled = true
	s.loginInput = input
	return s.loginResult, s.loginErr
}

func cookieValue(cookies []*http.Cookie, name string) string {
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie.Value
		}
	}
	return ""
}

func assertBootstrapError(t *testing.T, recorder *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if recorder.Code != status {
		t.Fatalf("expected %d, got %d body=%s", status, recorder.Code, recorder.Body.String())
	}
	var payload webutil.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Code != code {
		t.Fatalf("expected code %q, got %#v", code, payload)
	}
}
