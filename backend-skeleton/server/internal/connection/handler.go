package connection

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

type QuickConnectService interface {
	QuickConnect(ctx context.Context, input QuickConnectInput) (QuickConnectResult, error)
}

type Handler struct {
	service     QuickConnectService
	hostService *host.Service
}

func NewHandler(service QuickConnectService) *Handler {
	return &Handler{service: service}
}

func NewHandlerWithTemporaryConnections(service QuickConnectService, hostService *host.Service) *Handler {
	return &Handler{service: service, hostService: hostService}
}

func (h *Handler) QuickConnect(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req QuickConnectInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.QuickConnect(r.Context(), req)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid quick connection request")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "QUICK_CONNECT_FAILED", "quick connection failed")
		return
	}

	webutil.WriteJSON(w, http.StatusCreated, map[string]any{
		"credential":         credentialResponse(result.Credential),
		"host":               hostResponse(result.Host),
		"created_credential": result.CreatedCredential,
	})
}

func (h *Handler) CreateTemporaryConnection(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	if h.hostService == nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "temporary connections are unavailable")
		return
	}

	var req host.TemporaryConnectionInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	item, err := h.hostService.CreateTemporaryConnection(r.Context(), req)
	if err != nil {
		if errors.Is(err, host.ErrInvalidInput) {
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid temporary connection request")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "TEMPORARY_CONNECTION_FAILED", "temporary connection failed")
		return
	}

	webutil.WriteJSON(w, http.StatusCreated, map[string]any{
		"host": hostResponse(item),
	})
}

func credentialResponse(item model.Credential) map[string]any {
	return map[string]any{
		"id":              item.ID,
		"name":            item.Name,
		"auth_type":       item.AuthType,
		"has_secret":      item.EncryptedSecret != nil,
		"has_private_key": item.EncryptedPrivateKey != nil,
		"has_passphrase":  item.EncryptedPassphrase != nil,
		"key_version":     strconv.Itoa(item.KeyVersion),
		"is_default":      false,
		"created_at":      item.CreatedAt,
		"updated_at":      item.UpdatedAt,
	}
}

func hostResponse(item model.Host) map[string]any {
	return map[string]any{
		"id":                item.ID,
		"group_id":          item.GroupID,
		"credential_id":     item.CredentialID,
		"name":              item.Name,
		"host":              item.Host,
		"port":              item.Port,
		"username":          item.Username,
		"auth_type":         item.AuthType,
		"remark":            nil,
		"is_favorite":       item.IsFavorite,
		"status":            item.Status,
		"last_connected_at": item.LastConnectedAt,
		"created_at":        item.CreatedAt,
		"updated_at":        item.UpdatedAt,
	}
}
