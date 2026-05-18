package terminal

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/gorilla/websocket"
)

func (h *Handler) StreamShare(w http.ResponseWriter, r *http.Request) {
	viewerToken := strings.TrimSpace(r.URL.Query().Get("viewer_token"))
	attachment, err := h.service.AttachShareViewer(r.Context(), viewerToken)
	if err != nil {
		h.writeShareError(w, err)
		return
	}

	conn, err := h.upgradeShareWebSocket(w, r)
	if err != nil {
		attachment.Detach("share websocket upgrade failed")
		return
	}
	defer conn.Close()

	h.streamShareAttachment(r.Context(), conn, attachment)
}

func (h *Handler) streamShareAttachment(ctx context.Context, conn *websocket.Conn, attachment *TerminalShareAttachment) {
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
		"session_id": attachment.Runtime.Session.ID,
		"host_id":    attachment.Runtime.Session.HostID,
		"status":     attachment.Runtime.Session.Status,
		"protocol":   "terminal-share.v1",
		"readonly":   true,
		"share_id":   attachment.ShareID,
		"expires_at": attachment.ExpiresAt,
	})

	for _, payload := range attachment.Replay {
		if !h.writeTerminalBinary(conn, &writeMu, payload) {
			attachment.Detach("share websocket replay failed")
			return
		}
	}

	pingTicker := time.NewTicker(terminalPingPeriod)
	defer pingTicker.Stop()
	var availabilityTicker *time.Ticker
	var availabilityCh <-chan time.Time
	if terminalShareAvailabilityCheckEvery > 0 {
		availabilityTicker = time.NewTicker(terminalShareAvailabilityCheckEvery)
		availabilityCh = availabilityTicker.C
		defer availabilityTicker.Stop()
	}
	var expiryTimer *time.Timer
	var expiryCh <-chan time.Time
	currentShareExpiresAt := attachment.ExpiresAt
	resetExpiryTimer := func(expiresAt time.Time) {
		currentShareExpiresAt = expiresAt
		if expiresAt.IsZero() {
			if expiryTimer != nil {
				expiryTimer.Stop()
			}
			expiryCh = nil
			return
		}
		delay := time.Until(expiresAt)
		if delay <= 0 {
			delay = time.Millisecond
		}
		if expiryTimer == nil {
			expiryTimer = time.NewTimer(delay)
		} else {
			if !expiryTimer.Stop() {
				select {
				case <-expiryTimer.C:
				default:
				}
			}
			expiryTimer.Reset(delay)
		}
		expiryCh = expiryTimer.C
	}
	if !currentShareExpiresAt.IsZero() {
		resetExpiryTimer(currentShareExpiresAt)
		defer expiryTimer.Stop()
	}

	go func() {
		for {
			messageType, payload, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) || errors.Is(err, io.EOF) {
					finish(false, model.TerminalSessionStatusDisconnected, "share websocket client closed")
					return
				}
				finish(false, model.TerminalSessionStatusDisconnected, "share websocket read failed")
				return
			}
			if messageType != websocket.TextMessage {
				h.writeTerminalEvent(conn, &writeMu, "error", map[string]any{
					"code":    "READ_ONLY_TERMINAL",
					"message": "shared terminal is read-only",
				})
				continue
			}
			handled, controlMessage, controlErr := parseControlMessage(payload)
			if controlErr != nil || !handled || controlMessage.Type != "ping" {
				h.writeTerminalEvent(conn, &writeMu, "error", map[string]any{
					"code":    "READ_ONLY_TERMINAL",
					"message": "shared terminal is read-only",
				})
				continue
			}
			h.writeTerminalEvent(conn, &writeMu, "pong", map[string]any{
				"session_id": attachment.Runtime.Session.ID,
			})
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
				finish(false, model.TerminalSessionStatusDisconnected, "share websocket write failed")
			}
		case closed := <-closedCh:
			finish(closed.RuntimeClosed, closed.Status, closed.Message)
		case <-pingTicker.C:
			writeMu.Lock()
			_ = conn.SetWriteDeadline(time.Now().Add(terminalWriteWait))
			err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(terminalWriteWait))
			writeMu.Unlock()
			if err != nil {
				finish(false, model.TerminalSessionStatusDisconnected, "share websocket ping failed")
			}
		case <-expiryCh:
			finish(false, model.TerminalSessionStatusDisconnected, "terminal share expired")
		case <-availabilityCh:
			unavailableReason, shareExpiresAt, err := h.service.TerminalShareAvailability(ctx, attachment.Runtime.Session.UserID, attachment.ShareID)
			if err != nil {
				finish(false, model.TerminalSessionStatusDisconnected, "terminal share is not available")
				continue
			}
			if unavailableReason != "" {
				finish(false, model.TerminalSessionStatusDisconnected, unavailableReason)
				continue
			}
			if !shareExpiresAt.IsZero() && !shareExpiresAt.Equal(currentShareExpiresAt) {
				resetExpiryTimer(shareExpiresAt)
				h.writeTerminalEvent(conn, &writeMu, "share_update", map[string]any{
					"share_id":   attachment.ShareID,
					"expires_at": shareExpiresAt,
					"session_id": attachment.Runtime.Session.ID,
				})
			}
		case finalResult := <-done:
			if !finalResult.runtimeClosed {
				attachment.Detach(finalResult.message)
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
