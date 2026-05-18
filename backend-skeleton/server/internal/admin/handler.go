package admin

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/llm"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/settings"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

type Handler struct {
	service *Service
}

type roleWriteRequest struct {
	Key         string   `json:"key"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	IsActive    bool     `json:"is_active"`
	Permissions []string `json:"permissions"`
}

func (req roleWriteRequest) Role() Role {
	return Role{
		Key:         req.Key,
		Name:        req.Name,
		Description: req.Description,
		IsActive:    req.IsActive,
		Permissions: req.Permissions,
	}
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	items, err := h.service.ListUsers(r.Context(), actor)
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			h.writeError(w, err, "ADMIN_USERS_FORBIDDEN", "list users forbidden")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "ADMIN_USERS_FAILED", "list users failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	if err := h.service.DeleteUser(r.Context(), actor, r.PathValue("userId")); err != nil {
		h.writeError(w, err, "DELETE_USER_FAILED", "delete user failed")
		return
	}
	webutil.WriteNoContent(w)
}

func (h *Handler) UpdateUserStatus(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req struct {
		Status model.UserStatus `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	result, err := h.service.UpdateUserStatus(r.Context(), actor, r.PathValue("userId"), req.Status)
	if err != nil {
		h.writeError(w, err, "UPDATE_USER_STATUS_FAILED", "update user status failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) UpdateUserRole(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	user, err := h.service.UpdateUserRole(r.Context(), actor, r.PathValue("userId"), req.Role)
	if err != nil {
		h.writeError(w, err, "UPDATE_USER_ROLE_FAILED", "update user role failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (h *Handler) ListRoles(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	roles, permissions, err := h.service.ListRoles(r.Context(), actor)
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			h.writeError(w, err, "ADMIN_ROLES_FORBIDDEN", "list roles forbidden")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "ADMIN_ROLES_FAILED", "list roles failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"items":       roles,
		"permissions": permissions,
	})
}

func (h *Handler) CreateRole(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var req roleWriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	role, err := h.service.CreateRole(r.Context(), actor, req.Role())
	if err != nil {
		h.writeError(w, err, "CREATE_ROLE_FAILED", "create role failed")
		return
	}
	webutil.WriteJSON(w, http.StatusCreated, map[string]any{"role": role})
}

func (h *Handler) UpdateRole(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var req roleWriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	role, err := h.service.UpdateRole(r.Context(), actor, r.PathValue("roleKey"), req.Role())
	if err != nil {
		h.writeError(w, err, "UPDATE_ROLE_FAILED", "update role failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"role": role})
}

func (h *Handler) DeleteRole(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	if err := h.service.DeleteRole(r.Context(), actor, r.PathValue("roleKey")); err != nil {
		h.writeError(w, err, "DELETE_ROLE_FAILED", "delete role failed")
		return
	}
	webutil.WriteNoContent(w)
}

func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	items, err := h.service.ListSessions(r.Context(), actor)
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			h.writeError(w, err, "ADMIN_SESSIONS_FORBIDDEN", "list sessions forbidden")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "ADMIN_SESSIONS_FAILED", "list sessions failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) RevokeSession(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	if err := h.service.RevokeSession(r.Context(), actor, r.PathValue("sessionId")); err != nil {
		h.writeError(w, err, "REVOKE_SESSION_FAILED", "revoke session failed")
		return
	}
	webutil.WriteNoContent(w)
}

func (h *Handler) RevokeUserSessions(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	count, err := h.service.RevokeUserSessions(r.Context(), actor, r.PathValue("userId"))
	if err != nil {
		h.writeError(w, err, "REVOKE_USER_SESSIONS_FAILED", "revoke user sessions failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"revoked_session_count": count})
}

func (h *Handler) GetUserMFA(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	result, err := h.service.GetUserMFA(r.Context(), actor, r.PathValue("userId"))
	if err != nil {
		h.writeError(w, err, "GET_USER_MFA_FAILED", "get user mfa failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) ResetUserMFA(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	if err := h.service.ResetUserMFA(r.Context(), actor, r.PathValue("userId"), AdminRequestMetadata{
		ClientIP:  adminClientIPFromRequest(r),
		UserAgent: r.UserAgent(),
	}); err != nil {
		h.writeError(w, err, "RESET_USER_MFA_FAILED", "reset user mfa failed")
		return
	}
	webutil.WriteNoContent(w)
}

func (h *Handler) GetGeneralSettings(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	result, err := h.service.GetGeneralSettings(r.Context(), actor)
	if err != nil {
		h.writeError(w, err, "GET_GENERAL_SETTINGS_FAILED", "get general settings failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, GeneralSettingsResponse{Settings: newGeneralSettingsView(result)})
}

func (h *Handler) UpdateGeneralSettings(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req, options, err := decodeGeneralSettingsUpdate(raw)
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	result, err := h.service.UpdateGeneralSettings(r.Context(), actor, req, options)
	if err != nil {
		h.writeError(w, err, "UPDATE_GENERAL_SETTINGS_FAILED", "update general settings failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, GeneralSettingsResponse{Settings: newGeneralSettingsView(result)})
}

func (h *Handler) TestGeneralSettingsLLM(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req, options, err := decodeGeneralSettingsUpdate(raw)
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	result, err := h.service.TestGeneralSettingsLLM(r.Context(), actor, req, options)
	if err != nil {
		h.writeError(w, err, "TEST_GENERAL_SETTINGS_LLM_FAILED", "test llm settings failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) SendGeneralSettingsTestEmail(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	var req struct {
		To string `json:"to"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	settingsReq, options, err := decodeGeneralSettingsUpdate(raw)
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	providedKeys, err := decodeGeneralSettingsTestEmailProvidedKeys(raw)
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if err := h.service.SendGeneralSettingsTestEmail(r.Context(), actor, req.To, GeneralSettingsTestEmailOptions{
		Settings:      settingsReq,
		UpdateOptions: options,
		ProvidedKeys:  providedKeys,
	}); err != nil {
		h.writeError(w, err, "SEND_GENERAL_SETTINGS_TEST_EMAIL_FAILED", "send test email failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"sent": true})
}

func decodeGeneralSettingsTestEmailProvidedKeys(raw json.RawMessage) (map[string]bool, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	provided := map[string]bool{}
	for _, key := range []string{
		settings.KeySMTPHost,
		settings.KeySMTPPort,
		settings.KeySMTPFrom,
		settings.KeySMTPFromName,
		settings.KeySMTPUsername,
		settings.KeySMTPPassword,
		settings.KeySMTPUseSSL,
	} {
		if _, ok := fields[key]; ok {
			provided[key] = true
		}
	}
	return provided, nil
}

func (h *Handler) ExportDatabase(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	backup, err := h.service.ExportDatabase(r.Context(), actor)
	if err != nil {
		h.writeError(w, err, "EXPORT_DATABASE_FAILED", "export database failed")
		return
	}
	fileName := fmt.Sprintf("online-ssh-database-%s.json", backup.ExportedAt.UTC().Format("20060102-150405"))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fileName))
	webutil.WriteJSON(w, http.StatusOK, backup)
}

func (h *Handler) ImportDatabase(w http.ResponseWriter, r *http.Request) {
	actor, ok := adminActorFromRequest(r)
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var backup DatabaseBackup
	if err := json.NewDecoder(r.Body).Decode(&backup); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	result, err := h.service.ImportDatabase(r.Context(), actor, backup)
	if err != nil {
		h.writeError(w, err, "IMPORT_DATABASE_FAILED", "import database failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) writeError(w http.ResponseWriter, err error, fallbackCode string, fallbackMessage string) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid admin request")
	case errors.Is(err, ErrCannotModifySelf):
		webutil.WriteError(w, http.StatusConflict, "CANNOT_MODIFY_SELF", "cannot modify your own active admin access")
	case errors.Is(err, ErrCannotModifyAdmin):
		webutil.WriteError(w, http.StatusConflict, "CANNOT_MODIFY_ADMIN", "cannot modify administrator")
	case errors.Is(err, ErrForbidden):
		webutil.WriteError(w, http.StatusForbidden, "FORBIDDEN", "forbidden")
	case errors.Is(err, ErrNotFound):
		webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "admin resource not found")
	case errors.Is(err, ErrLastAdminAccess):
		webutil.WriteError(w, http.StatusConflict, "LAST_ADMIN_ACCESS", "cannot remove the last admin access holder")
	case errors.Is(err, ErrSystemRole):
		webutil.WriteError(w, http.StatusConflict, "SYSTEM_ROLE", "cannot modify system role")
	case errors.Is(err, auth.ErrEmailSenderUnavailable):
		webutil.WriteError(w, http.StatusServiceUnavailable, "EMAIL_SENDER_UNAVAILABLE", "email sender is unavailable")
	case errors.Is(err, llm.ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid llm settings")
	case errors.Is(err, llm.ErrNotConfigured):
		webutil.WriteError(w, http.StatusServiceUnavailable, "LLM_NOT_CONFIGURED", "llm settings are not configured")
	case errors.Is(err, llm.ErrProviderUnavailable):
		webutil.WriteError(w, http.StatusBadGateway, "LLM_PROVIDER_UNAVAILABLE", "llm provider is unavailable")
	case errors.Is(err, llm.ErrInvalidProviderResponse):
		webutil.WriteError(w, http.StatusBadGateway, "LLM_INVALID_RESPONSE", "llm provider returned an invalid response")
	default:
		webutil.WriteError(w, http.StatusInternalServerError, fallbackCode, fallbackMessage)
	}
}

func adminActorFromRequest(r *http.Request) (Actor, bool) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		return Actor{}, false
	}
	return Actor{
		UserID:      session.UserID,
		SessionID:   session.SessionID,
		Role:        session.User.Role,
		Permissions: append([]string(nil), session.User.Permissions...),
	}, true
}

func adminClientIPFromRequest(r *http.Request) string {
	for _, header := range []string{"CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP"} {
		value := strings.TrimSpace(r.Header.Get(header))
		if value == "" {
			continue
		}
		if header == "X-Forwarded-For" {
			value = strings.TrimSpace(strings.Split(value, ",")[0])
		}
		if value != "" {
			return value
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}
