package terminal

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/llm"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func (h *Handler) GenerateCommand(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req llm.CommandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	result, err := h.service.GenerateCommand(r.Context(), session.UserID, req)
	if err != nil {
		h.writeCommandAssistantError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) writeCommandAssistantError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput), errors.Is(err, llm.ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid command assistant request")
	case errors.Is(err, llm.ErrNotConfigured), errors.Is(err, ErrInvalidState):
		webutil.WriteError(w, http.StatusServiceUnavailable, "LLM_NOT_CONFIGURED", "llm command assistant is not configured")
	case errors.Is(err, llm.ErrProviderUnavailable):
		webutil.WriteError(w, http.StatusBadGateway, "LLM_PROVIDER_UNAVAILABLE", "llm provider is unavailable")
	case errors.Is(err, llm.ErrInvalidProviderResponse):
		webutil.WriteError(w, http.StatusBadGateway, "LLM_INVALID_RESPONSE", "llm provider returned an invalid response")
	default:
		webutil.WriteError(w, http.StatusInternalServerError, "TERMINAL_COMMAND_ASSISTANT_FAILED", "generate terminal command failed")
	}
}
