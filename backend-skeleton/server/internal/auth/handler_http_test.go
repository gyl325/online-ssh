package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func TestHandlerLoginSetsAuthCookies(t *testing.T) {
	service := NewService(&serviceRepoStub{
		getUserByEmailFn: func(_ context.Context, email string) (UserRecord, error) {
			return UserRecord{
				ID:           "user-1",
				Email:        email,
				DisplayName:  "User",
				PasswordHash: mustPasswordHash(t, "strong-pass"),
				Status:       string(model.UserStatusActive),
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}, nil
		},
		createSessionFn: func(_ context.Context, input CreateSessionInput) (SessionRecord, error) {
			return SessionRecord{ID: "session-1", UserID: input.UserID}, nil
		},
		revokeOtherSessionsFn: func(context.Context, string, string, time.Time) (int, error) {
			return 0, nil
		},
		getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
			return SessionRecord{ID: "session-1", UserID: "user-1"}, nil
		},
		updateLastLoginFn: func(_ context.Context, _ string, _ time.Time) error {
			return nil
		},
	}, time.Hour, nil)
	handler := NewHandler(service, "online_ssh_session", true, time.Hour, true)

	body := bytes.NewBufferString(`{"email":"user@example.com","password":"strong-pass"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.RemoteAddr = "203.0.113.10:4321"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "handler-test")
	recorder := httptest.NewRecorder()

	handler.Login(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	cookies := cookiesByName(recorder.Result().Cookies())
	if cookies["online_ssh_session"] == nil || cookies["online_ssh_session"].Value == "" {
		t.Fatalf("expected populated session cookie, got %#v", cookies)
	}
	if cookies["online_ssh_refresh"] == nil || cookies["online_ssh_refresh"].Value == "" {
		t.Fatalf("expected populated refresh cookie, got %#v", cookies)
	}
	if cookies["online_ssh_refresh"].Path != "/api/auth" {
		t.Fatalf("expected refresh cookie path /api/auth, got %q", cookies["online_ssh_refresh"].Path)
	}

	var payload map[string]model.User
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if payload["user"].Email != "user@example.com" {
		t.Fatalf("expected user email in response, got %#v", payload)
	}
}

func TestHandlerLoginReturnsMFARequiredWithoutAuthCookies(t *testing.T) {
	passwordHash := mustPasswordHash(t, "strong-pass")
	service := NewService(&serviceRepoStub{
		getUserByLoginIdentifierFn: func(_ context.Context, identifier string) (UserRecord, error) {
			return UserRecord{
				ID:           "user-1",
				Email:        identifier,
				DisplayName:  "User",
				PasswordHash: passwordHash,
				Status:       string(model.UserStatusActive),
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}, nil
		},
		getMFASettingsFn: func(_ context.Context, userID string) (MFASettingsRecord, error) {
			return MFASettingsRecord{UserID: userID, TOTPEnabled: true}, nil
		},
		createMFATokenFn: func(_ context.Context, input CreateMFATokenInput) (MFATokenRecord, error) {
			return MFATokenRecord{ID: "mfa-token-1", UserID: input.UserID, TokenHash: input.TokenHash, ExpiresAt: input.ExpiresAt}, nil
		},
	}, time.Hour, nil)
	handler := NewHandler(service, "online_ssh_session", true, time.Hour, true)

	body := bytes.NewBufferString(`{"identifier":"user@example.com","password":"strong-pass"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handler.Login(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	cookies := cookiesByName(recorder.Result().Cookies())
	if cookies["online_ssh_session"] != nil || cookies["online_ssh_refresh"] != nil {
		t.Fatalf("mfa pending login must not set auth cookies, got %#v", cookies)
	}
	var payload struct {
		Status   string   `json:"status"`
		MFAToken string   `json:"mfa_token"`
		Methods  []string `json:"methods"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if payload.Status != LoginStatusMFARequired || payload.MFAToken == "" {
		t.Fatalf("expected mfa_required payload, got %#v body=%s", payload, recorder.Body.String())
	}
}

func TestHandlerLoginReturnsAccountDisabled(t *testing.T) {
	service := NewService(&serviceRepoStub{
		getUserByLoginIdentifierFn: func(_ context.Context, identifier string) (UserRecord, error) {
			return UserRecord{
				ID:           "user-disabled",
				Email:        identifier,
				DisplayName:  "Disabled User",
				PasswordHash: "not-a-valid-hash",
				Status:       string(model.UserStatusDisabled),
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}, nil
		},
		createSessionFn: func(context.Context, CreateSessionInput) (SessionRecord, error) {
			t.Fatal("disabled user must not create a session")
			return SessionRecord{}, nil
		},
	}, time.Hour, nil)
	handler := NewHandler(service, "online_ssh_session", true, time.Hour, true)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(`{"identifier":"disabled@example.com","password":"strong-pass"}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handler.Login(recorder, req)

	assertAuthError(t, recorder, http.StatusForbidden, "ACCOUNT_DISABLED", "account is disabled")
	if cookies := cookiesByName(recorder.Result().Cookies()); cookies["online_ssh_session"] != nil || cookies["online_ssh_refresh"] != nil {
		t.Fatalf("disabled login must not set auth cookies, got %#v", cookies)
	}
}

func TestHandlerRegisterSetsAuthCookies(t *testing.T) {
	passwordHash := mustPasswordHash(t, "strong-pass")
	service := NewService(&serviceRepoStub{
		createUserFn: func(_ context.Context, input CreateUserInput) (UserRecord, error) {
			return UserRecord{
				ID:          "user-1",
				Email:       input.Email,
				DisplayName: input.DisplayName,
				Status:      string(model.UserStatusActive),
				Role:        string(model.UserRoleUser),
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			}, nil
		},
		getUserByEmailFn: func(_ context.Context, email string) (UserRecord, error) {
			return UserRecord{
				ID:           "user-1",
				Email:        email,
				DisplayName:  "User",
				PasswordHash: passwordHash,
				Status:       string(model.UserStatusActive),
				Role:         string(model.UserRoleUser),
				CreatedAt:    time.Now(),
				UpdatedAt:    time.Now(),
			}, nil
		},
		createSessionFn: func(_ context.Context, input CreateSessionInput) (SessionRecord, error) {
			if input.LoginMethod != "password" {
				t.Fatalf("expected register to create password login session, got %q", input.LoginMethod)
			}
			return SessionRecord{
				ID:          "session-1",
				UserID:      input.UserID,
				LoginMethod: input.LoginMethod,
				LastSeenAt:  time.Now(),
				ExpiresAt:   input.ExpiresAt,
				CreatedAt:   time.Now(),
			}, nil
		},
		revokeOtherSessionsFn: func(context.Context, string, string, time.Time) (int, error) {
			return 0, nil
		},
		getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
			return SessionRecord{ID: "session-1", UserID: "user-1"}, nil
		},
		updateLastLoginFn: func(context.Context, string, time.Time) error {
			return nil
		},
	}, time.Hour, nil)
	handler := NewHandler(service, "online_ssh_session", true, time.Hour, true)

	body := bytes.NewBufferString(`{"email":"user@example.com","password":"strong-pass","password_confirm":"strong-pass","display_name":"User"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", body)
	req.RemoteAddr = "203.0.113.10:4321"
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handler.Register(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	cookies := cookiesByName(recorder.Result().Cookies())
	if cookies["online_ssh_session"] == nil || cookies["online_ssh_session"].Value == "" {
		t.Fatalf("expected populated session cookie, got %#v", cookies)
	}
	if cookies["online_ssh_refresh"] == nil || cookies["online_ssh_refresh"].Value == "" {
		t.Fatalf("expected populated refresh cookie, got %#v", cookies)
	}
	var payload struct {
		User    model.User  `json:"user"`
		Session SessionInfo `json:"session"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if payload.User.Email != "user@example.com" || payload.Session.LoginMethod != "password" {
		t.Fatalf("expected user and password session in response, got %#v", payload)
	}
}

func TestHandlerEmailVerificationEndpoints(t *testing.T) {
	sender := &emailSenderStub{}
	service := NewServiceWithOptions(&serviceRepoStub{
		countEmailCodeSendsFn: func(context.Context, CountEmailVerificationCodeSendsInput) (int, error) {
			return 0, nil
		},
		createEmailCodeFn: func(_ context.Context, input CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
			return EmailVerificationCodeRecord{
				ID:          "code-1",
				Email:       input.Email,
				Purpose:     input.Purpose,
				CodeHash:    input.CodeHash,
				MaxAttempts: input.MaxAttempts,
				ExpiresAt:   input.ExpiresAt,
				CreatedAt:   time.Now(),
			}, nil
		},
	}, time.Hour, nil, ServiceOptions{
		AllowRegistration:       true,
		EmailSender:             sender,
		EmailCodeHashSecret:     "test-secret",
		AllowedEmailDomains:     []string{"example.com"},
		EmailCodeLength:         6,
		EmailCodeTTL:            5 * time.Minute,
		EmailCodeMaxAttempts:    5,
		EmailCodeResendCooldown: 60 * time.Second,
		EmailCodeEmailWindow:    15 * time.Minute,
		EmailCodeEmailMaxSends:  5,
		EmailCodeIPWindow:       15 * time.Minute,
		EmailCodeIPMaxSends:     10,
	})
	handler := NewHandler(service, "online_ssh_session", false, time.Hour, true)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/email-code/send", bytes.NewBufferString(`{"email":"USER@example.com","purpose":"register"}`))
	req.RemoteAddr = "203.0.113.10:4321"
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handler.SendEmailVerificationCode(recorder, req)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if len(sender.messages) != 1 || sender.messages[0].To != "user@example.com" {
		t.Fatalf("expected verification email to normalized recipient, got %#v", sender.messages)
	}
}

func TestHandlerEmailVerificationReturnsAccountDisabled(t *testing.T) {
	service := NewServiceWithOptions(&serviceRepoStub{
		getUserByEmailFn: func(_ context.Context, email string) (UserRecord, error) {
			return UserRecord{
				ID:        "user-disabled",
				Email:     email,
				Status:    string(model.UserStatusDisabled),
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}, nil
		},
		createEmailCodeFn: func(context.Context, CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
			t.Fatal("disabled user must not receive an email verification code")
			return EmailVerificationCodeRecord{}, nil
		},
	}, time.Hour, nil, ServiceOptions{
		AllowRegistration:   true,
		EmailSender:         &emailSenderStub{},
		EmailCodeHashSecret: "test-secret",
	})
	handler := NewHandler(service, "online_ssh_session", false, time.Hour, true)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/email-code/send", bytes.NewBufferString(`{"email":"disabled@example.com","purpose":"login"}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handler.SendEmailVerificationCode(recorder, req)

	assertAuthError(t, recorder, http.StatusForbidden, "ACCOUNT_DISABLED", "account is disabled")
}

func TestHandlerEmailCodeLoginSetsAuthCookies(t *testing.T) {
	refreshExpiresAt := time.Now().Add(24 * time.Hour)
	service := NewServiceWithOptions(&serviceRepoStub{
		getUserByEmailFn: func(_ context.Context, email string) (UserRecord, error) {
			return UserRecord{
				ID:          "user-1",
				Email:       email,
				DisplayName: "User",
				Status:      string(model.UserStatusActive),
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			}, nil
		},
		getLatestEmailCodeFn: func(_ context.Context, input GetLatestEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
			return EmailVerificationCodeRecord{
				ID:          "code-1",
				Email:       input.Email,
				Purpose:     input.Purpose,
				CodeHash:    hashEmailVerificationCode("test-secret", input.Email, input.Purpose, "123456"),
				MaxAttempts: 5,
				ExpiresAt:   time.Now().Add(time.Minute),
			}, nil
		},
		consumeEmailCodeFn: func(context.Context, string, time.Time) error {
			return nil
		},
		incrementEmailCodeAttempts: func(context.Context, string) error {
			return nil
		},
		createSessionFn: func(_ context.Context, input CreateSessionInput) (SessionRecord, error) {
			return SessionRecord{ID: "session-1", UserID: input.UserID, ExpiresAt: input.ExpiresAt, RefreshExpiresAt: &refreshExpiresAt}, nil
		},
		revokeOtherSessionsFn: func(context.Context, string, string, time.Time) (int, error) {
			return 0, nil
		},
		getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
			return SessionRecord{ID: "session-1", UserID: "user-1"}, nil
		},
		updateLastLoginFn: func(context.Context, string, time.Time) error {
			return nil
		},
	}, time.Hour, nil, ServiceOptions{
		AllowRegistration:   true,
		EmailCodeHashSecret: "test-secret",
		AllowedEmailDomains: []string{"example.com"},
	})
	handler := NewHandler(service, "online_ssh_session", true, time.Hour, true)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login/email-code", bytes.NewBufferString(`{"email":"user@example.com","verification_code":"123456"}`))
	req.RemoteAddr = "198.51.100.3:1234"
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handler.LoginWithEmailVerificationCode(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	cookies := cookiesByName(recorder.Result().Cookies())
	if cookies["online_ssh_session"] == nil || cookies["online_ssh_session"].Value == "" {
		t.Fatalf("expected populated session cookie, got %#v", cookies)
	}
	if cookies["online_ssh_refresh"] == nil || cookies["online_ssh_refresh"].Value == "" {
		t.Fatalf("expected populated refresh cookie, got %#v", cookies)
	}
}

func TestHandlerEmailCodeLoginReturnsAccountDisabled(t *testing.T) {
	service := NewServiceWithOptions(&serviceRepoStub{
		getUserByEmailFn: func(_ context.Context, email string) (UserRecord, error) {
			return UserRecord{
				ID:          "user-disabled",
				Email:       email,
				DisplayName: "Disabled User",
				Status:      string(model.UserStatusDisabled),
				CreatedAt:   time.Now(),
				UpdatedAt:   time.Now(),
			}, nil
		},
		getLatestEmailCodeFn: func(context.Context, GetLatestEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
			t.Fatal("disabled user login must not verify email code")
			return EmailVerificationCodeRecord{}, nil
		},
	}, time.Hour, nil, ServiceOptions{
		AllowRegistration:   true,
		EmailCodeHashSecret: "test-secret",
	})
	handler := NewHandler(service, "online_ssh_session", true, time.Hour, true)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login/email-code", bytes.NewBufferString(`{"email":"disabled@example.com","verification_code":"123456"}`))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handler.LoginWithEmailVerificationCode(recorder, req)

	assertAuthError(t, recorder, http.StatusForbidden, "ACCOUNT_DISABLED", "account is disabled")
	if cookies := cookiesByName(recorder.Result().Cookies()); cookies["online_ssh_session"] != nil || cookies["online_ssh_refresh"] != nil {
		t.Fatalf("disabled email-code login must not set auth cookies, got %#v", cookies)
	}
}

func TestHandlerSessionEndpointsRequireSession(t *testing.T) {
	handler := NewHandler(NewService(&serviceRepoStub{}, time.Hour, nil), "online_ssh_session", false, time.Hour, true)

	tests := []struct {
		name string
		call func(http.ResponseWriter, *http.Request)
	}{
		{
			name: "me returns unauthorized",
			call: handler.Me,
		},
		{
			name: "logout returns unauthorized",
			call: handler.Logout,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
			recorder := httptest.NewRecorder()

			tt.call(recorder, req)

			expectedStatus := http.StatusUnauthorized
			if tt.name == "logout returns unauthorized" {
				expectedStatus = http.StatusNoContent
			}
			if recorder.Code != expectedStatus {
				t.Fatalf("expected 401, got %d body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

func assertAuthError(t *testing.T, recorder *httptest.ResponseRecorder, status int, code string, message string) {
	t.Helper()
	if recorder.Code != status {
		t.Fatalf("expected %d, got %d body=%s", status, recorder.Code, recorder.Body.String())
	}
	var payload webutil.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Code != code || payload.Message != message {
		t.Fatalf("expected %s/%q error, got %#v", code, message, payload)
	}
}

func TestHandlerRefreshRotatesCookies(t *testing.T) {
	refreshExpiresAt := time.Now().Add(24 * time.Hour)
	var received RotateSessionInput
	service := NewService(&serviceRepoStub{
		rotateSessionByRefreshHash: func(_ context.Context, input RotateSessionInput) (SessionRecord, error) {
			received = input
			return SessionRecord{
				ID:               "session-1",
				UserID:           "user-1",
				SessionTokenHash: input.NewSessionTokenHash,
				RefreshTokenHash: &input.NewRefreshTokenHash,
				ExpiresAt:        input.ExpiresAt,
				RefreshExpiresAt: &refreshExpiresAt,
				User: UserRecord{
					ID:          "user-1",
					Email:       "user@example.com",
					DisplayName: "User",
					Status:      string(model.UserStatusActive),
					CreatedAt:   time.Now(),
					UpdatedAt:   time.Now(),
				},
			}, nil
		},
	}, time.Hour, nil)
	handler := NewHandler(service, "online_ssh_session", true, time.Hour, true)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	req.RemoteAddr = "198.51.100.9:5555"
	req.Header.Set("User-Agent", "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
	req.AddCookie(&http.Cookie{Name: "online_ssh_refresh", Value: "refresh-token"})
	recorder := httptest.NewRecorder()

	handler.Refresh(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	cookies := cookiesByName(recorder.Result().Cookies())
	if cookies["online_ssh_session"] == nil || cookies["online_ssh_session"].Value == "" {
		t.Fatalf("expected refreshed session cookie, got %#v", cookies)
	}
	if cookies["online_ssh_refresh"] == nil || cookies["online_ssh_refresh"].Value == "" {
		t.Fatalf("expected refreshed refresh cookie, got %#v", cookies)
	}
	if received.ClientIP == nil || *received.ClientIP != "198.51.100.9" {
		t.Fatalf("expected refresh client ip, got %#v", received.ClientIP)
	}
	if received.DeviceLabel == nil || *received.DeviceLabel != "Safari on iPadOS" {
		t.Fatalf("expected parsed refresh device label Safari on iPadOS, got %#v", received.DeviceLabel)
	}
}

func TestHandlerRefreshClearsCookiesWhenUnauthorized(t *testing.T) {
	handler := NewHandler(NewService(&serviceRepoStub{}, time.Hour, nil), "online_ssh_session", true, time.Hour, true)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", nil)
	recorder := httptest.NewRecorder()

	handler.Refresh(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	cookies := cookiesByName(recorder.Result().Cookies())
	if cookies["online_ssh_session"] == nil || cookies["online_ssh_session"].MaxAge != -1 {
		t.Fatalf("expected cleared session cookie, got %#v", cookies["online_ssh_session"])
	}
	if cookies["online_ssh_refresh"] == nil || cookies["online_ssh_refresh"].MaxAge != -1 {
		t.Fatalf("expected cleared refresh cookie, got %#v", cookies["online_ssh_refresh"])
	}
}

func TestHandlerConfigIncludesHostConnectivityPollInterval(t *testing.T) {
	handler := NewHandlerWithOptions(
		NewService(&serviceRepoStub{}, time.Hour, nil),
		"online_ssh_session",
		false,
		time.Hour,
		true,
		HandlerOptions{
			HostConnectivityPollInterval: 45 * time.Second,
			EmailCodeLength:              8,
		},
	)
	req := httptest.NewRequest(http.MethodGet, "/api/auth/config", nil)
	recorder := httptest.NewRecorder()

	handler.Config(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
	if payload["allow_registration"] != true {
		t.Fatalf("expected allow_registration true, got %#v", payload)
	}
	if payload["host_connectivity_poll_interval_seconds"] != float64(45) {
		t.Fatalf("expected host connectivity poll interval 45, got %#v", payload)
	}
	if payload["email_code_length"] != float64(8) {
		t.Fatalf("expected email code length 8, got %#v", payload)
	}
}

func TestHandlerLoginRejectsInvalidBody(t *testing.T) {
	handler := NewHandler(NewService(&serviceRepoStub{}, time.Hour, nil), "online_ssh_session", false, time.Hour, true)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBufferString(`{invalid`))
	recorder := httptest.NewRecorder()

	handler.Login(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func cookiesByName(cookies []*http.Cookie) map[string]*http.Cookie {
	items := make(map[string]*http.Cookie, len(cookies))
	for _, cookie := range cookies {
		items[cookie.Name] = cookie
	}
	return items
}
