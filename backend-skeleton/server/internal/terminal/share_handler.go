package terminal

import (
	"encoding/json"
	"net/http"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func (h *Handler) CreateShare(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req struct {
		ExpiresInMinutes int    `json:"expires_in_minutes"`
		MaxAccesses      *int   `json:"max_accesses"`
		Password         string `json:"password"`
		SensitivePrompt  string `json:"sensitive_prompt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	result, err := h.service.CreateShare(r.Context(), CreateTerminalShareInput{
		UserID:           session.UserID,
		SessionID:        r.PathValue("sessionId"),
		ExpiresInMinutes: req.ExpiresInMinutes,
		MaxAccesses:      req.MaxAccesses,
		Password:         req.Password,
		SensitivePrompt:  req.SensitivePrompt,
		PublicBaseURL:    terminalPublicBaseURL(r),
	})
	if err != nil {
		h.writeShareError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusCreated, result)
}

func (h *Handler) OpenShareAccess(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token          string `json:"token"`
		Password       string `json:"password"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	result, err := h.service.OpenShareAccess(r.Context(), OpenTerminalShareAccessInput{
		Token:            req.Token,
		Password:         req.Password,
		IdempotencyKey:   req.IdempotencyKey,
		ClientIP:         terminalClientIPFromRequest(r),
		UserAgent:        r.UserAgent(),
		WebSocketBaseURL: terminalWebSocketBaseURL(r),
	})
	if err != nil {
		h.writeShareError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) GetActiveShare(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	info, err := h.service.GetActiveShare(r.Context(), session.UserID, r.PathValue("sessionId"))
	if err != nil {
		h.writeShareError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"share": info})
}

func (h *Handler) ExtendShare(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var req struct {
		ExpiresInMinutes int `json:"expires_in_minutes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	info, err := h.service.ExtendShare(r.Context(), ExtendTerminalShareInput{
		UserID:           session.UserID,
		ShareID:          r.PathValue("shareId"),
		ExpiresInMinutes: req.ExpiresInMinutes,
	})
	if err != nil {
		h.writeShareError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"share": info})
}

func (h *Handler) RevokeShare(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	info, err := h.service.RevokeShare(r.Context(), session.UserID, r.PathValue("shareId"))
	if err != nil {
		h.writeShareError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"share": info})
}

func (h *Handler) ListShareAccessLogs(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	page, pageSize, err := paginationFromQuery(r, defaultRecordingPageSize, maxRecordingPageSize)
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid pagination")
		return
	}
	result, err := h.service.ListShareAccessLogs(r.Context(), session.UserID, r.PathValue("shareId"), page, pageSize)
	if err != nil {
		h.writeShareError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}
