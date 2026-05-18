package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

type auditCollector struct {
	logs []model.AuditLog
}

func (a *auditCollector) Record(_ context.Context, log model.AuditLog) error {
	a.logs = append(a.logs, log)
	return nil
}

func TestServiceRegisterLoginAuthenticateLogout(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	audit := &auditCollector{}
	service := NewServiceWithOptions(repo, 24*time.Hour, audit, ServiceOptions{
		AllowRegistration:   true,
		EmailCodeHashSecret: "test-secret",
	})
	ctx := context.Background()

	if _, err := repo.CreateEmailVerificationCode(ctx, CreateEmailVerificationCodeInput{
		Email:       "service@example.com",
		Purpose:     EmailVerificationPurposeRegister,
		CodeHash:    hashEmailVerificationCode("test-secret", "service@example.com", EmailVerificationPurposeRegister, "123456"),
		ExpiresAt:   time.Now().Add(5 * time.Minute),
		MaxAttempts: 5,
	}); err != nil {
		t.Fatalf("create register verification code: %v", err)
	}

	registeredUser, err := service.Register(ctx, RegisterInput{
		Email:            "service@example.com",
		Password:         "strong-pass-123",
		PasswordConfirm:  "strong-pass-123",
		DisplayName:      "Service User",
		VerificationCode: "123456",
	})
	if err != nil {
		t.Fatalf("register user: %v", err)
	}

	loginResult, err := service.Login(ctx, LoginInput{
		Email:     "service@example.com",
		Password:  "strong-pass-123",
		ClientIP:  "127.0.0.1",
		UserAgent: "integration-test",
	})
	if err != nil {
		t.Fatalf("login user: %v", err)
	}
	if loginResult.User.ID != registeredUser.ID {
		t.Fatalf("expected user id %s, got %s", registeredUser.ID, loginResult.User.ID)
	}
	if loginResult.SessionToken == "" {
		t.Fatal("expected session token")
	}
	if loginResult.RefreshToken == "" {
		t.Fatal("expected refresh token")
	}

	session, err := service.Authenticate(ctx, loginResult.SessionToken)
	if err != nil {
		t.Fatalf("authenticate session: %v", err)
	}
	if session.UserID != registeredUser.ID {
		t.Fatalf("expected authenticated user %s, got %s", registeredUser.ID, session.UserID)
	}

	refreshResult, err := service.Refresh(ctx, loginResult.RefreshToken)
	if err != nil {
		t.Fatalf("refresh session: %v", err)
	}
	if refreshResult.SessionToken == "" || refreshResult.RefreshToken == "" {
		t.Fatalf("expected refreshed tokens, got %#v", refreshResult)
	}
	if refreshResult.SessionToken == loginResult.SessionToken {
		t.Fatal("expected session token rotation")
	}
	if refreshResult.RefreshToken == loginResult.RefreshToken {
		t.Fatal("expected refresh token rotation")
	}

	_, err = service.Refresh(ctx, loginResult.RefreshToken)
	if err != ErrUnauthorized {
		t.Fatalf("expected old refresh token unauthorized, got %v", err)
	}

	secondLoginResult, err := service.Login(ctx, LoginInput{
		Email:     "service@example.com",
		Password:  "strong-pass-123",
		ClientIP:  "203.0.113.8",
		UserAgent: "second-device",
	})
	if err != nil {
		t.Fatalf("login from second device: %v", err)
	}
	if secondLoginResult.SessionToken == "" || secondLoginResult.RefreshToken == "" {
		t.Fatalf("expected second login tokens, got %#v", secondLoginResult)
	}
	_, err = service.Authenticate(ctx, refreshResult.SessionToken)
	if !errors.Is(err, ErrSessionRevoked) {
		t.Fatalf("expected first device session revoked after second login, got %v", err)
	}
	_, err = service.Refresh(ctx, refreshResult.RefreshToken)
	if err != ErrUnauthorized {
		t.Fatalf("expected first device refresh unauthorized after second login, got %v", err)
	}

	secondSession, err := service.Authenticate(ctx, secondLoginResult.SessionToken)
	if err != nil {
		t.Fatalf("authenticate second login session: %v", err)
	}

	refreshedSession, err := service.Authenticate(ctx, refreshResult.SessionToken)
	if err == nil {
		t.Fatalf("expected refreshed first session to stay revoked, got %#v", refreshedSession)
	}

	if err := service.Logout(ctx, secondSession); err != nil {
		t.Fatalf("logout session: %v", err)
	}

	_, err = service.Authenticate(ctx, secondLoginResult.SessionToken)
	if !errors.Is(err, ErrSessionRevoked) {
		t.Fatalf("expected unauthorized after logout, got %v", err)
	}

	if len(audit.logs) != 6 {
		t.Fatalf("expected 6 audit logs, got %d", len(audit.logs))
	}
	if audit.logs[0].EventType != "auth_register" {
		t.Fatalf("expected first audit event auth_register, got %s", audit.logs[0].EventType)
	}
	if audit.logs[1].EventType != "auth_login" {
		t.Fatalf("expected second audit event auth_login, got %s", audit.logs[1].EventType)
	}
	if audit.logs[2].EventType != "auth_refresh" {
		t.Fatalf("expected third audit event auth_refresh, got %s", audit.logs[2].EventType)
	}
	if audit.logs[3].EventType != "auth_login" {
		t.Fatalf("expected fourth audit event auth_login, got %s", audit.logs[3].EventType)
	}
	if audit.logs[4].EventType != "admin_user_kicked" {
		t.Fatalf("expected fifth audit event admin_user_kicked, got %s", audit.logs[4].EventType)
	}
	if audit.logs[5].EventType != "auth_logout" {
		t.Fatalf("expected sixth audit event auth_logout, got %s", audit.logs[5].EventType)
	}
}
