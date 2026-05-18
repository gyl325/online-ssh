package files

import (
	"encoding/json"
	"net/http"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func (h *Handler) ReadFileContent(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	result, err := h.service.ReadFileContent(r.Context(), ReadFileContentInput{
		UserID: session.UserID,
		HostID: r.URL.Query().Get("host_id"),
		Path:   r.URL.Query().Get("path"),
	})
	if err != nil {
		h.writeFilesError(w, err)
		return
	}

	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) WriteFileContent(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req WriteFileContentInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.WriteFileContent(r.Context(), req)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}

	webutil.WriteJSON(w, http.StatusOK, result)
}
