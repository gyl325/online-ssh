package terminal

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
)

func TestTerminalHubEnsureCapacity(t *testing.T) {
	h := &TerminalHub{
		sessions:   make(map[string]*managedRuntime),
		maxPerUser: 2,
		maxTotal:   3,
	}
	h.sessions[terminalRuntimeKey("user-1", "session-1")] = &managedRuntime{userID: "user-1"}
	h.sessions[terminalRuntimeKey("user-1", "session-2")] = &managedRuntime{userID: "user-1"}
	h.sessions[terminalRuntimeKey("user-2", "session-3")] = &managedRuntime{userID: "user-2"}

	if err := h.EnsureCapacity("user-1", "session-1"); err != nil {
		t.Fatalf("same session replacement should not count against capacity: %v", err)
	}

	err := h.EnsureCapacity("user-1", "session-new")
	var limitErr *SessionLimitError
	if !errors.As(err, &limitErr) || limitErr.Scope != "user" || limitErr.Limit != 2 {
		t.Fatalf("expected user limit error, got %#v", err)
	}

	err = h.EnsureCapacity("user-3", "session-new")
	limitErr = nil
	if !errors.As(err, &limitErr) || limitErr.Scope != "global" || limitErr.Limit != 3 {
		t.Fatalf("expected global limit error, got %#v", err)
	}
}

func TestNewTerminalHubDefaultsSessionLimitsToSixteen(t *testing.T) {
	h := NewTerminalHub(TerminalHubOptions{}, nil)

	if h.maxPerUser != 16 || h.maxTotal != 16 {
		t.Fatalf("expected terminal hub limits to default to 16, got user=%d total=%d", h.maxPerUser, h.maxTotal)
	}
}

func TestTerminalHubStaleRuntimeFinishDoesNotRemoveReplacement(t *testing.T) {
	h := &TerminalHub{
		sessions: make(map[string]*managedRuntime),
	}
	oldRuntime := runtimeForHubTest(h, "user-1", "session-1", time.Now())
	replacementRuntime := runtimeForHubTest(h, "user-1", "session-1", time.Now().Add(time.Second))
	h.sessions[terminalRuntimeKey("user-1", "session-1")] = replacementRuntime

	oldRuntime.finish(model.TerminalSessionStatusDisconnected, "terminal session replaced")

	if h.sessions[terminalRuntimeKey("user-1", "session-1")] != replacementRuntime {
		t.Fatal("expected stale runtime finish not to remove the replacement runtime")
	}
}

func TestTerminalHubList(t *testing.T) {
	older := time.Date(2026, 4, 11, 10, 0, 0, 0, time.UTC)
	newer := older.Add(time.Minute)
	h := &TerminalHub{
		sessions: make(map[string]*managedRuntime),
	}
	h.sessions[terminalRuntimeKey("user-1", "older")] = runtimeForListTest("user-1", "older", older)
	h.sessions[terminalRuntimeKey("user-2", "other")] = runtimeForListTest("user-2", "other", newer)
	h.sessions[terminalRuntimeKey("user-1", "newer")] = runtimeForListTest("user-1", "newer", newer)

	items := h.List("user-1")
	if len(items) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(items))
	}
	if items[0].Session.ID != "newer" || items[1].Session.ID != "older" {
		t.Fatalf("expected newest first user sessions, got %#v", items)
	}
	if items[0].State.Attached {
		t.Fatal("expected detached snapshot for runtime without attachment")
	}
}

func TestTerminalHubCloseUserRuntimes(t *testing.T) {
	var finished []string
	h := &TerminalHub{
		sessions: make(map[string]*managedRuntime),
		onFinish: func(userID, sessionID string, status model.TerminalSessionStatus, message string) {
			finished = append(finished, userID+":"+sessionID+":"+string(status)+":"+message)
		},
	}
	h.sessions[terminalRuntimeKey("user-1", "session-1")] = runtimeForHubTest(h, "user-1", "session-1", time.Now())
	h.sessions[terminalRuntimeKey("user-1", "session-2")] = runtimeForHubTest(h, "user-1", "session-2", time.Now())
	h.sessions[terminalRuntimeKey("user-2", "session-3")] = runtimeForHubTest(h, "user-2", "session-3", time.Now())

	closed := h.CloseUserRuntimes("user-1", "account signed in elsewhere")

	if closed != 2 {
		t.Fatalf("expected two user runtimes closed, got %d", closed)
	}
	if len(finished) != 2 {
		t.Fatalf("expected two finish callbacks, got %#v", finished)
	}
	if _, ok := h.sessions[terminalRuntimeKey("user-1", "session-1")]; ok {
		t.Fatal("expected session-1 removed")
	}
	if _, ok := h.sessions[terminalRuntimeKey("user-1", "session-2")]; ok {
		t.Fatal("expected session-2 removed")
	}
	if _, ok := h.sessions[terminalRuntimeKey("user-2", "session-3")]; !ok {
		t.Fatal("expected other user's runtime to remain")
	}
}

func TestTerminalHubCloseUserRuntimesDetachesKeepAliveRuntime(t *testing.T) {
	var finished []string
	h := &TerminalHub{
		sessions:     make(map[string]*managedRuntime),
		keepAliveTTL: time.Hour,
		detachedTTL:  2 * time.Minute,
		onFinish: func(userID, sessionID string, status model.TerminalSessionStatus, message string) {
			finished = append(finished, userID+":"+sessionID+":"+string(status)+":"+message)
		},
	}
	now := time.Now()
	keepAliveRuntime := runtimeForHubTest(h, "user-1", "session-keepalive", now)
	stdin := &terminalWriteSpy{}
	keepAliveRuntime.runtime.Stdin = stdin
	keepAliveUntil := now.Add(30 * time.Minute)
	keepAliveRuntime.keepAliveUntil = &keepAliveUntil
	keepAliveAttachment := &attachmentHandle{
		id:     1,
		output: make(chan []byte, 1),
		closed: make(chan AttachmentClose, 1),
	}
	keepAliveRuntime.attachment = keepAliveAttachment
	staleAttachment := &TerminalAttachment{
		Runtime: keepAliveRuntime.runtime,
		managed: keepAliveRuntime,
		handle:  keepAliveAttachment,
	}
	plainRuntime := runtimeForHubTest(h, "user-1", "session-plain", now)
	h.sessions[terminalRuntimeKey("user-1", "session-keepalive")] = keepAliveRuntime
	h.sessions[terminalRuntimeKey("user-1", "session-plain")] = plainRuntime

	closed := h.CloseUserRuntimes("user-1", "account signed in elsewhere")

	if closed != 1 {
		t.Fatalf("expected only non-keepalive runtime closed, got %d", closed)
	}
	if len(finished) != 1 || finished[0] != "user-1:session-plain:disconnected:account signed in elsewhere" {
		t.Fatalf("expected only plain runtime finish callback, got %#v", finished)
	}
	if _, ok := h.sessions[terminalRuntimeKey("user-1", "session-plain")]; ok {
		t.Fatal("expected non-keepalive runtime removed")
	}
	if _, ok := h.sessions[terminalRuntimeKey("user-1", "session-keepalive")]; !ok {
		t.Fatal("expected keepalive runtime to remain recoverable")
	}

	select {
	case reason := <-keepAliveAttachment.closed:
		if reason.RuntimeClosed {
			t.Fatalf("expected keepalive attachment to detach without closing runtime, got %#v", reason)
		}
		if reason.Message != "account signed in elsewhere" {
			t.Fatalf("expected auth invalidation message, got %q", reason.Message)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected keepalive attachment to be closed")
	}
	state := keepAliveRuntime.state(time.Now())
	if state.Attached {
		t.Fatal("expected keepalive runtime to be detached from revoked websocket")
	}
	if state.DetachedAt == nil {
		t.Fatal("expected keepalive runtime detached timestamp")
	}
	if state.KeepAliveUntil == nil || !state.KeepAliveUntil.After(now) {
		t.Fatalf("expected keepalive deadline to remain in the future, got %#v", state.KeepAliveUntil)
	}
	if err := staleAttachment.WriteInput([]byte("whoami\n")); !errors.Is(err, ErrRuntimeNotFound) {
		t.Fatalf("expected stale detached attachment input to be rejected, got %v", err)
	}
	if stdin.String() != "" {
		t.Fatalf("stale detached attachment wrote to SSH stdin: %q", stdin.String())
	}
}

func TestTerminalHubCloseUserRuntimesForceClosesKeepAliveRuntime(t *testing.T) {
	var finished []string
	h := &TerminalHub{
		sessions:     make(map[string]*managedRuntime),
		keepAliveTTL: time.Hour,
		detachedTTL:  2 * time.Minute,
		onFinish: func(userID, sessionID string, status model.TerminalSessionStatus, message string) {
			finished = append(finished, userID+":"+sessionID+":"+string(status)+":"+message)
		},
	}
	now := time.Now()
	keepAliveRuntime := runtimeForHubTest(h, "user-1", "session-keepalive", now)
	keepAliveUntil := now.Add(30 * time.Minute)
	keepAliveRuntime.keepAliveUntil = &keepAliveUntil
	keepAliveAttachment := &attachmentHandle{
		id:     1,
		output: make(chan []byte, 1),
		closed: make(chan AttachmentClose, 1),
	}
	keepAliveRuntime.attachment = keepAliveAttachment
	h.sessions[terminalRuntimeKey("user-1", "session-keepalive")] = keepAliveRuntime

	closed := h.CloseUserRuntimesForce("user-1", "admin revoked user sessions")

	if closed != 1 {
		t.Fatalf("expected keepalive runtime force closed, got %d", closed)
	}
	if len(finished) != 1 || finished[0] != "user-1:session-keepalive:disconnected:admin revoked user sessions" {
		t.Fatalf("expected keepalive runtime finish callback, got %#v", finished)
	}
	if _, ok := h.sessions[terminalRuntimeKey("user-1", "session-keepalive")]; ok {
		t.Fatal("expected keepalive runtime removed after force close")
	}
	select {
	case reason := <-keepAliveAttachment.closed:
		if !reason.RuntimeClosed || reason.Message != "admin revoked user sessions" {
			t.Fatalf("expected keepalive attachment closed by force close, got %#v", reason)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected keepalive attachment to close")
	}
}

func TestTerminalHubCloseAuthSessionRuntimes(t *testing.T) {
	var finished []string
	h := &TerminalHub{
		sessions: make(map[string]*managedRuntime),
		onFinish: func(userID, sessionID string, status model.TerminalSessionStatus, message string) {
			finished = append(finished, userID+":"+sessionID+":"+string(status)+":"+message)
		},
	}
	targetRuntime := runtimeForHubTest(h, "user-1", "terminal-session-1", time.Now())
	targetRuntime.runtime.AuthSessionID = "auth-session-1"
	targetAttachment := &attachmentHandle{
		id:     1,
		output: make(chan []byte, 1),
		closed: make(chan AttachmentClose, 1),
	}
	targetRuntime.attachment = targetAttachment
	otherRuntime := runtimeForHubTest(h, "user-1", "terminal-session-2", time.Now())
	otherRuntime.runtime.AuthSessionID = "auth-session-2"
	h.sessions[terminalRuntimeKey("user-1", "terminal-session-1")] = targetRuntime
	h.sessions[terminalRuntimeKey("user-1", "terminal-session-2")] = otherRuntime

	closed := h.CloseAuthSessionRuntimes("user-1", "auth-session-1", "auth session revoked")

	if closed != 1 {
		t.Fatalf("expected one auth session runtime closed, got %d", closed)
	}
	if len(finished) != 1 || finished[0] != "user-1:terminal-session-1:disconnected:auth session revoked" {
		t.Fatalf("expected target runtime finish callback, got %#v", finished)
	}
	if _, ok := h.sessions[terminalRuntimeKey("user-1", "terminal-session-1")]; ok {
		t.Fatal("expected target runtime removed")
	}
	if _, ok := h.sessions[terminalRuntimeKey("user-1", "terminal-session-2")]; !ok {
		t.Fatal("expected other auth session runtime to remain")
	}
	select {
	case reason := <-targetAttachment.closed:
		if !reason.RuntimeClosed || reason.Message != "auth session revoked" {
			t.Fatalf("expected target attachment closed by revoke, got %#v", reason)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected target attachment to close")
	}
}

func TestTerminalHubCloseAuthSessionRuntimesForceClosesKeepAliveRuntime(t *testing.T) {
	var finished []string
	h := &TerminalHub{
		sessions:     make(map[string]*managedRuntime),
		keepAliveTTL: time.Hour,
		onFinish: func(userID, sessionID string, status model.TerminalSessionStatus, message string) {
			finished = append(finished, userID+":"+sessionID+":"+string(status)+":"+message)
		},
	}
	now := time.Now()
	targetRuntime := runtimeForHubTest(h, "user-1", "terminal-session-1", now)
	targetRuntime.runtime.AuthSessionID = "auth-session-1"
	keepAliveUntil := now.Add(30 * time.Minute)
	targetRuntime.keepAliveUntil = &keepAliveUntil
	targetAttachment := &attachmentHandle{
		id:     1,
		output: make(chan []byte, 1),
		closed: make(chan AttachmentClose, 1),
	}
	targetRuntime.attachment = targetAttachment
	otherRuntime := runtimeForHubTest(h, "user-1", "terminal-session-2", now)
	otherRuntime.runtime.AuthSessionID = "auth-session-2"
	h.sessions[terminalRuntimeKey("user-1", "terminal-session-1")] = targetRuntime
	h.sessions[terminalRuntimeKey("user-1", "terminal-session-2")] = otherRuntime

	closed := h.CloseAuthSessionRuntimesForce("user-1", "auth-session-1", "admin revoked auth session")

	if closed != 1 {
		t.Fatalf("expected one keepalive auth session runtime force closed, got %d", closed)
	}
	if len(finished) != 1 || finished[0] != "user-1:terminal-session-1:disconnected:admin revoked auth session" {
		t.Fatalf("expected target runtime finish callback, got %#v", finished)
	}
	if _, ok := h.sessions[terminalRuntimeKey("user-1", "terminal-session-1")]; ok {
		t.Fatal("expected target runtime removed after force close")
	}
	if _, ok := h.sessions[terminalRuntimeKey("user-1", "terminal-session-2")]; !ok {
		t.Fatal("expected other auth session runtime to remain")
	}
	select {
	case reason := <-targetAttachment.closed:
		if !reason.RuntimeClosed || reason.Message != "admin revoked auth session" {
			t.Fatalf("expected target attachment closed by force revoke, got %#v", reason)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected target attachment to close")
	}
}

func TestTerminalHubViewerReceivesOutputWithoutReplacingPrimaryAttachment(t *testing.T) {
	h := &TerminalHub{
		sessions: make(map[string]*managedRuntime),
	}
	runtime := runtimeForHubTest(h, "user-1", "session-1", time.Now())
	runtime.buffer = newOutputRing(1024)
	runtime.buffer.add([]byte("previous output"))
	primary := &attachmentHandle{
		id:     1,
		output: make(chan []byte, 1),
		closed: make(chan AttachmentClose, 1),
	}
	runtime.attachment = primary
	h.sessions[terminalRuntimeKey("user-1", "session-1")] = runtime

	viewer, err := h.AttachViewer("user-1", "session-1", "share-1")
	if err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	if runtime.attachment != primary {
		t.Fatal("expected viewer attachment not to replace primary terminal attachment")
	}
	if count := h.ViewerCount("user-1", "session-1", "share-1"); count != 1 {
		t.Fatalf("expected one active viewer, got %d", count)
	}
	if len(viewer.Replay) != 1 || string(viewer.Replay[0]) != "previous output" {
		t.Fatalf("expected replay snapshot for viewer, got %#v", viewer.Replay)
	}

	runtime.publish([]byte("fresh output"))

	select {
	case payload := <-primary.output:
		if string(payload) != "fresh output" {
			t.Fatalf("unexpected primary payload %q", payload)
		}
	default:
		t.Fatal("expected primary attachment to receive output")
	}
	select {
	case payload := <-viewer.Output:
		if string(payload) != "fresh output" {
			t.Fatalf("unexpected viewer payload %q", payload)
		}
	default:
		t.Fatal("expected viewer attachment to receive output")
	}

	viewer.Detach("viewer left")
	if count := h.ViewerCount("user-1", "session-1", "share-1"); count != 0 {
		t.Fatalf("expected no active viewers after detach, got %d", count)
	}
}

func TestTerminalHubCloseShareViewersOnlyClosesMatchingShare(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	h := &TerminalHub{
		sessions: make(map[string]*managedRuntime),
	}
	runtime := runtimeForHubTest(h, "user-1", "session-1", time.Now())
	h.sessions[terminalRuntimeKey("user-1", "session-1")] = runtime

	shareViewer, err := h.AttachViewer("user-1", "session-1", "share-1")
	if err != nil {
		t.Fatalf("attach share viewer: %v", err)
	}
	otherViewer, err := h.AttachViewer("user-1", "session-1", "share-2")
	if err != nil {
		t.Fatalf("attach other viewer: %v", err)
	}

	closed := h.CloseShareViewers("user-1", "session-1", "share-1", "terminal share revoked")

	if closed != 1 {
		t.Fatalf("expected one viewer closed, got %d", closed)
	}
	select {
	case reason := <-shareViewer.Closed:
		if reason.RuntimeClosed || reason.Message != "terminal share revoked" {
			t.Fatalf("unexpected close reason: %#v", reason)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected matching share viewer to close")
	}
	select {
	case reason := <-otherViewer.Closed:
		t.Fatalf("unexpected close for other share viewer: %#v", reason)
	default:
	}
	if count := h.ViewerCount("user-1", "session-1", "share-1"); count != 0 {
		t.Fatalf("expected matching viewers removed, got %d", count)
	}
	if count := h.ViewerCount("user-1", "session-1", "share-2"); count != 1 {
		t.Fatalf("expected other share viewer to remain, got %d", count)
	}
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("decode share close log line %q: %v", line, err)
		}
		records = append(records, record)
	}
	events := make(map[string]map[string]any)
	for _, record := range records {
		if record["component"] == "terminal" {
			if event, ok := record["event"].(string); ok {
				events[event] = record
			}
		}
	}
	detached := events["terminal_share_viewer_detached"]
	if detached == nil {
		t.Fatalf("expected share viewer detached log when closing by share, got %#v", records)
	}
	if detached["user_id"] != "user-1" ||
		detached["session_id"] != "session-1" ||
		detached["share_id"] != "share-1" ||
		detached["host_id"] != "host-1" ||
		detached["reason_kind"] != "share_revoked" {
		t.Fatalf("unexpected share viewer detached log: %#v", detached)
	}
	if strings.Contains(output.String(), "terminal share revoked") {
		t.Fatalf("structured share viewer close log leaked raw close message: %s", output.String())
	}
}

func TestTerminalHubCloseShareViewersByShareIDScansAllRuntimes(t *testing.T) {
	h := &TerminalHub{
		sessions: make(map[string]*managedRuntime),
	}
	firstRuntime := runtimeForHubTest(h, "user-1", "session-1", time.Now())
	secondRuntime := runtimeForHubTest(h, "user-2", "session-2", time.Now())
	h.sessions[terminalRuntimeKey("user-1", "session-1")] = firstRuntime
	h.sessions[terminalRuntimeKey("user-2", "session-2")] = secondRuntime

	firstViewer, err := h.AttachViewer("user-1", "session-1", "share-1")
	if err != nil {
		t.Fatalf("attach first viewer: %v", err)
	}
	secondViewer, err := h.AttachViewer("user-2", "session-2", "share-1")
	if err != nil {
		t.Fatalf("attach second viewer: %v", err)
	}
	otherViewer, err := h.AttachViewer("user-2", "session-2", "share-2")
	if err != nil {
		t.Fatalf("attach other viewer: %v", err)
	}

	closed := h.CloseShareViewersByShareID("share-1", "terminal share revoked")

	if closed != 2 {
		t.Fatalf("expected two viewers closed, got %d", closed)
	}
	for name, viewer := range map[string]*TerminalShareAttachment{
		"first":  firstViewer,
		"second": secondViewer,
	} {
		select {
		case reason := <-viewer.Closed:
			if reason.RuntimeClosed || reason.Message != "terminal share revoked" {
				t.Fatalf("%s viewer got unexpected close reason: %#v", name, reason)
			}
		case <-time.After(100 * time.Millisecond):
			t.Fatalf("expected %s viewer to close", name)
		}
	}
	select {
	case reason := <-otherViewer.Closed:
		t.Fatalf("unexpected close for other share viewer: %#v", reason)
	default:
	}
}

func TestTerminalHubWritesStructuredOperationalLogs(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	h := &TerminalHub{
		sessions:     make(map[string]*managedRuntime),
		keepAliveTTL: time.Hour,
		detachedTTL:  2 * time.Minute,
	}
	runtime := runtimeForHubTest(h, "user-1", "session-1", time.Now())
	runtime.runtime.Session.HostID = "host-1"
	runtime.runtime.Stdin = &terminalWriteSpy{}
	h.sessions[terminalRuntimeKey("user-1", "session-1")] = runtime

	primary := &attachmentHandle{
		id:     1,
		output: make(chan []byte, 1),
		closed: make(chan AttachmentClose, 1),
	}
	runtime.attachment = primary
	attachment := &TerminalAttachment{
		Runtime: runtime.runtime,
		State:   runtime.state(time.Now()),
		Replay:  runtime.buffer.snapshot(),
		Output:  primary.output,
		Closed:  primary.closed,
		managed: runtime,
		handle:  primary,
	}
	runtime.mu.Lock()
	runtime.logRuntimeAttachedLocked("auth-session-1")
	runtime.mu.Unlock()
	viewer, err := h.AttachViewer("user-1", "session-1", "share-1")
	if err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	viewer.Detach("viewer closed with /tmp/private output visible")
	attachment.Detach("browser closed with /tmp/private output visible")
	if err := h.CloseRuntime("user-1", "session-1", "operator force close /tmp/private"); err != nil {
		t.Fatalf("close runtime: %v", err)
	}

	if strings.TrimSpace(output.String()) == "" {
		t.Fatal("expected terminal operational logs, got empty output")
	}
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("decode log line %q: %v", line, err)
		}
		records = append(records, record)
	}
	events := make(map[string]map[string]any)
	for _, record := range records {
		if record["component"] == "terminal" {
			if event, ok := record["event"].(string); ok {
				events[event] = record
			}
		}
	}
	for _, event := range []string{
		"terminal_runtime_attached",
		"terminal_share_viewer_attached",
		"terminal_share_viewer_detached",
		"terminal_runtime_detached",
		"terminal_runtime_closed",
	} {
		if events[event] == nil {
			t.Fatalf("missing terminal operational log %q in %#v", event, records)
		}
	}
	if events["terminal_runtime_closed"]["user_id"] != "user-1" ||
		events["terminal_runtime_closed"]["session_id"] != "session-1" ||
		events["terminal_runtime_closed"]["host_id"] != "host-1" ||
		events["terminal_runtime_closed"]["status"] != string(model.TerminalSessionStatusDisconnected) ||
		events["terminal_runtime_closed"]["reason_kind"] != "operator" {
		t.Fatalf("unexpected runtime close log: %#v", events["terminal_runtime_closed"])
	}
	if strings.Contains(output.String(), "/tmp/private") {
		t.Fatalf("structured terminal logs leaked raw close message content: %s", output.String())
	}
}

func TestTerminalHubCloseExpiredWritesStructuredOperationalLog(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	now := time.Now()
	h := &TerminalHub{
		sessions:    make(map[string]*managedRuntime),
		detachedTTL: 2 * time.Minute,
	}
	runtime := runtimeForHubTest(h, "user-1", "session-keepalive", now)
	detachedAt := now.Add(-1 * time.Hour)
	keepAliveUntil := now.Add(-1 * time.Minute)
	runtime.detachedAt = &detachedAt
	runtime.keepAliveUntil = &keepAliveUntil
	runtime.runtime.Session.HostID = "host-1"
	h.sessions[terminalRuntimeKey("user-1", "session-keepalive")] = runtime

	h.closeExpired()

	records := make([]map[string]any, 0)
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("decode expiration log line %q: %v", line, err)
		}
		records = append(records, record)
	}
	events := make(map[string]map[string]any)
	for _, record := range records {
		if record["component"] == "terminal" {
			if event, ok := record["event"].(string); ok {
				events[event] = record
			}
		}
	}
	expired := events["terminal_runtime_expired"]
	if expired == nil {
		t.Fatalf("expected terminal runtime expired log, got %#v", records)
	}
	if expired["user_id"] != "user-1" ||
		expired["session_id"] != "session-keepalive" ||
		expired["host_id"] != "host-1" ||
		expired["expiry_kind"] != "keepalive" ||
		expired["reason_kind"] != "expired" {
		t.Fatalf("unexpected runtime expired log: %#v", expired)
	}
	closed := events["terminal_runtime_closed"]
	if closed == nil || closed["reason_kind"] != "expired" {
		t.Fatalf("expected runtime closed log with expired reason, got %#v", events)
	}
	if strings.Contains(output.String(), "detached terminal session expired") {
		t.Fatalf("structured expiration logs leaked raw close message: %s", output.String())
	}
}

func runtimeForListTest(userID, sessionID string, startedAt time.Time) *managedRuntime {
	return &managedRuntime{
		userID: userID,
		runtime: &Runtime{Session: model.TerminalSession{
			ID:        sessionID,
			UserID:    userID,
			HostID:    "host-1",
			Status:    string(model.TerminalSessionStatusConnected),
			StartedAt: startedAt,
		}},
	}
}

func runtimeForHubTest(h *TerminalHub, userID, sessionID string, startedAt time.Time) *managedRuntime {
	item := runtimeForListTest(userID, sessionID, startedAt)
	item.hub = h
	return item
}
