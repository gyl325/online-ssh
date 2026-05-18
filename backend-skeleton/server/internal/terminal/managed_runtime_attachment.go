package terminal

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/observability"
)

func (m *managedRuntime) attach(authSessionID string, rows, cols int) (*TerminalAttachment, error) {
	if err := m.resize(rows, cols); err != nil {
		return nil, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, ErrRuntimeNotFound
	}

	authSessionID = strings.TrimSpace(authSessionID)
	if authSessionID != "" {
		m.runtime.AuthSessionID = authSessionID
	}

	if m.attachment != nil {
		m.attachment.close(AttachmentClose{
			RuntimeClosed: false,
			Status:        model.TerminalSessionStatusDisconnected,
			Message:       "terminal attached elsewhere",
		})
	}

	m.nextAttachment++
	handle := &attachmentHandle{
		id:     m.nextAttachment,
		output: make(chan []byte, defaultOutputQueueSize),
		closed: make(chan AttachmentClose, 1),
	}
	m.attachment = handle
	m.detachedAt = nil
	m.logRuntimeAttachedLocked(authSessionID)

	return &TerminalAttachment{
		Runtime: m.runtime,
		State:   m.stateLocked(time.Now()),
		Replay:  m.buffer.snapshot(),
		Output:  handle.output,
		Closed:  handle.closed,
		managed: m,
		handle:  handle,
	}, nil
}

func (m *managedRuntime) belongsToAuthSession(userID, authSessionID string) bool {
	if m == nil || m.runtime == nil {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.userID == userID && m.runtime.AuthSessionID == authSessionID
}

func (m *managedRuntime) attachViewer(shareID string) (*TerminalShareAttachment, error) {
	shareID = strings.TrimSpace(shareID)
	if shareID == "" {
		return nil, ErrInvalidInput
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, ErrRuntimeNotFound
	}
	if m.viewers == nil {
		m.viewers = make(map[int]*viewerAttachmentHandle)
	}
	m.nextViewer++
	handle := &viewerAttachmentHandle{
		id:      m.nextViewer,
		shareID: shareID,
		output:  make(chan []byte, defaultOutputQueueSize),
		closed:  make(chan AttachmentClose, 1),
	}
	m.viewers[handle.id] = handle
	m.logShareViewerAttachedLocked(handle.id, shareID)

	return &TerminalShareAttachment{
		Runtime: m.runtime,
		ShareID: shareID,
		Replay:  m.buffer.snapshot(),
		Output:  handle.output,
		Closed:  handle.closed,
		managed: m,
		handle:  handle,
	}, nil
}

func (m *managedRuntime) detach(attachmentID int, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.attachment == nil || m.attachment.id != attachmentID {
		return
	}

	now := time.Now()
	m.detachedAt = &now
	if m.keepAliveUntil != nil {
		until := now.Add(m.hub.keepAliveTTL)
		m.keepAliveUntil = &until
	}
	m.attachment.close(AttachmentClose{
		RuntimeClosed: false,
		Status:        model.TerminalSessionStatusDisconnected,
		Message:       stringsOrDefault(message, "websocket client detached"),
	})
	m.attachment = nil
	m.logRuntimeDetachedLocked(message)
}

func (m *managedRuntime) detachIfKeptAlive(message string, ttl time.Duration) bool {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.keepAliveUntil == nil || !m.keepAliveUntil.After(now) {
		return false
	}

	m.detachedAt = &now
	if ttl <= 0 {
		if m.hub != nil {
			ttl = m.hub.keepAliveTTL
		}
		if ttl <= 0 {
			ttl = defaultKeepAliveTTL
		}
	}
	until := now.Add(ttl)
	m.keepAliveUntil = &until
	if m.attachment != nil {
		m.attachment.close(AttachmentClose{
			RuntimeClosed: false,
			Status:        model.TerminalSessionStatusDisconnected,
			Message:       stringsOrDefault(message, "websocket client detached"),
		})
		m.attachment = nil
	}
	m.logRuntimeDetachedLocked(message)
	return true
}

func (m *managedRuntime) detachViewer(viewerID int, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.viewers == nil {
		return
	}
	handle := m.viewers[viewerID]
	if handle == nil {
		return
	}
	delete(m.viewers, viewerID)
	handle.close(AttachmentClose{
		RuntimeClosed: false,
		Status:        model.TerminalSessionStatusDisconnected,
		Message:       stringsOrDefault(message, "share viewer detached"),
	})
	m.logShareViewerDetachedLocked(viewerID, handle.shareID, message)
}

func (m *managedRuntime) writeInput(attachmentID int, payload []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.attachment == nil || m.attachment.id != attachmentID {
		return ErrRuntimeNotFound
	}
	if m.runtime.Recorder != nil {
		m.runtime.Recorder.Record(model.TerminalRecordingDirectionInput, payload)
	}
	_, err := m.runtime.Stdin.Write(payload)
	return err
}

func (m *managedRuntime) logRuntimeAttachedLocked(authSessionID string) {
	observability.Info(context.Background(), "terminal runtime attached",
		slog.String("component", "terminal"),
		slog.String("event", "terminal_runtime_attached"),
		slog.String("user_id", m.userID),
		slog.String("session_id", m.runtime.Session.ID),
		slog.String("auth_session_id", strings.TrimSpace(authSessionID)),
		slog.String("host_id", m.runtime.Session.HostID),
		slog.String("status", m.runtime.Session.Status),
	)
}

func (m *managedRuntime) logRuntimeDetachedLocked(message string) {
	observability.Info(context.Background(), "terminal runtime detached",
		slog.String("component", "terminal"),
		slog.String("event", "terminal_runtime_detached"),
		slog.String("user_id", m.userID),
		slog.String("session_id", m.runtime.Session.ID),
		slog.String("host_id", m.runtime.Session.HostID),
		slog.String("status", string(model.TerminalSessionStatusDisconnected)),
		slog.String("reason_kind", terminalCloseReasonKind(message)),
	)
}

func (m *managedRuntime) logShareViewerAttachedLocked(viewerID int, shareID string) {
	observability.Info(context.Background(), "terminal share viewer attached",
		slog.String("component", "terminal"),
		slog.String("event", "terminal_share_viewer_attached"),
		slog.String("user_id", m.userID),
		slog.String("session_id", m.runtime.Session.ID),
		slog.String("share_id", shareID),
		slog.String("host_id", m.runtime.Session.HostID),
		slog.Int("viewer_id", viewerID),
	)
}

func (m *managedRuntime) logShareViewerDetachedLocked(viewerID int, shareID string, message string) {
	if terminalCloseReasonKind(message) == "share_expired" {
		m.logShareViewerExpiredLocked(viewerID, shareID)
	}
	observability.Info(context.Background(), "terminal share viewer detached",
		slog.String("component", "terminal"),
		slog.String("event", "terminal_share_viewer_detached"),
		slog.String("user_id", m.userID),
		slog.String("session_id", m.runtime.Session.ID),
		slog.String("share_id", shareID),
		slog.String("host_id", m.runtime.Session.HostID),
		slog.Int("viewer_id", viewerID),
		slog.String("reason_kind", terminalCloseReasonKind(message)),
	)
}

func (m *managedRuntime) logShareViewerExpiredLocked(viewerID int, shareID string) {
	observability.Warn(context.Background(), "terminal share viewer expired",
		slog.String("component", "terminal"),
		slog.String("event", "terminal_share_viewer_expired"),
		slog.String("user_id", m.userID),
		slog.String("session_id", m.runtime.Session.ID),
		slog.String("share_id", shareID),
		slog.String("host_id", m.runtime.Session.HostID),
		slog.Int("viewer_id", viewerID),
		slog.String("reason_kind", "share_expired"),
	)
}

func (m *managedRuntime) resizeAttachment(attachmentID int, rows, cols int) error {
	rows, cols, err := normalizeTerminalSize(rows, cols)
	if err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.attachment == nil || m.attachment.id != attachmentID {
		return ErrRuntimeNotFound
	}
	return m.runtime.Resize(rows, cols)
}

func (m *managedRuntime) resize(rows, cols int) error {
	rows, cols, err := normalizeTerminalSize(rows, cols)
	if err != nil {
		return err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return ErrRuntimeNotFound
	}
	return m.runtime.Resize(rows, cols)
}

func (m *managedRuntime) viewerCount(shareID string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, viewer := range m.viewers {
		if viewer.shareID == shareID {
			count++
		}
	}
	return count
}

func (m *managedRuntime) viewerCounts() map[string]int {
	m.mu.Lock()
	defer m.mu.Unlock()
	counts := make(map[string]int)
	for _, viewer := range m.viewers {
		counts[viewer.shareID]++
	}
	return counts
}

func (m *managedRuntime) closeShareViewers(shareID, message string) int {
	shareID = strings.TrimSpace(shareID)
	if shareID == "" {
		return 0
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || len(m.viewers) == 0 {
		return 0
	}

	closed := 0
	for id, viewer := range m.viewers {
		if viewer.shareID != shareID {
			continue
		}
		delete(m.viewers, id)
		viewer.close(AttachmentClose{
			RuntimeClosed: false,
			Status:        model.TerminalSessionStatusDisconnected,
			Message:       stringsOrDefault(message, "terminal share closed"),
		})
		m.logShareViewerDetachedLocked(id, viewer.shareID, message)
		closed++
	}
	return closed
}
