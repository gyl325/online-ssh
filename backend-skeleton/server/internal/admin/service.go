package admin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/settings"
)

var (
	ErrInvalidInput      = errors.New("invalid input")
	ErrCannotModifySelf  = errors.New("cannot modify self")
	ErrCannotModifyAdmin = errors.New("cannot modify administrator")
	ErrLastAdminAccess   = errors.New("cannot remove last admin access")
	ErrSystemRole        = errors.New("cannot modify system role")
	ErrForbidden         = errors.New("forbidden")
	ErrNotFound          = errors.New("not found")
)

const adminRevokedSessionRuntimeMessage = "auth session revoked"

type Actor struct {
	UserID      string
	SessionID   string
	Role        string
	Permissions []string
}

type UserListItem struct {
	model.User
	ActiveSessionCount int     `json:"active_session_count"`
	LastLoginMethod    *string `json:"last_login_method,omitempty"`
	MFAEnabled         bool    `json:"mfa_enabled"`
}

type SessionListItem struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	UserEmail       string    `json:"user_email"`
	UserDisplayName string    `json:"user_display_name"`
	UserRole        string    `json:"user_role"`
	ClientIP        *string   `json:"client_ip"`
	UserAgent       *string   `json:"user_agent"`
	DeviceLabel     *string   `json:"device_label"`
	LoginMethod     string    `json:"login_method"`
	LastSeenAt      time.Time `json:"last_seen_at"`
	ExpiresAt       time.Time `json:"expires_at"`
	CreatedAt       time.Time `json:"created_at"`
}

type UserStatusResult struct {
	User                model.User `json:"user"`
	RevokedSessionCount int        `json:"revoked_session_count"`
}

type AdminRequestMetadata struct {
	ClientIP  string
	UserAgent string
}

type UserMFAStatus struct {
	UserID            string     `json:"user_id"`
	TOTPEnabled       bool       `json:"totp_enabled"`
	ConfirmedAt       *time.Time `json:"confirmed_at,omitempty"`
	LastUsedAt        *time.Time `json:"last_used_at,omitempty"`
	RecoveryCodeCount int        `json:"recovery_code_count"`
}

type Repository interface {
	ListUsers(ctx context.Context) ([]UserListItem, error)
	GetUser(ctx context.Context, userID string) (model.User, error)
	DeleteUser(ctx context.Context, userID string) error
	ListRoles(ctx context.Context) ([]Role, error)
	GetRole(ctx context.Context, key string) (Role, error)
	CreateRole(ctx context.Context, role Role) (Role, error)
	UpdateRole(ctx context.Context, key string, role Role) (Role, error)
	DeleteRole(ctx context.Context, key string) error
	CountUsersWithPermission(ctx context.Context, permission string) (int, error)
	UpdateUserStatus(ctx context.Context, userID string, status model.UserStatus) (model.User, error)
	UpdateUserRole(ctx context.Context, userID string, role string) (model.User, error)
	ListSessions(ctx context.Context, now time.Time) ([]SessionListItem, error)
	RevokeSession(ctx context.Context, sessionID string, revokedAt time.Time) (string, error)
	RevokeSessionsByUserID(ctx context.Context, userID string, exceptSessionID string, revokedAt time.Time) (int, error)
	RevokeSessionIDsByUserID(ctx context.Context, userID string, exceptSessionID string, revokedAt time.Time) ([]string, error)
	GetUserMFAStatus(ctx context.Context, userID string) (UserMFAStatus, error)
	ResetUserMFA(ctx context.Context, userID string) error
	ListDatabaseHostGroups(ctx context.Context) ([]model.HostGroup, error)
	ListDatabaseCredentials(ctx context.Context) ([]model.Credential, error)
	ListDatabaseHosts(ctx context.Context) ([]model.Host, error)
	CreateDatabaseHostGroup(ctx context.Context, item model.HostGroup) (model.HostGroup, error)
	CreateDatabaseCredential(ctx context.Context, item model.Credential) (model.Credential, error)
	CreateDatabaseHost(ctx context.Context, item model.Host) (model.Host, error)
	ListSystemSettings(ctx context.Context) (map[string]string, error)
	UpsertSystemSettings(ctx context.Context, values map[string]string, updatedBy string, updatedAt time.Time) error
}

type ServiceOptions struct {
	CredentialEncryptor     credential.Encryptor
	AuditRecorder           AuditRecorder
	GeneralSettings         *settings.Store
	GeneralSettingsDefaults settings.General
	EmailSenderForSettings  func(settings.General) auth.EmailSender
	EmailSenderProvider     func() auth.EmailSender
	LLMTester               LLMTester
	Now                     func() time.Time
	UserSessionsRevokedHook func(context.Context, string, string)
	UserSessionRevokedHook  func(context.Context, string, string, string)
}

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

type Service struct {
	repo                   Repository
	credentialEncryptor    credential.Encryptor
	audit                  AuditRecorder
	generalSettings        *settings.Store
	generalDefaults        settings.General
	emailSenderForSettings func(settings.General) auth.EmailSender
	emailSenderProvider    func() auth.EmailSender
	llmTester              LLMTester
	now                    func() time.Time
	userSessionsRevoked    func(context.Context, string, string)
	userSessionRevoked     func(context.Context, string, string, string)
}

func NewService(repo Repository) *Service {
	return NewServiceWithOptions(repo, ServiceOptions{})
}

func NewServiceWithOptions(repo Repository, options ServiceOptions) *Service {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	settingsStore := options.GeneralSettings
	if settingsStore == nil {
		settingsStore = settings.NewStore(options.GeneralSettingsDefaults)
	}
	return &Service{
		repo:                   repo,
		credentialEncryptor:    options.CredentialEncryptor,
		audit:                  options.AuditRecorder,
		generalSettings:        settingsStore,
		generalDefaults:        settingsStore.Snapshot(),
		emailSenderForSettings: options.EmailSenderForSettings,
		emailSenderProvider:    options.EmailSenderProvider,
		llmTester:              options.LLMTester,
		now:                    now,
		userSessionsRevoked:    options.UserSessionsRevokedHook,
		userSessionRevoked:     options.UserSessionRevokedHook,
	}
}

func (s *Service) SetUserSessionsRevokedHook(hook func(context.Context, string, string)) {
	if s == nil {
		return
	}
	s.userSessionsRevoked = hook
}

func (s *Service) SetUserSessionRevokedHook(hook func(context.Context, string, string, string)) {
	if s == nil {
		return
	}
	s.userSessionRevoked = hook
}

func (s *Service) currentEmailSender() auth.EmailSender {
	if s == nil || s.emailSenderProvider == nil {
		return nil
	}
	return s.emailSenderProvider()
}

func (s *Service) emailSenderFor(current settings.General) auth.EmailSender {
	if s == nil {
		return nil
	}
	if s.emailSenderForSettings != nil {
		return s.emailSenderForSettings(current)
	}
	return s.currentEmailSender()
}

func (s *Service) ListUsers(ctx context.Context, actor Actor) ([]UserListItem, error) {
	if !hasActorPermission(actor, model.PermissionAdminUsers) {
		return nil, ErrForbidden
	}
	return s.repo.ListUsers(ctx)
}

func (s *Service) UpdateUserStatus(ctx context.Context, actor Actor, userID string, status model.UserStatus) (UserStatusResult, error) {
	if !hasActorPermission(actor, model.PermissionAdminUsers) {
		return UserStatusResult{}, ErrForbidden
	}
	userID = strings.TrimSpace(userID)
	if userID == "" || !validUserStatus(status) {
		return UserStatusResult{}, ErrInvalidInput
	}
	if userID == actor.UserID && status == model.UserStatusDisabled {
		return UserStatusResult{}, ErrCannotModifySelf
	}

	user, err := s.repo.UpdateUserStatus(ctx, userID, status)
	if err != nil {
		if db.IsNotFound(err) {
			return UserStatusResult{}, ErrNotFound
		}
		return UserStatusResult{}, err
	}

	revokedCount := 0
	if status == model.UserStatusDisabled {
		revokedCount, err = s.repo.RevokeSessionsByUserID(ctx, userID, "", time.Now())
		if err != nil {
			return UserStatusResult{}, err
		}
		s.closeUserRuntimes(ctx, userID)
	}

	eventType := "admin_user_enabled"
	if status == model.UserStatusDisabled {
		eventType = "admin_user_disabled"
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       actor.UserID,
		EventType:    eventType,
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(userID),
		Result:       string(model.AuditResultSuccess),
		Message:      optionalString("user status changed"),
		MetadataJSON: jsonMetadata(map[string]any{
			"status":                 status,
			"revoked_session_count":  revokedCount,
			"target_user_id":         userID,
			"target_user_new_status": user.Status,
		}),
	})
	if status == model.UserStatusDisabled && revokedCount > 0 {
		s.recordUserKickAudit(ctx, actor.UserID, userID, revokedCount, "")
	}

	return UserStatusResult{User: user, RevokedSessionCount: revokedCount}, nil
}

func (s *Service) UpdateUserRole(ctx context.Context, actor Actor, userID string, role string) (model.User, error) {
	if !hasActorPermission(actor, model.PermissionAdminUsers) {
		return model.User{}, ErrForbidden
	}
	userID = strings.TrimSpace(userID)
	role = normalizeRoleKey(role)
	if userID == "" || role == "" {
		return model.User{}, ErrInvalidInput
	}
	if userID == actor.UserID {
		return model.User{}, ErrCannotModifySelf
	}

	target, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		if db.IsNotFound(err) {
			return model.User{}, ErrNotFound
		}
		return model.User{}, err
	}
	currentRole, err := s.repo.GetRole(ctx, target.Role)
	if err != nil && !db.IsNotFound(err) {
		return model.User{}, err
	}
	nextRole, err := s.repo.GetRole(ctx, role)
	if err != nil {
		if db.IsNotFound(err) {
			return model.User{}, ErrNotFound
		}
		return model.User{}, err
	}
	if !nextRole.IsActive {
		return model.User{}, ErrInvalidInput
	}
	if currentRole.HasPermission(model.PermissionAdminAccess) && !nextRole.HasPermission(model.PermissionAdminAccess) {
		if err := s.ensureAnotherAdminAccessHolder(ctx, 1); err != nil {
			return model.User{}, err
		}
	}
	user, err := s.repo.UpdateUserRole(ctx, userID, role)
	if err != nil {
		if db.IsNotFound(err) {
			return model.User{}, ErrNotFound
		}
		return model.User{}, err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       actor.UserID,
		EventType:    "admin_user_role_changed",
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(userID),
		Result:       string(model.AuditResultSuccess),
		Message:      optionalString("user role changed"),
		MetadataJSON: jsonMetadata(map[string]any{
			"from_role": target.Role,
			"to_role":   role,
		}),
	})
	return user, nil
}

func (s *Service) DeleteUser(ctx context.Context, actor Actor, userID string) error {
	if !hasActorPermission(actor, model.PermissionAdminUsers) {
		return ErrForbidden
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ErrInvalidInput
	}
	if userID == actor.UserID {
		return ErrCannotModifySelf
	}
	target, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		if db.IsNotFound(err) {
			return ErrNotFound
		}
		return err
	}
	role, err := s.repo.GetRole(ctx, target.Role)
	if err != nil && !db.IsNotFound(err) {
		return err
	}
	if role.HasPermission(model.PermissionAdminAccess) {
		return ErrCannotModifyAdmin
	}
	if _, err := s.repo.RevokeSessionsByUserID(ctx, userID, "", time.Now()); err != nil {
		return err
	}
	s.closeUserRuntimes(ctx, userID)
	if err := s.repo.DeleteUser(ctx, userID); err != nil {
		if db.IsNotFound(err) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func (s *Service) ListRoles(ctx context.Context, actor Actor) ([]Role, []PermissionDefinition, error) {
	if !hasActorPermission(actor, model.PermissionAdminRoles) {
		return nil, nil, ErrForbidden
	}
	roles, err := s.repo.ListRoles(ctx)
	if err != nil {
		return nil, nil, err
	}
	return roles, PermissionDefinitions(), nil
}

func (s *Service) CreateRole(ctx context.Context, actor Actor, input Role) (Role, error) {
	if !hasActorPermission(actor, model.PermissionAdminRoles) {
		return Role{}, ErrForbidden
	}
	role, err := normalizeRoleInput(input, true)
	if err != nil {
		return Role{}, err
	}
	role.Key = normalizeRoleKey(role.Key)
	if role.Key == "" {
		return Role{}, ErrInvalidInput
	}
	role.IsSystem = false
	return s.repo.CreateRole(ctx, role)
}

func (s *Service) UpdateRole(ctx context.Context, actor Actor, key string, input Role) (Role, error) {
	if !hasActorPermission(actor, model.PermissionAdminRoles) {
		return Role{}, ErrForbidden
	}
	key = normalizeRoleKey(key)
	if key == "" {
		return Role{}, ErrInvalidInput
	}
	current, err := s.repo.GetRole(ctx, key)
	if err != nil {
		if db.IsNotFound(err) {
			return Role{}, ErrNotFound
		}
		return Role{}, err
	}
	role, err := normalizeRoleInput(input, false)
	if err != nil {
		return Role{}, err
	}
	role.Key = key
	role.IsSystem = current.IsSystem
	if current.IsSystem && !role.IsActive {
		return Role{}, ErrSystemRole
	}
	if current.HasPermission(model.PermissionAdminAccess) && !role.HasPermission(model.PermissionAdminAccess) && current.UserCount > 0 {
		if err := s.ensureAnotherAdminAccessHolder(ctx, current.UserCount); err != nil {
			return Role{}, err
		}
	}
	updated, err := s.repo.UpdateRole(ctx, key, role)
	if err != nil {
		if db.IsNotFound(err) {
			return Role{}, ErrNotFound
		}
		return Role{}, err
	}
	return updated, nil
}

func (s *Service) DeleteRole(ctx context.Context, actor Actor, key string) error {
	if !hasActorPermission(actor, model.PermissionAdminRoles) {
		return ErrForbidden
	}
	key = normalizeRoleKey(key)
	if key == "" {
		return ErrInvalidInput
	}
	role, err := s.repo.GetRole(ctx, key)
	if err != nil {
		if db.IsNotFound(err) {
			return ErrNotFound
		}
		return err
	}
	if role.IsSystem {
		return ErrSystemRole
	}
	if role.UserCount > 0 {
		return ErrInvalidInput
	}
	if err := s.repo.DeleteRole(ctx, key); err != nil {
		if db.IsNotFound(err) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func (s *Service) ListSessions(ctx context.Context, actor Actor) ([]SessionListItem, error) {
	if !hasActorPermission(actor, model.PermissionAdminSessions) {
		return nil, ErrForbidden
	}
	return s.repo.ListSessions(ctx, time.Now())
}

func (s *Service) RevokeSession(ctx context.Context, actor Actor, sessionID string) error {
	if !hasActorPermission(actor, model.PermissionAdminSessions) {
		return ErrForbidden
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return ErrInvalidInput
	}
	if sessionID == actor.SessionID {
		return ErrCannotModifySelf
	}
	targetUserID, err := s.repo.RevokeSession(ctx, sessionID, time.Now())
	if err != nil {
		if db.IsNotFound(err) {
			return ErrNotFound
		}
		return err
	}
	s.closeUserSessionRuntime(ctx, targetUserID, sessionID)
	s.recordAudit(ctx, model.AuditLog{
		UserID:       actor.UserID,
		EventType:    "admin_user_kicked",
		ResourceType: stringPtr("user_session"),
		ResourceID:   stringPtr(sessionID),
		Result:       string(model.AuditResultSuccess),
		Message:      optionalString("user session revoked"),
		MetadataJSON: jsonMetadata(map[string]any{
			"session_id": sessionID,
		}),
	})
	return nil
}

func (s *Service) RevokeUserSessions(ctx context.Context, actor Actor, userID string) (int, error) {
	if !hasActorPermission(actor, model.PermissionAdminSessions) {
		return 0, ErrForbidden
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return 0, ErrInvalidInput
	}
	exceptSessionID := ""
	if userID == actor.UserID {
		exceptSessionID = actor.SessionID
	}
	revokedSessionIDs, err := s.repo.RevokeSessionIDsByUserID(ctx, userID, exceptSessionID, time.Now())
	if err != nil {
		return 0, err
	}
	count := len(revokedSessionIDs)
	if count > 0 {
		s.recordUserKickAudit(ctx, actor.UserID, userID, count, exceptSessionID)
	}
	if userID != actor.UserID {
		s.closeUserRuntimes(ctx, userID)
	} else {
		for _, sessionID := range revokedSessionIDs {
			s.closeUserSessionRuntime(ctx, userID, sessionID)
		}
	}
	return count, nil
}

func (s *Service) GetUserMFA(ctx context.Context, actor Actor, userID string) (UserMFAStatus, error) {
	if !hasActorPermission(actor, model.PermissionAdminUsers) {
		return UserMFAStatus{}, ErrForbidden
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return UserMFAStatus{}, ErrInvalidInput
	}
	status, err := s.repo.GetUserMFAStatus(ctx, userID)
	if err != nil {
		if db.IsNotFound(err) {
			return UserMFAStatus{UserID: userID}, nil
		}
		return UserMFAStatus{}, err
	}
	return status, nil
}

func (s *Service) ResetUserMFA(ctx context.Context, actor Actor, userID string, metadata AdminRequestMetadata) error {
	if !hasActorPermission(actor, model.PermissionAdminUsers) {
		return ErrForbidden
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return ErrInvalidInput
	}
	if userID == actor.UserID {
		return ErrCannotModifySelf
	}
	target, err := s.repo.GetUser(ctx, userID)
	if err != nil {
		if db.IsNotFound(err) {
			return ErrNotFound
		}
		return err
	}
	role, err := s.repo.GetRole(ctx, target.Role)
	if err != nil && !db.IsNotFound(err) {
		return err
	}
	if role.HasPermission(model.PermissionAdminAccess) {
		return ErrCannotModifyAdmin
	}
	if err := s.repo.ResetUserMFA(ctx, userID); err != nil {
		if db.IsNotFound(err) {
			return ErrNotFound
		}
		return err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       actor.UserID,
		EventType:    "admin_mfa_reset",
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(userID),
		Result:       string(model.AuditResultSuccess),
		ClientIP:     optionalString(metadata.ClientIP),
		UserAgent:    optionalString(metadata.UserAgent),
		Message:      optionalString("user mfa reset"),
		MetadataJSON: jsonMetadata(map[string]any{
			"target_user_id": userID,
		}),
	})
	return nil
}

func hasActorPermission(actor Actor, permission string) bool {
	return model.UserHasPermission(model.User{Permissions: actor.Permissions}, permission)
}

func validUserStatus(status model.UserStatus) bool {
	return status == model.UserStatusActive || status == model.UserStatusDisabled
}

func normalizeRoleInput(input Role, requireKey bool) (Role, error) {
	role := Role{
		Key:         normalizeRoleKey(input.Key),
		Name:        strings.TrimSpace(input.Name),
		Description: strings.TrimSpace(input.Description),
		IsActive:    input.IsActive,
		Permissions: normalizePermissions(input.Permissions),
	}
	if requireKey && role.Key == "" {
		return Role{}, ErrInvalidInput
	}
	if role.Name == "" {
		return Role{}, ErrInvalidInput
	}
	if len(role.Permissions) == 0 {
		role.Permissions = []string{}
	}
	return role, nil
}

func normalizePermissions(values []string) []string {
	known := make(map[string]struct{})
	for _, definition := range PermissionDefinitions() {
		known[definition.Key] = struct{}{}
	}
	seen := make(map[string]struct{})
	result := make([]string, 0, len(values))
	for _, value := range values {
		permission := strings.TrimSpace(value)
		if permission == "" {
			continue
		}
		if _, ok := known[permission]; !ok {
			continue
		}
		if _, ok := seen[permission]; ok {
			continue
		}
		seen[permission] = struct{}{}
		result = append(result, permission)
	}
	return result
}

func (s *Service) ensureAnotherAdminAccessHolder(ctx context.Context, affectedUsers int) error {
	count, err := s.repo.CountUsersWithPermission(ctx, model.PermissionAdminAccess)
	if err != nil {
		return err
	}
	if count-affectedUsers < 1 {
		return ErrLastAdminAccess
	}
	return nil
}

func (s *Service) recordUserKickAudit(ctx context.Context, actorUserID string, targetUserID string, revokedCount int, exceptSessionID string) {
	metadata := map[string]any{
		"target_user_id":         targetUserID,
		"revoked_session_count":  revokedCount,
		"except_session_id":      exceptSessionID,
		"target_user_session_op": "revoke",
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       actorUserID,
		EventType:    "admin_user_kicked",
		ResourceType: stringPtr("user"),
		ResourceID:   stringPtr(targetUserID),
		Result:       string(model.AuditResultSuccess),
		Message:      optionalString("user sessions revoked"),
		MetadataJSON: jsonMetadata(metadata),
	})
}

func (s *Service) closeUserRuntimes(ctx context.Context, userID string) {
	if s == nil || s.userSessionsRevoked == nil {
		return
	}
	s.userSessionsRevoked(ctx, strings.TrimSpace(userID), adminRevokedSessionRuntimeMessage)
}

func (s *Service) closeUserSessionRuntime(ctx context.Context, userID, sessionID string) {
	if s == nil || s.userSessionRevoked == nil {
		return
	}
	userID = strings.TrimSpace(userID)
	sessionID = strings.TrimSpace(sessionID)
	if userID == "" || sessionID == "" {
		return
	}
	s.userSessionRevoked(ctx, userID, sessionID, adminRevokedSessionRuntimeMessage)
}

func (s *Service) recordAudit(ctx context.Context, log model.AuditLog) {
	if s.audit == nil {
		return
	}
	_ = s.audit.Record(ctx, log)
}

func jsonMetadata(values map[string]any) []byte {
	encoded, err := json.Marshal(values)
	if err != nil {
		return nil
	}
	return encoded
}

func optionalString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
