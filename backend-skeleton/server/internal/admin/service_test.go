package admin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/settings"
	"github.com/jackc/pgx/v5/pgconn"
)

type serviceAuditRecorder struct {
	logs []model.AuditLog
}

func (r *serviceAuditRecorder) Record(_ context.Context, log model.AuditLog) error {
	r.logs = append(r.logs, log)
	return nil
}

type adminEmailSenderStub struct {
	messages []auth.EmailMessage
}

func (s *adminEmailSenderStub) Send(_ context.Context, message auth.EmailMessage) error {
	s.messages = append(s.messages, message)
	return nil
}

type adminLLMTesterStub struct {
	calls []settings.General
	err   error
}

func (s *adminLLMTesterStub) TestConnection(_ context.Context, cfg settings.General) error {
	s.calls = append(s.calls, cfg)
	return s.err
}

type serviceRepoStub struct {
	listUsersFn                func(context.Context) ([]UserListItem, error)
	getUserFn                  func(context.Context, string) (model.User, error)
	getRoleFn                  func(context.Context, string) (Role, error)
	listRolesFn                func(context.Context) ([]Role, error)
	countUsersWithPermissionFn func(context.Context, string) (int, error)
	createRoleFn               func(context.Context, Role) (Role, error)
	updateRoleFn               func(context.Context, string, Role) (Role, error)
	deleteRoleFn               func(context.Context, string) error
	updateUserStatusFn         func(context.Context, string, model.UserStatus) (model.User, error)
	updateUserRoleFn           func(context.Context, string, string) (model.User, error)
	listSessionsFn             func(context.Context, time.Time) ([]SessionListItem, error)
	revokeSessionFn            func(context.Context, string, time.Time) (string, error)
	revokeSessionsByUserIDFn   func(context.Context, string, string, time.Time) (int, error)
	revokeSessionIDsByUserIDFn func(context.Context, string, string, time.Time) ([]string, error)
	getUserMFAStatusFn         func(context.Context, string) (UserMFAStatus, error)
	resetUserMFAFn             func(context.Context, string) error
	deleteUserFn               func(context.Context, string) error
	listDatabaseHostGroupsFn   func(context.Context) ([]model.HostGroup, error)
	listDatabaseCredentialsFn  func(context.Context) ([]model.Credential, error)
	listDatabaseHostsFn        func(context.Context) ([]model.Host, error)
	createDatabaseHostGroupFn  func(context.Context, model.HostGroup) (model.HostGroup, error)
	createDatabaseCredentialFn func(context.Context, model.Credential) (model.Credential, error)
	createDatabaseHostFn       func(context.Context, model.Host) (model.Host, error)
	listSystemSettingsFn       func(context.Context) (map[string]string, error)
	upsertSystemSettingsFn     func(context.Context, map[string]string, string, time.Time) error
}

func (s *serviceRepoStub) ListUsers(ctx context.Context) ([]UserListItem, error) {
	if s.listUsersFn == nil {
		return nil, errors.New("unexpected ListUsers call")
	}
	return s.listUsersFn(ctx)
}

func (s *serviceRepoStub) GetUser(ctx context.Context, userID string) (model.User, error) {
	if s.getUserFn == nil {
		return model.User{}, errors.New("unexpected GetUser call")
	}
	return s.getUserFn(ctx, userID)
}

func (s *serviceRepoStub) GetRole(ctx context.Context, key string) (Role, error) {
	if s.getRoleFn == nil {
		return Role{}, errors.New("unexpected GetRole call")
	}
	return s.getRoleFn(ctx, key)
}

func (s *serviceRepoStub) ListRoles(ctx context.Context) ([]Role, error) {
	if s.listRolesFn == nil {
		return nil, errors.New("unexpected ListRoles call")
	}
	return s.listRolesFn(ctx)
}

func (s *serviceRepoStub) CountUsersWithPermission(ctx context.Context, permission string) (int, error) {
	if s.countUsersWithPermissionFn == nil {
		return 0, errors.New("unexpected CountUsersWithPermission call")
	}
	return s.countUsersWithPermissionFn(ctx, permission)
}

func (s *serviceRepoStub) CreateRole(ctx context.Context, role Role) (Role, error) {
	if s.createRoleFn == nil {
		return Role{}, errors.New("unexpected CreateRole call")
	}
	return s.createRoleFn(ctx, role)
}

func (s *serviceRepoStub) UpdateRole(ctx context.Context, key string, role Role) (Role, error) {
	if s.updateRoleFn == nil {
		return Role{}, errors.New("unexpected UpdateRole call")
	}
	return s.updateRoleFn(ctx, key, role)
}

func (s *serviceRepoStub) DeleteRole(ctx context.Context, key string) error {
	if s.deleteRoleFn == nil {
		return errors.New("unexpected DeleteRole call")
	}
	return s.deleteRoleFn(ctx, key)
}

func (s *serviceRepoStub) UpdateUserStatus(ctx context.Context, userID string, status model.UserStatus) (model.User, error) {
	if s.updateUserStatusFn == nil {
		return model.User{}, errors.New("unexpected UpdateUserStatus call")
	}
	return s.updateUserStatusFn(ctx, userID, status)
}

func (s *serviceRepoStub) UpdateUserRole(ctx context.Context, userID string, role string) (model.User, error) {
	if s.updateUserRoleFn == nil {
		return model.User{}, errors.New("unexpected UpdateUserRole call")
	}
	return s.updateUserRoleFn(ctx, userID, role)
}

func (s *serviceRepoStub) ListSessions(ctx context.Context, now time.Time) ([]SessionListItem, error) {
	if s.listSessionsFn == nil {
		return nil, errors.New("unexpected ListSessions call")
	}
	return s.listSessionsFn(ctx, now)
}

func (s *serviceRepoStub) RevokeSession(ctx context.Context, sessionID string, revokedAt time.Time) (string, error) {
	if s.revokeSessionFn == nil {
		return "", errors.New("unexpected RevokeSession call")
	}
	return s.revokeSessionFn(ctx, sessionID, revokedAt)
}

func (s *serviceRepoStub) RevokeSessionsByUserID(ctx context.Context, userID string, exceptSessionID string, revokedAt time.Time) (int, error) {
	if s.revokeSessionsByUserIDFn == nil {
		return 0, errors.New("unexpected RevokeSessionsByUserID call")
	}
	return s.revokeSessionsByUserIDFn(ctx, userID, exceptSessionID, revokedAt)
}

func (s *serviceRepoStub) RevokeSessionIDsByUserID(ctx context.Context, userID string, exceptSessionID string, revokedAt time.Time) ([]string, error) {
	if s.revokeSessionIDsByUserIDFn == nil {
		return nil, errors.New("unexpected RevokeSessionIDsByUserID call")
	}
	return s.revokeSessionIDsByUserIDFn(ctx, userID, exceptSessionID, revokedAt)
}

func (s *serviceRepoStub) GetUserMFAStatus(ctx context.Context, userID string) (UserMFAStatus, error) {
	if s.getUserMFAStatusFn == nil {
		return UserMFAStatus{}, errors.New("unexpected GetUserMFAStatus call")
	}
	return s.getUserMFAStatusFn(ctx, userID)
}

func (s *serviceRepoStub) ResetUserMFA(ctx context.Context, userID string) error {
	if s.resetUserMFAFn == nil {
		return errors.New("unexpected ResetUserMFA call")
	}
	return s.resetUserMFAFn(ctx, userID)
}

func (s *serviceRepoStub) DeleteUser(ctx context.Context, userID string) error {
	if s.deleteUserFn == nil {
		return errors.New("unexpected DeleteUser call")
	}
	return s.deleteUserFn(ctx, userID)
}

func (s *serviceRepoStub) ListDatabaseHostGroups(ctx context.Context) ([]model.HostGroup, error) {
	if s.listDatabaseHostGroupsFn == nil {
		return nil, errors.New("unexpected ListDatabaseHostGroups call")
	}
	return s.listDatabaseHostGroupsFn(ctx)
}

func (s *serviceRepoStub) ListDatabaseCredentials(ctx context.Context) ([]model.Credential, error) {
	if s.listDatabaseCredentialsFn == nil {
		return nil, errors.New("unexpected ListDatabaseCredentials call")
	}
	return s.listDatabaseCredentialsFn(ctx)
}

func (s *serviceRepoStub) ListDatabaseHosts(ctx context.Context) ([]model.Host, error) {
	if s.listDatabaseHostsFn == nil {
		return nil, errors.New("unexpected ListDatabaseHosts call")
	}
	return s.listDatabaseHostsFn(ctx)
}

func (s *serviceRepoStub) CreateDatabaseHostGroup(ctx context.Context, item model.HostGroup) (model.HostGroup, error) {
	if s.createDatabaseHostGroupFn == nil {
		return model.HostGroup{}, errors.New("unexpected CreateDatabaseHostGroup call")
	}
	return s.createDatabaseHostGroupFn(ctx, item)
}

func (s *serviceRepoStub) CreateDatabaseCredential(ctx context.Context, item model.Credential) (model.Credential, error) {
	if s.createDatabaseCredentialFn == nil {
		return model.Credential{}, errors.New("unexpected CreateDatabaseCredential call")
	}
	return s.createDatabaseCredentialFn(ctx, item)
}

func (s *serviceRepoStub) CreateDatabaseHost(ctx context.Context, item model.Host) (model.Host, error) {
	if s.createDatabaseHostFn == nil {
		return model.Host{}, errors.New("unexpected CreateDatabaseHost call")
	}
	return s.createDatabaseHostFn(ctx, item)
}

func (s *serviceRepoStub) ListSystemSettings(ctx context.Context) (map[string]string, error) {
	if s.listSystemSettingsFn == nil {
		return nil, errors.New("unexpected ListSystemSettings call")
	}
	return s.listSystemSettingsFn(ctx)
}

func (s *serviceRepoStub) UpsertSystemSettings(ctx context.Context, values map[string]string, updatedBy string, updatedAt time.Time) error {
	if s.upsertSystemSettingsFn == nil {
		return errors.New("unexpected UpsertSystemSettings call")
	}
	return s.upsertSystemSettingsFn(ctx, values, updatedBy, updatedAt)
}

func TestServiceGeneralSettings(t *testing.T) {
	ctx := context.Background()
	defaults := adminGeneralDefaultsForTest()

	t.Run("loads persisted values over defaults", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{
			listSystemSettingsFn: func(context.Context) (map[string]string, error) {
				return map[string]string{
					"allow_user_registration":                 "true",
					"host_connectivity_poll_interval_seconds": "45",
					"auth_allowed_email_domains":              "example.com, example.org",
				}, nil
			},
		}, ServiceOptions{GeneralSettingsDefaults: defaults})

		result, err := service.GetGeneralSettings(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminAccess}})
		if err != nil {
			t.Fatalf("get general settings: %v", err)
		}
		if !result.AllowUserRegistration || result.HostConnectivityPollIntervalSeconds != 45 {
			t.Fatalf("expected persisted values, got %#v", result)
		}
		if result.SessionIdleTimeoutMinutes != defaults.SessionIdleTimeoutMinutes {
			t.Fatalf("expected default session idle timeout, got %#v", result)
		}
		if service.GeneralSettingsSnapshot().HostConnectivityPollIntervalSeconds != 45 {
			t.Fatalf("expected cache to update from loaded settings")
		}
	})

	t.Run("falls back to defaults before system settings migration is applied", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{
			listSystemSettingsFn: func(context.Context) (map[string]string, error) {
				return nil, &pgconn.PgError{Code: "42P01"}
			},
		}, ServiceOptions{GeneralSettingsDefaults: defaults})

		result, err := service.GetGeneralSettings(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminAccess}})
		if err != nil {
			t.Fatalf("expected defaults when system_settings table is missing, got %v", err)
		}
		if result.SessionIdleTimeoutMinutes != defaults.SessionIdleTimeoutMinutes || result.HostConnectivityPollIntervalSeconds != defaults.HostConnectivityPollIntervalSeconds {
			t.Fatalf("expected default settings fallback, got %#v", result)
		}
	})

	t.Run("validates and stores normalized values", func(t *testing.T) {
		var stored map[string]string
		service := NewServiceWithOptions(&serviceRepoStub{
			upsertSystemSettingsFn: func(_ context.Context, values map[string]string, updatedBy string, _ time.Time) error {
				if updatedBy != "admin-1" {
					t.Fatalf("expected updater admin-1, got %q", updatedBy)
				}
				stored = values
				return nil
			},
		}, ServiceOptions{GeneralSettingsDefaults: defaults})

		input := defaults
		input.AllowUserRegistration = true
		input.SMTPHost = " smtp.example.com "
		input.SMTPFrom = " noreply@example.com "
		input.AuthAllowedEmails = " admin@example.com\nuser@example.com "
		input.AuthAllowedEmailDomains = " example.com,\n@example.org "
		result, err := service.UpdateGeneralSettings(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminAccess}}, input)
		if err != nil {
			t.Fatalf("update general settings: %v", err)
		}

		if result.SMTPHost != "smtp.example.com" || result.SMTPFrom != "noreply@example.com" {
			t.Fatalf("expected trimmed smtp settings, got %#v", result)
		}
		if result.AuthAllowedEmails != "admin@example.com, user@example.com" {
			t.Fatalf("expected normalized email whitelist, got %q", result.AuthAllowedEmails)
		}
		if result.AuthAllowedEmailDomains != "example.com, example.org" {
			t.Fatalf("expected normalized domain whitelist, got %q", result.AuthAllowedEmailDomains)
		}
		if stored["allow_user_registration"] != "true" || stored["smtp_host"] != "smtp.example.com" {
			t.Fatalf("expected stored normalized settings, got %#v", stored)
		}
	})

	t.Run("rejects invalid settings and missing permissions", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{}, ServiceOptions{GeneralSettingsDefaults: defaults})
		input := defaults
		input.SMTPHost = "smtp.example.com"
		input.SMTPFrom = ""

		if _, err := service.UpdateGeneralSettings(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminAccess}}, input); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected invalid smtp settings, got %v", err)
		}
		if _, err := service.GetGeneralSettings(ctx, Actor{UserID: "user-1"}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("expected forbidden general settings read, got %v", err)
		}
	})
}

func TestServiceGeneralSettingsLLMKeySemantics(t *testing.T) {
	ctx := context.Background()
	defaults := adminGeneralDefaultsForTest()
	defaults.LLMEnabled = true
	defaults.LLMProtocol = settings.LLMProtocolOpenAI
	defaults.LLMBaseURL = "https://llm.example.com/v1"
	defaults.LLMModel = "mimo-v2.5-pro"
	defaults.LLMAuthHeader = settings.LLMAuthHeaderAPIKey
	defaults.LLMAPIKey = "stored-example-secret"
	defaults.LLMTimeoutSeconds = 30
	defaults.LLMMaxTokens = 1024

	t.Run("blank or omitted api key keeps saved key", func(t *testing.T) {
		var stored map[string]string
		service := NewServiceWithOptions(&serviceRepoStub{
			upsertSystemSettingsFn: func(_ context.Context, values map[string]string, _ string, _ time.Time) error {
				stored = values
				return nil
			},
		}, ServiceOptions{GeneralSettingsDefaults: defaults})

		input := defaults
		input.LLMBaseURL = " https://llm.example.com/v1 "
		input.LLMAPIKey = ""
		result, err := service.UpdateGeneralSettings(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminAccess}}, input, GeneralSettingsUpdateOptions{
			LLMAPIKeyProvided: true,
		})
		if err != nil {
			t.Fatalf("update general settings: %v", err)
		}
		if result.LLMAPIKey != "stored-example-secret" || stored[settings.KeyLLMAPIKey] != "stored-example-secret" {
			t.Fatalf("expected saved key to be retained, result=%#v stored=%#v", result, stored)
		}
	})

	t.Run("explicit clear removes saved key", func(t *testing.T) {
		var stored map[string]string
		service := NewServiceWithOptions(&serviceRepoStub{
			upsertSystemSettingsFn: func(_ context.Context, values map[string]string, _ string, _ time.Time) error {
				stored = values
				return nil
			},
		}, ServiceOptions{GeneralSettingsDefaults: defaults})

		input := defaults
		input.LLMEnabled = false
		input.LLMAPIKey = ""
		result, err := service.UpdateGeneralSettings(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminAccess}}, input, GeneralSettingsUpdateOptions{
			LLMAPIKeyClear: true,
		})
		if err != nil {
			t.Fatalf("clear llm key: %v", err)
		}
		if result.LLMAPIKey != "" || stored[settings.KeyLLMAPIKey] != "" {
			t.Fatalf("expected key to be cleared, result=%#v stored=%#v", result, stored)
		}
	})
}

func TestServiceGeneralSettingsSMTPPasswordSemantics(t *testing.T) {
	ctx := context.Background()
	defaults := adminGeneralDefaultsForTest()
	defaults.SMTPHost = "smtp.example.com"
	defaults.SMTPPort = 465
	defaults.SMTPFrom = "noreply@example.com"
	defaults.SMTPFromName = "Online SSH"
	defaults.SMTPUsername = "saved-user"
	defaults.SMTPPassword = "stored-example-secret"
	defaults.SMTPUseSSL = true

	t.Run("blank or omitted password keeps saved password", func(t *testing.T) {
		var stored map[string]string
		service := NewServiceWithOptions(&serviceRepoStub{
			upsertSystemSettingsFn: func(_ context.Context, values map[string]string, _ string, _ time.Time) error {
				stored = values
				return nil
			},
		}, ServiceOptions{GeneralSettingsDefaults: defaults})

		input := defaults
		input.SMTPUsername = " next-user "
		input.SMTPPassword = ""
		result, err := service.UpdateGeneralSettings(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminAccess}}, input, GeneralSettingsUpdateOptions{
			SMTPPasswordProvided: true,
		})
		if err != nil {
			t.Fatalf("update general settings: %v", err)
		}
		if result.SMTPUsername != "next-user" || stored[settings.KeySMTPUsername] != "next-user" {
			t.Fatalf("expected updated smtp username, result=%#v stored=%#v", result, stored)
		}
		if result.SMTPPassword != "stored-example-secret" || stored[settings.KeySMTPPassword] != "stored-example-secret" {
			t.Fatalf("expected saved smtp password to be retained, result=%#v stored=%#v", result, stored)
		}
	})

	t.Run("explicit clear removes saved password", func(t *testing.T) {
		var stored map[string]string
		service := NewServiceWithOptions(&serviceRepoStub{
			upsertSystemSettingsFn: func(_ context.Context, values map[string]string, _ string, _ time.Time) error {
				stored = values
				return nil
			},
		}, ServiceOptions{GeneralSettingsDefaults: defaults})

		input := defaults
		input.SMTPPassword = ""
		result, err := service.UpdateGeneralSettings(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminAccess}}, input, GeneralSettingsUpdateOptions{
			SMTPPasswordClear: true,
		})
		if err != nil {
			t.Fatalf("clear smtp password: %v", err)
		}
		if result.SMTPPassword != "" || stored[settings.KeySMTPPassword] != "" {
			t.Fatalf("expected smtp password to be cleared, result=%#v stored=%#v", result, stored)
		}
	})
}

func TestServiceTestGeneralSettingsLLM(t *testing.T) {
	ctx := context.Background()
	defaults := adminGeneralDefaultsForTest()
	defaults.LLMEnabled = true
	defaults.LLMProtocol = settings.LLMProtocolOpenAI
	defaults.LLMBaseURL = "https://llm.example.com/v1"
	defaults.LLMModel = "mimo-v2.5-pro"
	defaults.LLMAuthHeader = settings.LLMAuthHeaderAPIKey
	defaults.LLMAPIKey = "stored-example-secret"
	defaults.LLMTimeoutSeconds = 30
	defaults.LLMMaxTokens = 1024
	tester := &adminLLMTesterStub{}
	service := NewServiceWithOptions(&serviceRepoStub{
		upsertSystemSettingsFn: func(context.Context, map[string]string, string, time.Time) error {
			t.Fatal("LLM test must not persist settings")
			return nil
		},
	}, ServiceOptions{
		GeneralSettingsDefaults: defaults,
		LLMTester:               tester,
	})

	input := defaults
	input.LLMProtocol = settings.LLMProtocolAnthropic
	input.LLMBaseURL = "https://llm.example.com/anthropic"
	input.LLMAPIKey = ""
	result, err := service.TestGeneralSettingsLLM(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminAccess}}, input, GeneralSettingsUpdateOptions{
		LLMAPIKeyProvided: true,
	})
	if err != nil {
		t.Fatalf("test llm: %v", err)
	}
	if !result.OK || result.Protocol != settings.LLMProtocolAnthropic || result.Model != "mimo-v2.5-pro" {
		t.Fatalf("unexpected test result %#v", result)
	}
	if len(tester.calls) != 1 || tester.calls[0].LLMAPIKey != "stored-example-secret" || tester.calls[0].LLMBaseURL != "https://llm.example.com/anthropic" {
		t.Fatalf("expected form values with saved key fallback, calls=%#v", tester.calls)
	}

	if _, err := service.TestGeneralSettingsLLM(ctx, Actor{UserID: "user-1"}, input, GeneralSettingsUpdateOptions{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden without admin access, got %v", err)
	}
}

func TestServiceSendGeneralSettingsTestEmail(t *testing.T) {
	ctx := context.Background()
	sender := &adminEmailSenderStub{}
	var senderSettings []settings.General
	defaults := adminGeneralDefaultsForTest()
	defaults.SMTPHost = "smtp.example.com"
	defaults.SMTPPort = 465
	defaults.SMTPFrom = "noreply@example.com"
	defaults.SMTPFromName = "Online SSH"
	defaults.SMTPUsername = "saved-user"
	defaults.SMTPPassword = "stored-example-secret"
	defaults.SMTPUseSSL = true
	service := NewServiceWithOptions(&serviceRepoStub{
		upsertSystemSettingsFn: func(context.Context, map[string]string, string, time.Time) error {
			t.Fatal("SMTP test must not persist settings")
			return nil
		},
	}, ServiceOptions{
		GeneralSettingsDefaults: defaults,
		EmailSenderForSettings: func(current settings.General) auth.EmailSender {
			senderSettings = append(senderSettings, current)
			return sender
		},
		EmailSenderProvider: func() auth.EmailSender {
			return sender
		},
	})

	if err := service.SendGeneralSettingsTestEmail(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminAccess}}, " ops@example.com "); err != nil {
		t.Fatalf("send test email: %v", err)
	}

	if len(sender.messages) != 1 {
		t.Fatalf("expected one test email, got %#v", sender.messages)
	}
	message := sender.messages[0]
	if message.To != "ops@example.com" {
		t.Fatalf("expected normalized recipient, got %q", message.To)
	}
	if message.Subject != "Online SSH SMTP test email" {
		t.Fatalf("unexpected subject %q", message.Subject)
	}
	if message.HTML == "" || message.Body == "" {
		t.Fatalf("expected html and text bodies, got %#v", message)
	}
	if len(senderSettings) != 1 || senderSettings[0].SMTPHost != "smtp.example.com" || senderSettings[0].SMTPPassword != "stored-example-secret" {
		t.Fatalf("expected saved smtp settings for default test, got %#v", senderSettings)
	}

	draft := settings.General{
		SMTPHost:     "smtp.next.example.com",
		SMTPPort:     587,
		SMTPFrom:     "next@example.com",
		SMTPFromName: "Next Sender",
		SMTPUsername: "next-user",
		SMTPPassword: "",
		SMTPUseSSL:   false,
	}
	if err := service.SendGeneralSettingsTestEmail(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminAccess}}, "draft@example.com", GeneralSettingsTestEmailOptions{
		Settings: draft,
		UpdateOptions: GeneralSettingsUpdateOptions{
			SMTPPasswordProvided: true,
		},
		ProvidedKeys: map[string]bool{
			settings.KeySMTPHost:     true,
			settings.KeySMTPPort:     true,
			settings.KeySMTPFrom:     true,
			settings.KeySMTPFromName: true,
			settings.KeySMTPUsername: true,
			settings.KeySMTPPassword: true,
			settings.KeySMTPUseSSL:   true,
		},
	}); err != nil {
		t.Fatalf("send draft test email: %v", err)
	}
	if len(senderSettings) != 2 {
		t.Fatalf("expected two sender settings calls, got %#v", senderSettings)
	}
	draftSettings := senderSettings[1]
	if draftSettings.SMTPHost != "smtp.next.example.com" ||
		draftSettings.SMTPPort != 587 ||
		draftSettings.SMTPFrom != "next@example.com" ||
		draftSettings.SMTPFromName != "Next Sender" ||
		draftSettings.SMTPUsername != "next-user" ||
		draftSettings.SMTPPassword != "stored-example-secret" ||
		draftSettings.SMTPUseSSL {
		t.Fatalf("expected draft SMTP values with saved password fallback, got %#v", draftSettings)
	}

	if err := service.SendGeneralSettingsTestEmail(ctx, Actor{UserID: "user-1"}, "ops@example.com"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected forbidden without admin access, got %v", err)
	}
}

func adminGeneralDefaultsForTest() settings.General {
	return settings.General{
		AllowUserRegistration:               false,
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
		LLMProtocol:                         settings.LLMProtocolOpenAI,
		LLMModel:                            "mimo-v2.5-pro",
		LLMAuthHeader:                       settings.LLMAuthHeaderAPIKey,
		LLMTimeoutSeconds:                   30,
		LLMMaxTokens:                        1024,
	}
}

func TestServiceAdminReadPermissions(t *testing.T) {
	ctx := context.Background()

	t.Run("requires user management permission to list users", func(t *testing.T) {
		service := NewService(&serviceRepoStub{})

		if _, err := service.ListUsers(ctx, Actor{Permissions: []string{model.PermissionAdminAccess}}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("expected ErrForbidden, got %v", err)
		}
	})

	t.Run("lists users with user management permission", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			listUsersFn: func(context.Context) ([]UserListItem, error) {
				return []UserListItem{{User: model.User{ID: "user-1"}}}, nil
			},
		})

		items, err := service.ListUsers(ctx, Actor{Permissions: []string{model.PermissionAdminUsers}})
		if err != nil {
			t.Fatalf("list users: %v", err)
		}
		if len(items) != 1 || items[0].ID != "user-1" {
			t.Fatalf("unexpected users: %#v", items)
		}
	})

	t.Run("requires role management permission to list roles", func(t *testing.T) {
		service := NewService(&serviceRepoStub{})

		if _, _, err := service.ListRoles(ctx, Actor{Permissions: []string{model.PermissionAdminAccess}}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("expected ErrForbidden, got %v", err)
		}
	})

	t.Run("lists roles with role management permission", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			listRolesFn: func(context.Context) ([]Role, error) {
				return []Role{{Key: "ops", Name: "Ops"}}, nil
			},
		})

		roles, permissions, err := service.ListRoles(ctx, Actor{Permissions: []string{model.PermissionAdminRoles}})
		if err != nil {
			t.Fatalf("list roles: %v", err)
		}
		if len(roles) != 1 || roles[0].Key != "ops" {
			t.Fatalf("unexpected roles: %#v", roles)
		}
		if len(permissions) == 0 {
			t.Fatal("expected permission definitions")
		}
	})
}

func TestServiceUserManagement(t *testing.T) {
	ctx := context.Background()

	t.Run("disables a user and revokes active sessions", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		var revokedUserID string
		var closedRuntimeUserID string
		var closedRuntimeMessage string
		service := NewServiceWithOptions(&serviceRepoStub{
			updateUserStatusFn: func(_ context.Context, userID string, status model.UserStatus) (model.User, error) {
				if userID != "user-2" || status != model.UserStatusDisabled {
					t.Fatalf("unexpected status update user=%q status=%q", userID, status)
				}
				return model.User{ID: userID, Status: string(status), Role: string(model.UserRoleUser)}, nil
			},
			revokeSessionsByUserIDFn: func(_ context.Context, userID string, exceptSessionID string, _ time.Time) (int, error) {
				revokedUserID = userID
				if exceptSessionID != "" {
					t.Fatalf("expected no session exception for target user, got %q", exceptSessionID)
				}
				return 2, nil
			},
		}, ServiceOptions{
			AuditRecorder: recorder,
			UserSessionsRevokedHook: func(_ context.Context, userID string, message string) {
				closedRuntimeUserID = userID
				closedRuntimeMessage = message
			},
		})

		result, err := service.UpdateUserStatus(ctx, Actor{UserID: "admin-1", SessionID: "admin-session", Permissions: []string{model.PermissionAdminUsers}}, "user-2", model.UserStatusDisabled)
		if err != nil {
			t.Fatalf("disable user: %v", err)
		}

		if result.RevokedSessionCount != 2 {
			t.Fatalf("expected two revoked sessions, got %d", result.RevokedSessionCount)
		}
		if revokedUserID != "user-2" {
			t.Fatalf("expected sessions revoked for user-2, got %q", revokedUserID)
		}
		if closedRuntimeUserID != "user-2" || closedRuntimeMessage != "auth session revoked" {
			t.Fatalf("expected user runtimes to close for user-2, got user=%q message=%q", closedRuntimeUserID, closedRuntimeMessage)
		}
		if got := auditEventTypes(recorder.logs); !slices.Equal(got, []string{"admin_user_disabled", "admin_user_kicked"}) {
			t.Fatalf("expected disabled and kicked audit events, got %#v", got)
		}
		if recorder.logs[0].UserID != "admin-1" || recorder.logs[0].ResourceID == nil || *recorder.logs[0].ResourceID != "user-2" {
			t.Fatalf("expected actor audit targeting user-2, got %#v", recorder.logs[0])
		}
	})

	t.Run("does not revoke sessions when enabling a user", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		service := NewServiceWithOptions(&serviceRepoStub{
			updateUserStatusFn: func(_ context.Context, userID string, status model.UserStatus) (model.User, error) {
				return model.User{ID: userID, Status: string(status), Role: string(model.UserRoleUser)}, nil
			},
		}, ServiceOptions{AuditRecorder: recorder})

		result, err := service.UpdateUserStatus(ctx, Actor{UserID: "admin-1", SessionID: "admin-session", Permissions: []string{model.PermissionAdminUsers}}, "user-2", model.UserStatusActive)
		if err != nil {
			t.Fatalf("enable user: %v", err)
		}
		if result.RevokedSessionCount != 0 {
			t.Fatalf("expected no revoked sessions, got %d", result.RevokedSessionCount)
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "admin_user_enabled" {
			t.Fatalf("expected admin_user_enabled audit log, got %#v", recorder.logs)
		}
	})

	t.Run("prevents disabling self", func(t *testing.T) {
		service := NewService(&serviceRepoStub{})

		_, err := service.UpdateUserStatus(ctx, Actor{UserID: "admin-1", SessionID: "admin-session", Permissions: []string{model.PermissionAdminUsers}}, "admin-1", model.UserStatusDisabled)
		if !errors.Is(err, ErrCannotModifySelf) {
			t.Fatalf("expected ErrCannotModifySelf, got %v", err)
		}
	})

	t.Run("prevents demoting self", func(t *testing.T) {
		service := NewService(&serviceRepoStub{})

		_, err := service.UpdateUserRole(ctx, Actor{UserID: "admin-1", SessionID: "admin-session", Permissions: []string{model.PermissionAdminUsers}}, "admin-1", "user")
		if !errors.Is(err, ErrCannotModifySelf) {
			t.Fatalf("expected ErrCannotModifySelf, got %v", err)
		}
	})

	t.Run("updates a user to a custom active role", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserFn: func(_ context.Context, userID string) (model.User, error) {
				return model.User{ID: userID, Role: "user"}, nil
			},
			getRoleFn: func(_ context.Context, key string) (Role, error) {
				switch key {
				case "user":
					return Role{Key: key, Name: "User", IsActive: true, Permissions: []string{}}, nil
				case "auditor":
					return Role{Key: key, Name: "Auditor", IsActive: true}, nil
				default:
					t.Fatalf("unexpected role lookup %q", key)
				}
				return Role{}, nil
			},
			updateUserRoleFn: func(_ context.Context, userID string, role string) (model.User, error) {
				if userID != "user-2" || role != "auditor" {
					t.Fatalf("unexpected role update user=%q role=%q", userID, role)
				}
				return model.User{ID: userID, Status: string(model.UserStatusActive), Role: role}, nil
			},
		}, ServiceOptions{AuditRecorder: recorder})

		user, err := service.UpdateUserRole(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminUsers}}, "user-2", "auditor")
		if err != nil {
			t.Fatalf("update user role: %v", err)
		}
		if user.Role != "auditor" {
			t.Fatalf("expected custom role, got %q", user.Role)
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "admin_user_role_changed" {
			t.Fatalf("expected admin_user_role_changed audit log, got %#v", recorder.logs)
		}
		if string(recorder.logs[0].MetadataJSON) != `{"from_role":"user","to_role":"auditor"}` {
			t.Fatalf("expected role change metadata, got %s", recorder.logs[0].MetadataJSON)
		}
	})

	t.Run("rejects inactive roles", func(t *testing.T) {
		service := NewService(&serviceRepoStub{})

		if _, err := service.UpdateUserRole(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminUsers}}, "user-2", ""); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected invalid role error, got %v", err)
		}
	})

	t.Run("prevents removing the last admin access holder", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			getUserFn: func(_ context.Context, userID string) (model.User, error) {
				if userID != "user-2" {
					t.Fatalf("expected user-2 lookup, got %q", userID)
				}
				return model.User{ID: userID, Role: "admin"}, nil
			},
			getRoleFn: func(_ context.Context, key string) (Role, error) {
				switch key {
				case "admin":
					return Role{Key: key, Name: "Admin", IsActive: true, Permissions: []string{model.PermissionAdminAccess}}, nil
				case "user":
					return Role{Key: key, Name: "User", IsActive: true, Permissions: []string{}}, nil
				default:
					t.Fatalf("unexpected role lookup %q", key)
				}
				return Role{}, nil
			},
			countUsersWithPermissionFn: func(_ context.Context, permission string) (int, error) {
				if permission != model.PermissionAdminAccess {
					t.Fatalf("expected admin access permission, got %q", permission)
				}
				return 1, nil
			},
		})

		_, err := service.UpdateUserRole(ctx, Actor{UserID: "admin-1", Role: "admin", Permissions: []string{model.PermissionAdminUsers, model.PermissionAdminAccess}}, "user-2", "user")
		if !errors.Is(err, ErrLastAdminAccess) {
			t.Fatalf("expected ErrLastAdminAccess, got %v", err)
		}
	})

	t.Run("prevents deleting an administrator until demoted", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			getUserFn: func(_ context.Context, userID string) (model.User, error) {
				return model.User{ID: userID, Role: string(model.UserRoleAdmin)}, nil
			},
			getRoleFn: func(_ context.Context, key string) (Role, error) {
				return Role{Key: key, Name: "Admin", IsActive: true, Permissions: []string{model.PermissionAdminAccess}}, nil
			},
			deleteUserFn: func(context.Context, string) error {
				t.Fatal("DeleteUser should not be called for administrators")
				return nil
			},
		})

		err := service.DeleteUser(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminUsers}}, "admin-2")
		if !errors.Is(err, ErrCannotModifyAdmin) {
			t.Fatalf("expected ErrCannotModifyAdmin, got %v", err)
		}
	})

	t.Run("closes user runtimes after deleting a user", func(t *testing.T) {
		var closedRuntimeUserID string
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserFn: func(_ context.Context, userID string) (model.User, error) {
				return model.User{ID: userID, Role: string(model.UserRoleUser)}, nil
			},
			getRoleFn: func(_ context.Context, key string) (Role, error) {
				return Role{Key: key, Name: "User", IsActive: true, Permissions: []string{}}, nil
			},
			revokeSessionsByUserIDFn: func(_ context.Context, userID string, except string, _ time.Time) (int, error) {
				if userID != "user-2" || except != "" {
					t.Fatalf("unexpected revoke user=%q except=%q", userID, except)
				}
				return 2, nil
			},
			deleteUserFn: func(_ context.Context, userID string) error {
				if userID != "user-2" {
					t.Fatalf("unexpected delete user %q", userID)
				}
				return nil
			},
		}, ServiceOptions{
			UserSessionsRevokedHook: func(_ context.Context, userID string, _ string) {
				closedRuntimeUserID = userID
			},
		})

		if err := service.DeleteUser(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminUsers}}, "user-2"); err != nil {
			t.Fatalf("delete user: %v", err)
		}
		if closedRuntimeUserID != "user-2" {
			t.Fatalf("expected deleted user runtimes to close, got %q", closedRuntimeUserID)
		}
	})

	t.Run("rejects invalid status", func(t *testing.T) {
		service := NewService(&serviceRepoStub{})

		if _, err := service.UpdateUserStatus(ctx, Actor{UserID: "admin-1", Permissions: []string{model.PermissionAdminUsers}}, "user-2", model.UserStatus("pending")); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected invalid status error, got %v", err)
		}
	})
}

func TestServiceSessionManagement(t *testing.T) {
	ctx := context.Background()

	t.Run("lists active sessions", func(t *testing.T) {
		now := time.Now()
		service := NewService(&serviceRepoStub{
			listSessionsFn: func(_ context.Context, received time.Time) ([]SessionListItem, error) {
				if received.IsZero() {
					t.Fatal("expected active session cutoff")
				}
				return []SessionListItem{{ID: "session-1", UserID: "user-1", UserEmail: "user@example.com", LastSeenAt: now}}, nil
			},
		})

		items, err := service.ListSessions(ctx, Actor{Permissions: []string{model.PermissionAdminSessions}})
		if err != nil {
			t.Fatalf("list sessions: %v", err)
		}
		if len(items) != 1 || items[0].ID != "session-1" {
			t.Fatalf("unexpected sessions: %#v", items)
		}
	})

	t.Run("requires session management permission to list sessions", func(t *testing.T) {
		service := NewService(&serviceRepoStub{})

		if _, err := service.ListSessions(ctx, Actor{Permissions: []string{model.PermissionAdminAccess}}); !errors.Is(err, ErrForbidden) {
			t.Fatalf("expected ErrForbidden, got %v", err)
		}
	})

	t.Run("revokes a selected session", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		var revokedSessionID string
		var closedRuntimeUserID string
		var closedRuntimeSessionID string
		var closedRuntimeMessage string
		service := NewServiceWithOptions(&serviceRepoStub{
			revokeSessionFn: func(_ context.Context, sessionID string, _ time.Time) (string, error) {
				revokedSessionID = sessionID
				return "user-2", nil
			},
		}, ServiceOptions{
			AuditRecorder: recorder,
			UserSessionRevokedHook: func(_ context.Context, userID string, sessionID string, message string) {
				closedRuntimeUserID = userID
				closedRuntimeSessionID = sessionID
				closedRuntimeMessage = message
			},
		})

		if err := service.RevokeSession(ctx, Actor{UserID: "admin-1", SessionID: "admin-session", Permissions: []string{model.PermissionAdminSessions}}, "session-2"); err != nil {
			t.Fatalf("revoke session: %v", err)
		}
		if revokedSessionID != "session-2" {
			t.Fatalf("expected session-2 revoked, got %q", revokedSessionID)
		}
		if closedRuntimeUserID != "user-2" || closedRuntimeSessionID != "session-2" || closedRuntimeMessage != "auth session revoked" {
			t.Fatalf("expected selected runtime close, got user=%q session=%q message=%q", closedRuntimeUserID, closedRuntimeSessionID, closedRuntimeMessage)
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "admin_user_kicked" {
			t.Fatalf("expected admin_user_kicked audit log, got %#v", recorder.logs)
		}
		if recorder.logs[0].ResourceType == nil || *recorder.logs[0].ResourceType != "user_session" || recorder.logs[0].ResourceID == nil || *recorder.logs[0].ResourceID != "session-2" {
			t.Fatalf("expected kicked session resource, got %#v", recorder.logs[0])
		}
	})

	t.Run("prevents revoking current session directly", func(t *testing.T) {
		service := NewService(&serviceRepoStub{})

		err := service.RevokeSession(ctx, Actor{UserID: "admin-1", SessionID: "admin-session", Permissions: []string{model.PermissionAdminSessions}}, "admin-session")
		if !errors.Is(err, ErrCannotModifySelf) {
			t.Fatalf("expected ErrCannotModifySelf, got %v", err)
		}
	})

	t.Run("revokes user sessions while preserving current admin session", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		var exceptSessionID string
		var closedSessionIDs []string
		service := NewServiceWithOptions(&serviceRepoStub{
			revokeSessionIDsByUserIDFn: func(_ context.Context, userID string, except string, _ time.Time) ([]string, error) {
				if userID != "admin-1" {
					t.Fatalf("expected admin-1 sessions, got %q", userID)
				}
				exceptSessionID = except
				return []string{"old-admin-session"}, nil
			},
		}, ServiceOptions{
			AuditRecorder: recorder,
			UserSessionRevokedHook: func(_ context.Context, userID string, sessionID string, message string) {
				if userID != "admin-1" || message != "auth session revoked" {
					t.Fatalf("unexpected session runtime close user=%q message=%q", userID, message)
				}
				closedSessionIDs = append(closedSessionIDs, sessionID)
			},
		})

		count, err := service.RevokeUserSessions(ctx, Actor{UserID: "admin-1", SessionID: "admin-session", Permissions: []string{model.PermissionAdminSessions}}, "admin-1")
		if err != nil {
			t.Fatalf("revoke own sessions: %v", err)
		}
		if count != 1 || exceptSessionID != "admin-session" {
			t.Fatalf("expected preserving current session, count=%d except=%q", count, exceptSessionID)
		}
		if !slices.Equal(closedSessionIDs, []string{"old-admin-session"}) {
			t.Fatalf("expected only revoked admin session runtime to close, got %#v", closedSessionIDs)
		}
		if len(recorder.logs) != 1 || recorder.logs[0].EventType != "admin_user_kicked" {
			t.Fatalf("expected admin_user_kicked audit log, got %#v", recorder.logs)
		}
		if recorder.logs[0].ResourceType == nil || *recorder.logs[0].ResourceType != "user" || recorder.logs[0].ResourceID == nil || *recorder.logs[0].ResourceID != "admin-1" {
			t.Fatalf("expected kicked user resource, got %#v", recorder.logs[0])
		}
	})

	t.Run("closes user runtimes after revoking another user's sessions", func(t *testing.T) {
		var closedRuntimeUserID string
		var closedRuntimeMessage string
		service := NewServiceWithOptions(&serviceRepoStub{
			revokeSessionIDsByUserIDFn: func(_ context.Context, userID string, except string, _ time.Time) ([]string, error) {
				if userID != "user-2" || except != "" {
					t.Fatalf("unexpected revoke user=%q except=%q", userID, except)
				}
				return []string{"session-2", "session-3"}, nil
			},
		}, ServiceOptions{
			UserSessionsRevokedHook: func(_ context.Context, userID string, message string) {
				closedRuntimeUserID = userID
				closedRuntimeMessage = message
			},
		})

		count, err := service.RevokeUserSessions(ctx, Actor{UserID: "admin-1", SessionID: "admin-session", Permissions: []string{model.PermissionAdminSessions}}, "user-2")
		if err != nil {
			t.Fatalf("revoke user sessions: %v", err)
		}
		if count != 2 {
			t.Fatalf("expected two revoked sessions, got %d", count)
		}
		if closedRuntimeUserID != "user-2" || closedRuntimeMessage != "auth session revoked" {
			t.Fatalf("expected user runtimes to close for user-2, got user=%q message=%q", closedRuntimeUserID, closedRuntimeMessage)
		}
	})

	t.Run("maps missing sessions to not found", func(t *testing.T) {
		service := NewService(&serviceRepoStub{
			revokeSessionFn: func(context.Context, string, time.Time) (string, error) {
				return "", db.ErrNotFound
			},
		})

		err := service.RevokeSession(ctx, Actor{UserID: "admin-1", SessionID: "admin-session", Permissions: []string{model.PermissionAdminSessions}}, "missing-session")
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("expected ErrNotFound, got %v", err)
		}
	})
}

func auditEventTypes(logs []model.AuditLog) []string {
	items := make([]string, 0, len(logs))
	for _, log := range logs {
		items = append(items, log.EventType)
	}
	return items
}

func TestServiceDatabaseExport(t *testing.T) {
	ctx := context.Background()
	encryptedPassword := stringPtr("cipher-password")
	encryptedPrivateKey := stringPtr("cipher-private-key")
	encryptedPassphrase := stringPtr("cipher-passphrase")
	exportedAt := time.Date(2026, 5, 4, 9, 0, 0, 0, time.UTC)
	service := NewServiceWithOptions(&serviceRepoStub{
		listDatabaseHostGroupsFn: func(context.Context) ([]model.HostGroup, error) {
			return []model.HostGroup{{
				ID:        "group-1",
				UserID:    "user-1",
				Name:      "Production",
				SortOrder: 20,
				CreatedAt: exportedAt.Add(-time.Hour),
				UpdatedAt: exportedAt.Add(-time.Hour),
			}}, nil
		},
		listDatabaseCredentialsFn: func(context.Context) ([]model.Credential, error) {
			return []model.Credential{
				{
					ID:              "cred-1",
					UserID:          "user-1",
					Name:            "Password credential",
					AuthType:        string(model.AuthTypePassword),
					EncryptedSecret: encryptedPassword,
					KeyVersion:      1,
					CreatedAt:       exportedAt.Add(-time.Hour),
					UpdatedAt:       exportedAt.Add(-time.Hour),
				},
				{
					ID:                  "cred-2",
					UserID:              "user-1",
					Name:                "Key credential",
					AuthType:            string(model.AuthTypePrivateKey),
					EncryptedPrivateKey: encryptedPrivateKey,
					EncryptedPassphrase: encryptedPassphrase,
					KeyVersion:          1,
					CreatedAt:           exportedAt.Add(-time.Hour),
					UpdatedAt:           exportedAt.Add(-time.Hour),
				},
			}, nil
		},
		listDatabaseHostsFn: func(context.Context) ([]model.Host, error) {
			return []model.Host{{
				ID:           "host-1",
				UserID:       "user-1",
				GroupID:      stringPtr("group-1"),
				CredentialID: stringPtr("cred-1"),
				Name:         "App server",
				Host:         "10.0.0.5",
				Port:         22,
				Username:     "deploy",
				AuthType:     string(model.AuthTypePassword),
				Status:       string(model.HostStatusActive),
				IsFavorite:   true,
				CreatedAt:    exportedAt.Add(-time.Hour),
				UpdatedAt:    exportedAt.Add(-time.Hour),
			}}, nil
		},
	}, ServiceOptions{
		CredentialEncryptor: databaseEncryptorStub{
			plainByCipher: map[string]string{
				"cipher-password":    "secret-password",
				"cipher-private-key": "private-key",
				"cipher-passphrase":  "key-passphrase",
			},
			activeVersion: 2,
		},
		Now: func() time.Time { return exportedAt },
	})

	backup, err := service.ExportDatabase(ctx, Actor{Permissions: []string{model.PermissionAdminDatabase}})
	if err != nil {
		t.Fatalf("export database: %v", err)
	}

	if backup.SchemaVersion != 1 || !backup.ExportedAt.Equal(exportedAt) {
		t.Fatalf("unexpected backup metadata: %#v", backup)
	}
	if len(backup.HostGroups) != 1 || backup.HostGroups[0].Name != "Production" {
		t.Fatalf("expected host group in export, got %#v", backup.HostGroups)
	}
	if len(backup.Credentials) != 2 {
		t.Fatalf("expected credentials in export, got %#v", backup.Credentials)
	}
	if backup.Credentials[0].EncryptedSecret == nil || *backup.Credentials[0].EncryptedSecret != "cipher-password" || backup.Credentials[0].KeyVersion != 1 {
		t.Fatalf("expected encrypted password credential, got %#v", backup.Credentials[0])
	}
	if backup.Credentials[1].EncryptedPrivateKey == nil || *backup.Credentials[1].EncryptedPrivateKey != "cipher-private-key" ||
		backup.Credentials[1].EncryptedPassphrase == nil || *backup.Credentials[1].EncryptedPassphrase != "cipher-passphrase" {
		t.Fatalf("expected encrypted private key credential, got %#v", backup.Credentials[1])
	}
	if backup.Credentials[0].ContentHash != databaseContentHash("password", "secret-password", "", "") {
		t.Fatalf("expected stable credential content hash, got %q", backup.Credentials[0].ContentHash)
	}
	if len(backup.Hosts) != 1 || backup.Hosts[0].GroupID == nil || *backup.Hosts[0].GroupID != "group-1" {
		t.Fatalf("expected host with original group reference, got %#v", backup.Hosts)
	}
}

func TestServiceDatabaseImportSkipsDuplicatesAndPreservesReferences(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 5, 4, 10, 0, 0, 0, time.UTC)
	lastConnectedAt := now.Add(-2 * time.Hour)
	var createdGroups []model.HostGroup
	var createdCredentials []model.Credential
	var createdHosts []model.Host
	service := NewServiceWithOptions(&serviceRepoStub{
		listDatabaseHostGroupsFn: func(context.Context) ([]model.HostGroup, error) {
			return []model.HostGroup{{ID: "existing-group", UserID: "user-1", Name: "Production"}}, nil
		},
		listDatabaseCredentialsFn: func(context.Context) ([]model.Credential, error) {
			return []model.Credential{{
				ID:              "existing-cred",
				UserID:          "user-1",
				Name:            "Existing Password",
				AuthType:        string(model.AuthTypePassword),
				EncryptedSecret: stringPtr("existing-cipher"),
				KeyVersion:      1,
			}}, nil
		},
		listDatabaseHostsFn: func(context.Context) ([]model.Host, error) {
			return []model.Host{{
				ID:       "existing-host",
				UserID:   "user-1",
				Host:     "10.0.0.5",
				Port:     22,
				Username: "deploy",
				Status:   string(model.HostStatusActive),
			}}, nil
		},
		createDatabaseHostGroupFn: func(_ context.Context, item model.HostGroup) (model.HostGroup, error) {
			item.ID = "new-group-id"
			createdGroups = append(createdGroups, item)
			return item, nil
		},
		createDatabaseCredentialFn: func(_ context.Context, item model.Credential) (model.Credential, error) {
			item.ID = "new-cred-id"
			createdCredentials = append(createdCredentials, item)
			return item, nil
		},
		createDatabaseHostFn: func(_ context.Context, item model.Host) (model.Host, error) {
			item.ID = "new-host-id"
			createdHosts = append(createdHosts, item)
			return item, nil
		},
	}, ServiceOptions{
		CredentialEncryptor: databaseEncryptorStub{
			cipherPrefix: "encrypted:",
			plainByCipher: map[string]string{
				"existing-cipher":           "existing-password",
				"source-existing-cipher":    "existing-password",
				"source-private-key-cipher": "new-private-key",
				"source-passphrase-cipher":  "new-passphrase",
			},
			activeVersion: 3,
		},
		Now: func() time.Time { return now },
	})

	result, err := service.ImportDatabase(ctx, Actor{Permissions: []string{model.PermissionAdminDatabase}}, DatabaseBackup{
		SchemaVersion: 1,
		HostGroups: []DatabaseHostGroupBackup{
			{ID: "source-group-existing", UserID: "user-1", Name: "Production", SortOrder: 1},
			{ID: "source-group-new", UserID: "user-1", Name: "Staging", SortOrder: 2},
		},
		Credentials: []DatabaseCredentialBackup{
			{
				ID:              "source-cred-existing",
				UserID:          "user-1",
				Name:            "Existing Password Copy",
				AuthType:        string(model.AuthTypePassword),
				EncryptedSecret: stringPtr("source-existing-cipher"),
				KeyVersion:      1,
				ContentHash:     databaseContentHash("password", "existing-password", "", ""),
			},
			{
				ID:                  "source-cred-new",
				UserID:              "user-1",
				Name:                "New Key",
				AuthType:            string(model.AuthTypePrivateKey),
				EncryptedPrivateKey: stringPtr("source-private-key-cipher"),
				EncryptedPassphrase: stringPtr("source-passphrase-cipher"),
				KeyVersion:          1,
				ContentHash:         databaseContentHash("private_key", "", "new-private-key", "new-passphrase"),
			},
		},
		Hosts: []DatabaseHostBackup{
			{ID: "source-host-existing", UserID: "user-1", GroupID: stringPtr("source-group-existing"), CredentialID: stringPtr("source-cred-existing"), Name: "Duplicate host", Host: "10.0.0.5", Port: 22, Username: "deploy", AuthType: string(model.AuthTypePassword), Status: string(model.HostStatusActive)},
			{ID: "source-host-new", UserID: "user-1", GroupID: stringPtr("source-group-new"), CredentialID: stringPtr("source-cred-new"), Name: "New host", Host: "10.0.0.6", Port: 22, Username: "deploy", AuthType: string(model.AuthTypePrivateKey), Status: string(model.HostStatusActive), IsFavorite: true, LastConnectedAt: &lastConnectedAt},
		},
	})
	if err != nil {
		t.Fatalf("import database: %v", err)
	}

	if result.HostGroupsImported != 1 || result.HostGroupsSkipped != 1 ||
		result.CredentialsImported != 1 || result.CredentialsSkipped != 1 ||
		result.HostsImported != 1 || result.HostsSkipped != 1 {
		t.Fatalf("unexpected import result: %#v", result)
	}
	if len(createdGroups) != 1 || createdGroups[0].Name != "Staging" {
		t.Fatalf("expected one new group, got %#v", createdGroups)
	}
	if len(createdCredentials) != 1 || createdCredentials[0].EncryptedPrivateKey == nil || *createdCredentials[0].EncryptedPrivateKey != "encrypted:new-private-key" || createdCredentials[0].KeyVersion != 3 {
		t.Fatalf("expected encrypted new credential with active key version, got %#v", createdCredentials)
	}
	if len(createdHosts) != 1 || createdHosts[0].GroupID == nil || *createdHosts[0].GroupID != "new-group-id" || createdHosts[0].CredentialID == nil || *createdHosts[0].CredentialID != "new-cred-id" {
		t.Fatalf("expected new host references mapped to imported records, got %#v", createdHosts)
	}
	if createdHosts[0].LastConnectedAt == nil || !createdHosts[0].LastConnectedAt.Equal(lastConnectedAt) {
		t.Fatalf("expected new host last_connected_at preserved, got %#v", createdHosts[0].LastConnectedAt)
	}
}

func TestServiceDatabaseRequiresPermission(t *testing.T) {
	ctx := context.Background()
	service := NewService(&serviceRepoStub{})

	if _, err := service.ExportDatabase(ctx, Actor{Permissions: []string{model.PermissionAdminUsers}}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected export forbidden, got %v", err)
	}
	if _, err := service.ImportDatabase(ctx, Actor{Permissions: []string{model.PermissionAdminUsers}}, DatabaseBackup{SchemaVersion: 1}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected import forbidden, got %v", err)
	}
}

type databaseEncryptorStub struct {
	plainByCipher map[string]string
	cipherPrefix  string
	activeVersion int
}

func (s databaseEncryptorStub) Encrypt(plain string) (string, error) {
	return s.cipherPrefix + plain, nil
}

func (s databaseEncryptorStub) Decrypt(cipher string) (string, error) {
	if s.plainByCipher != nil {
		if plain, ok := s.plainByCipher[cipher]; ok {
			return plain, nil
		}
	}
	return cipher, nil
}

func (s databaseEncryptorStub) EncryptWithActiveVersion(plain string) (credential.EncryptedValue, error) {
	version := s.activeVersion
	if version == 0 {
		version = 1
	}
	cipherText, err := s.Encrypt(plain)
	if err != nil {
		return credential.EncryptedValue{}, err
	}
	return credential.EncryptedValue{CipherText: cipherText, KeyVersion: version}, nil
}

func (s databaseEncryptorStub) DecryptWithVersion(cipher string, _ int) (string, error) {
	return s.Decrypt(cipher)
}

func (s databaseEncryptorStub) ActiveKeyVersion() int {
	if s.activeVersion == 0 {
		return 1
	}
	return s.activeVersion
}

func (s databaseEncryptorStub) ConfiguredKeyVersions() []int {
	return []int{s.ActiveKeyVersion()}
}

func (s databaseEncryptorStub) IsKeyVersionConfigured(keyVersion int) bool {
	return keyVersion == s.ActiveKeyVersion()
}

func databaseContentHash(authType, password, privateKey, passphrase string) string {
	sum := sha256.Sum256([]byte(authType + "\x00" + password + "\x00" + privateKey + "\x00" + passphrase))
	return hex.EncodeToString(sum[:])
}
