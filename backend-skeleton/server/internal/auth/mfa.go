package auth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"image/png"
	"math/big"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrMFARequired       = errors.New("mfa required")
	ErrMFAUnavailable    = errors.New("mfa unavailable")
	ErrMFAInvalidCode    = errors.New("mfa code invalid")
	ErrMFARateLimited    = errors.New("mfa rate limited")
	ErrMFAAlreadyEnabled = errors.New("mfa already enabled")
	ErrMFANotEnabled     = errors.New("mfa not enabled")
)

const (
	LoginStatusSuccess     = "success"
	LoginStatusMFARequired = "mfa_required"

	defaultMFASetupTTL            = 10 * time.Minute
	defaultMFATokenTTL            = 5 * time.Minute
	defaultMFATokenMaxAttempts    = 5
	defaultMFAFailureWindow       = 15 * time.Minute
	defaultMFAUserIPMaxFailures   = 10
	defaultMFARecoveryCodeCount   = 8
	defaultMFARecoveryCodeLength  = 8
	defaultMFARecoveryCodeCharset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
)

type MFAEncryptor interface {
	Encrypt(plain string) (string, error)
	Decrypt(cipherText string) (string, error)
	ActiveKeyVersion() int
}

type mfaVersionedDecryptor interface {
	DecryptWithVersion(cipherText string, keyVersion int) (string, error)
}

type MFASettingsRecord struct {
	UserID                   string
	TOTPEnabled              bool
	TOTPSecretCipher         string
	TOTPSecretKeyVersion     int
	TOTPConfirmedAt          *time.Time
	PendingTOTPSecretCipher  string
	PendingTOTPSecretVersion int
	PendingTOTPExpiresAt     *time.Time
	LastUsedAt               *time.Time
}

type MFATokenRecord struct {
	ID          string
	UserID      string
	TokenHash   string
	LoginMethod string
	ClientIP    *string
	UserAgent   *string
	Attempts    int
	MaxAttempts int
	ExpiresAt   time.Time
	ConsumedAt  *time.Time
	CreatedAt   time.Time
	User        UserRecord
}

type MFARecoveryCodeRecord struct {
	ID       string
	UserID   string
	CodeHash string
	UsedAt   *time.Time
}

type SavePendingTOTPSecretInput struct {
	UserID           string
	SecretCipher     string
	SecretKeyVersion int
	ExpiresAt        time.Time
}

type EnableMFAInput struct {
	UserID               string
	TOTPSecretCipher     string
	TOTPSecretKeyVersion int
	ConfirmedAt          time.Time
}

type CreateMFARecoveryCodeInput struct {
	UserID   string
	CodeHash string
}

type CreateMFATokenInput struct {
	UserID      string
	TokenHash   string
	LoginMethod string
	ClientIP    *string
	UserAgent   *string
	ExpiresAt   time.Time
	MaxAttempts int
}

type CountRecentMFAFailuresInput struct {
	UserID   string
	ClientIP *string
	Since    time.Time
}

type SetupMFAResult struct {
	OTPAuthURL   string `json:"otpauth_url"`
	ManualSecret string `json:"manual_secret"`
	QRCode       string `json:"qr_code"`
}

type SetupMFAInput struct {
	Password string `json:"password"`
}

type ConfirmMFASetupInput struct {
	Code string `json:"code"`
}

type ConfirmMFASetupResult struct {
	Enabled       bool     `json:"enabled"`
	RecoveryCodes []string `json:"recovery_codes"`
}

type MFAStatusResult struct {
	Enabled           bool       `json:"enabled"`
	LastUsedAt        *time.Time `json:"last_used_at,omitempty"`
	ConfirmedAt       *time.Time `json:"confirmed_at,omitempty"`
	RecoveryCodeCount int        `json:"recovery_code_count"`
}

type VerifyMFAInput struct {
	MFAToken     string `json:"mfa_token"`
	Code         string `json:"code,omitempty"`
	RecoveryCode string `json:"recovery_code,omitempty"`
}

type DisableMFAInput struct {
	Password     string `json:"password"`
	Code         string `json:"code,omitempty"`
	RecoveryCode string `json:"recovery_code,omitempty"`
}

type RegenerateMFARecoveryCodesInput struct {
	Password     string `json:"password"`
	Code         string `json:"code,omitempty"`
	RecoveryCode string `json:"recovery_code,omitempty"`
}

func (s *Service) GetMFAStatus(ctx context.Context, session AuthenticatedSession) (MFAStatusResult, error) {
	if session.UserID == "" {
		return MFAStatusResult{}, ErrUnauthorized
	}
	settings, err := s.repo.GetMFASettings(ctx, session.UserID)
	if err != nil {
		if db.IsNotFound(err) {
			return MFAStatusResult{}, nil
		}
		return MFAStatusResult{}, err
	}
	count, err := s.repo.CountUnusedMFARecoveryCodes(ctx, session.UserID)
	if err != nil {
		return MFAStatusResult{}, err
	}
	return MFAStatusResult{
		Enabled:           settings.TOTPEnabled,
		LastUsedAt:        settings.LastUsedAt,
		ConfirmedAt:       settings.TOTPConfirmedAt,
		RecoveryCodeCount: count,
	}, nil
}

func (s *Service) SetupMFA(ctx context.Context, session AuthenticatedSession, input SetupMFAInput) (SetupMFAResult, error) {
	if session.UserID == "" {
		return SetupMFAResult{}, ErrUnauthorized
	}
	if strings.TrimSpace(input.Password) == "" {
		return SetupMFAResult{}, ErrInvalidInput
	}
	if s.mfaEncryptor == nil {
		return SetupMFAResult{}, ErrMFAUnavailable
	}
	user, err := s.repo.GetUserByID(ctx, session.UserID)
	if err != nil {
		if db.IsNotFound(err) {
			return SetupMFAResult{}, ErrUnauthorized
		}
		return SetupMFAResult{}, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)); err != nil {
		return SetupMFAResult{}, ErrInvalidCredentials
	}
	settings, err := s.repo.GetMFASettings(ctx, session.UserID)
	if err != nil && !db.IsNotFound(err) {
		return SetupMFAResult{}, err
	}
	if err == nil && settings.TOTPEnabled {
		return SetupMFAResult{}, ErrMFAAlreadyEnabled
	}
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "Online SSH",
		AccountName: user.Email,
		Period:      30,
		SecretSize:  20,
	})
	if err != nil {
		return SetupMFAResult{}, err
	}
	secret := key.Secret()
	cipherText, err := s.mfaEncryptor.Encrypt(secret)
	if err != nil {
		return SetupMFAResult{}, err
	}
	if err := s.repo.SavePendingTOTPSecret(ctx, SavePendingTOTPSecretInput{
		UserID:           session.UserID,
		SecretCipher:     cipherText,
		SecretKeyVersion: s.mfaEncryptor.ActiveKeyVersion(),
		ExpiresAt:        time.Now().Add(defaultMFASetupTTL),
	}); err != nil {
		return SetupMFAResult{}, err
	}
	qr, err := qrCodeDataURL(key)
	if err != nil {
		return SetupMFAResult{}, err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       session.UserID,
		EventType:    "mfa_setup_started",
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(session.UserID),
		Result:       string(model.AuditResultSuccess),
	})
	return SetupMFAResult{OTPAuthURL: key.URL(), ManualSecret: secret, QRCode: qr}, nil
}

func (s *Service) ConfirmMFASetup(ctx context.Context, session AuthenticatedSession, input ConfirmMFASetupInput) (ConfirmMFASetupResult, error) {
	if session.UserID == "" {
		return ConfirmMFASetupResult{}, ErrUnauthorized
	}
	settings, err := s.repo.GetMFASettings(ctx, session.UserID)
	if err != nil {
		if db.IsNotFound(err) {
			return ConfirmMFASetupResult{}, ErrMFAInvalidCode
		}
		return ConfirmMFASetupResult{}, err
	}
	if settings.TOTPEnabled {
		return ConfirmMFASetupResult{}, ErrMFAAlreadyEnabled
	}
	if settings.PendingTOTPSecretCipher == "" || settings.PendingTOTPExpiresAt == nil || time.Now().After(*settings.PendingTOTPExpiresAt) {
		return ConfirmMFASetupResult{}, ErrMFAInvalidCode
	}
	secret, err := s.decryptMFASecret(settings.PendingTOTPSecretCipher, settings.PendingTOTPSecretVersion)
	if err != nil {
		return ConfirmMFASetupResult{}, err
	}
	if !validateTOTP(secret, input.Code, time.Now()) {
		return ConfirmMFASetupResult{}, ErrMFAInvalidCode
	}
	cipherText, err := s.mfaEncryptor.Encrypt(secret)
	if err != nil {
		return ConfirmMFASetupResult{}, err
	}
	recoveryCodes, codeInputs, err := generateRecoveryCodes(session.UserID)
	if err != nil {
		return ConfirmMFASetupResult{}, err
	}
	now := time.Now()
	if err := s.repo.EnableMFA(ctx, EnableMFAInput{
		UserID:               session.UserID,
		TOTPSecretCipher:     cipherText,
		TOTPSecretKeyVersion: s.mfaEncryptor.ActiveKeyVersion(),
		ConfirmedAt:          now,
	}, codeInputs); err != nil {
		return ConfirmMFASetupResult{}, err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       session.UserID,
		EventType:    "mfa_enabled",
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(session.UserID),
		Result:       string(model.AuditResultSuccess),
	})
	return ConfirmMFASetupResult{Enabled: true, RecoveryCodes: recoveryCodes}, nil
}

func (s *Service) VerifyMFA(ctx context.Context, input VerifyMFAInput) (LoginResult, error) {
	token := strings.TrimSpace(input.MFAToken)
	if token == "" {
		return LoginResult{}, ErrInvalidInput
	}
	now := time.Now()
	record, err := s.repo.GetMFATokenByHash(ctx, hashToken(token), now)
	if err != nil {
		if db.IsNotFound(err) {
			return LoginResult{}, ErrMFAInvalidCode
		}
		return LoginResult{}, err
	}
	if record.Attempts >= record.MaxAttempts {
		return LoginResult{}, ErrMFARateLimited
	}
	failures, err := s.repo.CountRecentMFAFailures(ctx, CountRecentMFAFailuresInput{
		UserID:   record.UserID,
		ClientIP: record.ClientIP,
		Since:    now.Add(-defaultMFAFailureWindow),
	})
	if err != nil {
		return LoginResult{}, err
	}
	if failures >= defaultMFAUserIPMaxFailures {
		return LoginResult{}, ErrMFARateLimited
	}
	usedRecoveryCode := false
	if strings.TrimSpace(input.RecoveryCode) != "" {
		if err := s.verifyRecoveryCode(ctx, record.UserID, input.RecoveryCode, true); err != nil {
			_ = s.recordMFAFailure(ctx, record, "invalid recovery code")
			return LoginResult{}, err
		}
		usedRecoveryCode = true
	} else {
		if err := s.verifyTOTPForUser(ctx, record.UserID, input.Code); err != nil {
			_ = s.recordMFAFailure(ctx, record, "invalid totp code")
			return LoginResult{}, err
		}
	}
	if err := s.repo.MarkMFAUsed(ctx, record.UserID, now); err != nil {
		return LoginResult{}, err
	}
	if err := s.repo.ConsumeMFAToken(ctx, record.ID, now); err != nil {
		return LoginResult{}, err
	}
	result, err := s.createLoginSession(ctx, record.User, stringValue(record.ClientIP), stringValue(record.UserAgent), record.LoginMethod)
	if err != nil {
		return LoginResult{}, err
	}
	eventType := "mfa_login_verified"
	if usedRecoveryCode {
		eventType = "mfa_recovery_code_used"
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       record.UserID,
		EventType:    eventType,
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(record.UserID),
		Result:       string(model.AuditResultSuccess),
		ClientIP:     record.ClientIP,
		UserAgent:    record.UserAgent,
	})
	return result, nil
}

func (s *Service) DisableMFA(ctx context.Context, session AuthenticatedSession, input DisableMFAInput) error {
	if session.UserID == "" {
		return ErrUnauthorized
	}
	if strings.TrimSpace(input.Password) == "" {
		return ErrInvalidInput
	}
	user, err := s.repo.GetUserByID(ctx, session.UserID)
	if err != nil {
		if db.IsNotFound(err) {
			return ErrUnauthorized
		}
		return err
	}
	if err := comparePassword(user.PasswordHash, input.Password); err != nil {
		return ErrInvalidCredentials
	}
	if err := s.verifyTOTPOrRecovery(ctx, session.UserID, input.Code, input.RecoveryCode, true); err != nil {
		return err
	}
	if err := s.repo.DisableMFA(ctx, session.UserID); err != nil {
		return err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       session.UserID,
		EventType:    "mfa_disabled",
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(session.UserID),
		Result:       string(model.AuditResultSuccess),
	})
	return nil
}

func (s *Service) RegenerateMFARecoveryCodes(ctx context.Context, session AuthenticatedSession, input RegenerateMFARecoveryCodesInput) (ConfirmMFASetupResult, error) {
	if session.UserID == "" {
		return ConfirmMFASetupResult{}, ErrUnauthorized
	}
	user, err := s.repo.GetUserByID(ctx, session.UserID)
	if err != nil {
		if db.IsNotFound(err) {
			return ConfirmMFASetupResult{}, ErrUnauthorized
		}
		return ConfirmMFASetupResult{}, err
	}
	if err := comparePassword(user.PasswordHash, input.Password); err != nil {
		return ConfirmMFASetupResult{}, ErrInvalidCredentials
	}
	if err := s.verifyTOTPOrRecovery(ctx, session.UserID, input.Code, input.RecoveryCode, true); err != nil {
		return ConfirmMFASetupResult{}, err
	}
	codes, codeInputs, err := generateRecoveryCodes(session.UserID)
	if err != nil {
		return ConfirmMFASetupResult{}, err
	}
	if err := s.repo.ReplaceMFARecoveryCodes(ctx, session.UserID, codeInputs); err != nil {
		return ConfirmMFASetupResult{}, err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       session.UserID,
		EventType:    "mfa_recovery_codes_regenerated",
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(session.UserID),
		Result:       string(model.AuditResultSuccess),
	})
	return ConfirmMFASetupResult{Enabled: true, RecoveryCodes: codes}, nil
}

func (s *Service) createPendingMFALogin(ctx context.Context, user UserRecord, clientIP string, userAgent string, loginMethod string) (LoginResult, error) {
	token, err := randomToken()
	if err != nil {
		return LoginResult{}, err
	}
	now := time.Now()
	if _, err := s.repo.CreateMFAToken(ctx, CreateMFATokenInput{
		UserID:      user.ID,
		TokenHash:   hashToken(token),
		LoginMethod: normalizedLoginMethod(loginMethod),
		ClientIP:    optionalString(clientIP),
		UserAgent:   optionalString(userAgent),
		ExpiresAt:   now.Add(defaultMFATokenTTL),
		MaxAttempts: defaultMFATokenMaxAttempts,
	}); err != nil {
		return LoginResult{}, err
	}
	return LoginResult{
		Status:       LoginStatusMFARequired,
		MFAToken:     token,
		MFAMethods:   []string{"totp", "recovery_code"},
		MFAExpiresAt: now.Add(defaultMFATokenTTL),
	}, nil
}

func (s *Service) userRequiresMFA(ctx context.Context, userID string) (bool, error) {
	settings, err := s.repo.GetMFASettings(ctx, userID)
	if err != nil {
		if db.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}
	return settings.TOTPEnabled, nil
}

func (s *Service) verifyTOTPOrRecovery(ctx context.Context, userID string, code string, recoveryCode string, consumeRecovery bool) error {
	if strings.TrimSpace(recoveryCode) != "" {
		return s.verifyRecoveryCode(ctx, userID, recoveryCode, consumeRecovery)
	}
	return s.verifyTOTPForUser(ctx, userID, code)
}

func (s *Service) verifyTOTPForUser(ctx context.Context, userID string, code string) error {
	settings, err := s.repo.GetMFASettings(ctx, userID)
	if err != nil {
		if db.IsNotFound(err) {
			return ErrMFANotEnabled
		}
		return err
	}
	if !settings.TOTPEnabled || settings.TOTPSecretCipher == "" {
		return ErrMFANotEnabled
	}
	secret, err := s.decryptMFASecret(settings.TOTPSecretCipher, settings.TOTPSecretKeyVersion)
	if err != nil {
		return err
	}
	if !validateTOTP(secret, code, time.Now()) {
		return ErrMFAInvalidCode
	}
	return nil
}

func (s *Service) verifyRecoveryCode(ctx context.Context, userID string, code string, consume bool) error {
	normalized := normalizeRecoveryCode(code)
	if normalized == "" {
		return ErrMFAInvalidCode
	}
	codes, err := s.repo.ListUnusedMFARecoveryCodes(ctx, userID)
	if err != nil {
		return err
	}
	expected := hashMFARecoveryCode(userID, normalized)
	for _, item := range codes {
		if hmac.Equal([]byte(item.CodeHash), []byte(expected)) {
			if consume {
				if err := s.repo.ConsumeMFARecoveryCode(ctx, item.ID, time.Now()); err != nil {
					if db.IsNotFound(err) {
						return ErrMFAInvalidCode
					}
					return err
				}
			}
			return nil
		}
	}
	return ErrMFAInvalidCode
}

func (s *Service) recordMFAFailure(ctx context.Context, record MFATokenRecord, reason string) error {
	if err := s.repo.IncrementMFATokenAttempts(ctx, record.ID); err != nil {
		return err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       record.UserID,
		EventType:    "mfa_login_failed",
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(record.UserID),
		Result:       string(model.AuditResultFailure),
		ClientIP:     record.ClientIP,
		UserAgent:    record.UserAgent,
		Message:      optionalString("mfa verification failed"),
		MetadataJSON: jsonMetadata(map[string]any{"reason": reason}),
	})
	return nil
}

func (s *Service) decryptMFASecret(cipherText string, keyVersion int) (string, error) {
	if s.mfaEncryptor == nil {
		return "", ErrMFAUnavailable
	}
	if versioned, ok := s.mfaEncryptor.(mfaVersionedDecryptor); ok && keyVersion > 0 {
		return versioned.DecryptWithVersion(cipherText, keyVersion)
	}
	return s.mfaEncryptor.Decrypt(cipherText)
}

func validateTOTP(secret string, code string, now time.Time) bool {
	valid, err := totp.ValidateCustom(strings.TrimSpace(code), secret, now, totp.ValidateOpts{
		Period:    30,
		Skew:      1,
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	return err == nil && valid
}

func generateRecoveryCodes(userID string) ([]string, []CreateMFARecoveryCodeInput, error) {
	plain := make([]string, 0, defaultMFARecoveryCodeCount)
	hashed := make([]CreateMFARecoveryCodeInput, 0, defaultMFARecoveryCodeCount)
	for len(plain) < defaultMFARecoveryCodeCount {
		code, err := randomRecoveryCode()
		if err != nil {
			return nil, nil, err
		}
		plain = append(plain, code)
		hashed = append(hashed, CreateMFARecoveryCodeInput{
			UserID:   userID,
			CodeHash: hashMFARecoveryCode(userID, code),
		})
	}
	return plain, hashed, nil
}

func randomRecoveryCode() (string, error) {
	var builder strings.Builder
	builder.Grow(defaultMFARecoveryCodeLength + 1)
	for i := 0; i < defaultMFARecoveryCodeLength; i++ {
		if i == 4 {
			builder.WriteByte('-')
		}
		value, err := rand.Int(rand.Reader, big.NewInt(int64(len(defaultMFARecoveryCodeCharset))))
		if err != nil {
			return "", err
		}
		builder.WriteByte(defaultMFARecoveryCodeCharset[value.Int64()])
	}
	return builder.String(), nil
}

func hashMFARecoveryCode(userID string, code string) string {
	sum := sha256.Sum256([]byte(userID + "\x00" + normalizeRecoveryCode(code)))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func normalizeRecoveryCode(code string) string {
	compact := strings.Builder{}
	compact.Grow(defaultMFARecoveryCodeLength)
	for _, char := range strings.ToUpper(code) {
		if (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			compact.WriteRune(char)
			if compact.Len() >= defaultMFARecoveryCodeLength {
				break
			}
		}
	}
	value := compact.String()
	if len(value) <= 4 {
		return value
	}
	return value[:4] + "-" + value[4:]
}

func qrCodeDataURL(key *otp.Key) (string, error) {
	image, err := key.Image(220, 220)
	if err != nil {
		return "", err
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, image); err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buffer.Bytes()), nil
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func comparePassword(hash string, password string) error {
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return ErrInvalidCredentials
	}
	return nil
}

func mfaLoginResponse(result LoginResult) map[string]any {
	return map[string]any{
		"status":     LoginStatusMFARequired,
		"mfa_token":  result.MFAToken,
		"methods":    result.MFAMethods,
		"expires_at": result.MFAExpiresAt,
	}
}
