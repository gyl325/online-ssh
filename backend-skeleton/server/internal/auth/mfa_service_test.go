package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/pquerna/otp/totp"
)

func TestServiceMFA(t *testing.T) {
	ctx := context.Background()
	passwordHash := mustPasswordHash(t, "current-pass")
	encryptor := fakeMFAEncryptor{}

	t.Run("enabled user login returns pending mfa without creating a session", func(t *testing.T) {
		var createSessionCalled bool
		var createdToken CreateMFATokenInput
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByLoginIdentifierFn: func(_ context.Context, identifier string) (UserRecord, error) {
				if identifier != "user@example.com" {
					t.Fatalf("unexpected identifier %q", identifier)
				}
				return UserRecord{
					ID:           "user-1",
					Email:        "user@example.com",
					DisplayName:  "User",
					PasswordHash: passwordHash,
					Status:       string(model.UserStatusActive),
					Role:         string(model.UserRoleUser),
				}, nil
			},
			getMFASettingsFn: func(_ context.Context, userID string) (MFASettingsRecord, error) {
				if userID != "user-1" {
					t.Fatalf("unexpected mfa settings user %q", userID)
				}
				return MFASettingsRecord{UserID: userID, TOTPEnabled: true}, nil
			},
			createMFATokenFn: func(_ context.Context, input CreateMFATokenInput) (MFATokenRecord, error) {
				createdToken = input
				return MFATokenRecord{
					ID:        "mfa-token-1",
					UserID:    input.UserID,
					TokenHash: input.TokenHash,
					ExpiresAt: input.ExpiresAt,
				}, nil
			},
			createSessionFn: func(context.Context, CreateSessionInput) (SessionRecord, error) {
				createSessionCalled = true
				return SessionRecord{}, nil
			},
		}, time.Minute, &serviceAuditRecorder{}, ServiceOptions{MFAEncryptor: encryptor})

		result, err := service.Login(ctx, LoginInput{
			Identifier: "user@example.com",
			Password:   "current-pass",
			ClientIP:   "203.0.113.10",
			UserAgent:  "test-agent",
		})
		if err != nil {
			t.Fatalf("login returned error: %v", err)
		}
		if result.Status != LoginStatusMFARequired {
			t.Fatalf("expected mfa required, got %q", result.Status)
		}
		if result.MFAToken == "" {
			t.Fatal("expected mfa token")
		}
		if createSessionCalled {
			t.Fatal("must not create full session before mfa verification")
		}
		if createdToken.UserID != "user-1" || createdToken.LoginMethod != "password" || createdToken.MaxAttempts != defaultMFATokenMaxAttempts {
			t.Fatalf("unexpected token input: %+v", createdToken)
		}
		if createdToken.ExpiresAt.Before(time.Now().Add(4 * time.Minute)) {
			t.Fatalf("mfa token ttl too short: %s", createdToken.ExpiresAt)
		}
	})

	t.Run("confirm stores encrypted totp secret and returns one-time recovery codes", func(t *testing.T) {
		var saved EnableMFAInput
		var savedCodes []CreateMFARecoveryCodeInput
		service := NewServiceWithOptions(&serviceRepoStub{
			savePendingTOTPSecretFn: func(context.Context, SavePendingTOTPSecretInput) error {
				return nil
			},
			getMFASettingsFn: func(_ context.Context, userID string) (MFASettingsRecord, error) {
				return MFASettingsRecord{
					UserID:                   userID,
					PendingTOTPSecretCipher:  pendingSecretCipher(t, encryptor, "JBSWY3DPEHPK3PXP"),
					PendingTOTPSecretVersion: 1,
					PendingTOTPExpiresAt:     timePtr(time.Now().Add(time.Minute)),
				}, nil
			},
			enableMFAFn: func(_ context.Context, input EnableMFAInput, codes []CreateMFARecoveryCodeInput) error {
				saved = input
				savedCodes = codes
				return nil
			},
		}, time.Minute, &serviceAuditRecorder{}, ServiceOptions{MFAEncryptor: encryptor})

		code, err := totp.GenerateCode("JBSWY3DPEHPK3PXP", time.Now())
		if err != nil {
			t.Fatal(err)
		}
		result, err := service.ConfirmMFASetup(ctx, AuthenticatedSession{UserID: "user-1"}, ConfirmMFASetupInput{Code: code})
		if err != nil {
			t.Fatalf("confirm returned error: %v", err)
		}
		if !result.Enabled {
			t.Fatal("expected mfa enabled")
		}
		if len(result.RecoveryCodes) != defaultMFARecoveryCodeCount {
			t.Fatalf("expected %d recovery codes, got %d", defaultMFARecoveryCodeCount, len(result.RecoveryCodes))
		}
		if saved.TOTPSecretCipher == "" || saved.TOTPSecretCipher == "JBSWY3DPEHPK3PXP" {
			t.Fatalf("secret was not encrypted: %q", saved.TOTPSecretCipher)
		}
		if len(savedCodes) != len(result.RecoveryCodes) {
			t.Fatalf("expected saved code hashes, got %d", len(savedCodes))
		}
		plainCodes := make(map[string]struct{})
		for _, code := range result.RecoveryCodes {
			plainCodes[code] = struct{}{}
		}
		for _, item := range savedCodes {
			if item.CodeHash == "" {
				t.Fatalf("recovery code hash looks unsafe: %q", item.CodeHash)
			}
			if _, ok := plainCodes[item.CodeHash]; ok {
				t.Fatalf("recovery code was stored in plaintext: %q", item.CodeHash)
			}
		}
	})

	t.Run("setup requires the current password before saving pending secret", func(t *testing.T) {
		var savedPending bool
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserByIDFn: func(_ context.Context, userID string) (UserRecord, error) {
				if userID != "user-1" {
					t.Fatalf("unexpected user id %q", userID)
				}
				return userRecord("user-1", "user@example.com", passwordHash), nil
			},
			getMFASettingsFn: func(_ context.Context, userID string) (MFASettingsRecord, error) {
				return MFASettingsRecord{}, db.ErrNotFound
			},
			savePendingTOTPSecretFn: func(context.Context, SavePendingTOTPSecretInput) error {
				savedPending = true
				return nil
			},
		}, time.Minute, &serviceAuditRecorder{}, ServiceOptions{MFAEncryptor: encryptor})

		if _, err := service.SetupMFA(ctx, AuthenticatedSession{UserID: "user-1"}, SetupMFAInput{Password: "wrong-pass"}); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("expected ErrInvalidCredentials, got %v", err)
		}
		if savedPending {
			t.Fatal("must not generate or save a pending secret before password verification")
		}

		result, err := service.SetupMFA(ctx, AuthenticatedSession{UserID: "user-1"}, SetupMFAInput{Password: "current-pass"})
		if err != nil {
			t.Fatalf("setup returned error: %v", err)
		}
		if result.ManualSecret == "" || result.QRCode == "" || result.OTPAuthURL == "" {
			t.Fatalf("expected setup material, got %#v", result)
		}
		if !savedPending {
			t.Fatal("expected pending secret to be saved after password verification")
		}
	})

	t.Run("recovery code login consumes the code once", func(t *testing.T) {
		recoveryCode := "ABCD-EFGH"
		codeHash := hashMFARecoveryCode("user-1", recoveryCode)
		var consumedID string
		service := NewServiceWithOptions(&serviceRepoStub{
			getMFATokenByHashFn: func(context.Context, string, time.Time) (MFATokenRecord, error) {
				return MFATokenRecord{
					ID:          "token-1",
					UserID:      "user-1",
					LoginMethod: "password",
					ClientIP:    stringPtr("203.0.113.10"),
					UserAgent:   stringPtr("test-agent"),
					Attempts:    0,
					MaxAttempts: defaultMFATokenMaxAttempts,
					ExpiresAt:   time.Now().Add(time.Minute),
					User:        userRecord("user-1", "user@example.com", passwordHash),
				}, nil
			},
			countRecentMFAFailuresFn: func(context.Context, CountRecentMFAFailuresInput) (int, error) {
				return 0, nil
			},
			listUnusedMFARecoveryCodesFn: func(context.Context, string) ([]MFARecoveryCodeRecord, error) {
				return []MFARecoveryCodeRecord{{ID: "code-1", UserID: "user-1", CodeHash: codeHash}}, nil
			},
			consumeMFARecoveryCodeFn: func(_ context.Context, id string, _ time.Time) error {
				consumedID = id
				return nil
			},
			markMFAUsedFn:     func(context.Context, string, time.Time) error { return nil },
			consumeMFATokenFn: func(context.Context, string, time.Time) error { return nil },
			createSessionFn: func(context.Context, CreateSessionInput) (SessionRecord, error) {
				return SessionRecord{ID: "session-1", UserID: "user-1", LoginMethod: "password", LastSeenAt: time.Now(), ExpiresAt: time.Now().Add(time.Minute), CreatedAt: time.Now()}, nil
			},
			revokeOtherSessionsFn: func(context.Context, string, string, time.Time) (int, error) { return 0, nil },
			getActiveSessionByTokenHash: func(context.Context, string, time.Time) (SessionRecord, error) {
				return SessionRecord{ID: "session-1", UserID: "user-1", User: userRecord("user-1", "user@example.com", passwordHash)}, nil
			},
			updateLastLoginFn: func(context.Context, string, time.Time) error { return nil },
		}, time.Minute, &serviceAuditRecorder{}, ServiceOptions{MFAEncryptor: encryptor})

		result, err := service.VerifyMFA(ctx, VerifyMFAInput{MFAToken: "pending-token", RecoveryCode: recoveryCode})
		if err != nil {
			t.Fatalf("verify returned error: %v", err)
		}
		if result.SessionToken == "" {
			t.Fatal("expected full session after recovery code")
		}
		if consumedID != "code-1" {
			t.Fatalf("expected recovery code consumed, got %q", consumedID)
		}
	})

	t.Run("mfa token rejects after max attempts", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{
			getMFATokenByHashFn: func(context.Context, string, time.Time) (MFATokenRecord, error) {
				return MFATokenRecord{
					ID:          "token-1",
					UserID:      "user-1",
					Attempts:    defaultMFATokenMaxAttempts,
					MaxAttempts: defaultMFATokenMaxAttempts,
					ExpiresAt:   time.Now().Add(time.Minute),
					User:        userRecord("user-1", "user@example.com", passwordHash),
				}, nil
			},
		}, time.Minute, &serviceAuditRecorder{}, ServiceOptions{MFAEncryptor: encryptor})

		_, err := service.VerifyMFA(ctx, VerifyMFAInput{MFAToken: "pending-token", Code: "000000"})
		if !errors.Is(err, ErrMFARateLimited) {
			t.Fatalf("expected ErrMFARateLimited, got %v", err)
		}
	})
}

func TestNormalizeRecoveryCode(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "keeps formatted code", input: "abcd-efgh", want: "ABCD-EFGH"},
		{name: "formats compact code", input: "abcdefgh", want: "ABCD-EFGH"},
		{name: "uses first code from copied list", input: "ABCD-EFGH\nJKLM-NPQR\nSTUV-WXYZ", want: "ABCD-EFGH"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeRecoveryCode(test.input); got != test.want {
				t.Fatalf("normalizeRecoveryCode(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func userRecord(id string, email string, passwordHash string) UserRecord {
	return UserRecord{
		ID:           id,
		Email:        email,
		DisplayName:  "User",
		PasswordHash: passwordHash,
		Status:       string(model.UserStatusActive),
		Role:         string(model.UserRoleUser),
	}
}

func pendingSecretCipher(t *testing.T, encryptor fakeMFAEncryptor, secret string) string {
	t.Helper()
	value, err := encryptor.Encrypt(secret)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func timePtr(value time.Time) *time.Time {
	return &value
}

type fakeMFAEncryptor struct{}

func (fakeMFAEncryptor) Encrypt(plain string) (string, error) {
	return "enc:" + plain, nil
}

func (fakeMFAEncryptor) Decrypt(cipherText string) (string, error) {
	return fakeMFAEncryptor{}.DecryptWithVersion(cipherText, 1)
}

func (fakeMFAEncryptor) ActiveKeyVersion() int {
	return 1
}

func (fakeMFAEncryptor) DecryptWithVersion(cipherText string, keyVersion int) (string, error) {
	if keyVersion != 1 || !strings.HasPrefix(cipherText, "enc:") {
		return "", errors.New("decrypt failed")
	}
	return strings.TrimPrefix(cipherText, "enc:"), nil
}
