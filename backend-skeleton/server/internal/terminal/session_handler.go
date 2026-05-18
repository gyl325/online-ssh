package terminal

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func (h *Handler) Bootstrap(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req SessionBootstrapInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID
	req.RemoteAddr = r.RemoteAddr
	req.WebSocketBaseURL = terminalWebSocketBaseURL(r)

	result, err := h.service.Bootstrap(r.Context(), req)
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}

	webutil.WriteJSON(w, http.StatusCreated, result)
}

func (h *Handler) QuickConnect(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req QuickConnectSessionInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID
	req.RemoteAddr = r.RemoteAddr
	req.WebSocketBaseURL = terminalWebSocketBaseURL(r)

	result, err := h.service.QuickConnect(r.Context(), req)
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}

	webutil.WriteJSON(w, http.StatusCreated, result)
}

func (h *Handler) GetSession(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	item, err := h.service.GetSession(r.Context(), session.UserID, r.PathValue("sessionId"))
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid terminal session id")
		case db.IsNotFound(err):
			webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "terminal session not found")
		default:
			webutil.WriteError(w, http.StatusInternalServerError, "GET_TERMINAL_SESSION_FAILED", "get terminal session failed")
		}
		return
	}

	state, hasState := h.service.RuntimeState(session.UserID, item.ID)
	response := sessionInfoResponseWithRuntimeState(item, state, hasState)
	if item.Status == string(model.TerminalSessionStatusConnected) {
		attachToken, err := h.service.NewAttachToken(session.UserID, item.ID)
		if err != nil {
			h.writeTerminalError(w, err)
			return
		}
		response.AttachToken = &attachToken
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"session": response,
	})
}

func (h *Handler) ListSessions(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	items, err := h.service.ListRecoverableSessions(r.Context(), session.UserID)
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) CloseSession(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	item, err := h.service.CloseSession(r.Context(), session.UserID, r.PathValue("sessionId"))
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}
	state, hasState := h.service.RuntimeState(session.UserID, item.ID)
	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"session": sessionInfoResponseWithRuntimeState(item, state, hasState),
	})
}

func (h *Handler) SetKeepAlive(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	info, err := h.service.SetKeepAlive(r.Context(), session.UserID, r.PathValue("sessionId"), req.Enabled)
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"session": info})
}
