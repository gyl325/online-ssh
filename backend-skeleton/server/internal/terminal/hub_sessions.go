package terminal

import (
	"sort"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
)

func (h *TerminalHub) Register(userID, authSessionID string, runtime *Runtime, rows, cols int) (*TerminalAttachment, error) {
	if h == nil || runtime == nil {
		return nil, ErrRuntimeNotFound
	}

	key := terminalRuntimeKey(userID, runtime.Session.ID)
	managed := newManagedRuntime(h, userID, runtime, h.bufferBytes)

	h.mu.Lock()
	existing := h.sessions[key]
	if existing == nil {
		if err := h.checkCapacityLocked(userID, key); err != nil {
			h.mu.Unlock()
			return nil, err
		}
	}
	h.sessions[key] = managed
	h.mu.Unlock()

	if existing != nil {
		existing.finish(model.TerminalSessionStatusDisconnected, "terminal session replaced")
	}

	attachment, err := managed.attach(authSessionID, rows, cols)
	if err != nil {
		managed.finish(model.TerminalSessionStatusFailed, "terminal session attach failed")
		return nil, err
	}
	managed.start()
	return attachment, nil
}

func (h *TerminalHub) remove(managed *managedRuntime) {
	if h == nil || managed == nil || managed.runtime == nil {
		return
	}
	key := terminalRuntimeKey(managed.userID, managed.runtime.Session.ID)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.sessions[key] == managed {
		delete(h.sessions, key)
	}
}

func (h *TerminalHub) EnsureCapacity(userID, sessionID string) error {
	if h == nil {
		return ErrRuntimeNotFound
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.checkCapacityLocked(userID, terminalRuntimeKey(userID, sessionID))
}

func (h *TerminalHub) Attach(userID, authSessionID, sessionID string, rows, cols int) (*TerminalAttachment, error) {
	managed := h.get(userID, sessionID)
	if managed == nil {
		return nil, ErrRuntimeNotFound
	}
	return managed.attach(authSessionID, rows, cols)
}

func (h *TerminalHub) AttachViewer(userID, sessionID, shareID string) (*TerminalShareAttachment, error) {
	managed := h.get(userID, sessionID)
	if managed == nil {
		return nil, ErrRuntimeNotFound
	}
	return managed.attachViewer(shareID)
}

func (h *TerminalHub) ViewerCount(userID, sessionID, shareID string) int {
	managed := h.get(userID, sessionID)
	if managed == nil {
		return 0
	}
	return managed.viewerCount(shareID)
}

func (h *TerminalHub) ViewerCounts(userID, sessionID string) map[string]int {
	managed := h.get(userID, sessionID)
	if managed == nil {
		return map[string]int{}
	}
	return managed.viewerCounts()
}

func (h *TerminalHub) CloseShareViewers(userID, sessionID, shareID, message string) int {
	managed := h.get(userID, sessionID)
	if managed == nil {
		return 0
	}
	return managed.closeShareViewers(shareID, stringsOrDefault(message, "terminal share closed"))
}

func (h *TerminalHub) CloseShareViewersByShareID(shareID, message string) int {
	if h == nil || strings.TrimSpace(shareID) == "" {
		return 0
	}
	h.mu.Lock()
	items := make([]*managedRuntime, 0, len(h.sessions))
	for _, item := range h.sessions {
		items = append(items, item)
	}
	h.mu.Unlock()

	closed := 0
	for _, item := range items {
		closed += item.closeShareViewers(shareID, stringsOrDefault(message, "terminal share closed"))
	}
	return closed
}

func (h *TerminalHub) State(userID, sessionID string) (RuntimeState, bool) {
	managed := h.get(userID, sessionID)
	if managed == nil {
		return RuntimeState{}, false
	}
	return managed.state(time.Now()), true
}

func (h *TerminalHub) List(userID string) []TerminalRuntimeSnapshot {
	if h == nil {
		return nil
	}

	h.mu.Lock()
	items := make([]*managedRuntime, 0)
	for _, item := range h.sessions {
		if item.userID == userID {
			items = append(items, item)
		}
	}
	h.mu.Unlock()

	now := time.Now()
	snapshots := make([]TerminalRuntimeSnapshot, 0, len(items))
	for _, item := range items {
		snapshots = append(snapshots, item.snapshot(now))
	}
	sort.Slice(snapshots, func(i, j int) bool {
		return snapshots[i].Session.StartedAt.After(snapshots[j].Session.StartedAt)
	})
	return snapshots
}

func (h *TerminalHub) SetKeepAlive(userID, sessionID string, enabled bool) (RuntimeState, error) {
	managed := h.get(userID, sessionID)
	if managed == nil {
		return RuntimeState{}, ErrRuntimeNotFound
	}
	return managed.setKeepAlive(enabled, h.runtimeSettings().KeepAliveTTL), nil
}

func (h *TerminalHub) CloseRuntime(userID, sessionID, message string) error {
	managed := h.get(userID, sessionID)
	if managed == nil {
		return ErrRuntimeNotFound
	}
	managed.finish(model.TerminalSessionStatusDisconnected, message)
	return nil
}

func (h *TerminalHub) CloseUserRuntimes(userID, message string) int {
	return h.closeUserRuntimes(userID, message, false)
}

func (h *TerminalHub) CloseUserRuntimesForce(userID, message string) int {
	return h.closeUserRuntimes(userID, message, true)
}

func (h *TerminalHub) closeUserRuntimes(userID, message string, force bool) int {
	if h == nil {
		return 0
	}

	h.mu.Lock()
	items := make([]*managedRuntime, 0)
	for _, item := range h.sessions {
		if item.userID == userID {
			items = append(items, item)
		}
	}
	h.mu.Unlock()

	closed := 0
	settings := h.runtimeSettings()
	for _, item := range items {
		if !force && item.detachIfKeptAlive(message, settings.KeepAliveTTL) {
			continue
		}
		item.finish(model.TerminalSessionStatusDisconnected, message)
		closed++
	}
	return closed
}

func (h *TerminalHub) CloseAuthSessionRuntimes(userID, authSessionID, message string) int {
	return h.closeAuthSessionRuntimes(userID, authSessionID, message, false)
}

func (h *TerminalHub) CloseAuthSessionRuntimesForce(userID, authSessionID, message string) int {
	return h.closeAuthSessionRuntimes(userID, authSessionID, message, true)
}

func (h *TerminalHub) closeAuthSessionRuntimes(userID, authSessionID, message string, force bool) int {
	if h == nil {
		return 0
	}
	userID = strings.TrimSpace(userID)
	authSessionID = strings.TrimSpace(authSessionID)
	if userID == "" || authSessionID == "" {
		return 0
	}

	h.mu.Lock()
	items := make([]*managedRuntime, 0, len(h.sessions))
	for _, item := range h.sessions {
		items = append(items, item)
	}
	h.mu.Unlock()

	closed := 0
	settings := h.runtimeSettings()
	for _, item := range items {
		if !item.belongsToAuthSession(userID, authSessionID) {
			continue
		}
		if !force && item.detachIfKeptAlive(message, settings.KeepAliveTTL) {
			continue
		}
		item.finish(model.TerminalSessionStatusDisconnected, message)
		closed++
	}
	return closed
}

func (h *TerminalHub) Close() {
	if h == nil {
		return
	}
	close(h.stopCh)
	<-h.doneCh

	h.mu.Lock()
	items := make([]*managedRuntime, 0, len(h.sessions))
	for _, item := range h.sessions {
		items = append(items, item)
	}
	h.mu.Unlock()

	for _, item := range items {
		item.finish(model.TerminalSessionStatusDisconnected, "server shutting down")
	}
}

func (h *TerminalHub) get(userID, sessionID string) *managedRuntime {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sessions[terminalRuntimeKey(userID, sessionID)]
}

func (h *TerminalHub) checkCapacityLocked(userID, replacingKey string) error {
	settings := h.runtimeSettings()
	userCount := 0
	totalCount := 0
	for key, item := range h.sessions {
		if key == replacingKey {
			continue
		}
		totalCount++
		if item.userID == userID {
			userCount++
		}
	}
	if settings.MaxSessionsPerUser > 0 && userCount >= settings.MaxSessionsPerUser {
		return &SessionLimitError{Scope: "user", Limit: settings.MaxSessionsPerUser}
	}
	if settings.MaxSessionsTotal > 0 && totalCount >= settings.MaxSessionsTotal {
		return &SessionLimitError{Scope: "global", Limit: settings.MaxSessionsTotal}
	}
	return nil
}

func (h *TerminalHub) runtimeSettings() TerminalHubRuntimeSettings {
	result := TerminalHubRuntimeSettings{
		KeepAliveTTL:       h.keepAliveTTL,
		MaxSessionsPerUser: h.maxPerUser,
		MaxSessionsTotal:   h.maxTotal,
	}
	if h.settingsProvider == nil {
		return result
	}
	next := h.settingsProvider()
	if next.KeepAliveTTL > 0 {
		result.KeepAliveTTL = next.KeepAliveTTL
	}
	if next.MaxSessionsPerUser > 0 {
		result.MaxSessionsPerUser = next.MaxSessionsPerUser
	}
	if next.MaxSessionsTotal > 0 {
		result.MaxSessionsTotal = next.MaxSessionsTotal
	}
	return result
}

func (h *TerminalHub) janitor() {
	defer close(h.doneCh)

	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			h.closeExpired()
		case <-h.stopCh:
			return
		}
	}
}

func (h *TerminalHub) closeExpired() {
	h.mu.Lock()
	items := make([]*managedRuntime, 0, len(h.sessions))
	for _, item := range h.sessions {
		items = append(items, item)
	}
	h.mu.Unlock()

	now := time.Now()
	for _, item := range items {
		if item.expired(now) {
			item.logRuntimeExpired(item.expiryKind(now))
			item.finish(model.TerminalSessionStatusDisconnected, "detached terminal session expired")
		}
	}
}

func terminalRuntimeKey(userID, sessionID string) string {
	return userID + "\x00" + sessionID
}
