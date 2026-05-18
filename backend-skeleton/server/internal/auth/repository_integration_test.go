package auth

import (
	"context"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

func TestPostgresRepositorySessionLifecycle(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	user, err := repo.CreateUser(ctx, CreateUserInput{
		Email:        "repo@example.com",
		PasswordHash: "hashed-password",
		DisplayName:  "Repo User",
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	loadedUser, err := repo.GetUserByEmail(ctx, user.Email)
	if err != nil {
		t.Fatalf("get user by email: %v", err)
	}
	if loadedUser.ID != user.ID {
		t.Fatalf("expected loaded user %s, got %s", user.ID, loadedUser.ID)
	}

	otherSession, err := repo.CreateSession(ctx, CreateSessionInput{
		UserID:           user.ID,
		SessionTokenHash: "other-token-hash",
		RefreshTokenHash: stringRef("other-refresh-hash"),
		ExpiresAt:        time.Now().Add(time.Hour),
		RefreshExpiresAt: timeRef(time.Now().Add(24 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("create other session: %v", err)
	}
	session, err := repo.CreateSession(ctx, CreateSessionInput{
		UserID:           user.ID,
		SessionTokenHash: "token-hash",
		RefreshTokenHash: stringRef("refresh-hash"),
		ClientIP:         stringRef("127.0.0.1"),
		UserAgent:        stringRef("integration-test"),
		DeviceLabel:      stringRef("Unknown browser on Unknown OS"),
		ExpiresAt:        time.Now().Add(time.Hour),
		RefreshExpiresAt: timeRef(time.Now().Add(24 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	laterSession, err := repo.CreateSession(ctx, CreateSessionInput{
		UserID:           user.ID,
		SessionTokenHash: "later-token-hash",
		RefreshTokenHash: stringRef("later-refresh-hash"),
		ExpiresAt:        time.Now().Add(time.Hour),
		RefreshExpiresAt: timeRef(time.Now().Add(24 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("create later session: %v", err)
	}

	activeSession, err := repo.GetActiveSessionByTokenHash(ctx, "token-hash", time.Now())
	if err != nil {
		t.Fatalf("get active session: %v", err)
	}
	if activeSession.ID != session.ID {
		t.Fatalf("expected session %s, got %s", session.ID, activeSession.ID)
	}
	if activeSession.User.Email != user.Email {
		t.Fatalf("expected user email %s, got %s", user.Email, activeSession.User.Email)
	}
	if activeSession.RefreshTokenHash == nil || *activeSession.RefreshTokenHash != "refresh-hash" {
		t.Fatalf("expected refresh hash, got %#v", activeSession.RefreshTokenHash)
	}
	if activeSession.DeviceLabel == nil || *activeSession.DeviceLabel != "Unknown browser on Unknown OS" {
		t.Fatalf("expected stored device label, got %#v", activeSession.DeviceLabel)
	}
	revokedCount, err := repo.RevokeOtherSessions(ctx, user.ID, session.ID, time.Now())
	if err != nil {
		t.Fatalf("revoke other sessions: %v", err)
	}
	if revokedCount != 1 {
		t.Fatalf("expected one older other session revoked, got %d", revokedCount)
	}
	_, err = repo.GetActiveSessionByTokenHash(ctx, "other-token-hash", time.Now())
	if !db.IsNotFound(err) {
		t.Fatalf("expected other session %s to be not found after revoke, got %v", otherSession.ID, err)
	}
	if _, err := repo.GetActiveSessionByTokenHash(ctx, "later-token-hash", time.Now()); err != nil {
		t.Fatalf("expected later session %s to remain active, got %v", laterSession.ID, err)
	}
	if _, err := repo.RotateSessionByRefreshTokenHash(ctx, RotateSessionInput{
		RefreshTokenHash:    "other-refresh-hash",
		NewSessionTokenHash: "other-new-token-hash",
		NewRefreshTokenHash: "other-new-refresh-hash",
		ExpiresAt:           time.Now().Add(30 * time.Minute),
		IdleSince:           time.Now().Add(-2 * time.Hour),
		Now:                 time.Now(),
	}); !db.IsNotFound(err) {
		t.Fatalf("expected revoked other refresh token to be not found, got %v", err)
	}

	rotated, err := repo.RotateSessionByRefreshTokenHash(ctx, RotateSessionInput{
		RefreshTokenHash:    "refresh-hash",
		NewSessionTokenHash: "new-token-hash",
		NewRefreshTokenHash: "new-refresh-hash",
		UserAgent:           stringRef("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"),
		DeviceLabel:         stringRef("Firefox on Linux"),
		ExpiresAt:           time.Now().Add(30 * time.Minute),
		IdleSince:           time.Now().Add(-2 * time.Hour),
		Now:                 time.Now(),
	})
	if err != nil {
		t.Fatalf("rotate session: %v", err)
	}
	if rotated.ID != session.ID {
		t.Fatalf("expected rotated session %s, got %s", session.ID, rotated.ID)
	}
	if rotated.SessionTokenHash != "new-token-hash" {
		t.Fatalf("expected rotated session token hash, got %q", rotated.SessionTokenHash)
	}
	if rotated.RefreshTokenHash == nil || *rotated.RefreshTokenHash != "new-refresh-hash" {
		t.Fatalf("expected rotated refresh hash, got %#v", rotated.RefreshTokenHash)
	}
	if rotated.DeviceLabel == nil || *rotated.DeviceLabel != "Firefox on Linux" {
		t.Fatalf("expected rotated device label, got %#v", rotated.DeviceLabel)
	}

	_, err = repo.RotateSessionByRefreshTokenHash(ctx, RotateSessionInput{
		RefreshTokenHash:    "refresh-hash",
		NewSessionTokenHash: "stale-session-hash",
		NewRefreshTokenHash: "stale-refresh-hash",
		ExpiresAt:           time.Now().Add(30 * time.Minute),
		IdleSince:           time.Now().Add(-2 * time.Hour),
		Now:                 time.Now(),
	})
	if !db.IsNotFound(err) {
		t.Fatalf("expected old refresh token to be not found, got %v", err)
	}

	idleSession, err := repo.CreateSession(ctx, CreateSessionInput{
		UserID:           user.ID,
		SessionTokenHash: "idle-token-hash",
		RefreshTokenHash: stringRef("idle-refresh-hash"),
		ExpiresAt:        time.Now().Add(time.Hour),
		RefreshExpiresAt: timeRef(time.Now().Add(24 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("create idle session: %v", err)
	}
	_, err = repo.RotateSessionByRefreshTokenHash(ctx, RotateSessionInput{
		RefreshTokenHash:    "idle-refresh-hash",
		NewSessionTokenHash: "idle-new-token-hash",
		NewRefreshTokenHash: "idle-new-refresh-hash",
		ExpiresAt:           time.Now().Add(30 * time.Minute),
		IdleSince:           time.Now().Add(time.Minute),
		Now:                 time.Now(),
	})
	if !db.IsNotFound(err) {
		t.Fatalf("expected idle session %s to be not found, got %v", idleSession.ID, err)
	}

	now := time.Now()
	if err := repo.UpdateLastLogin(ctx, user.ID, now); err != nil {
		t.Fatalf("update last login: %v", err)
	}

	updatedUser, err := repo.GetUserByEmail(ctx, user.Email)
	if err != nil {
		t.Fatalf("reload user after last_login update: %v", err)
	}
	if updatedUser.LastLoginAt == nil {
		t.Fatal("expected last_login_at to be set")
	}

	if err := repo.RevokeSession(ctx, session.ID, time.Now()); err != nil {
		t.Fatalf("revoke session: %v", err)
	}

	_, err = repo.GetActiveSessionByTokenHash(ctx, "new-token-hash", time.Now())
	if !db.IsNotFound(err) {
		t.Fatalf("expected revoked session to be not found, got %v", err)
	}
	revokedSession, err := repo.GetSessionByTokenHash(ctx, "new-token-hash")
	if err != nil {
		t.Fatalf("load revoked session by token hash: %v", err)
	}
	if revokedSession.RevokedAt == nil {
		t.Fatal("expected revoked session reason lookup to include revoked_at")
	}
}

func TestPostgresRepositoryEmailVerificationCodeLifecycle(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()
	now := time.Now()

	record, err := repo.CreateEmailVerificationCode(ctx, CreateEmailVerificationCodeInput{
		Email:       "user@example.com",
		Purpose:     EmailVerificationPurposeRegister,
		CodeHash:    "hashed-code",
		ClientIP:    stringRef("203.0.113.8"),
		ExpiresAt:   now.Add(5 * time.Minute),
		MaxAttempts: 5,
	})
	if err != nil {
		t.Fatalf("create email verification code: %v", err)
	}
	if record.CodeHash != "hashed-code" {
		t.Fatalf("expected stored hash, got %q", record.CodeHash)
	}

	count, err := repo.CountEmailVerificationCodeSends(ctx, CountEmailVerificationCodeSendsInput{
		Email: "user@example.com",
		Since: now.Add(-time.Minute),
	})
	if err != nil {
		t.Fatalf("count email sends: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one email send, got %d", count)
	}
	ipCount, err := repo.CountEmailVerificationCodeSends(ctx, CountEmailVerificationCodeSendsInput{
		ClientIP: stringRef("203.0.113.8"),
		Since:    now.Add(-time.Minute),
	})
	if err != nil {
		t.Fatalf("count ip sends: %v", err)
	}
	if ipCount != 1 {
		t.Fatalf("expected one IP send, got %d", ipCount)
	}

	latest, err := repo.GetLatestEmailVerificationCode(ctx, GetLatestEmailVerificationCodeInput{
		Email:   "user@example.com",
		Purpose: EmailVerificationPurposeRegister,
		Now:     now,
	})
	if err != nil {
		t.Fatalf("get latest email verification code: %v", err)
	}
	if latest.ID != record.ID {
		t.Fatalf("expected latest code %s, got %s", record.ID, latest.ID)
	}

	if err := repo.IncrementEmailVerificationCodeAttempts(ctx, record.ID); err != nil {
		t.Fatalf("increment attempts: %v", err)
	}
	latest, err = repo.GetLatestEmailVerificationCode(ctx, GetLatestEmailVerificationCodeInput{
		Email:   "user@example.com",
		Purpose: EmailVerificationPurposeRegister,
		Now:     now,
	})
	if err != nil {
		t.Fatalf("reload latest email verification code: %v", err)
	}
	if latest.Attempts != 1 {
		t.Fatalf("expected attempts incremented, got %d", latest.Attempts)
	}

	if err := repo.ConsumeEmailVerificationCode(ctx, record.ID, now); err != nil {
		t.Fatalf("consume email verification code: %v", err)
	}
	_, err = repo.GetLatestEmailVerificationCode(ctx, GetLatestEmailVerificationCodeInput{
		Email:   "user@example.com",
		Purpose: EmailVerificationPurposeRegister,
		Now:     now,
	})
	if !db.IsNotFound(err) {
		t.Fatalf("expected consumed code to be unavailable, got %v", err)
	}
}

func stringRef(value string) *string {
	return &value
}

func timeRef(value time.Time) *time.Time {
	return &value
}
