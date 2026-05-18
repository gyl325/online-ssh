package terminal

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
	"github.com/gorilla/websocket"
)

func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	sessionID := strings.TrimSpace(r.URL.Query().Get("session_id"))
	attachToken := strings.TrimSpace(r.URL.Query().Get("attach_token"))
	if !h.service.ValidateAttachToken(session.UserID, sessionID, attachToken) {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "terminal attach token required")
		return
	}
	query := r.URL.Query()
	initialDirectories := append([]string{query.Get("cwd")}, query["cwd_fallback"]...)
	rows, cols, err := terminalSizeFromQuery(r)
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid terminal size")
		return
	}

	attachment, err := h.service.AttachRuntime(r.Context(), session.UserID, session.SessionID, sessionID, rows, cols, initialDirectories)
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}

	conn, err := h.upgradeTerminalWebSocket(w, r)
	if err != nil {
		attachment.Detach("websocket upgrade failed")
		return
	}
	defer conn.Close()

	h.streamAttachment(conn, attachment)
}

func (h *Handler) upgradeTerminalWebSocket(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	upgrader := h.upgrader
	// Stream reaches this point only after cookie auth and attach token validation.
	upgrader.CheckOrigin = terminalValidatedTokenOriginAllowed
	return upgrader.Upgrade(w, r, nil)
}

func (h *Handler) streamAttachment(conn *websocket.Conn, attachment *TerminalAttachment) {
	type streamResult struct {
		runtimeClosed bool
		status        model.TerminalSessionStatus
		message       string
	}

	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(terminalPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(terminalPongWait))
	})

	var (
		once    sync.Once
		writeMu sync.Mutex
		done    = make(chan streamResult, 1)
	)
	finish := func(runtimeClosed bool, status model.TerminalSessionStatus, message string) {
		once.Do(func() {
			done <- streamResult{runtimeClosed: runtimeClosed, status: status, message: message}
		})
	}

	h.writeTerminalEvent(conn, &writeMu, "ready", map[string]any{
		"session_id":       attachment.Runtime.Session.ID,
		"host_id":          attachment.Runtime.Session.HostID,
		"status":           attachment.Runtime.Session.Status,
		"protocol":         "terminal.v1",
		"attached":         attachment.State.Attached,
		"detached_at":      attachment.State.DetachedAt,
		"expires_at":       attachment.State.ExpiresAt,
		"keep_alive_until": attachment.State.KeepAliveUntil,
		"fingerprint": map[string]any{
			"algorithm":   attachment.Runtime.Fingerprint.Algorithm,
			"fingerprint": attachment.Runtime.Fingerprint.Fingerprint,
			"status":      attachment.Runtime.Fingerprint.Status,
		},
	})

	for _, payload := range attachment.Replay {
		if !h.writeTerminalBinary(conn, &writeMu, payload) {
			attachment.Detach("websocket replay failed")
			return
		}
	}

	pingTicker := time.NewTicker(terminalPingPeriod)
	defer pingTicker.Stop()

	go func() {
		for {
			messageType, payload, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) || errors.Is(err, io.EOF) {
					finish(false, model.TerminalSessionStatusDisconnected, "websocket client closed")
					return
				}
				finish(false, model.TerminalSessionStatusDisconnected, "websocket read failed")
				return
			}
			switch messageType {
			case websocket.BinaryMessage:
				if err := attachment.WriteInput(payload); err != nil {
					finish(true, model.TerminalSessionStatusFailed, "failed to forward terminal input")
					return
				}
			case websocket.TextMessage:
				handled, controlMessage, controlErr := parseControlMessage(payload)
				if controlErr != nil {
					h.writeTerminalEvent(conn, &writeMu, "error", map[string]any{
						"code":    "INVALID_CONTROL_MESSAGE",
						"message": controlErr.Error(),
					})
					continue
				}
				if handled {
					switch controlMessage.Type {
					case "resize":
						rows, cols, err := normalizeTerminalSize(controlMessage.Rows, controlMessage.Cols)
						if err != nil {
							h.writeTerminalEvent(conn, &writeMu, "error", map[string]any{
								"code":    "INVALID_TERMINAL_SIZE",
								"message": "invalid terminal size",
							})
							continue
						}
						if err := attachment.Resize(rows, cols); err != nil {
							h.writeTerminalEvent(conn, &writeMu, "error", map[string]any{
								"code":    "TERMINAL_RESIZE_FAILED",
								"message": "failed to resize terminal",
							})
							finish(true, model.TerminalSessionStatusFailed, "terminal resize failed")
							return
						}
					case "input":
						if err := attachment.WriteInput([]byte(controlMessage.Data)); err != nil {
							finish(true, model.TerminalSessionStatusFailed, "failed to forward terminal input")
							return
						}
					case "ping":
						h.writeTerminalEvent(conn, &writeMu, "pong", map[string]any{
							"session_id": attachment.Runtime.Session.ID,
						})
					}
					continue
				}
				if err := attachment.WriteInput(payload); err != nil {
					finish(true, model.TerminalSessionStatusFailed, "failed to forward terminal input")
					return
				}
			default:
				continue
			}
		}
	}()

	outputCh := attachment.Output
	closedCh := attachment.Closed
	for {
		select {
		case payload, ok := <-outputCh:
			if !ok {
				outputCh = nil
				continue
			}
			if !h.writeTerminalBinary(conn, &writeMu, payload) {
				finish(false, model.TerminalSessionStatusDisconnected, "websocket write failed")
			}
		case closed := <-closedCh:
			finish(closed.RuntimeClosed, closed.Status, closed.Message)
		case <-pingTicker.C:
			writeMu.Lock()
			_ = conn.SetWriteDeadline(time.Now().Add(terminalWriteWait))
			err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(terminalWriteWait))
			writeMu.Unlock()
			if err != nil {
				finish(false, model.TerminalSessionStatusDisconnected, "websocket ping failed")
			}
		case finalResult := <-done:
			if !finalResult.runtimeClosed {
				attachment.Detach(finalResult.message)
			}
			if finalResult.status == model.TerminalSessionStatusFailed {
				h.writeTerminalEvent(conn, &writeMu, "error", map[string]any{
					"code":    "TERMINAL_RUNTIME_FAILED",
					"message": finalResult.message,
				})
			}
			h.writeTerminalEvent(conn, &writeMu, "exit", map[string]any{
				"status":         string(finalResult.status),
				"message":        finalResult.message,
				"runtime_closed": finalResult.runtimeClosed,
			})
			closeCode := websocket.CloseNormalClosure
			if finalResult.status == model.TerminalSessionStatusFailed {
				closeCode = websocket.CloseInternalServerErr
			}
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(closeCode, finalResult.message), time.Now().Add(2*time.Second))
			return
		}
	}
}
