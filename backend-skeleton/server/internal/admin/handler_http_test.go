package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/llm"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/settings"
)

type handlerRepoStub struct {
	serviceRepoStub
}

func TestHandlerListUsersWritesItems(t *testing.T) {
	handler := NewHandler(NewService(&handlerRepoStub{serviceRepoStub: serviceRepoStub{
		listUsersFn: func(context.Context) ([]UserListItem, error) {
			return []UserListItem{
				{
					User: model.User{
						ID:          "user-1",
						Email:       "admin@example.com",
						DisplayName: "Admin",
						Status:      string(model.UserStatusActive),
						Role:        string(model.UserRoleAdmin),
						CreatedAt:   time.Now(),
						UpdatedAt:   time.Now(),
					},
					ActiveSessionCount: 1,
				},
			}, nil
		},
	}}))

	req := adminRequestWithPermissions(http.MethodGet, "/api/admin/users", nil, model.PermissionAdminUsers)
	recorder := httptest.NewRecorder()

	handler.ListUsers(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Items []UserListItem `json:"items"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(payload.Items) != 1 || payload.Items[0].Role != string(model.UserRoleAdmin) {
		t.Fatalf("unexpected users payload: %#v", payload)
	}
}

func TestHandlerListUsersRequiresUserManagementPermission(t *testing.T) {
	handler := NewHandler(NewService(&handlerRepoStub{serviceRepoStub: serviceRepoStub{}}))
	req := adminRequestWithPermissions(http.MethodGet, "/api/admin/users", nil, model.PermissionAdminAccess)
	recorder := httptest.NewRecorder()

	handler.ListUsers(recorder, req)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestHandlerListSessionsRequiresSessionManagementPermission(t *testing.T) {
	handler := NewHandler(NewService(&handlerRepoStub{serviceRepoStub: serviceRepoStub{}}))
	req := adminRequestWithPermissions(http.MethodGet, "/api/admin/sessions", nil, model.PermissionAdminAccess)
	recorder := httptest.NewRecorder()

	handler.ListSessions(recorder, req)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestHandlerListRolesRequiresRoleManagementPermission(t *testing.T) {
	handler := NewHandler(NewService(&handlerRepoStub{serviceRepoStub: serviceRepoStub{}}))
	req := adminRequestWithPermissions(http.MethodGet, "/api/admin/roles", nil, model.PermissionAdminAccess)
	recorder := httptest.NewRecorder()

	handler.ListRoles(recorder, req)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestHandlerUpdateUserStatus(t *testing.T) {
	var receivedStatus model.UserStatus
	handler := NewHandler(NewService(&handlerRepoStub{serviceRepoStub: serviceRepoStub{
		updateUserStatusFn: func(_ context.Context, userID string, status model.UserStatus) (model.User, error) {
			if userID != "user-2" {
				t.Fatalf("expected user-2, got %q", userID)
			}
			receivedStatus = status
			return model.User{ID: userID, Status: string(status), Role: string(model.UserRoleUser)}, nil
		},
		revokeSessionsByUserIDFn: func(context.Context, string, string, time.Time) (int, error) {
			return 3, nil
		},
	}}))

	req := httptest.NewRequest(http.MethodPatch, "/api/admin/users/user-2/status", strings.NewReader(`{"status":"disabled"}`))
	req.SetPathValue("userId", "user-2")
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{
		SessionID: "admin-session",
		UserID:    "admin-1",
		User:      model.User{ID: "admin-1", Role: string(model.UserRoleAdmin), Permissions: []string{model.PermissionAdminUsers}},
	}))
	recorder := httptest.NewRecorder()

	handler.UpdateUserStatus(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if receivedStatus != model.UserStatusDisabled {
		t.Fatalf("expected disabled status, got %q", receivedStatus)
	}
	var payload UserStatusResult
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.RevokedSessionCount != 3 {
		t.Fatalf("expected revoked session count 3, got %d", payload.RevokedSessionCount)
	}
}

func TestHandlerCreateRoleAcceptsFrontendCreatePayload(t *testing.T) {
	createdAt := time.Date(2026, 5, 11, 9, 30, 0, 0, time.UTC)
	var received Role
	handler := NewHandler(NewService(&handlerRepoStub{serviceRepoStub: serviceRepoStub{
		createRoleFn: func(_ context.Context, role Role) (Role, error) {
			received = role
			role.CreatedAt = createdAt
			role.UpdatedAt = createdAt
			return role, nil
		},
	}}))

	body := `{
		"key": "ops",
		"name": "Operations",
		"description": "Operations team",
		"is_system": false,
		"is_active": true,
		"user_count": 0,
		"permissions": ["hosts.manage", "terminal.connect"],
		"created_at": "",
		"updated_at": ""
	}`
	req := adminRequestWithPermissions(http.MethodPost, "/api/admin/roles", strings.NewReader(body), model.PermissionAdminRoles)
	recorder := httptest.NewRecorder()

	handler.CreateRole(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if received.Key != "ops" || received.Name != "Operations" || !received.IsActive {
		t.Fatalf("unexpected created role input: %#v", received)
	}
	if len(received.Permissions) != 2 || received.Permissions[0] != "hosts.manage" || received.Permissions[1] != "terminal.connect" {
		t.Fatalf("unexpected role permissions: %#v", received.Permissions)
	}
	var payload struct {
		Role Role `json:"role"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Role.Key != "ops" {
		t.Fatalf("unexpected response payload: %#v", payload)
	}
}

func TestHandlerGeneralSettings(t *testing.T) {
	defaults := adminGeneralDefaultsForTest()
	defaults.SMTPUsername = "smtp-user"
	defaults.SMTPPassword = "smexample-api-key"
	defaults.LLMEnabled = true
	defaults.LLMBaseURL = "https://llm.example.com/v1"
	defaults.LLMAPIKey = "stored-example-secret"
	var stored map[string]string
	handler := NewHandler(NewServiceWithOptions(&handlerRepoStub{serviceRepoStub: serviceRepoStub{
		listSystemSettingsFn: func(context.Context) (map[string]string, error) {
			return map[string]string{"allow_user_registration": "true"}, nil
		},
		upsertSystemSettingsFn: func(_ context.Context, values map[string]string, updatedBy string, _ time.Time) error {
			if updatedBy != "admin-1" {
				t.Fatalf("expected admin-1 updater, got %q", updatedBy)
			}
			stored = values
			return nil
		},
	}}, ServiceOptions{GeneralSettingsDefaults: defaults}))

	getReq := adminRequestWithPermissions(http.MethodGet, "/api/admin/settings/general", nil, model.PermissionAdminAccess)
	getRecorder := httptest.NewRecorder()
	handler.GetGeneralSettings(getRecorder, getReq)

	if getRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200 get settings, got %d body=%s", getRecorder.Code, getRecorder.Body.String())
	}
	var getPayload GeneralSettingsResponse
	if err := json.Unmarshal(getRecorder.Body.Bytes(), &getPayload); err != nil {
		t.Fatalf("decode get settings: %v", err)
	}
	if !getPayload.Settings.AllowUserRegistration || getPayload.Settings.RefreshTokenTTLHours != 168 {
		t.Fatalf("unexpected get settings payload: %#v", getPayload)
	}
	if getPayload.Settings.LLMAPIKey != "" || !getPayload.Settings.LLMAPIKeyConfigured {
		t.Fatalf("expected llm api key to be redacted with configured flag, got %#v", getPayload.Settings)
	}
	if getPayload.Settings.SMTPPassword != "" || !getPayload.Settings.SMTPPasswordConfigured {
		t.Fatalf("expected smtp password to be redacted with configured flag, got %#v", getPayload.Settings)
	}
	if strings.Contains(getRecorder.Body.String(), "stored-example-secret") ||
		strings.Contains(getRecorder.Body.String(), "smexample-api-key") ||
		strings.Contains(getRecorder.Body.String(), "llm_api_key\"") ||
		strings.Contains(getRecorder.Body.String(), "smtp_password\"") {
		t.Fatalf("response must not expose saved secrets, body=%s", getRecorder.Body.String())
	}

	updateBody := `{
		"allow_user_registration": false,
		"session_idle_timeout_minutes": 90,
		"refresh_token_ttl_hours": 48,
		"terminal_max_sessions_per_user": 3,
		"terminal_max_sessions_total": 30,
		"terminal_keep_alive_hours": 12,
		"file_sftp_idle_ttl_minutes": 8,
		"host_connectivity_poll_interval_seconds": 25,
		"smtp_host": "smtp.example.com",
		"smtp_port": 465,
		"smtp_from": "noreply@example.com",
		"smtp_from_name": "Online SSH",
		"smtp_username": "smtp-admin",
		"smtp_password": "",
		"smtp_use_ssl": true,
		"auth_allowed_emails": "admin@example.com",
		"auth_allowed_email_domains": "example.com",
		"auth_email_code_length": 6,
		"auth_email_code_ttl_minutes": 5,
		"auth_email_code_max_attempts": 5,
		"auth_email_code_resend_cooldown_seconds": 60,
		"auth_email_code_email_window_minutes": 15,
		"auth_email_code_email_window_max_sends": 5,
		"auth_email_code_ip_window_minutes": 15,
		"auth_email_code_ip_window_max_sends": 10,
		"llm_enabled": true,
		"llm_protocol": "openai",
		"llm_base_url": "https://llm.example.com/v1",
		"llm_model": "mimo-v2.5-pro",
		"llm_auth_header": "api_key",
		"llm_api_key": "",
		"llm_timeout_seconds": 30,
		"llm_max_tokens": 1024
	}`
	updateReq := adminRequestWithPermissions(http.MethodPatch, "/api/admin/settings/general", strings.NewReader(updateBody), model.PermissionAdminAccess)
	updateRecorder := httptest.NewRecorder()
	handler.UpdateGeneralSettings(updateRecorder, updateReq)

	if updateRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200 update settings, got %d body=%s", updateRecorder.Code, updateRecorder.Body.String())
	}
	if stored["session_idle_timeout_minutes"] != "90" || stored["smtp_host"] != "smtp.example.com" {
		t.Fatalf("expected stored settings map, got %#v", stored)
	}
	if stored[settings.KeyLLMAPIKey] != "stored-example-secret" {
		t.Fatalf("expected blank llm api key to retain saved key, got %#v", stored)
	}
	if stored[settings.KeySMTPUsername] != "smtp-admin" || stored[settings.KeySMTPPassword] != "smexample-api-key" {
		t.Fatalf("expected smtp username update with blank password retention, got %#v", stored)
	}

	clearBody := strings.Replace(updateBody, `"smtp_password": ""`, `"smtp_password": "", "smtp_password_clear": true`, 1)
	clearReq := adminRequestWithPermissions(http.MethodPatch, "/api/admin/settings/general", strings.NewReader(clearBody), model.PermissionAdminAccess)
	clearRecorder := httptest.NewRecorder()
	handler.UpdateGeneralSettings(clearRecorder, clearReq)

	if clearRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200 clear smtp password, got %d body=%s", clearRecorder.Code, clearRecorder.Body.String())
	}
	if stored[settings.KeySMTPPassword] != "" {
		t.Fatalf("expected explicit smtp password clear, got %#v", stored)
	}
}

func TestHandlerGeneralSettingsTestLLM(t *testing.T) {
	defaults := adminGeneralDefaultsForTest()
	defaults.LLMEnabled = true
	defaults.LLMBaseURL = "https://llm.example.com/v1"
	defaults.LLMAPIKey = "stored-example-secret"
	tester := &adminLLMTesterStub{}
	handler := NewHandler(NewServiceWithOptions(&handlerRepoStub{}, ServiceOptions{
		GeneralSettingsDefaults: defaults,
		LLMTester:               tester,
	}))

	body := `{
		"llm_enabled": true,
		"llm_protocol": "anthropic",
		"llm_base_url": "https://llm.example.com/anthropic",
		"llm_model": "mimo-v2.5-pro",
		"llm_auth_header": "api_key",
		"llm_api_key": "",
		"llm_timeout_seconds": 30,
		"llm_max_tokens": 1024
	}`
	req := adminRequestWithPermissions(http.MethodPost, "/api/admin/settings/general/test-llm", strings.NewReader(body), model.PermissionAdminAccess)
	recorder := httptest.NewRecorder()
	handler.TestGeneralSettingsLLM(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 test llm, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload GeneralSettingsLLMTestResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.OK || payload.Protocol != settings.LLMProtocolAnthropic || payload.Model != "mimo-v2.5-pro" {
		t.Fatalf("unexpected test payload %#v", payload)
	}
	if len(tester.calls) != 1 || tester.calls[0].LLMAPIKey != "stored-example-secret" {
		t.Fatalf("expected saved key fallback, calls=%#v", tester.calls)
	}

	forbiddenReq := adminRequestWithPermissions(http.MethodPost, "/api/admin/settings/general/test-llm", strings.NewReader(body), model.PermissionAdminUsers)
	forbiddenRecorder := httptest.NewRecorder()
	handler.TestGeneralSettingsLLM(forbiddenRecorder, forbiddenReq)
	if forbiddenRecorder.Code != http.StatusForbidden {
		t.Fatalf("expected 403 without admin.access, got %d body=%s", forbiddenRecorder.Code, forbiddenRecorder.Body.String())
	}
}

func TestHandlerGeneralSettingsTestLLMMapsLLMErrors(t *testing.T) {
	defaults := adminGeneralDefaultsForTest()
	defaults.LLMEnabled = true
	defaults.LLMBaseURL = "https://llm.example.com/anthropic"
	defaults.LLMAPIKey = "stored-example-secret"
	body := `{
		"llm_enabled": true,
		"llm_protocol": "anthropic",
		"llm_base_url": "https://llm.example.com/anthropic",
		"llm_model": "mimo-v2.5-pro",
		"llm_auth_header": "api_key",
		"llm_api_key": "",
		"llm_timeout_seconds": 30,
		"llm_max_tokens": 1024
	}`

	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "not configured",
			err:        llm.ErrNotConfigured,
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   "LLM_NOT_CONFIGURED",
		},
		{
			name:       "provider unavailable",
			err:        llm.ErrProviderUnavailable,
			wantStatus: http.StatusBadGateway,
			wantCode:   "LLM_PROVIDER_UNAVAILABLE",
		},
		{
			name:       "invalid provider response",
			err:        llm.ErrInvalidProviderResponse,
			wantStatus: http.StatusBadGateway,
			wantCode:   "LLM_INVALID_RESPONSE",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			handler := NewHandler(NewServiceWithOptions(&handlerRepoStub{}, ServiceOptions{
				GeneralSettingsDefaults: defaults,
				LLMTester:               &adminLLMTesterStub{err: tc.err},
			}))
			req := adminRequestWithPermissions(http.MethodPost, "/api/admin/settings/general/test-llm", strings.NewReader(body), model.PermissionAdminAccess)
			recorder := httptest.NewRecorder()

			handler.TestGeneralSettingsLLM(recorder, req)

			if recorder.Code != tc.wantStatus {
				t.Fatalf("expected %d, got %d body=%s", tc.wantStatus, recorder.Code, recorder.Body.String())
			}
			var payload struct {
				Code string `json:"code"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload.Code != tc.wantCode {
				t.Fatalf("expected code %q, got %#v", tc.wantCode, payload)
			}
		})
	}
}

func TestHandlerGeneralSettingsTestEmail(t *testing.T) {
	sender := &adminEmailSenderStub{}
	var senderSettings []settings.General
	handler := NewHandler(NewServiceWithOptions(&handlerRepoStub{}, ServiceOptions{
		GeneralSettingsDefaults: generalSettingsDefaultsWithSMTPForTest(),
		EmailSenderForSettings: func(current settings.General) auth.EmailSender {
			senderSettings = append(senderSettings, current)
			return sender
		},
		EmailSenderProvider: func() auth.EmailSender {
			return sender
		},
	}))

	req := adminRequestWithPermissions(http.MethodPost, "/api/admin/settings/general/test-email", strings.NewReader(`{"to":"ops@example.com"}`), model.PermissionAdminAccess)
	recorder := httptest.NewRecorder()
	handler.SendGeneralSettingsTestEmail(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 test email, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Sent bool `json:"sent"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.Sent || len(sender.messages) != 1 || sender.messages[0].To != "ops@example.com" {
		t.Fatalf("expected sent response and one email, payload=%#v messages=%#v", payload, sender.messages)
	}
	if len(senderSettings) != 1 || senderSettings[0].SMTPHost != "smtp.example.com" {
		t.Fatalf("expected saved SMTP settings for simple test email request, got %#v", senderSettings)
	}

	draftBody := `{
		"to":"draft@example.com",
		"smtp_host":"smtp.next.example.com",
		"smtp_port":587,
		"smtp_from":"next@example.com",
		"smtp_from_name":"Next Sender",
		"smtp_username":"next-user",
		"smtp_password":"",
		"smtp_use_ssl":false
	}`
	draftReq := adminRequestWithPermissions(http.MethodPost, "/api/admin/settings/general/test-email", strings.NewReader(draftBody), model.PermissionAdminAccess)
	draftRecorder := httptest.NewRecorder()
	handler.SendGeneralSettingsTestEmail(draftRecorder, draftReq)

	if draftRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200 draft test email, got %d body=%s", draftRecorder.Code, draftRecorder.Body.String())
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
		draftSettings.SMTPPassword != "" ||
		draftSettings.SMTPUseSSL {
		t.Fatalf("expected request SMTP draft to reach handler service, got %#v", draftSettings)
	}
}

func generalSettingsDefaultsWithSMTPForTest() settings.General {
	defaults := adminGeneralDefaultsForTest()
	defaults.SMTPHost = "smtp.example.com"
	defaults.SMTPPort = 465
	defaults.SMTPFrom = "noreply@example.com"
	defaults.SMTPFromName = "Online SSH"
	defaults.SMTPUseSSL = true
	return defaults
}

func TestHandlerDatabaseExportAndImport(t *testing.T) {
	exportedAt := time.Date(2026, 5, 4, 9, 0, 0, 0, time.UTC)
	handler := NewHandler(NewServiceWithOptions(&handlerRepoStub{serviceRepoStub: serviceRepoStub{
		listDatabaseHostGroupsFn: func(context.Context) ([]model.HostGroup, error) {
			return []model.HostGroup{{ID: "group-1", UserID: "user-1", Name: "Production", CreatedAt: exportedAt, UpdatedAt: exportedAt}}, nil
		},
		listDatabaseCredentialsFn: func(context.Context) ([]model.Credential, error) {
			return []model.Credential{{
				ID:              "cred-1",
				UserID:          "user-1",
				Name:            "Password credential",
				AuthType:        string(model.AuthTypePassword),
				EncryptedSecret: stringPtr("cipher-password"),
				KeyVersion:      1,
				CreatedAt:       exportedAt,
				UpdatedAt:       exportedAt,
			}}, nil
		},
		listDatabaseHostsFn: func(context.Context) ([]model.Host, error) {
			return []model.Host{{ID: "host-1", UserID: "user-1", Name: "App server", Host: "10.0.0.5", Port: 22, Username: "deploy", AuthType: string(model.AuthTypePassword), Status: string(model.HostStatusActive), CreatedAt: exportedAt, UpdatedAt: exportedAt}}, nil
		},
	}}, ServiceOptions{
		CredentialEncryptor: databaseEncryptorStub{plainByCipher: map[string]string{"cipher-password": "secret-password"}},
		Now:                 func() time.Time { return exportedAt },
	}))

	exportReq := adminRequest(http.MethodGet, "/api/admin/database/export", nil)
	exportRecorder := httptest.NewRecorder()
	handler.ExportDatabase(exportRecorder, exportReq)

	if exportRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200 export, got %d body=%s", exportRecorder.Code, exportRecorder.Body.String())
	}
	if contentType := exportRecorder.Header().Get("Content-Type"); !strings.Contains(contentType, "application/json") {
		t.Fatalf("expected json content type, got %q", contentType)
	}
	if disposition := exportRecorder.Header().Get("Content-Disposition"); !strings.Contains(disposition, "online-ssh-database-20260504-090000.json") {
		t.Fatalf("unexpected content disposition %q", disposition)
	}
	var backup DatabaseBackup
	if err := json.Unmarshal(exportRecorder.Body.Bytes(), &backup); err != nil {
		t.Fatalf("decode export body: %v", err)
	}
	if backup.SchemaVersion != 1 || len(backup.HostGroups) != 1 || len(backup.Credentials) != 1 || len(backup.Hosts) != 1 {
		t.Fatalf("unexpected export backup: %#v", backup)
	}

	importHandler := NewHandler(NewServiceWithOptions(&handlerRepoStub{serviceRepoStub: serviceRepoStub{
		listDatabaseHostGroupsFn:  func(context.Context) ([]model.HostGroup, error) { return nil, nil },
		listDatabaseCredentialsFn: func(context.Context) ([]model.Credential, error) { return nil, nil },
		listDatabaseHostsFn:       func(context.Context) ([]model.Host, error) { return nil, nil },
		createDatabaseHostGroupFn: func(_ context.Context, item model.HostGroup) (model.HostGroup, error) {
			item.ID = "created-group"
			return item, nil
		},
		createDatabaseCredentialFn: func(_ context.Context, item model.Credential) (model.Credential, error) {
			item.ID = "created-credential"
			return item, nil
		},
		createDatabaseHostFn: func(_ context.Context, item model.Host) (model.Host, error) {
			item.ID = "created-host"
			return item, nil
		},
	}}, ServiceOptions{
		CredentialEncryptor: databaseEncryptorStub{plainByCipher: map[string]string{"cipher-password": "secret-password"}},
		Now:                 func() time.Time { return exportedAt },
	}))

	importReq := adminRequest(http.MethodPost, "/api/admin/database/import", strings.NewReader(exportRecorder.Body.String()))
	importRecorder := httptest.NewRecorder()
	importHandler.ImportDatabase(importRecorder, importReq)

	if importRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200 import, got %d body=%s", importRecorder.Code, importRecorder.Body.String())
	}
	var result DatabaseImportResult
	if err := json.Unmarshal(importRecorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode import response: %v", err)
	}
	if result.HostGroupsImported != 1 || result.CredentialsImported != 1 || result.HostsImported != 1 {
		t.Fatalf("unexpected import result: %#v", result)
	}
}

func adminRequest(method string, target string, body *strings.Reader) *http.Request {
	return adminRequestWithPermissions(method, target, body, model.PermissionAdminDatabase)
}

func adminRequestWithPermissions(method string, target string, body *strings.Reader, permissions ...string) *http.Request {
	var reader *strings.Reader
	if body == nil {
		reader = strings.NewReader("")
	} else {
		reader = body
	}
	req := httptest.NewRequest(method, target, reader)
	return req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{
		SessionID: "admin-session",
		UserID:    "admin-1",
		User:      model.User{ID: "admin-1", Role: string(model.UserRoleAdmin), Permissions: permissions},
	}))
}
