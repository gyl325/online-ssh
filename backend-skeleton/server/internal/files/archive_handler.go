package files

import (
	"encoding/json"
	"net/http"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func (h *Handler) CompressArchive(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req CompressArchiveInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.CompressArchive(r.Context(), req)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) ExtractArchive(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req ExtractArchiveInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.ExtractArchive(r.Context(), req)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}
