package files

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func (h *Handler) SearchFiles(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	recursive, err := parseRecursive(r.URL.Query().Get("recursive"))
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid recursive flag")
		return
	}

	result, err := h.service.SearchFiles(r.Context(), SearchFilesInput{
		UserID:    session.UserID,
		HostID:    r.URL.Query().Get("host_id"),
		BasePath:  r.URL.Query().Get("base_path"),
		Keyword:   r.URL.Query().Get("keyword"),
		Recursive: recursive,
	})
	if err != nil {
		h.writeFilesError(w, err)
		return
	}

	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) CreateSearchTask(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req CreateSearchTaskInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	task, err := h.service.CreateSearchTask(r.Context(), req)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusCreated, map[string]any{"task": task})
}

func (h *Handler) GetSearchTask(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	task, err := h.service.GetSearchTask(r.Context(), session.UserID, r.PathValue("taskId"))
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"task": task})
}

func (h *Handler) ListSearchTaskResults(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	pagination := webutil.ParsePagination(r)
	result, err := h.service.ListSearchResults(r.Context(), session.UserID, r.PathValue("taskId"), pagination.Page, pagination.PageSize)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) CancelSearchTask(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	task, err := h.service.CancelSearchTask(r.Context(), session.UserID, r.PathValue("taskId"))
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"task": task})
}

func parseRecursive(raw string) (bool, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return false, nil
	}
	switch strings.ToLower(value) {
	case "1", "true":
		return true, nil
	case "0", "false":
		return false, nil
	default:
		return false, ErrInvalidInput
	}
}
