package terminal

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
)

const (
	defaultDetachedTTL     = time.Hour
	defaultKeepAliveTTL    = 24 * time.Hour
	defaultRuntimeBuffer   = 2 * 1024 * 1024
	defaultMaxSessions     = 16
	defaultOutputQueueSize = 256
	terminalKeepAliveEvery = 30 * time.Second
)

var ErrRuntimeNotFound = errors.New("terminal runtime not found")

type SessionLimitError struct {
	Scope string
	Limit int
}

func (e *SessionLimitError) Error() string {
	return fmt.Sprintf("terminal %s session limit exceeded: %d", e.Scope, e.Limit)
}

type TerminalHubOptions struct {
	DetachedTTL        time.Duration
	KeepAliveTTL       time.Duration
	BufferBytes        int
	MaxSessionsPerUser int
	MaxSessionsTotal   int
	SettingsProvider   func() TerminalHubRuntimeSettings
}

type TerminalHubRuntimeSettings struct {
	KeepAliveTTL       time.Duration
	MaxSessionsPerUser int
	MaxSessionsTotal   int
}

type RuntimeState struct {
	Attached       bool       `json:"attached"`
	DetachedAt     *time.Time `json:"detached_at,omitempty"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	KeepAliveUntil *time.Time `json:"keep_alive_until,omitempty"`
}

type AttachmentClose struct {
	RuntimeClosed bool
	Status        model.TerminalSessionStatus
	Message       string
}

type TerminalAttachment struct {
	Runtime *Runtime
	State   RuntimeState
	Replay  [][]byte
	Output  <-chan []byte
	Closed  <-chan AttachmentClose

	managed *managedRuntime
	handle  *attachmentHandle
}

type TerminalShareAttachment struct {
	Runtime   *Runtime
	ShareID   string
	ExpiresAt time.Time
	Replay    [][]byte
	Output    <-chan []byte
	Closed    <-chan AttachmentClose

	managed *managedRuntime
	handle  *viewerAttachmentHandle
}

type TerminalRuntimeSnapshot struct {
	Session model.TerminalSession
	State   RuntimeState
}

func (a *TerminalAttachment) WriteInput(payload []byte) error {
	if a == nil || a.managed == nil || a.handle == nil {
		return ErrRuntimeNotFound
	}
	return a.managed.writeInput(a.handle.id, payload)
}

func (a *TerminalAttachment) Resize(rows, cols int) error {
	if a == nil || a.managed == nil || a.handle == nil {
		return ErrRuntimeNotFound
	}
	return a.managed.resizeAttachment(a.handle.id, rows, cols)
}

func (a *TerminalAttachment) Detach(message string) {
	if a == nil || a.managed == nil || a.handle == nil {
		return
	}
	a.managed.detach(a.handle.id, message)
}

func (a *TerminalShareAttachment) Detach(message string) {
	if a == nil || a.managed == nil || a.handle == nil {
		return
	}
	a.managed.detachViewer(a.handle.id, message)
}

type TerminalHub struct {
	mu               sync.Mutex
	sessions         map[string]*managedRuntime
	detachedTTL      time.Duration
	keepAliveTTL     time.Duration
	bufferBytes      int
	maxPerUser       int
	maxTotal         int
	settingsProvider func() TerminalHubRuntimeSettings
	onFinish         func(userID, sessionID string, status model.TerminalSessionStatus, message string)
	stopCh           chan struct{}
	doneCh           chan struct{}
}

func NewTerminalHub(options TerminalHubOptions, onFinish func(userID, sessionID string, status model.TerminalSessionStatus, message string)) *TerminalHub {
	options = normalizeTerminalHubOptions(options)
	h := &TerminalHub{
		sessions:         make(map[string]*managedRuntime),
		detachedTTL:      options.DetachedTTL,
		keepAliveTTL:     options.KeepAliveTTL,
		bufferBytes:      options.BufferBytes,
		maxPerUser:       options.MaxSessionsPerUser,
		maxTotal:         options.MaxSessionsTotal,
		settingsProvider: options.SettingsProvider,
		onFinish:         onFinish,
		stopCh:           make(chan struct{}),
		doneCh:           make(chan struct{}),
	}
	go h.janitor()
	return h
}

func normalizeTerminalHubOptions(options TerminalHubOptions) TerminalHubOptions {
	if options.DetachedTTL <= 0 {
		options.DetachedTTL = defaultDetachedTTL
	}
	if options.KeepAliveTTL <= 0 {
		options.KeepAliveTTL = defaultKeepAliveTTL
	}
	if options.BufferBytes <= 0 {
		options.BufferBytes = defaultRuntimeBuffer
	}
	if options.MaxSessionsPerUser <= 0 {
		options.MaxSessionsPerUser = defaultMaxSessions
	}
	if options.MaxSessionsTotal <= 0 {
		options.MaxSessionsTotal = defaultMaxSessions
	}
	return options
}

type managedRuntime struct {
	hub     *TerminalHub
	userID  string
	runtime *Runtime
	buffer  *outputRing

	mu             sync.Mutex
	nextAttachment int
	nextViewer     int
	attachment     *attachmentHandle
	viewers        map[int]*viewerAttachmentHandle
	detachedAt     *time.Time
	keepAliveUntil *time.Time
	closed         bool
	finishOnce     sync.Once
}

func newManagedRuntime(hub *TerminalHub, userID string, runtime *Runtime, bufferBytes int) *managedRuntime {
	return &managedRuntime{
		hub:     hub,
		userID:  userID,
		runtime: runtime,
		buffer:  newOutputRing(bufferBytes),
	}
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func stringsOrDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
