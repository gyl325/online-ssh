package host

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

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
	filter := ListFilter{
		Limit:        pagination.PageSize,
		Offset:       pagination.Offset,
		Keyword:      r.URL.Query().Get("keyword"),
		FavoriteOnly: r.URL.Query().Get("favorite_only") == "true",
		GroupID:      r.URL.Query().Get("group_id"),
	}
	items, total, err := h.service.List(r.Context(), session.UserID, filter)
	if err != nil {
		webutil.WriteError(w, http.StatusInternalServerError, "LIST_HOSTS_FAILED", "list hosts failed")
		return
	}

	respItems := make([]map[string]any, 0, len(items))
	for _, item := range items {
		respItems = append(respItems, hostResponse(item))
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
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid host request")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "CREATE_HOST_FAILED", "create host failed")
		return
	}

	webutil.WriteJSON(w, http.StatusCreated, map[string]any{
		"host": hostResponse(item),
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

	item, err := h.service.Update(r.Context(), session.UserID, r.PathValue("hostId"), req)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid host request")
		case db.IsNotFound(err):
			webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "host not found")
		default:
			webutil.WriteError(w, http.StatusInternalServerError, "UPDATE_HOST_FAILED", "update host failed")
		}
		return
	}

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"host": hostResponse(item),
	})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	err := h.service.Delete(r.Context(), session.UserID, r.PathValue("hostId"))
	if err != nil {
		if db.IsNotFound(err) {
			webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "host not found")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "DELETE_HOST_FAILED", "delete host failed")
		return
	}
	webutil.WriteNoContent(w)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	item, err := h.service.Get(r.Context(), session.UserID, r.PathValue("hostId"))
	if err != nil {
		if db.IsNotFound(err) {
			webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "host not found")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "GET_HOST_FAILED", "get host failed")
		return
	}

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"host": hostResponse(item),
	})
}

func (h *Handler) Metrics(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	metrics, err := h.service.GetMetrics(r.Context(), session.UserID, r.PathValue("hostId"))
	if err != nil {
		var fingerprintErr *FingerprintConflictError
		switch {
		case errors.Is(err, ErrInvalidInput):
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid host metrics request")
		case errors.As(err, &fingerprintErr):
			webutil.WriteJSON(w, http.StatusConflict, map[string]any{
				"code":                 fingerprintErr.Code,
				"message":              fingerprintErr.Message,
				"current_fingerprint":  hostFingerprintResponse(fingerprintErr.CurrentFingerprint),
				"previous_fingerprint": optionalHostFingerprintResponse(fingerprintErr.PreviousFingerprint),
			})
		case db.IsNotFound(err):
			webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "host not found")
		default:
			webutil.WriteError(w, http.StatusInternalServerError, "HOST_METRICS_FAILED", "host metrics failed")
		}
		return
	}

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"metrics": metrics,
	})
}

func (h *Handler) TestConnection(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req TestConnectionInput
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
			return
		}
	}

	result, err := h.service.TestConnection(r.Context(), session.UserID, r.PathValue("hostId"), req)
	if err != nil {
		var fingerprintErr *FingerprintConflictError
		switch {
		case errors.Is(err, ErrInvalidInput):
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid host test request")
		case errors.As(err, &fingerprintErr):
			webutil.WriteJSON(w, http.StatusConflict, map[string]any{
				"code":                 fingerprintErr.Code,
				"message":              fingerprintErr.Message,
				"current_fingerprint":  hostFingerprintResponse(fingerprintErr.CurrentFingerprint),
				"previous_fingerprint": optionalHostFingerprintResponse(fingerprintErr.PreviousFingerprint),
			})
		case db.IsNotFound(err):
			webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "host not found")
		default:
			webutil.WriteError(w, http.StatusInternalServerError, "TEST_HOST_FAILED", "host test failed")
		}
		return
	}

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":          result.OK,
		"message":     result.Message,
		"fingerprint": hostFingerprintResponse(result.Fingerprint),
	})
}

func (h *Handler) ConfirmFingerprint(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req ConfirmFingerprintInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	item, err := h.service.ConfirmFingerprint(r.Context(), session.UserID, r.PathValue("hostId"), req)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid fingerprint request")
		case db.IsNotFound(err):
			webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "host not found")
		default:
			webutil.WriteError(w, http.StatusInternalServerError, "CONFIRM_HOST_FINGERPRINT_FAILED", "confirm host fingerprint failed")
		}
		return
	}

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"fingerprint": hostFingerprintResponse(item),
	})
}

func hostFingerprintResponse(item model.HostFingerprint) map[string]any {
	return map[string]any{
		"algorithm":        item.Algorithm,
		"fingerprint":      item.Fingerprint,
		"status":           item.Status,
		"first_seen_at":    zeroTimeToNil(item.FirstSeenAt),
		"last_verified_at": item.LastVerifiedAt,
	}
}

func optionalHostFingerprintResponse(item *model.HostFingerprint) any {
	if item == nil {
		return nil
	}
	return hostFingerprintResponse(*item)
}

func zeroTimeToNil(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
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
