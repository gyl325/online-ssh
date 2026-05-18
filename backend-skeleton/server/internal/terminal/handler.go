package terminal

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
	"github.com/gorilla/websocket"
)

const (
	terminalWriteWait  = 10 * time.Second
	terminalPongWait   = 75 * time.Second
	terminalPingPeriod = 25 * time.Second
)

var terminalShareAvailabilityCheckEvery = 2 * time.Second

type Handler struct {
	service  *Service
	upgrader websocket.Upgrader
}

type terminalControlMessage struct {
	Type string `json:"type"`
	Rows int    `json:"rows"`
	Cols int    `json:"cols"`
	Data string `json:"data"`
}

func NewHandler(service *Service) *Handler {
	return &Handler{
		service: service,
		upgrader: websocket.Upgrader{
			CheckOrigin:  terminalWebSocketOriginAllowed,
			Subprotocols: []string{"terminal.v1", "terminal-share.v1"},
		},
	}
}

func (h *Handler) upgradeShareWebSocket(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	upgrader := h.upgrader
	// StreamShare reaches this point only after viewer token validation.
	upgrader.CheckOrigin = terminalValidatedTokenOriginAllowed
	return upgrader.Upgrade(w, r, nil)
}

func (h *Handler) writeTerminalBinary(conn *websocket.Conn, writeMu *sync.Mutex, payload []byte) bool {
	writeMu.Lock()
	defer writeMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(terminalWriteWait))
	return conn.WriteMessage(websocket.BinaryMessage, payload) == nil
}

func parseControlMessage(payload []byte) (bool, terminalControlMessage, error) {
	trimmed := strings.TrimSpace(string(payload))
	if !strings.HasPrefix(trimmed, "{") {
		return false, terminalControlMessage{}, nil
	}

	var message terminalControlMessage
	if err := json.Unmarshal(payload, &message); err != nil {
		return false, terminalControlMessage{}, nil
	}
	message.Type = strings.TrimSpace(message.Type)
	if message.Type == "" {
		return false, terminalControlMessage{}, nil
	}
	switch message.Type {
	case "resize", "input", "ping":
		return true, message, nil
	default:
		return true, terminalControlMessage{}, ErrInvalidInput
	}
}

func (h *Handler) writeTerminalEvent(conn *websocket.Conn, writeMu *sync.Mutex, eventType string, payload map[string]any) {
	message := map[string]any{"type": eventType}
	for key, value := range payload {
		message[key] = value
	}
	data, err := json.Marshal(message)
	if err != nil {
		return
	}
	writeMu.Lock()
	defer writeMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(terminalWriteWait))
	_ = conn.WriteMessage(websocket.TextMessage, data)
}

func (h *Handler) writeTerminalError(w http.ResponseWriter, err error) {
	var fingerprintErr *host.FingerprintConflictError
	var hostConnErr *host.SSHConnectionFailedError
	var connectErr *ConnectionFailedError
	var sessionLimitErr *SessionLimitError
	switch {
	case errors.Is(err, ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid terminal session request")
	case errors.Is(err, ErrInvalidState):
		webutil.WriteError(w, http.StatusConflict, "TERMINAL_SESSION_INVALID_STATE", "terminal session is not ready")
	case errors.As(err, &sessionLimitErr):
		webutil.WriteJSON(w, http.StatusTooManyRequests, map[string]any{
			"code":    "TERMINAL_SESSION_LIMIT_EXCEEDED",
			"message": "terminal session limit exceeded",
			"scope":   sessionLimitErr.Scope,
			"limit":   sessionLimitErr.Limit,
		})
	case errors.As(err, &fingerprintErr):
		webutil.WriteJSON(w, http.StatusConflict, map[string]any{
			"code":                 fingerprintErr.Code,
			"message":              fingerprintErr.Message,
			"current_fingerprint":  hostFingerprintResponse(fingerprintErr.CurrentFingerprint),
			"previous_fingerprint": optionalHostFingerprintResponse(fingerprintErr.PreviousFingerprint),
		})
	case errors.As(err, &hostConnErr):
		webutil.WriteJSON(w, http.StatusBadGateway, map[string]any{
			"code":           "TERMINAL_SSH_CONNECT_FAILED",
			"message":        hostConnErr.Message,
			"connection_log": hostConnectionLogResponse(hostConnErr.ConnectionLog),
		})
	case errors.As(err, &connectErr):
		webutil.WriteJSON(w, http.StatusBadGateway, map[string]any{
			"code":           "TERMINAL_BOOTSTRAP_CONNECT_FAILED",
			"message":        connectErr.Message,
			"connection_log": hostConnectionLogResponse(connectErr.ConnectionLog),
		})
	case db.IsNotFound(err):
		webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "host or terminal session not found")
	default:
		webutil.WriteError(w, http.StatusInternalServerError, "TERMINAL_FAILED", "terminal request failed")
	}
}

func (h *Handler) writeShareError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid terminal share request")
	case errors.Is(err, ErrInvalidState):
		webutil.WriteError(w, http.StatusConflict, "TERMINAL_SESSION_INVALID_STATE", "terminal session is not ready")
	case errors.Is(err, ErrSharePasswordInvalid):
		webutil.WriteError(w, http.StatusUnauthorized, "TERMINAL_SHARE_PASSWORD_INVALID", "share password is invalid")
	case errors.Is(err, ErrShareAccessLimit):
		webutil.WriteError(w, http.StatusTooManyRequests, "TERMINAL_SHARE_ACCESS_LIMIT", "terminal share access limit reached")
	case errors.Is(err, ErrShareNotAvailable):
		webutil.WriteError(w, http.StatusNotFound, "TERMINAL_SHARE_NOT_AVAILABLE", "terminal share is not available")
	case db.IsNotFound(err):
		webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "terminal share not found")
	default:
		webutil.WriteError(w, http.StatusInternalServerError, "TERMINAL_SHARE_FAILED", "terminal share request failed")
	}
}

func hostConnectionLogResponse(entries []host.ConnectionLogEntry) []map[string]any {
	if len(entries) == 0 {
		return nil
	}
	result := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		result = append(result, map[string]any{
			"level":       entry.Level,
			"message":     entry.Message,
			"occurred_at": entry.OccurredAt,
		})
	}
	return result
}

func paginationFromQuery(r *http.Request, defaultPageSize, maxPageSize int) (int, int, error) {
	page, err := intQueryParam(r, "page", 1)
	if err != nil {
		return 0, 0, err
	}
	pageSize, err := intQueryParam(r, "page_size", defaultPageSize)
	if err != nil {
		return 0, 0, err
	}
	if page < 1 || pageSize < 1 || pageSize > maxPageSize {
		return 0, 0, ErrInvalidInput
	}
	return page, pageSize, nil
}

func intQueryParam(r *http.Request, name string, fallback int) (int, error) {
	value := strings.TrimSpace(r.URL.Query().Get(name))
	if value == "" {
		return fallback, nil
	}
	return strconv.Atoi(value)
}

func hostFingerprintResponse(item model.HostFingerprint) map[string]any {
	return map[string]any{
		"algorithm":        item.Algorithm,
		"fingerprint":      item.Fingerprint,
		"status":           item.Status,
		"first_seen_at":    zeroTimeToNil(item.FirstSeenAt),
		"last_verified_at": item.LastVerifiedAt,
	}
}

func optionalHostFingerprintResponse(item *model.HostFingerprint) any {
	if item == nil {
		return nil
	}
	return hostFingerprintResponse(*item)
}

func zeroTimeToNil(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}
