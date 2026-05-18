package files

import (
	"encoding/json"
	"net/http"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func (h *Handler) CreateDirectory(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req CreateDirectoryInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.CreateDirectory(r.Context(), req)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusCreated, result)
}

func (h *Handler) CreateFile(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req CreateFileInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.CreateFile(r.Context(), req)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusCreated, result)
}

func (h *Handler) RenameFile(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req RenameFileInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.RenameFile(r.Context(), req)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) DeleteFile(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req DeleteFileInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.DeleteFile(r.Context(), req)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) Chmod(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req ChmodInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.Chmod(r.Context(), req)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) CopyFile(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req CopyFileInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.CopyFile(r.Context(), req)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) CalculateChecksum(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req FileChecksumInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.CalculateChecksum(r.Context(), req)
	if err != nil {
		h.writeFilesError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}
