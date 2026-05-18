package files

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func (h *Handler) ListDirectory(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	limit, err := parseLimit(r.URL.Query().Get("limit"))
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid limit")
		return
	}

	result, err := h.service.ListDirectory(r.Context(), ListDirectoryInput{
		UserID: session.UserID,
		HostID: r.URL.Query().Get("host_id"),
		Path:   r.URL.Query().Get("path"),
		Limit:  limit,
		Cursor: r.URL.Query().Get("cursor"),
	})
	if err != nil {
		h.writeFilesError(w, err)
		return
	}

	if result.SFTPConnectionReused {
		w.Header().Set("X-SFTP-Connection", "reused")
	} else {
		w.Header().Set("X-SFTP-Connection", "new")
	}
	if result.SFTPConnectionRetried {
		w.Header().Set("X-SFTP-Retry", "1")
	} else {
		w.Header().Set("X-SFTP-Retry", "0")
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func parseLimit(raw string) (int, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, err
	}
	return parsed, nil
}
