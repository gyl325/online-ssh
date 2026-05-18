package auditexport

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
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

	task, err := h.service.Create(r.Context(), req)
	if err != nil {
		h.writeError(w, err, "CREATE_AUDIT_EXPORT_FAILED", "create audit export failed")
		return
	}
	webutil.WriteJSON(w, http.StatusCreated, map[string]any{"task": task})
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	pagination := webutil.ParsePagination(r)
	result, err := h.service.List(r.Context(), session.UserID, pagination.Page, pagination.PageSize)
	if err != nil {
		h.writeError(w, err, "LIST_AUDIT_EXPORTS_FAILED", "list audit exports failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	task, err := h.service.Get(r.Context(), session.UserID, r.PathValue("exportId"))
	if err != nil {
		h.writeError(w, err, "GET_AUDIT_EXPORT_FAILED", "get audit export failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (h *Handler) Download(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	result, err := h.service.Download(r.Context(), session.UserID, r.PathValue("exportId"))
	if err != nil {
		h.writeError(w, err, "DOWNLOAD_AUDIT_EXPORT_FAILED", "download audit export failed")
		return
	}

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, result.FileName))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(result.CSV))
}

func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	task, err := h.service.Cancel(r.Context(), session.UserID, r.PathValue("exportId"))
	if err != nil {
		h.writeError(w, err, "CANCEL_AUDIT_EXPORT_FAILED", "cancel audit export failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	if err := h.service.Delete(r.Context(), session.UserID, r.PathValue("exportId")); err != nil {
		h.writeError(w, err, "DELETE_AUDIT_EXPORT_FAILED", "delete audit export failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) writeError(w http.ResponseWriter, err error, code, message string) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid audit export request")
	case errors.Is(err, ErrQueueFull):
		webutil.WriteError(w, http.StatusConflict, errorCodeQueueFull, "too many active audit export tasks")
	case errors.Is(err, ErrNotReady):
		webutil.WriteError(w, http.StatusConflict, errorCodeNotReady, "audit export is not ready")
	case errors.Is(err, ErrExpired):
		webutil.WriteError(w, http.StatusGone, errorCodeExpired, "audit export has expired")
	case errors.Is(err, ErrActive):
		webutil.WriteError(w, http.StatusConflict, errorCodeActive, "audit export is still running")
	case db.IsNotFound(err):
		webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "audit export not found")
	default:
		webutil.WriteError(w, http.StatusInternalServerError, code, message)
	}
}
