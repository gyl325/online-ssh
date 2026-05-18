package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/settings"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

type serviceRepoStub struct {
	createUserFn                  func(context.Context, CreateUserInput) (UserRecord, error)
	getUserByIDFn                 func(context.Context, string) (UserRecord, error)
	getUserByEmailFn              func(context.Context, string) (UserRecord, error)
	getUserByLoginIdentifierFn    func(context.Context, string) (UserRecord, error)
	updateUserPasswordFn          func(context.Context, string, string) error
	updateUserEmailFn             func(context.Context, string, string) (UserRecord, error)
	deleteUserFn                  func(context.Context, string) error
	countUsersWithPermissionFn    func(context.Context, string) (int, error)
	updateLastLoginFn             func(context.Context, string, time.Time) error
	createSessionFn               func(context.Context, CreateSessionInput) (SessionRecord, error)
	getActiveSessionByTokenHash   func(context.Context, string, time.Time) (SessionRecord, error)
	getSessionByTokenHash         func(context.Context, string) (SessionRecord, error)
	rotateSessionByRefreshHash    func(context.Context, RotateSessionInput) (SessionRecord, error)
	revokeSessionFn               func(context.Context, string, time.Time) error
	revokeOtherSessionsFn         func(context.Context, string, string, time.Time) (int, error)
	revokeSessionByRefreshHash    func(context.Context, string, time.Time) (SessionRecord, error)
	createEmailCodeFn             func(context.Context, CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error)
	countEmailCodeSendsFn         func(context.Context, CountEmailVerificationCodeSendsInput) (int, error)
	getLatestEmailCodeFn          func(context.Context, GetLatestEmailVerificationCodeInput) (EmailVerificationCodeRecord, error)
	incrementEmailCodeAttempts    func(context.Context, string) error
	consumeEmailCodeFn            func(context.Context, string, time.Time) error
	getMFASettingsFn              func(context.Context, string) (MFASettingsRecord, error)
	savePendingTOTPSecretFn       func(context.Context, SavePendingTOTPSecretInput) error
	enableMFAFn                   func(context.Context, EnableMFAInput, []CreateMFARecoveryCodeInput) error
	disableMFAFn                  func(context.Context, string) error
	replaceMFARecoveryCodesFn     func(context.Context, string, []CreateMFARecoveryCodeInput) error
	countUnusedMFARecoveryCodesFn func(context.Context, string) (int, error)
	listUnusedMFARecoveryCodesFn  func(context.Context, string) ([]MFARecoveryCodeRecord, error)
	consumeMFARecoveryCodeFn      func(context.Context, string, time.Time) error
	markMFAUsedFn                 func(context.Context, string, time.Time) error
	createMFATokenFn              func(context.Context, CreateMFATokenInput) (MFATokenRecord, error)
	getMFATokenByHashFn           func(context.Context, string, time.Time) (MFATokenRecord, error)
	incrementMFATokenAttemptsFn   func(context.Context, string) error
	consumeMFATokenFn             func(context.Context, string, time.Time) error
	countRecentMFAFailuresFn      func(context.Context, CountRecentMFAFailuresInput) (int, error)
}

func (s *serviceRepoStub) CreateUser(ctx context.Context, input CreateUserInput) (UserRecord, error) {
	if s.createUserFn == nil {
		return UserRecord{}, errors.New("unexpected CreateUser call")
	}
	return s.createUserFn(ctx, input)
}

func (s *serviceRepoStub) GetUserByID(ctx context.Context, userID string) (UserRecord, error) {
	if s.getUserByIDFn == nil {
		return UserRecord{}, errors.New("unexpected GetUserByID call")
	}
	return s.getUserByIDFn(ctx, userID)
}

func (s *serviceRepoStub) GetUserByEmail(ctx context.Context, email string) (UserRecord, error) {
	if s.getUserByEmailFn == nil {
		return UserRecord{}, errors.New("unexpected GetUserByEmail call")
	}
	return s.getUserByEmailFn(ctx, email)
}

func (s *serviceRepoStub) GetUserByLoginIdentifier(ctx context.Context, identifier string) (UserRecord, error) {
	if s.getUserByLoginIdentifierFn != nil {
		return s.getUserByLoginIdentifierFn(ctx, identifier)
	}
	if s.getUserByEmailFn != nil {
		return s.getUserByEmailFn(ctx, identifier)
	}
	return UserRecord{}, errors.New("unexpected GetUserByLoginIdentifier call")
}

func (s *serviceRepoStub) UpdateUserPassword(ctx context.Context, userID string, passwordHash string) error {
	if s.updateUserPasswordFn == nil {
		return errors.New("unexpected UpdateUserPassword call")
	}
	return s.updateUserPasswordFn(ctx, userID, passwordHash)
}

func (s *serviceRepoStub) UpdateUserEmail(ctx context.Context, userID string, email string) (UserRecord, error) {
	if s.updateUserEmailFn == nil {
		return UserRecord{}, errors.New("unexpected UpdateUserEmail call")
	}
	return s.updateUserEmailFn(ctx, userID, email)
}

func (s *serviceRepoStub) DeleteUser(ctx context.Context, userID string) error {
	if s.deleteUserFn == nil {
		return errors.New("unexpected DeleteUser call")
	}
	return s.deleteUserFn(ctx, userID)
}

func (s *serviceRepoStub) CountUsersWithPermission(ctx context.Context, permission string) (int, error) {
	if s.countUsersWithPermissionFn == nil {
		return 0, errors.New("unexpected CountUsersWithPermission call")
	}
	return s.countUsersWithPermissionFn(ctx, permission)
}

func (s *serviceRepoStub) UpdateLastLogin(ctx context.Context, userID string, at time.Time) error {
	if s.updateLastLoginFn == nil {
		return errors.New("unexpected UpdateLastLogin call")
	}
	return s.updateLastLoginFn(ctx, userID, at)
}

func (s *serviceRepoStub) CreateSession(ctx context.Context, input CreateSessionInput) (SessionRecord, error) {
	if s.createSessionFn == nil {
		return SessionRecord{}, errors.New("unexpected CreateSession call")
	}
	return s.createSessionFn(ctx, input)
}

func (s *serviceRepoStub) GetActiveSessionByTokenHash(ctx context.Context, tokenHash string, now time.Time) (SessionRecord, error) {
	if s.getActiveSessionByTokenHash == nil {
		return SessionRecord{}, errors.New("unexpected GetActiveSessionByTokenHash call")
	}
	return s.getActiveSessionByTokenHash(ctx, tokenHash, now)
}

func (s *serviceRepoStub) GetSessionByTokenHash(ctx context.Context, tokenHash string) (SessionRecord, error) {
	if s.getSessionByTokenHash == nil {
		return SessionRecord{}, errors.New("unexpected GetSessionByTokenHash call")
	}
	return s.getSessionByTokenHash(ctx, tokenHash)
}

func (s *serviceRepoStub) RotateSessionByRefreshTokenHash(ctx context.Context, input RotateSessionInput) (SessionRecord, error) {
	if s.rotateSessionByRefreshHash == nil {
		return SessionRecord{}, errors.New("unexpected RotateSessionByRefreshTokenHash call")
	}
	return s.rotateSessionByRefreshHash(ctx, input)
}

func (s *serviceRepoStub) RevokeSession(ctx context.Context, sessionID string, revokedAt time.Time) error {
	if s.revokeSessionFn == nil {
		return errors.New("unexpected RevokeSession call")
	}
	return s.revokeSessionFn(ctx, sessionID, revokedAt)
}

func (s *serviceRepoStub) RevokeOtherSessions(ctx context.Context, userID string, keepSessionID string, revokedAt time.Time) (int, error) {
	if s.revokeOtherSessionsFn == nil {
		return 0, errors.New("unexpected RevokeOtherSessions call")
	}
	return s.revokeOtherSessionsFn(ctx, userID, keepSessionID, revokedAt)
}

func (s *serviceRepoStub) RevokeSessionByRefreshTokenHash(ctx context.Context, refreshTokenHash string, revokedAt time.Time) (SessionRecord, error) {
	if s.revokeSessionByRefreshHash == nil {
		return SessionRecord{}, errors.New("unexpected RevokeSessionByRefreshTokenHash call")
	}
	return s.revokeSessionByRefreshHash(ctx, refreshTokenHash, revokedAt)
}

func (s *serviceRepoStub) CreateEmailVerificationCode(ctx context.Context, input CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
	if s.createEmailCodeFn == nil {
		return EmailVerificationCodeRecord{}, errors.New("unexpected CreateEmailVerificationCode call")
	}
	return s.createEmailCodeFn(ctx, input)
}

func (s *serviceRepoStub) CountEmailVerificationCodeSends(ctx context.Context, input CountEmailVerificationCodeSendsInput) (int, error) {
	if s.countEmailCodeSendsFn == nil {
		return 0, errors.New("unexpected CountEmailVerificationCodeSends call")
	}
	return s.countEmailCodeSendsFn(ctx, input)
}

func (s *serviceRepoStub) GetLatestEmailVerificationCode(ctx context.Context, input GetLatestEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
	if s.getLatestEmailCodeFn == nil {
		return EmailVerificationCodeRecord{}, errors.New("unexpected GetLatestEmailVerificationCode call")
	}
	return s.getLatestEmailCodeFn(ctx, input)
}

func (s *serviceRepoStub) IncrementEmailVerificationCodeAttempts(ctx context.Context, id string) error {
	if s.incrementEmailCodeAttempts == nil {
		return errors.New("unexpected IncrementEmailVerificationCodeAttempts call")
	}
	return s.incrementEmailCodeAttempts(ctx, id)
}

func (s *serviceRepoStub) ConsumeEmailVerificationCode(ctx context.Context, id string, consumedAt time.Time) error {
	if s.consumeEmailCodeFn == nil {
		return errors.New("unexpected ConsumeEmailVerificationCode call")
	}
	return s.consumeEmailCodeFn(ctx, id, consumedAt)
}

func (s *serviceRepoStub) GetMFASettings(ctx context.Context, userID string) (MFASettingsRecord, error) {
	if s.getMFASettingsFn == nil {
		return MFASettingsRecord{}, db.ErrNotFound
	}
	return s.getMFASettingsFn(ctx, userID)
}

func (s *serviceRepoStub) SavePendingTOTPSecret(ctx context.Context, input SavePendingTOTPSecretInput) error {
	if s.savePendingTOTPSecretFn == nil {
		return errors.New("unexpected SavePendingTOTPSecret call")
	}
	return s.savePendingTOTPSecretFn(ctx, input)
}

func (s *serviceRepoStub) EnableMFA(ctx context.Context, input EnableMFAInput, codes []CreateMFARecoveryCodeInput) error {
	if s.enableMFAFn == nil {
		return errors.New("unexpected EnableMFA call")
	}
	return s.enableMFAFn(ctx, input, codes)
}

func (s *serviceRepoStub) DisableMFA(ctx context.Context, userID string) error {
	if s.disableMFAFn == nil {
		return errors.New("unexpected DisableMFA call")
	}
	return s.disableMFAFn(ctx, userID)
}

func (s *serviceRepoStub) ReplaceMFARecoveryCodes(ctx context.Context, userID string, codes []CreateMFARecoveryCodeInput) error {
	if s.replaceMFARecoveryCodesFn == nil {
		return errors.New("unexpected ReplaceMFARecoveryCodes call")
	}
	return s.replaceMFARecoveryCodesFn(ctx, userID, codes)
}

func (s *serviceRepoStub) CountUnusedMFARecoveryCodes(ctx context.Context, userID string) (int, error) {
	if s.countUnusedMFARecoveryCodesFn == nil {
		return 0, errors.New("unexpected CountUnusedMFARecoveryCodes call")
	}
	return s.countUnusedMFARecoveryCodesFn(ctx, userID)
}

func (s *serviceRepoStub) ListUnusedMFARecoveryCodes(ctx context.Context, userID string) ([]MFARecoveryCodeRecord, error) {
	if s.listUnusedMFARecoveryCodesFn == nil {
		return nil, errors.New("unexpected ListUnusedMFARecoveryCodes call")
	}
	return s.listUnusedMFARecoveryCodesFn(ctx, userID)
}

func (s *serviceRepoStub) ConsumeMFARecoveryCode(ctx context.Context, id string, usedAt time.Time) error {
	if s.consumeMFARecoveryCodeFn == nil {
		return errors.New("unexpected ConsumeMFARecoveryCode call")
	}
	return s.consumeMFARecoveryCodeFn(ctx, id, usedAt)
}

func (s *serviceRepoStub) MarkMFAUsed(ctx context.Context, userID string, usedAt time.Time) error {
	if s.markMFAUsedFn == nil {
		return errors.New("unexpected MarkMFAUsed call")
	}
	return s.markMFAUsedFn(ctx, userID, usedAt)
}

func (s *serviceRepoStub) CreateMFAToken(ctx context.Context, input CreateMFATokenInput) (MFATokenRecord, error) {
	if s.createMFATokenFn == nil {
		return MFATokenRecord{}, errors.New("unexpected CreateMFAToken call")
	}
	return s.createMFATokenFn(ctx, input)
}

func (s *serviceRepoStub) GetMFATokenByHash(ctx context.Context, tokenHash string, now time.Time) (MFATokenRecord, error) {
	if s.getMFATokenByHashFn == nil {
		return MFATokenRecord{}, errors.New("unexpected GetMFATokenByHash call")
	}
	return s.getMFATokenByHashFn(ctx, tokenHash, now)
}

func (s *serviceRepoStub) IncrementMFATokenAttempts(ctx context.Context, id string) error {
	if s.incrementMFATokenAttemptsFn == nil {
		return errors.New("unexpected IncrementMFATokenAttempts call")
	}
	return s.incrementMFATokenAttemptsFn(ctx, id)
}

func (s *serviceRepoStub) ConsumeMFAToken(ctx context.Context, id string, consumedAt time.Time) error {
	if s.consumeMFATokenFn == nil {
		return errors.New("unexpected ConsumeMFAToken call")
	}
	return s.consumeMFATokenFn(ctx, id, consumedAt)
}

func (s *serviceRepoStub) CountRecentMFAFailures(ctx context.Context, input CountRecentMFAFailuresInput) (int, error) {
	if s.countRecentMFAFailuresFn == nil {
		return 0, errors.New("unexpected CountRecentMFAFailures call")
	}
	return s.countRecentMFAFailuresFn(ctx, input)
}

func TestServiceAccountSecurity(t *testing.T) {
	ctx := context.Background()
	passwordHash := mustPasswordHash(t, "current-pass")

	t.Run("changes password after verifying current password and revokes other sessions", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		var updatedHash string
		var revokedUserID string
		var keptSessionID string
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByIDFn: func(_ context.Context, userID string) (UserRecord, error) {
				if userID != "user-1" {
					t.Fatalf("unexpected user lookup %q", userID)
				}
				return UserRecord{
					ID:           userID,
					Email:        "user@example.com",
					DisplayName:  "User",
					PasswordHash: passwordHash,
					Status:       string(model.UserStatusActive),
					Role:         string(model.UserRoleUser),
				}, nil
			},
			updateUserPasswordFn: func(_ context.Context, userID string, passwordHash string) error {
				if userID != "user-1" {
					t.Fatalf("unexpected password update user %q", userID)
				}
				updatedHash = passwordHash
				return nil
			},
			revokeOtherSessionsFn: func(_ context.Context, userID string, keepSession string, _ time.Time) (int, error) {
				revokedUserID = userID
				keptSessionID = keepSession
				return 2, nil
			},
		}, time.Hour, recorder, ServiceOptions{AllowRegistration: true})

		result, err := service.ChangePassword(ctx, AuthenticatedSession{SessionID: "session-1", UserID: "user-1"}, ChangePasswordInput{
			CurrentPassword: "current-pass",
			NewPassword:     "next-password",
		})
		if err != nil {
			t.Fatalf("change password: %v", err)
		}
		if result.RevokedSessionCount != 2 || revokedUserID != "user-1" || keptSessionID != "session-1" {
			t.Fatalf("expected other sessions revoked, result=%#v user=%q keep=%q", result, revokedUserID, keptSessionID)
		}
		if updatedHash == "" || bcrypt.CompareHashAndPassword([]byte(updatedHash), []byte("next-password")) != nil {
			t.Fatalf("expected stored hash to match new password")
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "account_password_changed" {
			t.Fatalf("expected account_password_changed audit log, got %#v", recorder.logs)
		}
	})

	t.Run("rejects password change when new password matches current password", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByIDFn: func(_ context.Context, userID string) (UserRecord, error) {
				return UserRecord{
					ID:           userID,
					Email:        "user@example.com",
					DisplayName:  "User",
					PasswordHash: passwordHash,
					Status:       string(model.UserStatusActive),
					Role:         string(model.UserRoleUser),
				}, nil
			},
			updateUserPasswordFn: func(context.Context, string, string) error {
				t.Fatal("password should not be updated when the new password matches the current password")
				return nil
			},
		}, time.Hour, nil, ServiceOptions{AllowRegistration: true})

		_, err := service.ChangePassword(ctx, AuthenticatedSession{SessionID: "session-1", UserID: "user-1"}, ChangePasswordInput{
			CurrentPassword: "current-pass",
			NewPassword:     "current-pass",
		})
		if !errors.Is(err, ErrPasswordUnchanged) {
			t.Fatalf("expected ErrPasswordUnchanged, got %v", err)
		}
	})

	t.Run("changes email only after old and new email codes verify without applying registration whitelist", func(t *testing.T) {
		consumed := make([]string, 0, 2)
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByIDFn: func(_ context.Context, userID string) (UserRecord, error) {
				return UserRecord{
					ID:           userID,
					Email:        "old@example.com",
					DisplayName:  "User",
					PasswordHash: passwordHash,
					Status:       string(model.UserStatusActive),
					Role:         string(model.UserRoleUser),
				}, nil
			},
			getUserByEmailFn: func(_ context.Context, email string) (UserRecord, error) {
				if email == "new@gmail.com" {
					return UserRecord{}, db.ErrNotFound
				}
				return UserRecord{ID: "other-user", Email: email}, nil
			},
			getLatestEmailCodeFn: func(_ context.Context, input GetLatestEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
				code := "111111"
				id := "old-code"
				if input.Email == "new@gmail.com" {
					code = "222222"
					id = "new-code"
				}
				return EmailVerificationCodeRecord{
					ID:          id,
					Email:       input.Email,
					Purpose:     input.Purpose,
					CodeHash:    hashEmailVerificationCode("test-secret", input.Email, input.Purpose, code),
					MaxAttempts: 5,
					ExpiresAt:   time.Now().Add(time.Minute),
				}, nil
			},
			consumeEmailCodeFn: func(_ context.Context, id string, _ time.Time) error {
				consumed = append(consumed, id)
				return nil
			},
			updateUserEmailFn: func(_ context.Context, userID string, email string) (UserRecord, error) {
				return UserRecord{
					ID:          userID,
					Email:       email,
					DisplayName: "User",
					Status:      string(model.UserStatusActive),
					Role:        string(model.UserRoleUser),
					CreatedAt:   time.Now(),
					UpdatedAt:   time.Now(),
				}, nil
			},
		}, time.Hour, nil, ServiceOptions{
			AllowRegistration:   true,
			EmailCodeHashSecret: "test-secret",
			AllowedEmailDomains: []string{"qq.com"},
		})

		user, err := service.ChangeEmail(ctx, AuthenticatedSession{SessionID: "session-1", UserID: "user-1"}, ChangeEmailInput{
			CurrentEmailCode: "111111",
			NewEmail:         "NEW@gmail.com",
			NewEmailCode:     "222222",
		})
		if err != nil {
			t.Fatalf("change email: %v", err)
		}
		if user.Email != "new@gmail.com" {
			t.Fatalf("expected normalized new email, got %#v", user)
		}
		if !slices.Equal(consumed, []string{"old-code", "new-code"}) {
			t.Fatalf("expected both codes consumed after verification, got %#v", consumed)
		}
	})

	t.Run("deletes account after password verification", func(t *testing.T) {
		var deletedUserID string
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByIDFn: func(_ context.Context, userID string) (UserRecord, error) {
				return UserRecord{
					ID:           userID,
					Email:        "user@example.com",
					DisplayName:  "User",
					PasswordHash: passwordHash,
					Status:       string(model.UserStatusActive),
					Role:         string(model.UserRoleUser),
				}, nil
			},
			revokeOtherSessionsFn: func(context.Context, string, string, time.Time) (int, error) {
				return 0, nil
			},
			deleteUserFn: func(_ context.Context, userID string) error {
				deletedUserID = userID
				return nil
			},
		}, time.Hour, nil, ServiceOptions{AllowRegistration: true})

		if err := service.DeleteAccount(ctx, AuthenticatedSession{SessionID: "session-1", UserID: "user-1"}, DeleteAccountInput{CurrentPassword: "current-pass"}); err != nil {
			t.Fatalf("delete account: %v", err)
		}
		if deletedUserID != "user-1" {
			t.Fatalf("expected user deleted, got %q", deletedUserID)
		}
	})
}

type serviceAuditRecorder struct {
	logs []model.AuditLog
}

func (r *serviceAuditRecorder) Record(_ context.Context, log model.AuditLog) error {
	r.logs = append(r.logs, log)
	return nil
}

type emailSenderStub struct {
	messages []sentEmailMessage
	sendFn   func(context.Context, sentEmailMessage) error
}

type sentEmailMessage struct {
	To      string
	Subject string
	Body    string
	HTML    string
}

func (s *emailSenderStub) Send(ctx context.Context, message EmailMessage) error {
	item := sentEmailMessage{To: message.To, Subject: message.Subject, Body: message.Body, HTML: message.HTML}
	s.messages = append(s.messages, item)
	if s.sendFn != nil {
		return s.sendFn(ctx, item)
	}
	return nil
}

func validGeneralSettings() settings.General {
	return settings.General{
		AllowUserRegistration:               true,
		SessionIdleTimeoutMinutes:           120,
		RefreshTokenTTLHours:                168,
		TerminalMaxSessionsPerUser:          5,
		TerminalMaxSessionsTotal:            20,
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
	}
}

func TestServiceRegister(t *testing.T) {
	ctx := context.Background()

	t.Run("rejects disabled registration", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{}, time.Hour, nil, ServiceOptions{AllowRegistration: false})

		_, err := service.Register(ctx, RegisterInput{
			Email:       "user@example.com",
			Password:    "strong-pass",
			DisplayName: "User",
		})
		if !errors.Is(err, ErrRegistrationDisabled) {
			t.Fatalf("expected ErrRegistrationDisabled, got %v", err)
		}
	})

	t.Run("rejects invalid input", func(t *testing.T) {
		service := NewService(&serviceRepoStub{}, time.Hour, nil)

		_, err := service.Register(ctx, RegisterInput{
			Email:       "  ",
			Password:    "short",
			DisplayName: " ",
		})
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
	})

	t.Run("maps unique violation to email exists", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{
			getLatestEmailCodeFn: func(_ context.Context, input GetLatestEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
				return EmailVerificationCodeRecord{
					ID:          "code-1",
					Email:       input.Email,
					Purpose:     input.Purpose,
					CodeHash:    hashEmailVerificationCode("test-secret", input.Email, input.Purpose, "123456"),
					Attempts:    0,
					MaxAttempts: 5,
					ExpiresAt:   time.Now().Add(time.Minute),
				}, nil
			},
			consumeEmailCodeFn: func(context.Context, string, time.Time) error {
				return nil
			},
			createUserFn: func(context.Context, CreateUserInput) (UserRecord, error) {
				return UserRecord{}, &pgconn.PgError{Code: "23505"}
			},
		}, time.Hour, nil, ServiceOptions{AllowRegistration: true, EmailCodeHashSecret: "test-secret"})

		_, err := service.Register(ctx, RegisterInput{
			Email:            "user@example.com",
			Password:         "strong-pass",
			DisplayName:      "User",
			PasswordConfirm:  "strong-pass",
			VerificationCode: "123456",
		})
		if !errors.Is(err, ErrEmailAlreadyExists) {
			t.Fatalf("expected ErrEmailAlreadyExists, got %v", err)
		}
	})

	t.Run("maps username unique violation to username exists", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{
			getLatestEmailCodeFn: func(_ context.Context, input GetLatestEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
				return EmailVerificationCodeRecord{
					ID:          "code-1",
					Email:       input.Email,
					Purpose:     input.Purpose,
					CodeHash:    hashEmailVerificationCode("test-secret", input.Email, input.Purpose, "123456"),
					Attempts:    0,
					MaxAttempts: 5,
					ExpiresAt:   time.Now().Add(time.Minute),
				}, nil
			},
			consumeEmailCodeFn: func(context.Context, string, time.Time) error {
				return nil
			},
			createUserFn: func(context.Context, CreateUserInput) (UserRecord, error) {
				return UserRecord{}, &pgconn.PgError{Code: "23505", ConstraintName: "uq_users_display_name_lower"}
			},
		}, time.Hour, nil, ServiceOptions{AllowRegistration: true, EmailCodeHashSecret: "test-secret"})

		_, err := service.Register(ctx, RegisterInput{
			Email:            "user@example.com",
			Password:         "strong-pass",
			DisplayName:      "Tester",
			PasswordConfirm:  "strong-pass",
			VerificationCode: "123456",
		})
		if !errors.Is(err, ErrUsernameAlreadyExists) {
			t.Fatalf("expected username already exists, got %v", err)
		}
	})

	t.Run("normalizes input and records audit", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		var received CreateUserInput
		var consumedID string
		service := NewService(&serviceRepoStub{
			getLatestEmailCodeFn: func(_ context.Context, input GetLatestEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
				if input.Email != "user@example.com" || input.Purpose != EmailVerificationPurposeRegister {
					t.Fatalf("expected register verification lookup, got %#v", input)
				}
				return EmailVerificationCodeRecord{
					ID:          "code-1",
					Email:       input.Email,
					Purpose:     input.Purpose,
					CodeHash:    hashEmailVerificationCode("test-secret", input.Email, input.Purpose, "123456"),
					Attempts:    0,
					MaxAttempts: 5,
					ExpiresAt:   time.Now().Add(time.Minute),
				}, nil
			},
			incrementEmailCodeAttempts: func(context.Context, string) error {
				t.Fatal("did not expect attempts increment for valid code")
				return nil
			},
			consumeEmailCodeFn: func(_ context.Context, id string, consumedAt time.Time) error {
				consumedID = id
				if consumedAt.IsZero() {
					t.Fatal("expected consumed timestamp")
				}
				return nil
			},
			createUserFn: func(_ context.Context, input CreateUserInput) (UserRecord, error) {
				received = input
				if input.Role != string(model.UserRoleUser) {
					t.Fatalf("normal registration must not request admin role, got %q", input.Role)
				}
				return UserRecord{
					ID:          "user-1",
					Email:       input.Email,
					DisplayName: input.DisplayName,
					Status:      string(model.UserStatusActive),
					CreatedAt:   time.Now(),
					UpdatedAt:   time.Now(),
				}, nil
			},
		}, time.Hour, recorder)
		service.emailCodeHashSecret = "test-secret"

		user, err := service.Register(ctx, RegisterInput{
			Email:            "  User@Example.COM  ",
			Password:         "strong-pass",
			PasswordConfirm:  "strong-pass",
			DisplayName:      "  Test User  ",
			VerificationCode: "123456",
		})
		if err != nil {
			t.Fatalf("register user: %v", err)
		}

		if received.Email != "user@example.com" {
			t.Fatalf("expected normalized email, got %q", received.Email)
		}
		if received.DisplayName != "Test User" {
			t.Fatalf("expected trimmed display name, got %q", received.DisplayName)
		}
		if user.Email != "user@example.com" {
			t.Fatalf("expected normalized user email, got %q", user.Email)
		}
		if consumedID != "code-1" {
			t.Fatalf("expected verification code consumed, got %q", consumedID)
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "auth_register" {
			t.Fatalf("expected auth_register audit log, got %#v", recorder.logs)
		}
	})
}

func TestServiceSendEmailVerificationCode(t *testing.T) {
	ctx := context.Background()

	t.Run("stores only a code hash and sends the generated code", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		sender := &emailSenderStub{}
		var created CreateEmailVerificationCodeInput
		service := NewServiceWithOptions(&serviceRepoStub{
			countEmailCodeSendsFn: func(_ context.Context, input CountEmailVerificationCodeSendsInput) (int, error) {
				if input.Since.IsZero() {
					t.Fatal("expected rate limit window")
				}
				return 0, nil
			},
			createEmailCodeFn: func(_ context.Context, input CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
				created = input
				return EmailVerificationCodeRecord{
					ID:          "code-1",
					Email:       input.Email,
					Purpose:     input.Purpose,
					CodeHash:    input.CodeHash,
					Attempts:    0,
					MaxAttempts: input.MaxAttempts,
					ExpiresAt:   input.ExpiresAt,
					CreatedAt:   time.Now(),
				}, nil
			},
		}, time.Hour, recorder, ServiceOptions{
			AllowRegistration:       true,
			EmailSender:             sender,
			EmailCodeHashSecret:     "test-secret",
			AllowedEmails:           []string{"user@example.com"},
			EmailCodeLength:         6,
			EmailCodeTTL:            5 * time.Minute,
			EmailCodeMaxAttempts:    5,
			EmailCodeResendCooldown: 60 * time.Second,
			EmailCodeEmailWindow:    15 * time.Minute,
			EmailCodeEmailMaxSends:  5,
			EmailCodeIPWindow:       15 * time.Minute,
			EmailCodeIPMaxSends:     10,
		})

		err := service.SendEmailVerificationCode(ctx, SendEmailVerificationCodeInput{
			Email:    " USER@example.com ",
			Purpose:  EmailVerificationPurposeRegister,
			ClientIP: "203.0.113.8",
		})
		if err != nil {
			t.Fatalf("send email code: %v", err)
		}

		if created.Email != "user@example.com" || created.Purpose != EmailVerificationPurposeRegister {
			t.Fatalf("expected normalized register email code, got %#v", created)
		}
		if created.CodeHash == "" {
			t.Fatal("expected stored code hash")
		}
		if strings.Contains(created.CodeHash, "123456") {
			t.Fatalf("expected no plain code in stored hash, got %q", created.CodeHash)
		}
		if created.ClientIP == nil || *created.ClientIP != "203.0.113.8" {
			t.Fatalf("expected client IP stored, got %#v", created.ClientIP)
		}
		if len(sender.messages) != 1 {
			t.Fatalf("expected one email, got %#v", sender.messages)
		}
		if sender.messages[0].To != "user@example.com" {
			t.Fatalf("expected normalized recipient, got %q", sender.messages[0].To)
		}
		if !strings.Contains(sender.messages[0].Body, "Online SSH") {
			t.Fatalf("expected branded message body, got %q", sender.messages[0].Body)
		}
		if !strings.Contains(sender.messages[0].HTML, "<html") || !strings.Contains(sender.messages[0].HTML, "Online SSH") {
			t.Fatalf("expected branded HTML message body, got %q", sender.messages[0].HTML)
		}
		if !strings.Contains(sender.messages[0].HTML, "Please do not reply to this email.") {
			t.Fatalf("expected no-reply footer in HTML message body, got %q", sender.messages[0].HTML)
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "auth_email_code_send" {
			t.Fatalf("expected auth_email_code_send audit log, got %#v", recorder.logs)
		}
		if recorder.logs[0].Result != string(model.AuditResultSuccess) || recorder.logs[0].ClientIP == nil || *recorder.logs[0].ClientIP != "203.0.113.8" {
			t.Fatalf("expected successful email code audit with client ip, got %#v", recorder.logs[0])
		}
	})

	t.Run("rejects registration addresses outside the whitelist", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{}, time.Hour, nil, ServiceOptions{
			AllowRegistration:   true,
			EmailSender:         &emailSenderStub{},
			EmailCodeHashSecret: "test-secret",
			AllowedEmails:       []string{"allowed@example.com"},
		})

		err := service.SendEmailVerificationCode(ctx, SendEmailVerificationCodeInput{
			Email:   "blocked@example.com",
			Purpose: EmailVerificationPurposeRegister,
		})
		if !errors.Is(err, ErrEmailNotAllowed) {
			t.Fatalf("expected ErrEmailNotAllowed, got %v", err)
		}
	})

	t.Run("allows login code outside the registration whitelist", func(t *testing.T) {
		sender := &emailSenderStub{}
		var created CreateEmailVerificationCodeInput
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByLoginIdentifierFn: func(_ context.Context, identifier string) (UserRecord, error) {
				if identifier != "registered@gmail.com" {
					t.Fatalf("unexpected login identifier %q", identifier)
				}
				return UserRecord{
					ID:          "user-1",
					Email:       "registered@gmail.com",
					DisplayName: "Registered User",
					Status:      string(model.UserStatusActive),
				}, nil
			},
			countEmailCodeSendsFn: func(context.Context, CountEmailVerificationCodeSendsInput) (int, error) {
				return 0, nil
			},
			createEmailCodeFn: func(_ context.Context, input CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
				created = input
				return EmailVerificationCodeRecord{
					ID:          "code-login",
					Email:       input.Email,
					Purpose:     input.Purpose,
					CodeHash:    input.CodeHash,
					Attempts:    0,
					MaxAttempts: input.MaxAttempts,
					ExpiresAt:   input.ExpiresAt,
					CreatedAt:   time.Now(),
				}, nil
			},
		}, time.Hour, nil, ServiceOptions{
			AllowRegistration:   true,
			EmailSender:         sender,
			EmailCodeHashSecret: "test-secret",
			AllowedEmailDomains: []string{"qq.com"},
		})

		err := service.SendEmailVerificationCode(ctx, SendEmailVerificationCodeInput{
			Email:   "registered@gmail.com",
			Purpose: EmailVerificationPurposeLogin,
		})
		if err != nil {
			t.Fatalf("send login code outside registration whitelist: %v", err)
		}
		if created.Email != "registered@gmail.com" || created.Purpose != EmailVerificationPurposeLogin {
			t.Fatalf("expected login code for registered@gmail.com, got %#v", created)
		}
		if len(sender.messages) != 1 || sender.messages[0].To != "registered@gmail.com" {
			t.Fatalf("expected login email sent outside registration whitelist, got %#v", sender.messages)
		}
	})

	t.Run("rejects login code for an unknown email", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByEmailFn: func(_ context.Context, email string) (UserRecord, error) {
				if email != "missing@example.com" {
					t.Fatalf("unexpected login email lookup %q", email)
				}
				return UserRecord{}, db.ErrNotFound
			},
			countEmailCodeSendsFn: func(context.Context, CountEmailVerificationCodeSendsInput) (int, error) {
				t.Fatal("did not expect rate limit lookup for an unknown login email")
				return 0, nil
			},
			createEmailCodeFn: func(context.Context, CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
				t.Fatal("did not expect email code creation for an unknown login email")
				return EmailVerificationCodeRecord{}, nil
			},
		}, time.Hour, nil, ServiceOptions{
			AllowRegistration:   true,
			EmailSender:         &emailSenderStub{},
			EmailCodeHashSecret: "test-secret",
		})

		err := service.SendEmailVerificationCode(ctx, SendEmailVerificationCodeInput{
			Email:   "missing@example.com",
			Purpose: EmailVerificationPurposeLogin,
		})
		if !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("expected ErrInvalidCredentials, got %v", err)
		}
	})

	t.Run("rejects login code for a disabled account", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByEmailFn: func(_ context.Context, email string) (UserRecord, error) {
				if email != "disabled@example.com" {
					t.Fatalf("unexpected login email lookup %q", email)
				}
				return UserRecord{
					ID:        "user-disabled",
					Email:     email,
					Status:    string(model.UserStatusDisabled),
					CreatedAt: time.Now(),
					UpdatedAt: time.Now(),
				}, nil
			},
			countEmailCodeSendsFn: func(context.Context, CountEmailVerificationCodeSendsInput) (int, error) {
				t.Fatal("did not expect rate limit lookup for a disabled account")
				return 0, nil
			},
			createEmailCodeFn: func(context.Context, CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
				t.Fatal("did not expect email code creation for a disabled account")
				return EmailVerificationCodeRecord{}, nil
			},
		}, time.Hour, nil, ServiceOptions{
			AllowRegistration:   true,
			EmailSender:         &emailSenderStub{},
			EmailCodeHashSecret: "test-secret",
		})

		err := service.SendEmailVerificationCode(ctx, SendEmailVerificationCodeInput{
			Email:   "disabled@example.com",
			Purpose: EmailVerificationPurposeLogin,
		})
		if !errors.Is(err, ErrAccountDisabled) {
			t.Fatalf("expected ErrAccountDisabled, got %v", err)
		}
	})

	t.Run("sends login code to the registered email when the identifier is a username", func(t *testing.T) {
		sender := &emailSenderStub{}
		var created CreateEmailVerificationCodeInput
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByLoginIdentifierFn: func(_ context.Context, identifier string) (UserRecord, error) {
				if identifier != "tester" {
					t.Fatalf("expected normalized username lookup, got %q", identifier)
				}
				return UserRecord{
					ID:          "user-1",
					Email:       "tester@example.com",
					DisplayName: "Tester",
					Status:      string(model.UserStatusActive),
				}, nil
			},
			countEmailCodeSendsFn: func(context.Context, CountEmailVerificationCodeSendsInput) (int, error) {
				return 0, nil
			},
			createEmailCodeFn: func(_ context.Context, input CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
				created = input
				return EmailVerificationCodeRecord{
					ID:          "code-login",
					Email:       input.Email,
					Purpose:     input.Purpose,
					CodeHash:    input.CodeHash,
					Attempts:    0,
					MaxAttempts: input.MaxAttempts,
					ExpiresAt:   input.ExpiresAt,
					CreatedAt:   time.Now(),
				}, nil
			},
		}, time.Hour, nil, ServiceOptions{
			AllowRegistration:   true,
			EmailSender:         sender,
			EmailCodeHashSecret: "test-secret",
		})

		err := service.SendEmailVerificationCode(ctx, SendEmailVerificationCodeInput{
			Email:   "Tester",
			Purpose: EmailVerificationPurposeLogin,
		})
		if err != nil {
			t.Fatalf("send login code by username: %v", err)
		}
		if created.Email != "tester@example.com" || created.Purpose != EmailVerificationPurposeLogin {
			t.Fatalf("expected login code for account email, got %#v", created)
		}
		if len(sender.messages) != 1 || sender.messages[0].To != "tester@example.com" {
			t.Fatalf("expected login email sent to account email, got %#v", sender.messages)
		}
	})

	t.Run("uses runtime whitelist settings from admin configuration", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{
			countEmailCodeSendsFn: func(context.Context, CountEmailVerificationCodeSendsInput) (int, error) {
				t.Fatal("did not expect rate limit lookup for blocked email")
				return 0, nil
			},
			createEmailCodeFn: func(context.Context, CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
				t.Fatal("did not expect email code creation for blocked email")
				return EmailVerificationCodeRecord{}, nil
			},
		}, time.Hour, nil, ServiceOptions{
			AllowRegistration:   true,
			EmailSender:         &emailSenderStub{},
			EmailCodeHashSecret: "test-secret",
			SettingsProvider: func() settings.General {
				cfg := validGeneralSettings()
				cfg.AuthAllowedEmailDomains = "qq.com"
				return cfg
			},
		})

		err := service.SendEmailVerificationCode(ctx, SendEmailVerificationCodeInput{
			Email:   "person@gmail.com",
			Purpose: EmailVerificationPurposeRegister,
		})
		if !errors.Is(err, ErrEmailNotAllowed) {
			t.Fatalf("expected ErrEmailNotAllowed, got %v", err)
		}
	})
}

func TestServiceSendAccountEmailVerificationCode(t *testing.T) {
	ctx := context.Background()

	t.Run("allows new email code outside the registration whitelist", func(t *testing.T) {
		sender := &emailSenderStub{}
		var created CreateEmailVerificationCodeInput
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByIDFn: func(_ context.Context, userID string) (UserRecord, error) {
				if userID != "user-1" {
					t.Fatalf("unexpected user lookup %q", userID)
				}
				return UserRecord{
					ID:          userID,
					Email:       "old@example.com",
					DisplayName: "User",
					Status:      string(model.UserStatusActive),
				}, nil
			},
			getUserByEmailFn: func(_ context.Context, email string) (UserRecord, error) {
				if email != "new@gmail.com" {
					t.Fatalf("unexpected new email lookup %q", email)
				}
				return UserRecord{}, db.ErrNotFound
			},
			countEmailCodeSendsFn: func(context.Context, CountEmailVerificationCodeSendsInput) (int, error) {
				return 0, nil
			},
			createEmailCodeFn: func(_ context.Context, input CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
				created = input
				return EmailVerificationCodeRecord{
					ID:          "code-new-email",
					Email:       input.Email,
					Purpose:     input.Purpose,
					CodeHash:    input.CodeHash,
					Attempts:    0,
					MaxAttempts: input.MaxAttempts,
					ExpiresAt:   input.ExpiresAt,
					CreatedAt:   time.Now(),
				}, nil
			},
		}, time.Hour, nil, ServiceOptions{
			AllowRegistration:   true,
			EmailSender:         sender,
			EmailCodeHashSecret: "test-secret",
			AllowedEmailDomains: []string{"qq.com"},
		})

		err := service.SendAccountEmailVerificationCode(ctx, AuthenticatedSession{SessionID: "session-1", UserID: "user-1"}, SendAccountEmailVerificationCodeInput{
			Stage: "new",
			Email: "new@gmail.com",
		})
		if err != nil {
			t.Fatalf("send new email code outside registration whitelist: %v", err)
		}
		if created.Email != "new@gmail.com" || created.Purpose != EmailVerificationPurposeEmailNew {
			t.Fatalf("expected new email verification code, got %#v", created)
		}
		if len(sender.messages) != 1 || sender.messages[0].To != "new@gmail.com" {
			t.Fatalf("expected email sent outside registration whitelist, got %#v", sender.messages)
		}
	})
}

func TestServiceLoginWithEmailVerificationCode(t *testing.T) {
	ctx := context.Background()

	t.Run("creates a login session and records audit", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		var consumedID string
		var createdSession CreateSessionInput
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
				if input.Email != "user@gmail.com" || input.Purpose != EmailVerificationPurposeLogin {
					t.Fatalf("expected login verification lookup, got %#v", input)
				}
				return EmailVerificationCodeRecord{
					ID:          "code-1",
					Email:       input.Email,
					Purpose:     input.Purpose,
					CodeHash:    hashEmailVerificationCode("test-secret", input.Email, input.Purpose, "654321"),
					Attempts:    1,
					MaxAttempts: 5,
					ExpiresAt:   time.Now().Add(time.Minute),
				}, nil
			},
			consumeEmailCodeFn: func(_ context.Context, id string, _ time.Time) error {
				consumedID = id
				return nil
			},
			incrementEmailCodeAttempts: func(context.Context, string) error {
				t.Fatal("did not expect attempts increment for valid code")
				return nil
			},
			createSessionFn: func(_ context.Context, input CreateSessionInput) (SessionRecord, error) {
				createdSession = input
				return SessionRecord{ID: "session-1", UserID: input.UserID}, nil
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
		}, time.Hour, recorder, ServiceOptions{
			AllowRegistration:   true,
			EmailCodeHashSecret: "test-secret",
			AllowedEmailDomains: []string{"qq.com"},
		})

		result, err := service.LoginWithEmailVerificationCode(ctx, EmailCodeLoginInput{
			Email:            " USER@gmail.com ",
			VerificationCode: "654321",
			ClientIP:         "198.51.100.2",
			UserAgent:        "Mozilla/5.0 Firefox/125.0",
		})
		if err != nil {
			t.Fatalf("login with email code: %v", err)
		}

		if result.User.Email != "user@gmail.com" || result.SessionToken == "" || result.RefreshToken == "" {
			t.Fatalf("expected logged-in user and tokens, got %#v", result)
		}
		if consumedID != "code-1" {
			t.Fatalf("expected verification code consumed, got %q", consumedID)
		}
		if createdSession.UserID != "user-1" {
			t.Fatalf("expected session for user-1, got %#v", createdSession)
		}
		if createdSession.LoginMethod != "email_code" {
			t.Fatalf("expected email code login method, got %#v", createdSession.LoginMethod)
		}
		if result.Session.LoginMethod != "email_code" {
			t.Fatalf("expected email code session in result, got %#v", result.Session)
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "auth_login" {
			t.Fatalf("expected auth_login audit log, got %#v", recorder.logs)
		}
	})

	t.Run("records invalid email code attempts", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
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
					CodeHash:    hashEmailVerificationCode("test-secret", input.Email, input.Purpose, "654321"),
					Attempts:    1,
					MaxAttempts: 5,
					ExpiresAt:   time.Now().Add(time.Minute),
				}, nil
			},
			incrementEmailCodeAttempts: func(context.Context, string) error {
				return nil
			},
		}, time.Hour, recorder, ServiceOptions{
			AllowRegistration:   true,
			EmailCodeHashSecret: "test-secret",
			AllowedEmailDomains: []string{"example.com"},
		})

		_, err := service.LoginWithEmailVerificationCode(ctx, EmailCodeLoginInput{
			Email:            "user@example.com",
			VerificationCode: "000000",
			ClientIP:         "198.51.100.2",
			UserAgent:        "Mozilla/5.0 Firefox/125.0",
		})
		if !errors.Is(err, ErrVerificationCodeInvalid) {
			t.Fatalf("expected invalid verification code, got %v", err)
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "auth_email_code_verify_failed" {
			t.Fatalf("expected auth_email_code_verify_failed audit log, got %#v", recorder.logs)
		}
		if recorder.logs[0].UserID != "user-1" || recorder.logs[0].Result != string(model.AuditResultFailure) {
			t.Fatalf("expected failed verification audit for user-1, got %#v", recorder.logs[0])
		}
	})

	t.Run("rejects disabled email code login before consuming code", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByEmailFn: func(_ context.Context, email string) (UserRecord, error) {
				if email != "disabled@example.com" {
					t.Fatalf("unexpected login email %q", email)
				}
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
				t.Fatal("disabled user login must not verify or consume email code")
				return EmailVerificationCodeRecord{}, nil
			},
		}, time.Hour, recorder, ServiceOptions{
			AllowRegistration:   true,
			EmailCodeHashSecret: "test-secret",
		})

		_, err := service.LoginWithEmailVerificationCode(ctx, EmailCodeLoginInput{
			Email:            "disabled@example.com",
			VerificationCode: "123456",
			ClientIP:         "198.51.100.10",
			UserAgent:        "disabled-email-code-login-test",
		})

		if !errors.Is(err, ErrAccountDisabled) {
			t.Fatalf("expected ErrAccountDisabled, got %v", err)
		}
		if got := auditEventTypes(recorder.logs); !slices.Equal(got, []string{"auth_login_failed"}) {
			t.Fatalf("expected disabled email-code login failure audit, got %#v", got)
		}
	})
}

func TestServiceLogin(t *testing.T) {
	ctx := context.Background()

	t.Run("rejects invalid input", func(t *testing.T) {
		service := NewService(&serviceRepoStub{}, time.Hour, nil)

		_, err := service.Login(ctx, LoginInput{Email: " ", Password: ""})
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
	})

	t.Run("maps missing user to invalid credentials", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		service := NewService(&serviceRepoStub{
			getUserByEmailFn: func(context.Context, string) (UserRecord, error) {
				return UserRecord{}, db.ErrNotFound
			},
		}, time.Hour, recorder)

		_, err := service.Login(ctx, LoginInput{Email: "user@example.com", Password: "strong-pass", ClientIP: "198.51.100.7", UserAgent: "agent"})
		if !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("expected ErrInvalidCredentials, got %v", err)
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "auth_login_failed" {
			t.Fatalf("expected auth_login_failed audit log, got %#v", recorder.logs)
		}
		if recorder.logs[0].UserID != "" || recorder.logs[0].Result != string(model.AuditResultFailure) {
			t.Fatalf("expected anonymous failed login audit, got %#v", recorder.logs[0])
		}
	})

	t.Run("rejects inactive users with account disabled error", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			getUserByEmailFn: func(context.Context, string) (UserRecord, error) {
				return UserRecord{
					ID:           "user-1",
					Email:        "user@example.com",
					PasswordHash: mustPasswordHash(t, "strong-pass"),
					Status:       string(model.UserStatusDisabled),
				}, nil
			},
		}, time.Hour, nil)

		_, err := service.Login(ctx, LoginInput{Email: "user@example.com", Password: "strong-pass"})
		if !errors.Is(err, ErrAccountDisabled) {
			t.Fatalf("expected ErrAccountDisabled, got %v", err)
		}
	})

	t.Run("rejects wrong password", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		service := NewService(&serviceRepoStub{
			getUserByEmailFn: func(context.Context, string) (UserRecord, error) {
				return UserRecord{
					ID:           "user-1",
					Email:        "user@example.com",
					PasswordHash: mustPasswordHash(t, "strong-pass"),
					Status:       string(model.UserStatusActive),
				}, nil
			},
		}, time.Hour, recorder)

		_, err := service.Login(ctx, LoginInput{Email: "user@example.com", Password: "wrong-pass"})
		if !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("expected ErrInvalidCredentials, got %v", err)
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "auth_login_failed" {
			t.Fatalf("expected auth_login_failed audit log, got %#v", recorder.logs)
		}
		if recorder.logs[0].UserID != "user-1" || recorder.logs[0].Result != string(model.AuditResultFailure) {
			t.Fatalf("expected failed login audit for user-1, got %#v", recorder.logs[0])
		}
	})

	t.Run("creates session updates last login and records audit", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		var createSessionInput CreateSessionInput
		var updateLastLoginUserID string
		var revokedUserID string
		var keptSessionID string
		var invalidatedUserID string
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
				createSessionInput = input
				return SessionRecord{ID: "session-1", UserID: input.UserID}, nil
			},
			revokeOtherSessionsFn: func(_ context.Context, userID string, keepSessionID string, revokedAt time.Time) (int, error) {
				revokedUserID = userID
				keptSessionID = keepSessionID
				if revokedAt.IsZero() {
					t.Fatal("expected revoke timestamp")
				}
				return 2, nil
			},
			getActiveSessionByTokenHash: func(_ context.Context, tokenHash string, at time.Time) (SessionRecord, error) {
				if tokenHash == "" || at.IsZero() {
					t.Fatalf("expected active session check with token hash and timestamp, got hash=%q at=%v", tokenHash, at)
				}
				return SessionRecord{ID: "session-1", UserID: "user-1"}, nil
			},
			updateLastLoginFn: func(_ context.Context, userID string, _ time.Time) error {
				updateLastLoginUserID = userID
				return nil
			},
		}, 2*time.Hour, recorder)
		service.SetOtherSessionsRevokedHook(func(_ context.Context, userID string) {
			invalidatedUserID = userID
		})

		result, err := service.Login(ctx, LoginInput{
			Email:     " USER@example.com ",
			Password:  "strong-pass",
			ClientIP:  " 127.0.0.1 ",
			UserAgent: " Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0 ",
		})
		if err != nil {
			t.Fatalf("login user: %v", err)
		}

		if result.User.Email != "user@example.com" {
			t.Fatalf("expected normalized email, got %q", result.User.Email)
		}
		if result.SessionToken == "" {
			t.Fatal("expected session token")
		}
		if result.RefreshToken == "" {
			t.Fatal("expected refresh token")
		}
		if createSessionInput.UserID != "user-1" {
			t.Fatalf("expected session for user-1, got %q", createSessionInput.UserID)
		}
		if createSessionInput.LoginMethod != "password" {
			t.Fatalf("expected password login method, got %q", createSessionInput.LoginMethod)
		}
		if result.Session.LoginMethod != "password" {
			t.Fatalf("expected password session in result, got %#v", result.Session)
		}
		if createSessionInput.SessionTokenHash == "" {
			t.Fatal("expected hashed session token")
		}
		if createSessionInput.SessionTokenHash == result.SessionToken {
			t.Fatal("expected stored token hash to differ from raw session token")
		}
		if createSessionInput.RefreshTokenHash == nil || *createSessionInput.RefreshTokenHash == "" {
			t.Fatal("expected hashed refresh token")
		}
		if createSessionInput.RefreshTokenHash != nil && *createSessionInput.RefreshTokenHash == result.RefreshToken {
			t.Fatal("expected stored refresh hash to differ from raw refresh token")
		}
		if createSessionInput.RefreshExpiresAt == nil {
			t.Fatal("expected refresh expiry")
		}
		if createSessionInput.ClientIP == nil || *createSessionInput.ClientIP != "127.0.0.1" {
			t.Fatalf("expected trimmed client ip, got %#v", createSessionInput.ClientIP)
		}
		if createSessionInput.UserAgent == nil || *createSessionInput.UserAgent != "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0" {
			t.Fatalf("expected trimmed user agent, got %#v", createSessionInput.UserAgent)
		}
		if createSessionInput.DeviceLabel == nil || *createSessionInput.DeviceLabel != "Edge on macOS" {
			t.Fatalf("expected parsed device label Edge on macOS, got %#v", createSessionInput.DeviceLabel)
		}
		if revokedUserID != "user-1" || keptSessionID != "session-1" {
			t.Fatalf("expected login to revoke other sessions for user-1 while keeping session-1, got user=%q keep=%q", revokedUserID, keptSessionID)
		}
		if invalidatedUserID != "user-1" {
			t.Fatalf("expected login to notify other session revocation for user-1, got %q", invalidatedUserID)
		}
		if updateLastLoginUserID != "user-1" {
			t.Fatalf("expected UpdateLastLogin for user-1, got %q", updateLastLoginUserID)
		}
		if got := auditEventTypes(recorder.logs); !slices.Equal(got, []string{"auth_login", "admin_user_kicked"}) {
			t.Fatalf("expected auth_login and kicked audit logs, got %#v", got)
		}
	})

	t.Run("creates a password login session by username", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			getUserByLoginIdentifierFn: func(_ context.Context, identifier string) (UserRecord, error) {
				if identifier != "tester" {
					t.Fatalf("expected normalized username lookup, got %q", identifier)
				}
				return UserRecord{
					ID:           "user-1",
					Email:        "tester@example.com",
					DisplayName:  "Tester",
					PasswordHash: mustPasswordHash(t, "strong-pass"),
					Status:       string(model.UserStatusActive),
					CreatedAt:    time.Now(),
					UpdatedAt:    time.Now(),
				}, nil
			},
			createSessionFn: func(_ context.Context, input CreateSessionInput) (SessionRecord, error) {
				return SessionRecord{ID: "session-1", UserID: input.UserID, LoginMethod: input.LoginMethod}, nil
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

		result, err := service.Login(ctx, LoginInput{
			Email:    "Tester",
			Password: "strong-pass",
		})
		if err != nil {
			t.Fatalf("login by username: %v", err)
		}
		if result.User.Email != "tester@example.com" || result.User.DisplayName != "Tester" {
			t.Fatalf("expected username login user, got %#v", result.User)
		}
	})

	t.Run("rejects disabled password login with account disabled error", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		service := NewService(&serviceRepoStub{
			getUserByLoginIdentifierFn: func(_ context.Context, identifier string) (UserRecord, error) {
				if identifier != "disabled@example.com" {
					t.Fatalf("expected disabled login identifier, got %q", identifier)
				}
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
				t.Fatal("disabled user must not create a login session")
				return SessionRecord{}, nil
			},
		}, time.Hour, recorder)

		_, err := service.Login(ctx, LoginInput{
			Email:     "disabled@example.com",
			Password:  "strong-pass",
			ClientIP:  "198.51.100.9",
			UserAgent: "disabled-login-test",
		})

		if !errors.Is(err, ErrAccountDisabled) {
			t.Fatalf("expected ErrAccountDisabled, got %v", err)
		}
		if got := auditEventTypes(recorder.logs); !slices.Equal(got, []string{"auth_login_failed"}) {
			t.Fatalf("expected disabled login failure audit, got %#v", got)
		}
	})

	t.Run("allows password login outside the registration whitelist", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByEmailFn: func(_ context.Context, email string) (UserRecord, error) {
				if email != "registered@gmail.com" {
					t.Fatalf("unexpected login email %q", email)
				}
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
			updateLastLoginFn: func(context.Context, string, time.Time) error {
				return nil
			},
		}, time.Hour, nil, ServiceOptions{
			AllowRegistration:   true,
			AllowedEmailDomains: []string{"qq.com"},
		})

		result, err := service.Login(ctx, LoginInput{Email: "registered@gmail.com", Password: "strong-pass"})
		if err != nil {
			t.Fatalf("password login outside registration whitelist: %v", err)
		}
		if result.User.Email != "registered@gmail.com" || result.Session.LoginMethod != "password" {
			t.Fatalf("expected password login session, got %#v", result)
		}
	})

	t.Run("rejects login result when concurrent login already revoked its new session", func(t *testing.T) {
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
				return 1, nil
			},
			getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
				return SessionRecord{}, db.ErrNotFound
			},
			updateLastLoginFn: func(context.Context, string, time.Time) error {
				t.Fatal("did not expect last login update for revoked concurrent login")
				return nil
			},
		}, time.Hour, nil)

		_, err := service.Login(ctx, LoginInput{Email: "user@example.com", Password: "strong-pass"})

		if !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("expected ErrUnauthorized for superseded login, got %v", err)
		}
	})
}

func TestServiceRefresh(t *testing.T) {
	ctx := context.Background()

	t.Run("rejects blank refresh token", func(t *testing.T) {
		service := NewService(&serviceRepoStub{}, time.Hour, nil)

		_, err := service.Refresh(ctx, "   ")
		if !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("expected ErrUnauthorized, got %v", err)
		}
	})

	t.Run("maps missing refresh token to unauthorized", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			rotateSessionByRefreshHash: func(context.Context, RotateSessionInput) (SessionRecord, error) {
				return SessionRecord{}, db.ErrNotFound
			},
		}, time.Hour, nil)

		_, err := service.Refresh(ctx, "refresh-token")
		if !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("expected ErrUnauthorized, got %v", err)
		}
	})

	t.Run("rotates tokens and records audit", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		refreshExpiresAt := time.Now().Add(24 * time.Hour)
		idleTimeout := 90 * time.Minute
		var input RotateSessionInput
		service := NewServiceWithOptions(&serviceRepoStub{
			rotateSessionByRefreshHash: func(_ context.Context, received RotateSessionInput) (SessionRecord, error) {
				input = received
				return SessionRecord{
					ID:               "session-1",
					UserID:           "user-1",
					SessionTokenHash: received.NewSessionTokenHash,
					RefreshTokenHash: &received.NewRefreshTokenHash,
					ExpiresAt:        received.ExpiresAt,
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
		}, time.Hour, recorder, ServiceOptions{AllowRegistration: true, IdleTimeout: idleTimeout})

		result, err := service.RefreshWithMetadata(ctx, RefreshInput{
			RefreshToken: "refresh-token",
			ClientIP:     " 203.0.113.8 ",
			UserAgent:    " Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 ",
		})
		if err != nil {
			t.Fatalf("refresh session: %v", err)
		}

		if result.SessionToken == "" || result.RefreshToken == "" {
			t.Fatalf("expected new tokens, got %#v", result)
		}
		if input.RefreshTokenHash == "" || input.RefreshTokenHash == "refresh-token" {
			t.Fatalf("expected hashed old refresh token, got %q", input.RefreshTokenHash)
		}
		if input.NewSessionTokenHash == "" || input.NewRefreshTokenHash == "" {
			t.Fatalf("expected new token hashes, got %#v", input)
		}
		if input.IdleSince.IsZero() {
			t.Fatal("expected idle threshold")
		}
		if input.ClientIP == nil || *input.ClientIP != "203.0.113.8" {
			t.Fatalf("expected refreshed client ip, got %#v", input.ClientIP)
		}
		if input.UserAgent == nil || *input.UserAgent != "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36" {
			t.Fatalf("expected refreshed user agent, got %#v", input.UserAgent)
		}
		if input.DeviceLabel == nil || *input.DeviceLabel != "Chrome on Windows" {
			t.Fatalf("expected refreshed device label Chrome on Windows, got %#v", input.DeviceLabel)
		}
		if delta := input.Now.Sub(input.IdleSince); delta < idleTimeout-time.Second || delta > idleTimeout+time.Second {
			t.Fatalf("expected idle threshold around %s, got %s", idleTimeout, delta)
		}
		if result.RefreshExpiresAt != refreshExpiresAt {
			t.Fatalf("expected refresh expiry to be preserved, got %v", result.RefreshExpiresAt)
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "auth_refresh" {
			t.Fatalf("expected auth_refresh audit log, got %#v", recorder.logs)
		}
	})
}

func TestServiceAuthenticateAndLogout(t *testing.T) {
	ctx := context.Background()

	t.Run("rejects blank session token", func(t *testing.T) {
		service := NewService(&serviceRepoStub{}, time.Hour, nil)

		_, err := service.Authenticate(ctx, "   ")
		if !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("expected ErrUnauthorized, got %v", err)
		}
	})

	t.Run("maps missing session to unauthorized", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
				return SessionRecord{}, db.ErrNotFound
			},
			getSessionByTokenHash: func(context.Context, string) (SessionRecord, error) {
				return SessionRecord{}, db.ErrNotFound
			},
		}, time.Hour, nil)

		_, err := service.Authenticate(ctx, "token")
		if !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("expected ErrUnauthorized, got %v", err)
		}
	})

	t.Run("maps revoked session to session revoked", func(t *testing.T) {
		revokedAt := time.Now()
		service := NewService(&serviceRepoStub{
			getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
				return SessionRecord{}, db.ErrNotFound
			},
			getSessionByTokenHash: func(context.Context, string) (SessionRecord, error) {
				return SessionRecord{
					ID:        "session-1",
					UserID:    "user-1",
					RevokedAt: &revokedAt,
				}, nil
			},
		}, time.Hour, nil)

		_, err := service.Authenticate(ctx, "token")
		if !errors.Is(err, ErrSessionRevoked) {
			t.Fatalf("expected ErrSessionRevoked, got %v", err)
		}
	})

	t.Run("rejects inactive authenticated user", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
				return SessionRecord{
					ID:     "session-1",
					UserID: "user-1",
					User: UserRecord{
						ID:     "user-1",
						Email:  "user@example.com",
						Status: string(model.UserStatusDisabled),
					},
				}, nil
			},
		}, time.Hour, nil)

		_, err := service.Authenticate(ctx, "token")
		if !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("expected ErrUnauthorized, got %v", err)
		}
	})

	t.Run("logout rejects missing session id", func(t *testing.T) {
		service := NewService(&serviceRepoStub{}, time.Hour, nil)

		err := service.Logout(ctx, AuthenticatedSession{})
		if !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("expected ErrUnauthorized, got %v", err)
		}
	})

	t.Run("logout maps missing stored session to unauthorized", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			revokeSessionFn: func(context.Context, string, time.Time) error {
				return db.ErrNotFound
			},
		}, time.Hour, nil)

		err := service.Logout(ctx, AuthenticatedSession{SessionID: "missing", UserID: "user-1"})
		if !errors.Is(err, ErrUnauthorized) {
			t.Fatalf("expected ErrUnauthorized, got %v", err)
		}
	})
}

func TestAdminMiddleware(t *testing.T) {
	ctx := context.Background()

	t.Run("allows admin session", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
				return SessionRecord{
					ID:     "session-1",
					UserID: "admin-1",
					User: UserRecord{
						ID:          "admin-1",
						Email:       "admin@example.com",
						Status:      string(model.UserStatusActive),
						Role:        "operator",
						Permissions: []string{model.PermissionAdminAccess},
					},
				}, nil
			},
		}, time.Hour, nil)

		handler := NewAdminMiddleware(service, "online_ssh_session")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session, ok := SessionFromContext(r.Context())
			if !ok || session.UserID != "admin-1" {
				t.Fatalf("expected admin session in context, got %#v", session)
			}
			w.WriteHeader(http.StatusNoContent)
		}))
		req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
		req = req.WithContext(ctx)
		req.AddCookie(&http.Cookie{Name: "online_ssh_session", Value: "token"})
		recorder := httptest.NewRecorder()

		handler.ServeHTTP(recorder, req)

		if recorder.Code != http.StatusNoContent {
			t.Fatalf("expected 204, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("rejects admin role without admin access permission", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
				return SessionRecord{
					ID:     "session-1",
					UserID: "admin-1",
					User: UserRecord{
						ID:          "admin-1",
						Email:       "admin@example.com",
						Status:      string(model.UserStatusActive),
						Role:        string(model.UserRoleAdmin),
						Permissions: []string{},
					},
				}, nil
			},
		}, time.Hour, nil)

		handler := NewAdminMiddleware(service, "online_ssh_session")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("role name without permission should not reach admin handler")
		}))
		req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
		req.AddCookie(&http.Cookie{Name: "online_ssh_session", Value: "token"})
		recorder := httptest.NewRecorder()

		handler.ServeHTTP(recorder, req)

		if recorder.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("rejects regular user session", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
				return SessionRecord{
					ID:     "session-1",
					UserID: "user-1",
					User: UserRecord{
						ID:     "user-1",
						Email:  "user@example.com",
						Status: string(model.UserStatusActive),
						Role:   string(model.UserRoleUser),
					},
				}, nil
			},
		}, time.Hour, nil)

		handler := NewAdminMiddleware(service, "online_ssh_session")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("regular user should not reach admin handler")
		}))
		req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
		req.AddCookie(&http.Cookie{Name: "online_ssh_session", Value: "token"})
		recorder := httptest.NewRecorder()

		handler.ServeHTTP(recorder, req)

		if recorder.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("returns revoked session code when auth session was revoked", func(t *testing.T) {
		revokedAt := time.Now()
		service := NewService(&serviceRepoStub{
			getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
				return SessionRecord{}, db.ErrNotFound
			},
			getSessionByTokenHash: func(context.Context, string) (SessionRecord, error) {
				return SessionRecord{
					ID:        "session-1",
					UserID:    "user-1",
					RevokedAt: &revokedAt,
				}, nil
			},
		}, time.Hour, nil)

		handler := NewMiddleware(service, "online_ssh_session")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("revoked session should not reach protected handler")
		}))
		req := httptest.NewRequest(http.MethodGet, "/api/hosts", nil)
		req.AddCookie(&http.Cookie{Name: "online_ssh_session", Value: "token"})
		recorder := httptest.NewRecorder()

		handler.ServeHTTP(recorder, req)

		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d body=%s", recorder.Code, recorder.Body.String())
		}
		if !strings.Contains(recorder.Body.String(), `"code":"AUTH_SESSION_REVOKED"`) {
			t.Fatalf("expected AUTH_SESSION_REVOKED response, got %s", recorder.Body.String())
		}
	})
}

func mustPasswordHash(t *testing.T, password string) string {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("generate password hash: %v", err)
	}
	return string(hash)
}

func auditEventTypes(logs []model.AuditLog) []string {
	items := make([]string, 0, len(logs))
	for _, log := range logs {
		items = append(items, log.EventType)
	}
	return items
}
