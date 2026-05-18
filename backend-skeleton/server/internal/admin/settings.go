package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/settings"
)

type GeneralSettingsView struct {
	settings.General
	LLMAPIKeyConfigured    bool `json:"llm_api_key_configured"`
	SMTPPasswordConfigured bool `json:"smtp_password_configured"`
}

type GeneralSettingsResponse struct {
	Settings GeneralSettingsView `json:"settings"`
}

type GeneralSettingsUpdateOptions struct {
	LLMAPIKeyProvided    bool
	LLMAPIKeyClear       bool
	SMTPPasswordProvided bool
	SMTPPasswordClear    bool
}

type GeneralSettingsLLMTestResponse struct {
	OK       bool   `json:"ok"`
	Model    string `json:"model"`
	Protocol string `json:"protocol"`
}

type GeneralSettingsTestEmailOptions struct {
	Settings      settings.General
	UpdateOptions GeneralSettingsUpdateOptions
	ProvidedKeys  map[string]bool
}

type LLMTester interface {
	TestConnection(ctx context.Context, cfg settings.General) error
}

func (s *Service) GetGeneralSettings(ctx context.Context, actor Actor) (settings.General, error) {
	if !hasActorPermission(actor, model.PermissionAdminAccess) {
		return settings.General{}, ErrForbidden
	}
	values, err := s.repo.ListSystemSettings(ctx)
	if err != nil {
		if db.IsUndefinedTable(err) {
			defaults, normalizeErr := settings.Normalize(s.generalDefaults)
			if normalizeErr != nil {
				return settings.General{}, ErrInvalidInput
			}
			_ = s.generalSettings.Update(defaults)
			return defaults, nil
		}
		return settings.General{}, err
	}
	merged, err := settings.Merge(s.generalDefaults, values)
	if err != nil {
		return settings.General{}, ErrInvalidInput
	}
	if err := s.generalSettings.Update(merged); err != nil {
		return settings.General{}, ErrInvalidInput
	}
	return merged, nil
}

func (s *Service) UpdateGeneralSettings(ctx context.Context, actor Actor, input settings.General, updateOptions ...GeneralSettingsUpdateOptions) (settings.General, error) {
	if !hasActorPermission(actor, model.PermissionAdminAccess) {
		return settings.General{}, ErrForbidden
	}
	input = s.applyGeneralSettingsUpdateOptions(input, firstGeneralSettingsUpdateOptions(updateOptions))
	normalized, err := settings.Normalize(input)
	if err != nil {
		return settings.General{}, ErrInvalidInput
	}
	values, err := settings.Encode(normalized)
	if err != nil {
		return settings.General{}, ErrInvalidInput
	}
	if err := s.repo.UpsertSystemSettings(ctx, values, actor.UserID, s.now()); err != nil {
		if db.IsNotFound(err) {
			return settings.General{}, ErrNotFound
		}
		return settings.General{}, err
	}
	if err := s.generalSettings.Update(normalized); err != nil {
		return settings.General{}, ErrInvalidInput
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       actor.UserID,
		EventType:    "admin_general_settings_update",
		ResourceType: stringPtr("system_settings"),
		Result:       string(model.AuditResultSuccess),
		Message:      optionalString("general settings updated"),
		MetadataJSON: jsonMetadata(map[string]any{
			"updated_keys": encodedSettingKeys(values),
		}),
	})
	return normalized, nil
}

func (s *Service) TestGeneralSettingsLLM(ctx context.Context, actor Actor, input settings.General, updateOptions GeneralSettingsUpdateOptions) (GeneralSettingsLLMTestResponse, error) {
	if !hasActorPermission(actor, model.PermissionAdminAccess) {
		return GeneralSettingsLLMTestResponse{}, ErrForbidden
	}
	if s == nil || s.llmTester == nil {
		return GeneralSettingsLLMTestResponse{}, ErrInvalidInput
	}
	input = s.mergeLLMTestInput(input)
	input = s.applyGeneralSettingsUpdateOptions(input, updateOptions)
	normalized, err := settings.Normalize(input)
	if err != nil {
		return GeneralSettingsLLMTestResponse{}, ErrInvalidInput
	}
	if err := s.llmTester.TestConnection(ctx, normalized); err != nil {
		return GeneralSettingsLLMTestResponse{}, err
	}
	return GeneralSettingsLLMTestResponse{
		OK:       true,
		Model:    normalized.LLMModel,
		Protocol: normalized.LLMProtocol,
	}, nil
}

func (s *Service) mergeLLMTestInput(input settings.General) settings.General {
	base := s.GeneralSettingsSnapshot()
	base.LLMEnabled = input.LLMEnabled
	if strings.TrimSpace(input.LLMProtocol) != "" {
		base.LLMProtocol = input.LLMProtocol
	}
	if strings.TrimSpace(input.LLMBaseURL) != "" {
		base.LLMBaseURL = input.LLMBaseURL
	}
	if strings.TrimSpace(input.LLMModel) != "" {
		base.LLMModel = input.LLMModel
	}
	if strings.TrimSpace(input.LLMAuthHeader) != "" {
		base.LLMAuthHeader = input.LLMAuthHeader
	}
	if strings.TrimSpace(input.LLMAPIKey) != "" {
		base.LLMAPIKey = input.LLMAPIKey
	}
	if input.LLMTimeoutSeconds != 0 {
		base.LLMTimeoutSeconds = input.LLMTimeoutSeconds
	}
	if input.LLMMaxTokens != 0 {
		base.LLMMaxTokens = input.LLMMaxTokens
	}
	return base
}

func (s *Service) applyGeneralSettingsUpdateOptions(input settings.General, options GeneralSettingsUpdateOptions) settings.General {
	current := s.GeneralSettingsSnapshot()
	switch {
	case options.LLMAPIKeyClear:
		input.LLMAPIKey = ""
	case strings.TrimSpace(input.LLMAPIKey) != "":
		// Use a newly supplied key.
	default:
		input.LLMAPIKey = current.LLMAPIKey
	}
	switch {
	case options.SMTPPasswordClear:
		input.SMTPPassword = ""
	case strings.TrimSpace(input.SMTPPassword) != "":
		// Use a newly supplied SMTP password.
	default:
		input.SMTPPassword = current.SMTPPassword
	}
	return input
}

func firstGeneralSettingsUpdateOptions(options []GeneralSettingsUpdateOptions) GeneralSettingsUpdateOptions {
	if len(options) == 0 {
		return GeneralSettingsUpdateOptions{}
	}
	return options[0]
}

func (s *Service) GeneralSettingsSnapshot() settings.General {
	if s == nil || s.generalSettings == nil {
		return settings.General{}
	}
	return s.generalSettings.Snapshot()
}

func (s *Service) SendGeneralSettingsTestEmail(ctx context.Context, actor Actor, to string, testOptions ...GeneralSettingsTestEmailOptions) error {
	if !hasActorPermission(actor, model.PermissionAdminAccess) {
		return ErrForbidden
	}
	recipient := normalizeAdminEmail(to)
	if recipient == "" {
		return ErrInvalidInput
	}
	options := firstGeneralSettingsTestEmailOptions(testOptions)
	current := s.mergeSMTPTestInput(options.Settings, options.ProvidedKeys)
	current = s.applyGeneralSettingsUpdateOptions(current, options.UpdateOptions)
	current, err := settings.Normalize(current)
	if err != nil {
		return ErrInvalidInput
	}
	if strings.TrimSpace(current.SMTPHost) == "" || strings.TrimSpace(current.SMTPFrom) == "" {
		return auth.ErrEmailSenderUnavailable
	}
	sender := s.emailSenderFor(current)
	if sender == nil {
		return auth.ErrEmailSenderUnavailable
	}
	if err := sender.Send(ctx, auth.EmailMessage{
		To:      recipient,
		Subject: "Online SSH SMTP test email",
		Body:    fmt.Sprintf("This is a test email from Online SSH. SMTP host: %s.", current.SMTPHost),
		HTML: fmt.Sprintf(
			`<!doctype html><html><body><div style="font-family:Arial,sans-serif;line-height:1.5;color:#172033"><h2>Online SSH SMTP test email</h2><p>This message confirms that the configured SMTP sender can deliver mail.</p><p><strong>SMTP host:</strong> %s</p><p style="color:#667085;font-size:13px">This email was sent automatically by Online SSH. Please do not reply to this email.</p></div></body></html>`,
			current.SMTPHost,
		),
	}); err != nil {
		return err
	}
	return nil
}

func firstGeneralSettingsTestEmailOptions(options []GeneralSettingsTestEmailOptions) GeneralSettingsTestEmailOptions {
	if len(options) == 0 {
		return GeneralSettingsTestEmailOptions{}
	}
	return options[0]
}

func (s *Service) mergeSMTPTestInput(input settings.General, providedKeys map[string]bool) settings.General {
	base := s.GeneralSettingsSnapshot()
	if len(providedKeys) == 0 {
		return base
	}
	if providedKeys[settings.KeySMTPHost] {
		base.SMTPHost = input.SMTPHost
	}
	if providedKeys[settings.KeySMTPPort] {
		base.SMTPPort = input.SMTPPort
	}
	if providedKeys[settings.KeySMTPFrom] {
		base.SMTPFrom = input.SMTPFrom
	}
	if providedKeys[settings.KeySMTPFromName] {
		base.SMTPFromName = input.SMTPFromName
	}
	if providedKeys[settings.KeySMTPUsername] {
		base.SMTPUsername = input.SMTPUsername
	}
	if providedKeys[settings.KeySMTPPassword] {
		base.SMTPPassword = input.SMTPPassword
	}
	if providedKeys[settings.KeySMTPUseSSL] {
		base.SMTPUseSSL = input.SMTPUseSSL
	}
	return base
}

func normalizeAdminEmail(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" || !strings.Contains(value, "@") {
		return ""
	}
	return value
}

func encodedSettingKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func newGeneralSettingsView(input settings.General) GeneralSettingsView {
	view := GeneralSettingsView{
		General:                input,
		LLMAPIKeyConfigured:    strings.TrimSpace(input.LLMAPIKey) != "",
		SMTPPasswordConfigured: strings.TrimSpace(input.SMTPPassword) != "",
	}
	view.LLMAPIKey = ""
	view.SMTPPassword = ""
	return view
}

func decodeGeneralSettingsUpdate(raw json.RawMessage) (settings.General, GeneralSettingsUpdateOptions, error) {
	var req settings.General
	if err := json.Unmarshal(raw, &req); err != nil {
		return settings.General{}, GeneralSettingsUpdateOptions{}, err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return settings.General{}, GeneralSettingsUpdateOptions{}, err
	}
	options := GeneralSettingsUpdateOptions{}
	if _, ok := fields[settings.KeyLLMAPIKey]; ok {
		options.LLMAPIKeyProvided = true
	}
	if rawClear, ok := fields["llm_api_key_clear"]; ok {
		_ = json.Unmarshal(rawClear, &options.LLMAPIKeyClear)
	}
	if _, ok := fields[settings.KeySMTPPassword]; ok {
		options.SMTPPasswordProvided = true
	}
	if rawClear, ok := fields["smtp_password_clear"]; ok {
		_ = json.Unmarshal(rawClear, &options.SMTPPasswordClear)
	}
	return req, options, nil
}
