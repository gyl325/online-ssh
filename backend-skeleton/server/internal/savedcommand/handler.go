package savedcommand

import (
	"encoding/json"
	"errors"
	"net/http"

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

	items, err := h.service.List(r.Context(), session.UserID)
	if err != nil {
		webutil.WriteError(w, http.StatusInternalServerError, "LIST_SAVED_COMMANDS_FAILED", "list saved commands failed")
		return
	}
	if items == nil {
		items = []model.SavedCommand{}
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req SaveInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	item, err := h.service.Create(r.Context(), session.UserID, req)
	if err != nil {
		h.writeError(w, err, "CREATE_SAVED_COMMAND_FAILED", "create saved command failed")
		return
	}
	webutil.WriteJSON(w, http.StatusCreated, map[string]any{"command": item})
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req SaveInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	item, err := h.service.Update(r.Context(), session.UserID, r.PathValue("commandId"), req)
	if err != nil {
		h.writeError(w, err, "UPDATE_SAVED_COMMAND_FAILED", "update saved command failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"command": item})
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	if err := h.service.Delete(r.Context(), session.UserID, r.PathValue("commandId")); err != nil {
		h.writeError(w, err, "DELETE_SAVED_COMMAND_FAILED", "delete saved command failed")
		return
	}
	webutil.WriteNoContent(w)
}

func (h *Handler) writeError(w http.ResponseWriter, err error, code, message string) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid saved command request")
	case db.IsNotFound(err):
		webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "saved command not found")
	default:
		webutil.WriteError(w, http.StatusInternalServerError, code, message)
	}
}
