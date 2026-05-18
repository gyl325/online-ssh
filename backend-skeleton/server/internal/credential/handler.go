package credential

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	pagination := webutil.ParsePagination(r)
	items, total, err := h.service.List(r.Context(), session.UserID, ListFilter{
		Limit:    pagination.PageSize,
		Offset:   pagination.Offset,
		AuthType: r.URL.Query().Get("auth_type"),
	})
	if err != nil {
		webutil.WriteError(w, http.StatusInternalServerError, "LIST_CREDENTIALS_FAILED", "list credentials failed")
		return
	}

	respItems := make([]map[string]any, 0, len(items))
	for _, item := range items {
		respItems = append(respItems, credentialResponse(item))
	}

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"items":     respItems,
		"page":      pagination.Page,
		"page_size": pagination.PageSize,
		"total":     total,
	})
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req CreateInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	item, err := h.service.Create(r.Context(), req)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid credential request")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "CREATE_CREDENTIAL_FAILED", "create credential failed")
		return
	}

	webutil.WriteJSON(w, http.StatusCreated, map[string]any{
		"credential": credentialResponse(item),
	})
}

func (h *Handler) GenerateKeyPair(w http.ResponseWriter, r *http.Request) {
	if _, ok := auth.SessionFromContext(r.Context()); !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req GenerateKeyPairInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	keyPair, err := GenerateKeyPair(req)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid key pair request")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "GENERATE_KEY_PAIR_FAILED", "generate key pair failed")
		return
	}

	webutil.WriteJSON(w, http.StatusCreated, map[string]any{
		"key_pair": keyPair,
	})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	item, err := h.service.Get(r.Context(), session.UserID, r.PathValue("credentialId"))
	if err != nil {
		if db.IsNotFound(err) {
			webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "credential not found")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "GET_CREDENTIAL_FAILED", "get credential failed")
		return
	}

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"credential": credentialResponse(item),
	})
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req UpdateInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	item, err := h.service.Update(r.Context(), session.UserID, r.PathValue("credentialId"), req)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid credential request")
		case db.IsNotFound(err):
			webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "credential not found")
		default:
			webutil.WriteError(w, http.StatusInternalServerError, "UPDATE_CREDENTIAL_FAILED", "update credential failed")
		}
		return
	}

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"credential": credentialResponse(item),
	})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	err := h.service.Delete(r.Context(), session.UserID, r.PathValue("credentialId"))
	if err != nil {
		if db.IsNotFound(err) {
			webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "credential not found")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "DELETE_CREDENTIAL_FAILED", "delete credential failed")
		return
	}
	webutil.WriteNoContent(w)
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
