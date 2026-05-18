package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/mail"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/settings"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidCredentials          = errors.New("invalid credentials")
	ErrAccountDisabled             = errors.New("account disabled")
	ErrEmailAlreadyExists          = errors.New("email already exists")
	ErrUsernameAlreadyExists       = errors.New("username already exists")
	ErrRegistrationDisabled        = errors.New("registration disabled")
	ErrUnauthorized                = errors.New("unauthorized")
	ErrSessionRevoked              = errors.New("session revoked")
	ErrInvalidInput                = errors.New("invalid input")
	ErrEmailNotAllowed             = errors.New("email not allowed")
	ErrEmailSenderUnavailable      = errors.New("email sender unavailable")
	ErrVerificationCodeInvalid     = errors.New("verification code invalid")
	ErrVerificationCodeRateLimited = errors.New("verification code rate limited")
	ErrLastAdminAccess             = errors.New("cannot remove last admin access")
	ErrPasswordUnchanged           = errors.New("password unchanged")
)

const (
	defaultRefreshTTL              = 7 * 24 * time.Hour
	defaultIdleTimeout             = 2 * time.Hour
	defaultEmailCodeLength         = 6
	defaultEmailCodeTTL            = 5 * time.Minute
	defaultEmailCodeMaxAttempts    = 5
	defaultEmailCodeResendCooldown = time.Minute
	defaultEmailCodeWindow         = 15 * time.Minute
	defaultEmailCodeEmailMaxSends  = 5
	defaultEmailCodeIPMaxSends     = 10
)

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

type Service struct {
	repo                    Repository
	ttl                     time.Duration
	idleTimeout             time.Duration
	refreshTTL              time.Duration
	audit                   AuditRecorder
	mfaEncryptor            MFAEncryptor
	allowRegistration       bool
	onOtherSessionsRevoked  func(context.Context, string)
	emailSender             EmailSender
	emailCodeHashSecret     string
	allowedEmails           map[string]struct{}
	allowedEmailDomains     map[string]struct{}
	emailCodeLength         int
	emailCodeTTL            time.Duration
	emailCodeMaxAttempts    int
	emailCodeResendCooldown time.Duration
	emailCodeEmailWindow    time.Duration
	emailCodeEmailMaxSends  int
	emailCodeIPWindow       time.Duration
	emailCodeIPMaxSends     int
	settingsProvider        func() settings.General
	emailSenderProvider     func() EmailSender
}

func NewService(repo Repository, ttl time.Duration, audit AuditRecorder) *Service {
	return NewServiceWithOptions(repo, ttl, audit, ServiceOptions{AllowRegistration: true})
}

type ServiceOptions struct {
	AllowRegistration       bool
	IdleTimeout             time.Duration
	RefreshTTL              time.Duration
	EmailSender             EmailSender
	EmailCodeHashSecret     string
	AllowedEmails           []string
	AllowedEmailDomains     []string
	EmailCodeLength         int
	EmailCodeTTL            time.Duration
	EmailCodeMaxAttempts    int
	EmailCodeResendCooldown time.Duration
	EmailCodeEmailWindow    time.Duration
	EmailCodeEmailMaxSends  int
	EmailCodeIPWindow       time.Duration
	EmailCodeIPMaxSends     int
	SettingsProvider        func() settings.General
	EmailSenderProvider     func() EmailSender
	MFAEncryptor            MFAEncryptor
}

type EmailSender interface {
	Send(ctx context.Context, message EmailMessage) error
}

type EmailMessage struct {
	To      string
	Subject string
	Body    string
	HTML    string
}

func NewServiceWithOptions(repo Repository, ttl time.Duration, audit AuditRecorder, options ServiceOptions) *Service {
	idleTimeout := options.IdleTimeout
	if idleTimeout <= 0 {
		idleTimeout = defaultIdleTimeout
	}
	refreshTTL := options.RefreshTTL
	if refreshTTL <= 0 {
		refreshTTL = defaultRefreshTTL
	}
	emailCodeLength := options.EmailCodeLength
	if emailCodeLength <= 0 {
		emailCodeLength = defaultEmailCodeLength
	}
	emailCodeTTL := options.EmailCodeTTL
	if emailCodeTTL <= 0 {
		emailCodeTTL = defaultEmailCodeTTL
	}
	emailCodeMaxAttempts := options.EmailCodeMaxAttempts
	if emailCodeMaxAttempts <= 0 {
		emailCodeMaxAttempts = defaultEmailCodeMaxAttempts
	}
	emailCodeResendCooldown := options.EmailCodeResendCooldown
	if emailCodeResendCooldown <= 0 {
		emailCodeResendCooldown = defaultEmailCodeResendCooldown
	}
	emailCodeEmailWindow := options.EmailCodeEmailWindow
	if emailCodeEmailWindow <= 0 {
		emailCodeEmailWindow = defaultEmailCodeWindow
	}
	emailCodeEmailMaxSends := options.EmailCodeEmailMaxSends
	if emailCodeEmailMaxSends <= 0 {
		emailCodeEmailMaxSends = defaultEmailCodeEmailMaxSends
	}
	emailCodeIPWindow := options.EmailCodeIPWindow
	if emailCodeIPWindow <= 0 {
		emailCodeIPWindow = defaultEmailCodeWindow
	}
	emailCodeIPMaxSends := options.EmailCodeIPMaxSends
	if emailCodeIPMaxSends <= 0 {
		emailCodeIPMaxSends = defaultEmailCodeIPMaxSends
	}
	return &Service{
		repo:                    repo,
		ttl:                     ttl,
		idleTimeout:             idleTimeout,
		refreshTTL:              refreshTTL,
		audit:                   audit,
		mfaEncryptor:            options.MFAEncryptor,
		allowRegistration:       options.AllowRegistration,
		emailSender:             options.EmailSender,
		emailCodeHashSecret:     strings.TrimSpace(options.EmailCodeHashSecret),
		allowedEmails:           normalizeEmailSet(options.AllowedEmails),
		allowedEmailDomains:     normalizeDomainSet(options.AllowedEmailDomains),
		emailCodeLength:         emailCodeLength,
		emailCodeTTL:            emailCodeTTL,
		emailCodeMaxAttempts:    emailCodeMaxAttempts,
		emailCodeResendCooldown: emailCodeResendCooldown,
		emailCodeEmailWindow:    emailCodeEmailWindow,
		emailCodeEmailMaxSends:  emailCodeEmailMaxSends,
		emailCodeIPWindow:       emailCodeIPWindow,
		emailCodeIPMaxSends:     emailCodeIPMaxSends,
		settingsProvider:        options.SettingsProvider,
		emailSenderProvider:     options.EmailSenderProvider,
	}
}

func (s *Service) SetOtherSessionsRevokedHook(hook func(context.Context, string)) {
	if s == nil {
		return
	}
	s.onOtherSessionsRevoked = hook
}

func (s *Service) currentSettings() settings.General {
	cfg := settings.General{
		AllowUserRegistration:               s.allowRegistration,
		SessionIdleTimeoutMinutes:           int(s.idleTimeout / time.Minute),
		RefreshTokenTTLHours:                int(s.refreshTTL / time.Hour),
		AuthEmailCodeLength:                 s.emailCodeLength,
		AuthEmailCodeTTLMinutes:             int(s.emailCodeTTL / time.Minute),
		AuthEmailCodeMaxAttempts:            s.emailCodeMaxAttempts,
		AuthEmailCodeResendCooldownSeconds:  int(s.emailCodeResendCooldown / time.Second),
		AuthEmailCodeEmailWindowMinutes:     int(s.emailCodeEmailWindow / time.Minute),
		AuthEmailCodeEmailWindowMaxSends:    s.emailCodeEmailMaxSends,
		AuthEmailCodeIPWindowMinutes:        int(s.emailCodeIPWindow / time.Minute),
		AuthEmailCodeIPWindowMaxSends:       s.emailCodeIPMaxSends,
		SMTPPort:                            587,
		TerminalMaxSessionsPerUser:          1,
		TerminalMaxSessionsTotal:            1,
		TerminalKeepAliveHours:              1,
		FileSFTPIdleTTLMinutes:              1,
		HostConnectivityPollIntervalSeconds: 30,
	}
	if s != nil && s.settingsProvider != nil {
		next := s.settingsProvider()
		if normalized, err := settings.Normalize(next); err == nil {
			cfg.AllowUserRegistration = normalized.AllowUserRegistration
			cfg.SessionIdleTimeoutMinutes = normalized.SessionIdleTimeoutMinutes
			cfg.RefreshTokenTTLHours = normalized.RefreshTokenTTLHours
			cfg.AuthEmailCodeLength = normalized.AuthEmailCodeLength
			cfg.AuthEmailCodeTTLMinutes = normalized.AuthEmailCodeTTLMinutes
			cfg.AuthEmailCodeMaxAttempts = normalized.AuthEmailCodeMaxAttempts
			cfg.AuthEmailCodeResendCooldownSeconds = normalized.AuthEmailCodeResendCooldownSeconds
			cfg.AuthEmailCodeEmailWindowMinutes = normalized.AuthEmailCodeEmailWindowMinutes
			cfg.AuthEmailCodeEmailWindowMaxSends = normalized.AuthEmailCodeEmailWindowMaxSends
			cfg.AuthEmailCodeIPWindowMinutes = normalized.AuthEmailCodeIPWindowMinutes
			cfg.AuthEmailCodeIPWindowMaxSends = normalized.AuthEmailCodeIPWindowMaxSends
			cfg.AuthAllowedEmails = normalized.AuthAllowedEmails
			cfg.AuthAllowedEmailDomains = normalized.AuthAllowedEmailDomains
		}
	}
	return cfg
}

func (s *Service) currentEmailSender() EmailSender {
	if s != nil && s.emailSenderProvider != nil {
		return s.emailSenderProvider()
	}
	if s == nil {
		return nil
	}
	return s.emailSender
}

type RegisterInput struct {
	Email            string `json:"email"`
	Password         string `json:"password"`
	PasswordConfirm  string `json:"password_confirm,omitempty"`
	DisplayName      string `json:"display_name"`
	VerificationCode string `json:"verification_code"`
}

type LoginInput struct {
	Identifier string
	Email      string
	Password   string
	ClientIP   string
	UserAgent  string
}

type EmailCodeLoginInput struct {
	Identifier       string
	Email            string
	VerificationCode string
	ClientIP         string
	UserAgent        string
}

type SendEmailVerificationCodeInput struct {
	Identifier string
	Email      string
	Purpose    EmailVerificationPurpose
	ClientIP   string
}

type SendAccountEmailVerificationCodeInput struct {
	Stage    string `json:"stage"`
	Email    string `json:"email,omitempty"`
	ClientIP string
}

type ChangePasswordInput struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type ChangePasswordResult struct {
	RevokedSessionCount int `json:"revoked_session_count"`
}

type ChangeEmailInput struct {
	CurrentEmailCode string `json:"current_email_code"`
	NewEmail         string `json:"new_email"`
	NewEmailCode     string `json:"new_email_code"`
}

type DeleteAccountInput struct {
	CurrentPassword string `json:"current_password"`
}

type RefreshInput struct {
	RefreshToken string
	ClientIP     string
	UserAgent    string
}

type SessionInfo struct {
	ID          string    `json:"id"`
	ClientIP    *string   `json:"client_ip,omitempty"`
	UserAgent   *string   `json:"user_agent,omitempty"`
	DeviceLabel *string   `json:"device_label,omitempty"`
	LoginMethod string    `json:"login_method"`
	LastSeenAt  time.Time `json:"last_seen_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
}

type LoginResult struct {
	Status           string
	User             model.User
	Session          SessionInfo
	SessionToken     string
	RefreshToken     string
	ExpiresAt        time.Time
	RefreshExpiresAt time.Time
	MFAToken         string
	MFAMethods       []string
	MFAExpiresAt     time.Time
}

type RefreshResult struct {
	User             model.User
	Session          SessionInfo
	SessionToken     string
	RefreshToken     string
	ExpiresAt        time.Time
	RefreshExpiresAt time.Time
}

type AuthenticatedSession struct {
	SessionID string
	UserID    string
	User      model.User
	Session   SessionInfo
}

func (s *Service) Register(ctx context.Context, input RegisterInput) (model.User, error) {
	cfg := s.currentSettings()
	if !cfg.AllowUserRegistration {
		return model.User{}, ErrRegistrationDisabled
	}

	email := normalizeEmail(input.Email)
	displayName := strings.TrimSpace(input.DisplayName)
	if email == "" || displayName == "" || len(input.Password) < 8 {
		return model.User{}, ErrInvalidInput
	}
	if !s.isEmailAllowed(email) {
		return model.User{}, ErrEmailNotAllowed
	}
	if strings.TrimSpace(s.emailCodeHashSecret) != "" {
		if input.PasswordConfirm == "" || input.PasswordConfirm != input.Password {
			return model.User{}, ErrInvalidInput
		}
		if err := s.verifyEmailCode(ctx, email, EmailVerificationPurposeRegister, input.VerificationCode); err != nil {
			return model.User{}, err
		}
	} else if input.PasswordConfirm != "" && input.PasswordConfirm != input.Password {
		return model.User{}, ErrInvalidInput
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return model.User{}, err
	}

	record, err := s.repo.CreateUser(ctx, CreateUserInput{
		Email:        email,
		PasswordHash: string(passwordHash),
		DisplayName:  displayName,
		Role:         string(model.UserRoleUser),
	})
	if err != nil {
		if db.IsUniqueViolation(err) {
			if uniqueViolationConstraint(err) == "uq_users_display_name_lower" {
				return model.User{}, ErrUsernameAlreadyExists
			}
			return model.User{}, ErrEmailAlreadyExists
		}
		return model.User{}, err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:    record.ID,
		EventType: "auth_register",
		Result:    string(model.AuditResultSuccess),
	})

	return userRecordToModel(record), nil
}

func (s *Service) SendEmailVerificationCode(ctx context.Context, input SendEmailVerificationCodeInput) error {
	cfg := s.currentSettings()
	if input.Purpose != EmailVerificationPurposeRegister && input.Purpose != EmailVerificationPurposeLogin {
		return ErrInvalidInput
	}
	if input.Purpose == EmailVerificationPurposeRegister {
		email := normalizeEmail(input.Email)
		if email == "" {
			return ErrInvalidInput
		}
		if !cfg.AllowUserRegistration {
			return ErrRegistrationDisabled
		}
		if !s.isEmailAllowed(email) {
			return ErrEmailNotAllowed
		}
		return s.sendEmailVerificationCode(ctx, email, input.Purpose, input.ClientIP)
	}

	user, _, err := s.lookupUserByLoginIdentifier(ctx, firstNonBlank(input.Identifier, input.Email))
	if err != nil {
		return err
	}
	if user.Status != string(model.UserStatusActive) {
		return ErrAccountDisabled
	}
	return s.sendEmailVerificationCode(ctx, user.Email, input.Purpose, input.ClientIP)
}

func (s *Service) SendAccountEmailVerificationCode(ctx context.Context, session AuthenticatedSession, input SendAccountEmailVerificationCodeInput) error {
	if session.UserID == "" {
		return ErrUnauthorized
	}
	user, err := s.repo.GetUserByID(ctx, session.UserID)
	if err != nil {
		if db.IsNotFound(err) {
			return ErrUnauthorized
		}
		return err
	}

	stage := strings.TrimSpace(input.Stage)
	switch stage {
	case "current":
		return s.sendEmailVerificationCode(ctx, user.Email, EmailVerificationPurposeEmailCurrent, input.ClientIP)
	case "new":
		email := normalizeEmail(input.Email)
		if email == "" || email == normalizeEmail(user.Email) {
			return ErrInvalidInput
		}
		existing, err := s.repo.GetUserByEmail(ctx, email)
		if err != nil && !db.IsNotFound(err) {
			return err
		}
		if err == nil && existing.ID != user.ID {
			return ErrEmailAlreadyExists
		}
		return s.sendEmailVerificationCode(ctx, email, EmailVerificationPurposeEmailNew, input.ClientIP)
	default:
		return ErrInvalidInput
	}
}

func (s *Service) sendEmailVerificationCode(ctx context.Context, email string, purpose EmailVerificationPurpose, rawClientIP string) error {
	cfg := s.currentSettings()
	emailSender := s.currentEmailSender()
	if emailSender == nil {
		return ErrEmailSenderUnavailable
	}
	if strings.TrimSpace(s.emailCodeHashSecret) == "" {
		return ErrEmailSenderUnavailable
	}

	now := time.Now()
	recentEmailSends, err := s.repo.CountEmailVerificationCodeSends(ctx, CountEmailVerificationCodeSendsInput{
		Email: email,
		Since: now.Add(-cfg.EmailCodeEmailWindow()),
	})
	if err != nil {
		return err
	}
	if recentEmailSends >= cfg.AuthEmailCodeEmailWindowMaxSends {
		return ErrVerificationCodeRateLimited
	}

	cooldownSends, err := s.repo.CountEmailVerificationCodeSends(ctx, CountEmailVerificationCodeSendsInput{
		Email: email,
		Since: now.Add(-cfg.EmailCodeResendCooldown()),
	})
	if err != nil {
		return err
	}
	if cooldownSends > 0 {
		return ErrVerificationCodeRateLimited
	}

	var clientIP *string
	if trimmedIP := strings.TrimSpace(rawClientIP); trimmedIP != "" {
		clientIP = &trimmedIP
		ipSends, err := s.repo.CountEmailVerificationCodeSends(ctx, CountEmailVerificationCodeSendsInput{
			ClientIP: clientIP,
			Since:    now.Add(-cfg.EmailCodeIPWindow()),
		})
		if err != nil {
			return err
		}
		if ipSends >= cfg.AuthEmailCodeIPWindowMaxSends {
			return ErrVerificationCodeRateLimited
		}
	}

	code, err := randomNumericCode(cfg.AuthEmailCodeLength)
	if err != nil {
		return err
	}
	if _, err := s.repo.CreateEmailVerificationCode(ctx, CreateEmailVerificationCodeInput{
		Email:       email,
		Purpose:     purpose,
		CodeHash:    hashEmailVerificationCode(s.emailCodeHashSecret, email, purpose, code),
		ClientIP:    clientIP,
		ExpiresAt:   now.Add(cfg.EmailCodeTTL()),
		MaxAttempts: cfg.AuthEmailCodeMaxAttempts,
	}); err != nil {
		return err
	}

	htmlBody, err := mail.RenderVerificationCodeHTML(mail.VerificationCodeTemplateData{
		Brand:      "Online SSH",
		Code:       code,
		Footer:     "This email was sent automatically by Online SSH. Please do not reply to this email.",
		Heading:    "Your verification code",
		Title:      "Online SSH verification code",
		TTLMinutes: cfg.AuthEmailCodeTTLMinutes,
	})
	if err != nil {
		return err
	}

	if err := emailSender.Send(ctx, EmailMessage{
		To:      email,
		Subject: "Online SSH verification code",
		Body:    fmt.Sprintf("Your Online SSH verification code is %s. It expires in %d minutes.", code, cfg.AuthEmailCodeTTLMinutes),
		HTML:    htmlBody,
	}); err != nil {
		return err
	}

	s.recordAudit(ctx, model.AuditLog{
		EventType:    "auth_email_code_send",
		ResourceType: stringPtr("email_verification_code"),
		Result:       string(model.AuditResultSuccess),
		ClientIP:     clientIP,
		Message:      optionalString(fmt.Sprintf("verification code sent for %s", purpose)),
		MetadataJSON: jsonMetadata(map[string]any{
			"email":   email,
			"purpose": purpose,
		}),
	})

	return nil
}

func (s *Service) ChangePassword(ctx context.Context, session AuthenticatedSession, input ChangePasswordInput) (ChangePasswordResult, error) {
	if session.UserID == "" || session.SessionID == "" {
		return ChangePasswordResult{}, ErrUnauthorized
	}
	if input.CurrentPassword == "" || len(input.NewPassword) < 8 {
		return ChangePasswordResult{}, ErrInvalidInput
	}
	user, err := s.repo.GetUserByID(ctx, session.UserID)
	if err != nil {
		if db.IsNotFound(err) {
			return ChangePasswordResult{}, ErrUnauthorized
		}
		return ChangePasswordResult{}, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.CurrentPassword)); err != nil {
		return ChangePasswordResult{}, ErrInvalidCredentials
	}
	if input.NewPassword == input.CurrentPassword {
		return ChangePasswordResult{}, ErrPasswordUnchanged
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		return ChangePasswordResult{}, err
	}
	if err := s.repo.UpdateUserPassword(ctx, user.ID, string(passwordHash)); err != nil {
		if db.IsNotFound(err) {
			return ChangePasswordResult{}, ErrUnauthorized
		}
		return ChangePasswordResult{}, err
	}
	revokedCount, err := s.repo.RevokeOtherSessions(ctx, user.ID, session.SessionID, time.Now())
	if err != nil {
		return ChangePasswordResult{}, err
	}
	if revokedCount > 0 && s.onOtherSessionsRevoked != nil {
		s.onOtherSessionsRevoked(ctx, user.ID)
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       user.ID,
		EventType:    "account_password_changed",
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(user.ID),
		Result:       string(model.AuditResultSuccess),
		Message:      optionalString("account password changed"),
		MetadataJSON: jsonMetadata(map[string]any{
			"revoked_session_count": revokedCount,
		}),
	})
	return ChangePasswordResult{RevokedSessionCount: revokedCount}, nil
}

func (s *Service) ChangeEmail(ctx context.Context, session AuthenticatedSession, input ChangeEmailInput) (model.User, error) {
	if session.UserID == "" {
		return model.User{}, ErrUnauthorized
	}
	newEmail := normalizeEmail(input.NewEmail)
	if newEmail == "" || strings.TrimSpace(input.CurrentEmailCode) == "" || strings.TrimSpace(input.NewEmailCode) == "" {
		return model.User{}, ErrInvalidInput
	}
	user, err := s.repo.GetUserByID(ctx, session.UserID)
	if err != nil {
		if db.IsNotFound(err) {
			return model.User{}, ErrUnauthorized
		}
		return model.User{}, err
	}
	if newEmail == normalizeEmail(user.Email) {
		return model.User{}, ErrInvalidInput
	}
	existing, err := s.repo.GetUserByEmail(ctx, newEmail)
	if err != nil && !db.IsNotFound(err) {
		return model.User{}, err
	}
	if err == nil && existing.ID != user.ID {
		return model.User{}, ErrEmailAlreadyExists
	}

	currentCode, err := s.verifyEmailCodeRecord(ctx, user.Email, EmailVerificationPurposeEmailCurrent, input.CurrentEmailCode)
	if err != nil {
		return model.User{}, err
	}
	newCode, err := s.verifyEmailCodeRecord(ctx, newEmail, EmailVerificationPurposeEmailNew, input.NewEmailCode)
	if err != nil {
		return model.User{}, err
	}
	now := time.Now()
	if err := s.repo.ConsumeEmailVerificationCode(ctx, currentCode.ID, now); err != nil {
		if db.IsNotFound(err) {
			return model.User{}, ErrVerificationCodeInvalid
		}
		return model.User{}, err
	}
	if err := s.repo.ConsumeEmailVerificationCode(ctx, newCode.ID, now); err != nil {
		if db.IsNotFound(err) {
			return model.User{}, ErrVerificationCodeInvalid
		}
		return model.User{}, err
	}
	updated, err := s.repo.UpdateUserEmail(ctx, user.ID, newEmail)
	if err != nil {
		if db.IsUniqueViolation(err) {
			return model.User{}, ErrEmailAlreadyExists
		}
		if db.IsNotFound(err) {
			return model.User{}, ErrUnauthorized
		}
		return model.User{}, err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       user.ID,
		EventType:    "account_email_changed",
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(user.ID),
		Result:       string(model.AuditResultSuccess),
		Message:      optionalString("account email changed"),
		MetadataJSON: jsonMetadata(map[string]any{
			"from_email": user.Email,
			"to_email":   newEmail,
		}),
	})
	return userRecordToModel(updated), nil
}

func (s *Service) DeleteAccount(ctx context.Context, session AuthenticatedSession, input DeleteAccountInput) error {
	if session.UserID == "" {
		return ErrUnauthorized
	}
	if input.CurrentPassword == "" {
		return ErrInvalidInput
	}
	user, err := s.repo.GetUserByID(ctx, session.UserID)
	if err != nil {
		if db.IsNotFound(err) {
			return ErrUnauthorized
		}
		return err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.CurrentPassword)); err != nil {
		return ErrInvalidCredentials
	}
	if recordHasPermission(user, model.PermissionAdminAccess) {
		count, err := s.repo.CountUsersWithPermission(ctx, model.PermissionAdminAccess)
		if err != nil {
			return err
		}
		if count <= 1 {
			return ErrLastAdminAccess
		}
	}
	if err := s.repo.DeleteUser(ctx, user.ID); err != nil {
		if db.IsNotFound(err) {
			return ErrUnauthorized
		}
		return err
	}
	return nil
}

func (s *Service) Login(ctx context.Context, input LoginInput) (LoginResult, error) {
	identifier := normalizeLoginIdentifier(firstNonBlank(input.Identifier, input.Email))
	if identifier == "" || input.Password == "" {
		return LoginResult{}, ErrInvalidInput
	}

	user, err := s.repo.GetUserByLoginIdentifier(ctx, identifier)
	if err != nil {
		if db.IsNotFound(err) {
			s.recordLoginFailure(ctx, "", identifier, input.ClientIP, input.UserAgent, "user not found")
			return LoginResult{}, ErrInvalidCredentials
		}
		return LoginResult{}, err
	}
	if user.Status != string(model.UserStatusActive) {
		s.recordLoginFailure(ctx, user.ID, user.Email, input.ClientIP, input.UserAgent, "user disabled")
		return LoginResult{}, ErrAccountDisabled
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)); err != nil {
		s.recordLoginFailure(ctx, user.ID, user.Email, input.ClientIP, input.UserAgent, "invalid password")
		return LoginResult{}, ErrInvalidCredentials
	}
	requiresMFA, err := s.userRequiresMFA(ctx, user.ID)
	if err != nil {
		return LoginResult{}, err
	}
	if requiresMFA {
		return s.createPendingMFALogin(ctx, user, input.ClientIP, input.UserAgent, "password")
	}

	return s.createLoginSession(ctx, user, input.ClientIP, input.UserAgent, "password")
}

func (s *Service) LoginWithEmailVerificationCode(ctx context.Context, input EmailCodeLoginInput) (LoginResult, error) {
	user, _, err := s.lookupUserByLoginIdentifier(ctx, firstNonBlank(input.Identifier, input.Email))
	if err != nil {
		return LoginResult{}, err
	}
	if user.Status != string(model.UserStatusActive) {
		s.recordLoginFailure(ctx, user.ID, user.Email, input.ClientIP, input.UserAgent, "user disabled")
		return LoginResult{}, ErrAccountDisabled
	}
	if err := s.verifyEmailCode(ctx, user.Email, EmailVerificationPurposeLogin, input.VerificationCode); err != nil {
		if errors.Is(err, ErrVerificationCodeInvalid) {
			s.recordEmailCodeVerificationFailure(ctx, user.ID, user.Email, EmailVerificationPurposeLogin, input.ClientIP, input.UserAgent, "invalid verification code")
		}
		return LoginResult{}, err
	}
	requiresMFA, err := s.userRequiresMFA(ctx, user.ID)
	if err != nil {
		return LoginResult{}, err
	}
	if requiresMFA {
		return s.createPendingMFALogin(ctx, user, input.ClientIP, input.UserAgent, "email_code")
	}
	return s.createLoginSession(ctx, user, input.ClientIP, input.UserAgent, "email_code")
}

func (s *Service) createLoginSession(ctx context.Context, user UserRecord, clientIP string, userAgent string, loginMethod string) (LoginResult, error) {
	cfg := s.currentSettings()
	sessionToken, err := randomToken()
	if err != nil {
		return LoginResult{}, err
	}
	refreshToken, err := randomToken()
	if err != nil {
		return LoginResult{}, err
	}
	now := time.Now()
	expiresAt := now.Add(s.ttl)
	refreshExpiresAt := now.Add(cfg.RefreshTTL())
	session, err := s.repo.CreateSession(ctx, CreateSessionInput{
		UserID:           user.ID,
		SessionTokenHash: hashToken(sessionToken),
		RefreshTokenHash: stringPtr(hashToken(refreshToken)),
		ClientIP:         optionalString(clientIP),
		UserAgent:        optionalString(userAgent),
		DeviceLabel:      deviceLabelFromUserAgent(userAgent),
		LoginMethod:      normalizedLoginMethod(loginMethod),
		ExpiresAt:        expiresAt,
		RefreshExpiresAt: &refreshExpiresAt,
	})
	if err != nil {
		return LoginResult{}, err
	}
	session.LoginMethod = normalizedLoginMethod(loginMethod)
	if session.ExpiresAt.IsZero() {
		session.ExpiresAt = expiresAt
	}
	revokedCount, err := s.repo.RevokeOtherSessions(ctx, user.ID, session.ID, time.Now())
	if err != nil {
		return LoginResult{}, err
	}
	if s.onOtherSessionsRevoked != nil {
		s.onOtherSessionsRevoked(ctx, user.ID)
	}
	if _, err := s.repo.GetActiveSessionByTokenHash(ctx, hashToken(sessionToken), time.Now()); err != nil {
		if db.IsNotFound(err) {
			return LoginResult{}, ErrUnauthorized
		}
		return LoginResult{}, err
	}
	if err := s.repo.UpdateLastLogin(ctx, user.ID, time.Now()); err != nil {
		return LoginResult{}, err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:    user.ID,
		EventType: "auth_login",
		Result:    string(model.AuditResultSuccess),
		ClientIP:  optionalString(clientIP),
		UserAgent: optionalString(userAgent),
		Message:   optionalString("login success"),
	})
	if revokedCount > 0 {
		s.recordAudit(ctx, model.AuditLog{
			UserID:       user.ID,
			EventType:    "admin_user_kicked",
			ResourceType: stringPtr("user"),
			ResourceID:   stringPtr(user.ID),
			Result:       string(model.AuditResultSuccess),
			Message:      optionalString("previous sessions revoked by new login"),
			MetadataJSON: jsonMetadata(map[string]any{
				"reason":                "single_device_login",
				"revoked_session_count": revokedCount,
				"kept_session_id":       session.ID,
			}),
		})
	}

	return LoginResult{
		Status:           LoginStatusSuccess,
		User:             userRecordToModel(user),
		Session:          sessionInfoFromRecord(session),
		SessionToken:     sessionToken,
		RefreshToken:     refreshToken,
		ExpiresAt:        expiresAt,
		RefreshExpiresAt: refreshExpiresAt,
	}, nil
}

func (s *Service) verifyEmailCode(ctx context.Context, email string, purpose EmailVerificationPurpose, rawCode string) error {
	record, err := s.verifyEmailCodeRecord(ctx, email, purpose, rawCode)
	if err != nil {
		return err
	}
	if err := s.repo.ConsumeEmailVerificationCode(ctx, record.ID, time.Now()); err != nil {
		if db.IsNotFound(err) {
			return ErrVerificationCodeInvalid
		}
		return err
	}
	return nil
}

func (s *Service) verifyEmailCodeRecord(ctx context.Context, email string, purpose EmailVerificationPurpose, rawCode string) (EmailVerificationCodeRecord, error) {
	code := strings.TrimSpace(rawCode)
	if email == "" || code == "" || strings.TrimSpace(s.emailCodeHashSecret) == "" {
		return EmailVerificationCodeRecord{}, ErrVerificationCodeInvalid
	}
	record, err := s.repo.GetLatestEmailVerificationCode(ctx, GetLatestEmailVerificationCodeInput{
		Email:   email,
		Purpose: purpose,
		Now:     time.Now(),
	})
	if err != nil {
		if db.IsNotFound(err) {
			return EmailVerificationCodeRecord{}, ErrVerificationCodeInvalid
		}
		return EmailVerificationCodeRecord{}, err
	}
	expected := hashEmailVerificationCode(s.emailCodeHashSecret, email, purpose, code)
	if !hmac.Equal([]byte(record.CodeHash), []byte(expected)) {
		_ = s.repo.IncrementEmailVerificationCodeAttempts(ctx, record.ID)
		return EmailVerificationCodeRecord{}, ErrVerificationCodeInvalid
	}
	return record, nil
}

func (s *Service) Refresh(ctx context.Context, refreshToken string) (RefreshResult, error) {
	return s.RefreshWithMetadata(ctx, RefreshInput{RefreshToken: refreshToken})
}

func (s *Service) RefreshWithMetadata(ctx context.Context, input RefreshInput) (RefreshResult, error) {
	cfg := s.currentSettings()
	if strings.TrimSpace(input.RefreshToken) == "" {
		return RefreshResult{}, ErrUnauthorized
	}

	sessionToken, err := randomToken()
	if err != nil {
		return RefreshResult{}, err
	}
	nextRefreshToken, err := randomToken()
	if err != nil {
		return RefreshResult{}, err
	}

	now := time.Now()
	session, err := s.repo.RotateSessionByRefreshTokenHash(ctx, RotateSessionInput{
		RefreshTokenHash:    hashToken(input.RefreshToken),
		NewSessionTokenHash: hashToken(sessionToken),
		NewRefreshTokenHash: hashToken(nextRefreshToken),
		ClientIP:            optionalString(input.ClientIP),
		UserAgent:           optionalString(input.UserAgent),
		DeviceLabel:         deviceLabelFromUserAgent(input.UserAgent),
		ExpiresAt:           now.Add(s.ttl),
		IdleSince:           now.Add(-cfg.IdleTimeout()),
		Now:                 now,
	})
	if err != nil {
		if db.IsNotFound(err) {
			return RefreshResult{}, ErrUnauthorized
		}
		return RefreshResult{}, err
	}
	if session.User.Status != string(model.UserStatusActive) || session.RefreshExpiresAt == nil {
		return RefreshResult{}, ErrUnauthorized
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:    session.UserID,
		EventType: "auth_refresh",
		Result:    string(model.AuditResultSuccess),
		ClientIP:  session.ClientIP,
		UserAgent: session.UserAgent,
		Message:   optionalString("session refreshed"),
	})

	return RefreshResult{
		User:             userRecordToModel(session.User),
		Session:          sessionInfoFromRecord(session),
		SessionToken:     sessionToken,
		RefreshToken:     nextRefreshToken,
		ExpiresAt:        session.ExpiresAt,
		RefreshExpiresAt: *session.RefreshExpiresAt,
	}, nil
}

func (s *Service) Authenticate(ctx context.Context, sessionToken string) (AuthenticatedSession, error) {
	if strings.TrimSpace(sessionToken) == "" {
		return AuthenticatedSession{}, ErrUnauthorized
	}

	session, err := s.repo.GetActiveSessionByTokenHash(ctx, hashToken(sessionToken), time.Now())
	if err != nil {
		if db.IsNotFound(err) {
			storedSession, lookupErr := s.repo.GetSessionByTokenHash(ctx, hashToken(sessionToken))
			if lookupErr == nil && storedSession.RevokedAt != nil {
				return AuthenticatedSession{}, ErrSessionRevoked
			}
			return AuthenticatedSession{}, ErrUnauthorized
		}
		return AuthenticatedSession{}, err
	}
	if session.User.Status != string(model.UserStatusActive) {
		return AuthenticatedSession{}, ErrUnauthorized
	}

	return AuthenticatedSession{
		SessionID: session.ID,
		UserID:    session.UserID,
		User:      userRecordToModel(session.User),
		Session:   sessionInfoFromRecord(session),
	}, nil
}

func (s *Service) Logout(ctx context.Context, session AuthenticatedSession) error {
	if session.SessionID == "" {
		return ErrUnauthorized
	}

	if err := s.repo.RevokeSession(ctx, session.SessionID, time.Now()); err != nil {
		if db.IsNotFound(err) {
			return ErrUnauthorized
		}
		return err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:    session.UserID,
		EventType: "auth_logout",
		Result:    string(model.AuditResultSuccess),
	})

	return nil
}

func (s *Service) LogoutByRefreshToken(ctx context.Context, refreshToken string) error {
	if strings.TrimSpace(refreshToken) == "" {
		return ErrUnauthorized
	}

	session, err := s.repo.RevokeSessionByRefreshTokenHash(ctx, hashToken(refreshToken), time.Now())
	if err != nil {
		if db.IsNotFound(err) {
			return ErrUnauthorized
		}
		return err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:    session.UserID,
		EventType: "auth_logout",
		Result:    string(model.AuditResultSuccess),
	})

	return nil
}

func userRecordToModel(record UserRecord) model.User {
	return model.User{
		ID:              record.ID,
		Email:           record.Email,
		DisplayName:     record.DisplayName,
		PreferredLocale: record.PreferredLocale,
		Theme:           record.Theme,
		Status:          record.Status,
		Role:            record.Role,
		AuthType:        record.AuthType,
		Permissions:     append([]string(nil), record.Permissions...),
		LastLoginAt:     record.LastLoginAt,
		CreatedAt:       record.CreatedAt,
		UpdatedAt:       record.UpdatedAt,
	}
}

func sessionInfoFromRecord(record SessionRecord) SessionInfo {
	return SessionInfo{
		ID:          record.ID,
		ClientIP:    record.ClientIP,
		UserAgent:   record.UserAgent,
		DeviceLabel: record.DeviceLabel,
		LoginMethod: normalizedLoginMethod(record.LoginMethod),
		LastSeenAt:  record.LastSeenAt,
		ExpiresAt:   record.ExpiresAt,
		CreatedAt:   record.CreatedAt,
	}
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func normalizeLoginIdentifier(identifier string) string {
	return strings.ToLower(strings.TrimSpace(identifier))
}

func firstNonBlank(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (s *Service) lookupUserByLoginIdentifier(ctx context.Context, rawIdentifier string) (UserRecord, string, error) {
	identifier := normalizeLoginIdentifier(rawIdentifier)
	if identifier == "" {
		return UserRecord{}, "", ErrInvalidInput
	}
	user, err := s.repo.GetUserByLoginIdentifier(ctx, identifier)
	if err != nil {
		if db.IsNotFound(err) {
			return UserRecord{}, identifier, ErrInvalidCredentials
		}
		return UserRecord{}, identifier, err
	}
	return user, identifier, nil
}

func uniqueViolationConstraint(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.ConstraintName
	}
	return ""
}

func randomToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func hashEmailVerificationCode(secret string, email string, purpose EmailVerificationPurpose, code string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(normalizeEmail(email)))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(string(purpose)))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(strings.TrimSpace(code)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func randomNumericCode(length int) (string, error) {
	if length <= 0 {
		length = defaultEmailCodeLength
	}
	var builder strings.Builder
	builder.Grow(length)
	for builder.Len() < length {
		value, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		builder.WriteByte(byte('0' + value.Int64()))
	}
	return builder.String(), nil
}

func normalizeEmailSet(values []string) map[string]struct{} {
	items := make(map[string]struct{})
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			email := normalizeEmail(part)
			if email != "" {
				items[email] = struct{}{}
			}
		}
	}
	return items
}

func normalizeDomainSet(values []string) map[string]struct{} {
	items := make(map[string]struct{})
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			domain := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(part, "@")))
			if domain != "" {
				items[domain] = struct{}{}
			}
		}
	}
	return items
}

func (s *Service) isEmailAllowed(email string) bool {
	allowedEmails := s.allowedEmails
	allowedEmailDomains := s.allowedEmailDomains
	if cfg := s.currentSettings(); s.settingsProvider != nil {
		allowedEmails = normalizeEmailSet(cfg.AllowedEmailList())
		allowedEmailDomains = normalizeDomainSet(cfg.AllowedDomainList())
	}
	if len(allowedEmails) == 0 && len(allowedEmailDomains) == 0 {
		return true
	}
	normalized := normalizeEmail(email)
	if _, ok := allowedEmails[normalized]; ok {
		return true
	}
	_, domain, ok := strings.Cut(normalized, "@")
	if !ok {
		return false
	}
	_, ok = allowedEmailDomains[domain]
	return ok
}

func recordHasPermission(user UserRecord, permission string) bool {
	for _, item := range user.Permissions {
		if item == permission {
			return true
		}
	}
	return false
}

func optionalString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func stringPtr(value string) *string {
	return &value
}

func (s *Service) recordAudit(ctx context.Context, log model.AuditLog) {
	if s.audit == nil {
		return
	}
	_ = s.audit.Record(ctx, log)
}

func (s *Service) recordLoginFailure(ctx context.Context, userID string, email string, clientIP string, userAgent string, reason string) {
	s.recordAudit(ctx, model.AuditLog{
		UserID:    userID,
		EventType: "auth_login_failed",
		Result:    string(model.AuditResultFailure),
		ClientIP:  optionalString(clientIP),
		UserAgent: optionalString(userAgent),
		Message:   optionalString("login failed"),
		MetadataJSON: jsonMetadata(map[string]any{
			"email":  email,
			"reason": reason,
		}),
	})
}

func (s *Service) recordEmailCodeVerificationFailure(ctx context.Context, userID string, email string, purpose EmailVerificationPurpose, clientIP string, userAgent string, reason string) {
	s.recordAudit(ctx, model.AuditLog{
		UserID:       userID,
		EventType:    "auth_email_code_verify_failed",
		ResourceType: stringPtr("email_verification_code"),
		Result:       string(model.AuditResultFailure),
		ClientIP:     optionalString(clientIP),
		UserAgent:    optionalString(userAgent),
		Message:      optionalString("email verification code failed"),
		MetadataJSON: jsonMetadata(map[string]any{
			"email":   email,
			"purpose": purpose,
			"reason":  reason,
		}),
	})
}

func jsonMetadata(values map[string]any) []byte {
	encoded, err := json.Marshal(values)
	if err != nil {
		return nil
	}
	return encoded
}
