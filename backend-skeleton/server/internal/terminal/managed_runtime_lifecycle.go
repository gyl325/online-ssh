package terminal

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/observability"
	"golang.org/x/crypto/ssh"
)

func (m *managedRuntime) start() {
	go m.forwardOutput(m.runtime.Stdout)
	go m.forwardOutput(m.runtime.Stderr)
	go m.waitSSHSession()
	go m.keepAlive()
}

func (m *managedRuntime) setKeepAlive(enabled bool, ttl time.Duration) RuntimeState {
	m.mu.Lock()
	defer m.mu.Unlock()

	if enabled {
		until := time.Now().Add(ttl)
		m.keepAliveUntil = &until
	} else {
		m.keepAliveUntil = nil
	}
	return m.stateLocked(time.Now())
}

func (m *managedRuntime) state(now time.Time) RuntimeState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.stateLocked(now)
}

func (m *managedRuntime) snapshot(now time.Time) TerminalRuntimeSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return TerminalRuntimeSnapshot{
		Session: m.runtime.Session,
		State:   m.stateLocked(now),
	}
}

func (m *managedRuntime) stateLocked(now time.Time) RuntimeState {
	state := RuntimeState{
		Attached:       m.attachment != nil,
		DetachedAt:     cloneTime(m.detachedAt),
		KeepAliveUntil: cloneTime(m.keepAliveUntil),
	}
	if m.detachedAt != nil {
		expiresAt := m.detachedAt.Add(m.hub.detachedTTL)
		if m.keepAliveUntil != nil && m.keepAliveUntil.After(expiresAt) {
			expiresAt = *m.keepAliveUntil
		}
		state.ExpiresAt = &expiresAt
	}
	_ = now
	return state
}

func (m *managedRuntime) expired(now time.Time) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.attachment != nil || m.detachedAt == nil {
		return false
	}

	expiresAt := m.detachedAt.Add(m.hub.detachedTTL)
	if m.keepAliveUntil != nil && m.keepAliveUntil.After(expiresAt) {
		expiresAt = *m.keepAliveUntil
	}
	return now.After(expiresAt)
}

func (m *managedRuntime) expiryKind(now time.Time) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.keepAliveUntil != nil && !m.keepAliveUntil.After(now) {
		return "keepalive"
	}
	return "detached_ttl"
}

func (m *managedRuntime) forwardOutput(reader io.Reader) {
	buffer := make([]byte, 32*1024)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			payload := append([]byte(nil), buffer[:n]...)
			m.publish(payload)
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				m.finish(model.TerminalSessionStatusFailed, "failed to read terminal output")
			}
			return
		}
	}
}

func (m *managedRuntime) publish(payload []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return
	}
	if m.runtime.Recorder != nil {
		m.runtime.Recorder.Record(model.TerminalRecordingDirectionOutput, payload)
	}
	m.buffer.add(payload)
	if m.attachment != nil {
		select {
		case m.attachment.output <- payload:
		default:
		}
	}
	for _, viewer := range m.viewers {
		select {
		case viewer.output <- payload:
		default:
		}
	}
}

func (m *managedRuntime) waitSSHSession() {
	if err := m.runtime.SSHSession.Wait(); err != nil {
		var exitErr *ssh.ExitError
		if errors.As(err, &exitErr) {
			m.finish(model.TerminalSessionStatusDisconnected, "ssh session ended")
			return
		}
		m.finish(model.TerminalSessionStatusFailed, "ssh session failed")
		return
	}
	m.finish(model.TerminalSessionStatusDisconnected, "ssh session ended")
}

func (m *managedRuntime) keepAlive() {
	ticker := time.NewTicker(terminalKeepAliveEvery)
	defer ticker.Stop()
	for range ticker.C {
		m.mu.Lock()
		closed := m.closed
		client := m.runtime.Client
		m.mu.Unlock()
		if closed {
			return
		}
		if client == nil {
			continue
		}
		if _, _, err := client.SendRequest("keepalive@openssh.com", true, nil); err != nil {
			m.finish(model.TerminalSessionStatusFailed, "ssh keepalive failed")
			return
		}
	}
}

func (m *managedRuntime) finish(status model.TerminalSessionStatus, message string) {
	m.finishOnce.Do(func() {
		m.mu.Lock()
		if m.closed {
			m.mu.Unlock()
			return
		}
		m.closed = true
		if m.attachment != nil {
			m.attachment.close(AttachmentClose{
				RuntimeClosed: true,
				Status:        status,
				Message:       message,
			})
			m.attachment = nil
		}
		for id, viewer := range m.viewers {
			viewer.close(AttachmentClose{
				RuntimeClosed: true,
				Status:        status,
				Message:       message,
			})
			delete(m.viewers, id)
		}
		runtime := m.runtime
		m.logRuntimeClosedLocked(status, message)
		m.mu.Unlock()

		_ = runtime.Close()
		if runtime.Recorder != nil {
			recordingStatus := model.TerminalRecordingStatusCompleted
			if status == model.TerminalSessionStatusFailed {
				recordingStatus = model.TerminalRecordingStatusFailed
			}
			runtime.Recorder.Finish(recordingStatus)
		}
		m.hub.remove(m)
		if m.hub.onFinish != nil {
			m.hub.onFinish(m.userID, runtime.Session.ID, status, message)
		}
	})
}

func (m *managedRuntime) logRuntimeClosedLocked(status model.TerminalSessionStatus, message string) {
	observability.Warn(context.Background(), "terminal runtime closed",
		slog.String("component", "terminal"),
		slog.String("event", "terminal_runtime_closed"),
		slog.String("user_id", m.userID),
		slog.String("session_id", m.runtime.Session.ID),
		slog.String("host_id", m.runtime.Session.HostID),
		slog.String("status", string(status)),
		slog.String("reason_kind", terminalCloseReasonKind(message)),
	)
}

func (m *managedRuntime) logRuntimeExpired(expiryKind string) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.runtime == nil {
		return
	}
	observability.Warn(context.Background(), "terminal runtime expired",
		slog.String("component", "terminal"),
		slog.String("event", "terminal_runtime_expired"),
		slog.String("user_id", m.userID),
		slog.String("session_id", m.runtime.Session.ID),
		slog.String("host_id", m.runtime.Session.HostID),
		slog.String("expiry_kind", stringsOrDefault(expiryKind, "detached_ttl")),
		slog.String("reason_kind", "expired"),
	)
}

func terminalCloseReasonKind(message string) string {
	value := strings.ToLower(strings.TrimSpace(message))
	switch {
	case value == "":
		return "unknown"
	case strings.Contains(value, "admin"):
		return "admin"
	case strings.Contains(value, "operator") || strings.Contains(value, "force"):
		return "operator"
	case strings.Contains(value, "share") && strings.Contains(value, "revoked"):
		return "share_revoked"
	case strings.Contains(value, "share") && strings.Contains(value, "expired"):
		return "share_expired"
	case strings.Contains(value, "revoked") || strings.Contains(value, "signed in elsewhere"):
		return "auth"
	case strings.Contains(value, "expired"):
		return "expired"
	case strings.Contains(value, "share"):
		return "share"
	case strings.Contains(value, "websocket") || strings.Contains(value, "browser") || strings.Contains(value, "client") || strings.Contains(value, "viewer"):
		return "client"
	case strings.Contains(value, "keepalive") || strings.Contains(value, "ssh") || strings.Contains(value, "terminal"):
		return "runtime"
	default:
		return "unknown"
	}
}
