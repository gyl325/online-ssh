package terminal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/llm"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/gorilla/websocket"
)

type terminalRepoStub struct {
	mu                 sync.Mutex
	session            model.TerminalSession
	getErr             error
	updateErr          error
	createCalls        int
	updateCalls        []terminalStatusUpdate
	createdShare       CreateTerminalShareRecordInput
	share              model.TerminalShare
	accessLogs         []model.TerminalShareAccessLog
	viewerTokenInput   CreateTerminalShareViewerTokenInput
	viewerTokenCreated model.TerminalShareViewerToken
}

type terminalStatusUpdate struct {
	userID    string
	sessionID string
	status    string
	endedAt   *time.Time
}

func (s *terminalRepoStub) CreateSession(_ context.Context, userID, hostID, status string, remoteAddr *string) (model.TerminalSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createCalls++
	s.session = model.TerminalSession{
		ID:         "session-1",
		UserID:     userID,
		HostID:     hostID,
		Status:     status,
		RemoteAddr: remoteAddr,
		StartedAt:  time.Now(),
	}
	return s.session, nil
}

func (s *terminalRepoStub) GetSessionByID(context.Context, string, string) (model.TerminalSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.getErr != nil {
		return model.TerminalSession{}, s.getErr
	}
	return s.session, nil
}

func (s *terminalRepoStub) UpdateSessionStatus(_ context.Context, userID, sessionID, status string, endedAt *time.Time) (model.TerminalSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.updateCalls = append(s.updateCalls, terminalStatusUpdate{
		userID:    userID,
		sessionID: sessionID,
		status:    status,
		endedAt:   endedAt,
	})
	if s.updateErr != nil {
		return model.TerminalSession{}, s.updateErr
	}
	s.session.Status = status
	s.session.EndedAt = endedAt
	return s.session, nil
}

func (s *terminalRepoStub) CreateTerminalShare(_ context.Context, input CreateTerminalShareRecordInput) (model.TerminalShare, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createdShare = input
	s.share = model.TerminalShare{
		ID:                "share-1",
		UserID:            input.UserID,
		TerminalSessionID: input.TerminalSessionID,
		HostID:            input.HostID,
		TokenHash:         input.TokenHash,
		PublicToken:       input.PublicToken,
		PasswordHash:      input.PasswordHash,
		ExpiresAt:         input.ExpiresAt,
		MaxAccesses:       input.MaxAccesses,
		SensitivePrompt:   input.SensitivePrompt,
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
	}
	return s.share, nil
}

func (s *terminalRepoStub) GetActiveTerminalShare(context.Context, string, string, time.Time) (model.TerminalShare, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.share.ID == "" {
		return model.TerminalShare{}, db.ErrNotFound
	}
	return s.share, nil
}

func (s *terminalRepoStub) GetTerminalShareByID(context.Context, string, string) (model.TerminalShare, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.share.ID == "" {
		return model.TerminalShare{}, db.ErrNotFound
	}
	return s.share, nil
}

func (s *terminalRepoStub) GetTerminalShareByTokenHash(_ context.Context, tokenHash string, _ time.Time) (model.TerminalShare, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.share.ID == "" || s.share.TokenHash != tokenHash {
		return model.TerminalShare{}, db.ErrNotFound
	}
	return s.share, nil
}

func (s *terminalRepoStub) IncrementTerminalShareAccess(_ context.Context, shareID string, _ time.Time) (model.TerminalShare, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.share.ID != shareID {
		return model.TerminalShare{}, db.ErrNotFound
	}
	s.share.AccessCount++
	return s.share, nil
}

func (s *terminalRepoStub) RevokeTerminalShare(_ context.Context, userID, shareID string, revokedAt time.Time) (model.TerminalShare, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.share.ID != shareID || s.share.UserID != userID {
		return model.TerminalShare{}, db.ErrNotFound
	}
	s.share.RevokedAt = &revokedAt
	return s.share, nil
}

func (s *terminalRepoStub) ExtendTerminalShare(_ context.Context, userID, shareID string, expiresAt time.Time) (model.TerminalShare, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.share.ID != shareID || s.share.UserID != userID {
		return model.TerminalShare{}, db.ErrNotFound
	}
	s.share.ExpiresAt = expiresAt
	return s.share, nil
}

func (s *terminalRepoStub) setShareExpiresAt(expiresAt time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.share.ExpiresAt = expiresAt
	s.viewerTokenCreated.Share = s.share
}

func (s *terminalRepoStub) setShareRevokedAt(revokedAt time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.share.RevokedAt = &revokedAt
	s.viewerTokenCreated.Share = s.share
}

func (s *terminalRepoStub) CreateTerminalShareAccessLog(_ context.Context, log model.TerminalShareAccessLog) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.accessLogs = append(s.accessLogs, log)
	return nil
}

func (s *terminalRepoStub) ListTerminalShareAccessLogs(context.Context, string, string, int, int) ([]model.TerminalShareAccessLog, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := append([]model.TerminalShareAccessLog(nil), s.accessLogs...)
	return items, len(items), nil
}

func (s *terminalRepoStub) CreateTerminalShareViewerToken(_ context.Context, input CreateTerminalShareViewerTokenInput) (model.TerminalShareViewerToken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.viewerTokenInput = input
	s.viewerTokenCreated = model.TerminalShareViewerToken{
		ID:        "viewer-token-1",
		ShareID:   input.ShareID,
		TokenHash: input.TokenHash,
		ExpiresAt: input.ExpiresAt,
		CreatedAt: time.Now(),
	}
	return s.viewerTokenCreated, nil
}

func (s *terminalRepoStub) GetTerminalShareViewerTokenByHash(_ context.Context, tokenHash string, _ time.Time) (model.TerminalShareViewerToken, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.viewerTokenCreated.TokenHash != tokenHash {
		return model.TerminalShareViewerToken{}, db.ErrNotFound
	}
	item := s.viewerTokenCreated
	item.Share = s.share
	return item, nil
}

type terminalAuditRecorder struct {
	logs []model.AuditLog
}

func (r *terminalAuditRecorder) Record(_ context.Context, log model.AuditLog) error {
	r.logs = append(r.logs, log)
	return nil
}

type terminalCommandGeneratorStub struct {
	inputs []llm.CommandRequest
	result llm.CommandGeneration
	err    error
}

func (s *terminalCommandGeneratorStub) GenerateCommand(_ context.Context, input llm.CommandRequest) (llm.CommandGeneration, error) {
	s.inputs = append(s.inputs, input)
	return s.result, s.err
}

type terminalWriteSpy struct {
	builder strings.Builder
}

func (s *terminalWriteSpy) Write(payload []byte) (int, error) {
	return s.builder.Write(payload)
}

func (s *terminalWriteSpy) Close() error {
	return nil
}

func (s *terminalWriteSpy) String() string {
	return s.builder.String()
}

type terminalConcurrentWriteSpy struct {
	mu      sync.Mutex
	builder strings.Builder
}

func (s *terminalConcurrentWriteSpy) Write(payload []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.builder.Write(payload)
}

func (s *terminalConcurrentWriteSpy) Close() error {
	return nil
}

func (s *terminalConcurrentWriteSpy) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.builder.String()
}

func TestServiceFinishRuntime(t *testing.T) {
	repo := &terminalRepoStub{session: model.TerminalSession{
		ID:        "session-1",
		UserID:    "user-1",
		HostID:    "host-1",
		Status:    string(model.TerminalSessionStatusConnected),
		StartedAt: time.Now(),
	}}
	audit := &terminalAuditRecorder{}
	service := NewService(repo, nil, audit)
	defer service.Close()

	item, err := service.FinishRuntime(context.Background(), "user-1", "session-1", model.TerminalSessionStatusFailed, "ssh closed")
	if err != nil {
		t.Fatalf("finish runtime: %v", err)
	}

	if item.Status != string(model.TerminalSessionStatusFailed) || item.EndedAt == nil {
		t.Fatalf("unexpected finished session: %#v", item)
	}
	if len(repo.updateCalls) != 1 || repo.updateCalls[0].status != string(model.TerminalSessionStatusFailed) || repo.updateCalls[0].endedAt == nil {
		t.Fatalf("unexpected update calls: %#v", repo.updateCalls)
	}
	if len(audit.logs) != 1 {
		t.Fatalf("expected one audit log, got %#v", audit.logs)
	}
	if audit.logs[0].EventType != "terminal_session_failed" || audit.logs[0].Result != string(model.AuditResultFailure) {
		t.Fatalf("unexpected audit log: %#v", audit.logs[0])
	}
	if audit.logs[0].Message == nil || *audit.logs[0].Message != "ssh closed" {
		t.Fatalf("unexpected audit message: %#v", audit.logs[0].Message)
	}
}

func TestServiceFinishRuntimeRejectsInvalidStatus(t *testing.T) {
	service := NewService(&terminalRepoStub{}, nil, nil)
	defer service.Close()

	_, err := service.FinishRuntime(context.Background(), "user-1", "session-1", model.TerminalSessionStatusConnected, "")
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestServiceCloseSessionWithoutRuntimeMarksDisconnected(t *testing.T) {
	repo := &terminalRepoStub{session: model.TerminalSession{
		ID:        "session-1",
		UserID:    "user-1",
		HostID:    "host-1",
		Status:    string(model.TerminalSessionStatusConnected),
		StartedAt: time.Now(),
	}}
	audit := &terminalAuditRecorder{}
	service := NewService(repo, nil, audit)
	defer service.Close()

	item, err := service.CloseSession(context.Background(), "user-1", "session-1")
	if err != nil {
		t.Fatalf("close session: %v", err)
	}

	if item.Status != string(model.TerminalSessionStatusDisconnected) || item.EndedAt == nil {
		t.Fatalf("unexpected closed session: %#v", item)
	}
	if len(repo.updateCalls) != 1 || repo.updateCalls[0].status != string(model.TerminalSessionStatusDisconnected) {
		t.Fatalf("unexpected update calls: %#v", repo.updateCalls)
	}
	if len(audit.logs) != 1 || audit.logs[0].EventType != "terminal_session_disconnected" {
		t.Fatalf("unexpected audit logs: %#v", audit.logs)
	}
}

func TestServiceGenerateCommandUsesConfiguredGenerator(t *testing.T) {
	generator := &terminalCommandGeneratorStub{result: llm.CommandGeneration{Result: &llm.CommandResult{
		CommandText: "find /var/log -type f -mtime -1 -print",
		Name:        "Find recent logs",
		Category:    "Logs",
		Description: "Lists recently modified log files.",
		RiskLevel:   "low",
		Notes:       []string{"Review the path before running."},
	}}}
	service := NewServiceWithOptions(&terminalRepoStub{}, nil, nil, ServiceOptions{CommandGenerator: generator})
	defer service.Close()

	result, err := service.GenerateCommand(context.Background(), "user-1", llm.CommandRequest{
		Prompt:           "find recent logs",
		HostLabel:        "prod-web-1",
		ShellHint:        "bash",
		WorkingDirectory: "/var/log",
		SystemInfo:       "  OS: Ubuntu 22.04.2 LTS  ",
	})
	if err != nil {
		t.Fatalf("generate command: %v", err)
	}
	if result.Result == nil || result.Result.CommandText == "" || result.Result.RiskLevel != "low" {
		t.Fatalf("unexpected command result %#v", result)
	}
	if len(generator.inputs) != 1 || generator.inputs[0].Prompt != "find recent logs" || generator.inputs[0].WorkingDirectory != "/var/log" || generator.inputs[0].SystemInfo != "OS: Ubuntu 22.04.2 LTS" {
		t.Fatalf("expected generator input to be forwarded, got %#v", generator.inputs)
	}
}

func TestServiceGenerateCommandRequiresGeneratorAndPrompt(t *testing.T) {
	service := NewService(&terminalRepoStub{}, nil, nil)
	defer service.Close()

	if _, err := service.GenerateCommand(context.Background(), "user-1", llm.CommandRequest{Prompt: "list logs"}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("expected invalid state without generator, got %v", err)
	}
	generator := &terminalCommandGeneratorStub{}
	service = NewServiceWithOptions(&terminalRepoStub{}, nil, nil, ServiceOptions{CommandGenerator: generator})
	defer service.Close()
	if _, err := service.GenerateCommand(context.Background(), "user-1", llm.CommandRequest{Prompt: "   "}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid prompt, got %v", err)
	}
}

func TestServiceCloseSessionReturnsTerminalSessionWithoutAudit(t *testing.T) {
	repo := &terminalRepoStub{session: model.TerminalSession{
		ID:        "session-1",
		UserID:    "user-1",
		HostID:    "host-1",
		Status:    string(model.TerminalSessionStatusDisconnected),
		StartedAt: time.Now(),
	}}
	audit := &terminalAuditRecorder{}
	service := NewService(repo, nil, audit)
	defer service.Close()

	item, err := service.CloseSession(context.Background(), "user-1", "session-1")
	if err != nil {
		t.Fatalf("close session: %v", err)
	}

	if item.Status != string(model.TerminalSessionStatusDisconnected) {
		t.Fatalf("unexpected session: %#v", item)
	}
	if len(repo.updateCalls) != 0 {
		t.Fatalf("expected no update calls, got %#v", repo.updateCalls)
	}
	if len(audit.logs) != 0 {
		t.Fatalf("expected no audit logs, got %#v", audit.logs)
	}
}

func TestServiceCloseSessionReturnsRepositoryErrors(t *testing.T) {
	service := NewService(&terminalRepoStub{getErr: db.ErrNotFound}, nil, nil)
	defer service.Close()

	_, err := service.CloseSession(context.Background(), "user-1", "missing")
	if !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("expected not found error, got %v", err)
	}
}

func TestServiceQuickConnectCreatesTemporarySessionWithoutRepository(t *testing.T) {
	repo := &terminalRepoStub{}
	hostService := host.NewService(nil, nil, nil, nil, nil)
	service := NewService(repo, hostService, nil)
	defer service.Close()

	result, err := service.QuickConnect(context.Background(), QuickConnectSessionInput{
		UserID:   "user-1",
		Host:     "203.0.113.40",
		Port:     22,
		Username: "root",
		AuthType: string(model.AuthTypePassword),
		Password: "secret-password",
		Rows:     36,
		Cols:     120,
	})
	if err != nil {
		t.Fatalf("quick connect: %v", err)
	}

	if repo.createCalls != 0 {
		t.Fatalf("expected no persisted session, got %d create calls", repo.createCalls)
	}
	if !strings.HasPrefix(result.Session.ID, "tmp-session-") {
		t.Fatalf("expected temporary session id, got %q", result.Session.ID)
	}
	if !strings.HasPrefix(result.Session.HostID, "tmp-host-") {
		t.Fatalf("expected temporary host id, got %q", result.Session.HostID)
	}
	if result.Session.Status != string(model.TerminalSessionStatusConnecting) {
		t.Fatalf("unexpected session status: %#v", result.Session)
	}
	if result.WebSocket.Protocol != "terminal.v1" {
		t.Fatalf("unexpected websocket protocol: %#v", result.WebSocket)
	}
	if _, ok := service.temporarySessions.Get("user-1", result.Session.ID); !ok {
		t.Fatalf("expected temporary session to be stored")
	}
	if _, err := hostService.Get(context.Background(), "user-1", result.Session.HostID); err != nil {
		t.Fatalf("expected temporary host to be retrievable: %v", err)
	}
}

func TestServiceQuickConnectIssuesTerminalAttachToken(t *testing.T) {
	repo := &terminalRepoStub{}
	hostService := host.NewService(nil, nil, nil, nil, nil)
	service := NewService(repo, hostService, nil)
	defer service.Close()

	result, err := service.QuickConnect(context.Background(), QuickConnectSessionInput{
		UserID:           "user-1",
		Host:             "203.0.113.40",
		Port:             22,
		Username:         "root",
		AuthType:         string(model.AuthTypePassword),
		Password:         "secret-password",
		Rows:             36,
		Cols:             120,
		WebSocketBaseURL: "wss://app.example.com",
	})
	if err != nil {
		t.Fatalf("quick connect: %v", err)
	}

	if result.WebSocket.Token == nil || *result.WebSocket.Token == "" {
		t.Fatalf("expected terminal attach token, got %#v", result.WebSocket)
	}
	if !strings.Contains(result.WebSocket.URL, "attach_token="+*result.WebSocket.Token) {
		t.Fatalf("expected websocket URL to include attach token, got %q", result.WebSocket.URL)
	}
	if !service.ValidateAttachToken("user-1", result.Session.ID, *result.WebSocket.Token) {
		t.Fatalf("expected generated attach token to validate")
	}
	if service.ValidateAttachToken("user-1", result.Session.ID, "wrong-token") {
		t.Fatalf("expected wrong attach token to be rejected")
	}
}

func TestServiceListRecoverableSessionsIssuesAttachTokens(t *testing.T) {
	service := NewService(&terminalRepoStub{}, nil, nil)
	defer service.Close()

	runtime := runtimeForHubTest(service.hub, "user-1", "session-1", time.Now())
	service.hub.sessions[terminalRuntimeKey("user-1", "session-1")] = runtime

	items, err := service.ListRecoverableSessions(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("list recoverable sessions: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one recoverable session, got %#v", items)
	}
	if items[0].AttachToken == nil || *items[0].AttachToken == "" {
		t.Fatalf("expected recoverable session attach token, got %#v", items[0])
	}
	if !service.ValidateAttachToken("user-1", "session-1", *items[0].AttachToken) {
		t.Fatalf("expected recoverable session attach token to validate")
	}
}

func TestHandlerWebSocketOriginPolicy(t *testing.T) {
	handler := NewHandler(nil)

	tests := []struct {
		name    string
		url     string
		headers map[string]string
		want    bool
	}{
		{
			name: "allows non browser clients without origin",
			url:  "http://app.example.com/ws/terminal",
			want: true,
		},
		{
			name: "allows same forwarded https origin",
			url:  "http://internal.local/ws/terminal",
			headers: map[string]string{
				"Origin":            "https://app.example.com",
				"X-Forwarded-Proto": "https",
				"X-Forwarded-Host":  "app.example.com",
			},
			want: true,
		},
		{
			name: "allows same local development origin",
			url:  "http://127.0.0.1:5173/ws/terminal",
			headers: map[string]string{
				"Origin": "http://127.0.0.1:5173",
			},
			want: true,
		},
		{
			name: "rejects cross site origin",
			url:  "http://app.example.com/ws/terminal",
			headers: map[string]string{
				"Origin": "https://evil.example.com",
			},
			want: false,
		},
		{
			name: "rejects malformed origin",
			url:  "http://app.example.com/ws/terminal",
			headers: map[string]string{
				"Origin": "://bad-origin",
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.url, nil)
			for key, value := range tt.headers {
				req.Header.Set(key, value)
			}
			if got := handler.upgrader.CheckOrigin(req); got != tt.want {
				t.Fatalf("CheckOrigin() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestHandlerStreamRequiresValidAttachToken(t *testing.T) {
	service := NewService(&terminalRepoStub{}, nil, nil)
	defer service.Close()
	handler := NewHandler(service)

	req := httptest.NewRequest(http.MethodGet, "/ws/terminal?session_id=session-1&rows=36&cols=120", nil)
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{
		UserID: "user-1",
		User: model.User{
			ID:          "user-1",
			Permissions: []string{model.PermissionTerminalConnect},
		},
	}))
	rr := httptest.NewRecorder()

	handler.Stream(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected missing attach token to return 401, got %d body=%s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "terminal attach token required") {
		t.Fatalf("expected attach token error, got %s", rr.Body.String())
	}
}

func TestHandlerUpgradeTerminalWebSocketAllowsValidatedAttachTokenBehindHostRewritingProxy(t *testing.T) {
	handler := NewHandler(nil)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := handler.upgradeTerminalWebSocket(w, r)
		if err != nil {
			return
		}
		defer conn.Close()
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"ready"}`)); err != nil {
			t.Errorf("write ready event: %v", err)
		}
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/terminal"
	headers := http.Header{}
	headers.Set("Origin", "http://203.0.113.118:7583")
	conn, response, err := websocket.DefaultDialer.Dial(wsURL, headers)
	if err != nil {
		status := 0
		if response != nil {
			status = response.StatusCode
		}
		t.Fatalf("dial websocket with validated attach token: %v status=%d", err, status)
	}
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ready event: %v", err)
	}
	if messageType != websocket.TextMessage || !strings.Contains(string(payload), `"type":"ready"`) {
		t.Fatalf("expected ready event, got type=%d payload=%s", messageType, payload)
	}
}

func TestHandlerStreamAttachmentForwardsMainTerminalInputAndOutput(t *testing.T) {
	handler := NewHandler(nil)
	hub := &TerminalHub{
		sessions:    make(map[string]*managedRuntime),
		detachedTTL: time.Minute,
	}
	runtime := runtimeForHubTest(hub, "user-1", "session-1", time.Now())
	runtime.buffer = newOutputRing(1024)
	stdin := &terminalConcurrentWriteSpy{}
	runtime.runtime.Stdin = stdin
	handle := &attachmentHandle{
		id:     1,
		output: make(chan []byte, 4),
		closed: make(chan AttachmentClose, 1),
	}
	runtime.attachment = handle
	attachment := &TerminalAttachment{
		Runtime: runtime.runtime,
		State:   runtime.state(time.Now()),
		Replay:  [][]byte{[]byte("previous output")},
		Output:  handle.output,
		Closed:  handle.closed,
		managed: runtime,
		handle:  handle,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := handler.upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		handler.streamAttachment(conn, attachment)
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/terminal"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial main terminal websocket: %v", err)
	}
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ready event: %v", err)
	}
	if messageType != websocket.TextMessage || !strings.Contains(string(payload), `"type":"ready"`) || !strings.Contains(string(payload), `"protocol":"terminal.v1"`) {
		t.Fatalf("expected main terminal ready event, got type=%d payload=%s", messageType, payload)
	}

	messageType, payload, err = conn.ReadMessage()
	if err != nil {
		t.Fatalf("read replay payload: %v", err)
	}
	if messageType != websocket.BinaryMessage || string(payload) != "previous output" {
		t.Fatalf("expected replay binary payload, got type=%d payload=%q", messageType, payload)
	}

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"input","data":"whoami\n"}`)); err != nil {
		t.Fatalf("write terminal input: %v", err)
	}
	eventually(t, func() bool {
		return stdin.String() == "whoami\n"
	})

	runtime.publish([]byte("fresh output"))
	messageType, payload, err = conn.ReadMessage()
	if err != nil {
		t.Fatalf("read fresh output: %v", err)
	}
	if messageType != websocket.BinaryMessage || string(payload) != "fresh output" {
		t.Fatalf("expected fresh binary output, got type=%d payload=%q", messageType, payload)
	}
}

func TestServiceCreateShareStoresHashedTokenAndPassword(t *testing.T) {
	repo := &terminalRepoStub{session: model.TerminalSession{
		ID:        "session-1",
		UserID:    "user-1",
		HostID:    "host-1",
		Status:    string(model.TerminalSessionStatusConnected),
		StartedAt: time.Now(),
	}}
	audit := &terminalAuditRecorder{}
	service := NewService(repo, nil, audit)
	defer service.Close()
	maxAccesses := 3

	result, err := service.CreateShare(context.Background(), CreateTerminalShareInput{
		UserID:           "user-1",
		SessionID:        "session-1",
		ExpiresInMinutes: 10,
		MaxAccesses:      &maxAccesses,
		Password:         "view-pass",
		SensitivePrompt:  "Contains production deployment output.",
		PublicBaseURL:    "https://app.example.com",
	})
	if err != nil {
		t.Fatalf("create share: %v", err)
	}
	if result.Token == "" || len(result.Token) < 32 {
		t.Fatalf("expected high strength token, got %q", result.Token)
	}
	if repo.createdShare.TokenHash == "" || repo.createdShare.TokenHash == result.Token {
		t.Fatalf("expected hashed token storage, got %#v", repo.createdShare)
	}
	if repo.createdShare.TokenHash != hashShareToken(result.Token) {
		t.Fatalf("stored token hash does not match result token")
	}
	if repo.createdShare.PublicToken != result.Token {
		t.Fatalf("expected recoverable public token for management URL, got %q want %q", repo.createdShare.PublicToken, result.Token)
	}
	if repo.createdShare.PasswordHash == nil || *repo.createdShare.PasswordHash == "view-pass" {
		t.Fatalf("expected password hash, got %#v", repo.createdShare.PasswordHash)
	}
	if !verifySharePassword(*repo.createdShare.PasswordHash, "view-pass") {
		t.Fatalf("stored password hash does not verify")
	}
	if result.Share.URL != "https://app.example.com/share/terminal/"+result.Token {
		t.Fatalf("unexpected share url %q", result.Share.URL)
	}
	if result.Share.ViewerCount != 0 || !result.Share.PasswordRequired {
		t.Fatalf("unexpected share info: %#v", result.Share)
	}
	if len(audit.logs) != 1 || audit.logs[0].EventType != "terminal_share_create" {
		t.Fatalf("expected terminal_share_create audit log, got %#v", audit.logs)
	}
}

func TestServiceRejectsShareDurationUnderTwoMinutes(t *testing.T) {
	repo := &terminalRepoStub{session: model.TerminalSession{
		ID:        "session-1",
		UserID:    "user-1",
		HostID:    "host-1",
		Status:    string(model.TerminalSessionStatusConnected),
		StartedAt: time.Now(),
	}}
	service := NewService(repo, nil, nil)
	defer service.Close()

	_, err := service.CreateShare(context.Background(), CreateTerminalShareInput{
		UserID:           "user-1",
		SessionID:        "session-1",
		ExpiresInMinutes: 1,
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input for one-minute share, got %v", err)
	}

	tooManyAccesses := 1001
	_, err = service.CreateShare(context.Background(), CreateTerminalShareInput{
		UserID:           "user-1",
		SessionID:        "session-1",
		ExpiresInMinutes: 10,
		MaxAccesses:      &tooManyAccesses,
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input for access limit over 1000, got %v", err)
	}

	repo.share = model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		ExpiresAt:         time.Now().Add(10 * time.Minute),
	}
	_, err = service.ExtendShare(context.Background(), ExtendTerminalShareInput{
		UserID:           "user-1",
		ShareID:          "share-1",
		ExpiresInMinutes: 1,
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input for one-minute extension, got %v", err)
	}
}

func TestServiceOpenShareAccessEnforcesPasswordAndAccessLimit(t *testing.T) {
	token := "share-token-value"
	passwordHash, err := hashSharePassword("view-pass")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	maxAccesses := 1
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken(token),
		PasswordHash:      &passwordHash,
		ExpiresAt:         time.Now().Add(10 * time.Minute),
		MaxAccesses:       &maxAccesses,
		SensitivePrompt:   "Sensitive production output",
	}}
	service := NewService(repo, nil, nil)
	defer service.Close()

	_, err = service.OpenShareAccess(context.Background(), OpenTerminalShareAccessInput{
		Token:            token,
		Password:         "wrong-pass",
		ClientIP:         "203.0.113.8",
		UserAgent:        "viewer-agent",
		WebSocketBaseURL: "wss://app.example.com",
	})
	if !errors.Is(err, ErrSharePasswordInvalid) {
		t.Fatalf("expected password error, got %v", err)
	}
	if repo.share.AccessCount != 0 {
		t.Fatalf("failed password should not increment access count")
	}
	if len(repo.accessLogs) != 1 || repo.accessLogs[0].Result != string(model.AuditResultFailure) {
		t.Fatalf("expected failed access log, got %#v", repo.accessLogs)
	}

	result, err := service.OpenShareAccess(context.Background(), OpenTerminalShareAccessInput{
		Token:            token,
		Password:         "view-pass",
		ClientIP:         "203.0.113.8",
		UserAgent:        "viewer-agent",
		WebSocketBaseURL: "wss://app.example.com",
	})
	if err != nil {
		t.Fatalf("open share access: %v", err)
	}
	if result.ViewerToken == "" || repo.viewerTokenInput.TokenHash != hashShareToken(result.ViewerToken) {
		t.Fatalf("expected stored hashed viewer token, result=%#v input=%#v", result, repo.viewerTokenInput)
	}
	if result.WebSocket.URL != "wss://app.example.com/ws/terminal/share?viewer_token="+result.ViewerToken {
		t.Fatalf("unexpected websocket url %q", result.WebSocket.URL)
	}
	if repo.share.AccessCount != 1 {
		t.Fatalf("expected access count 1, got %d", repo.share.AccessCount)
	}
	if len(repo.accessLogs) != 2 || repo.accessLogs[1].Result != string(model.AuditResultSuccess) {
		t.Fatalf("expected successful access log, got %#v", repo.accessLogs)
	}

	_, err = service.OpenShareAccess(context.Background(), OpenTerminalShareAccessInput{
		Token:    token,
		Password: "view-pass",
	})
	if !errors.Is(err, ErrShareAccessLimit) {
		t.Fatalf("expected access limit error, got %v", err)
	}
	if repo.share.AccessCount != 1 {
		t.Fatalf("access limit failure should not increment count, got %d", repo.share.AccessCount)
	}
}

func TestServiceOpenShareAccessDeduplicatesDuplicateIdempotencyKey(t *testing.T) {
	token := "share-token-value"
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken(token),
		ExpiresAt:         time.Now().Add(10 * time.Minute),
	}}
	service := NewService(repo, nil, nil)
	defer service.Close()

	input := OpenTerminalShareAccessInput{
		Token:            token,
		ClientIP:         "203.0.113.8",
		UserAgent:        "viewer-agent",
		WebSocketBaseURL: "wss://app.example.com",
		IdempotencyKey:   "safari-tab-open-1",
	}
	first, err := service.OpenShareAccess(context.Background(), input)
	if err != nil {
		t.Fatalf("open first share access: %v", err)
	}
	second, err := service.OpenShareAccess(context.Background(), input)
	if err != nil {
		t.Fatalf("open duplicate share access: %v", err)
	}
	if first.ViewerToken == "" || second.ViewerToken != first.ViewerToken {
		t.Fatalf("expected duplicate open to reuse viewer token, first=%#v second=%#v", first, second)
	}
	if repo.share.AccessCount != 1 {
		t.Fatalf("expected duplicate open to count once, got %d", repo.share.AccessCount)
	}
	if len(repo.accessLogs) != 1 || repo.accessLogs[0].Result != string(model.AuditResultSuccess) {
		t.Fatalf("expected one successful access log, got %#v", repo.accessLogs)
	}

	input.IdempotencyKey = "safari-tab-open-2"
	if _, err := service.OpenShareAccess(context.Background(), input); err != nil {
		t.Fatalf("open distinct share access: %v", err)
	}
	if repo.share.AccessCount != 2 {
		t.Fatalf("expected distinct open key to count again, got %d", repo.share.AccessCount)
	}
	if len(repo.accessLogs) != 2 {
		t.Fatalf("expected second successful access log for distinct key, got %#v", repo.accessLogs)
	}
}

func TestServiceOpenShareAccessReportsLimitBeforePasswordChallenge(t *testing.T) {
	token := "share-token-value"
	passwordHash, err := hashSharePassword("view-pass")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	maxAccesses := 5
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken(token),
		PasswordHash:      &passwordHash,
		ExpiresAt:         time.Now().Add(10 * time.Minute),
		MaxAccesses:       &maxAccesses,
		AccessCount:       maxAccesses,
	}}
	service := NewService(repo, nil, nil)
	defer service.Close()

	_, err = service.OpenShareAccess(context.Background(), OpenTerminalShareAccessInput{
		Token:    token,
		Password: "",
	})

	if !errors.Is(err, ErrShareAccessLimit) {
		t.Fatalf("expected access limit before password challenge, got %v", err)
	}
	if repo.share.AccessCount != maxAccesses {
		t.Fatalf("access limit failure should not increment count, got %d", repo.share.AccessCount)
	}
}

func TestServiceManageShareReturnsViewerCountAndUpdatesExpiry(t *testing.T) {
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken("share-token"),
		PublicToken:       "share-token",
		ExpiresAt:         time.Now().Add(10 * time.Minute),
	}}
	service := NewService(repo, nil, nil)
	defer service.Close()
	runtime := runtimeForHubTest(service.hub, "user-1", "session-1", time.Now())
	runtime.buffer = newOutputRing(1024)
	service.hub.sessions[terminalRuntimeKey("user-1", "session-1")] = runtime
	viewer, err := service.hub.AttachViewer("user-1", "session-1", "share-1")
	if err != nil {
		t.Fatalf("attach viewer: %v", err)
	}
	defer viewer.Detach("test cleanup")

	info, err := service.GetActiveShare(context.Background(), "user-1", "session-1")
	if err != nil {
		t.Fatalf("get active share: %v", err)
	}
	if info.ViewerCount != 1 {
		t.Fatalf("expected one viewer, got %#v", info)
	}
	if info.URL != "/share/terminal/share-token" {
		t.Fatalf("expected active share URL to be recoverable, got %q", info.URL)
	}

	extended, err := service.ExtendShare(context.Background(), ExtendTerminalShareInput{
		UserID:           "user-1",
		ShareID:          "share-1",
		ExpiresInMinutes: 30,
	})
	if err != nil {
		t.Fatalf("extend share: %v", err)
	}
	if !extended.ExpiresAt.After(info.ExpiresAt) || extended.ViewerCount != 1 {
		t.Fatalf("unexpected extended share: before=%#v after=%#v", info, extended)
	}

	revoked, err := service.RevokeShare(context.Background(), "user-1", "share-1")
	if err != nil {
		t.Fatalf("revoke share: %v", err)
	}
	if revoked.RevokedAt == nil {
		t.Fatalf("expected revoked timestamp, got %#v", revoked)
	}
	select {
	case reason := <-viewer.Closed:
		if reason.RuntimeClosed || reason.Message != "terminal share revoked" {
			t.Fatalf("expected share revoke close reason, got %#v", reason)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected revoke to close active share viewer")
	}
}

func TestServiceRevokeShareClosesViewerEvenWhenRuntimeLookupMisses(t *testing.T) {
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken("share-token"),
		PublicToken:       "share-token",
		ExpiresAt:         time.Now().Add(10 * time.Minute),
	}}
	service := NewService(repo, nil, nil)
	defer service.Close()
	runtime := runtimeForHubTest(service.hub, "user-1", "session-1", time.Now())
	runtime.buffer = newOutputRing(1024)
	service.hub.sessions[terminalRuntimeKey("different-user-key", "different-session-key")] = runtime
	viewer, err := runtime.attachViewer("share-1")
	if err != nil {
		t.Fatalf("attach viewer: %v", err)
	}

	if _, err := service.RevokeShare(context.Background(), "user-1", "share-1"); err != nil {
		t.Fatalf("revoke share: %v", err)
	}

	select {
	case reason := <-viewer.Closed:
		if reason.RuntimeClosed || reason.Message != "terminal share revoked" {
			t.Fatalf("expected share revoke close reason, got %#v", reason)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("expected revoke to close share viewer by share id")
	}

	runtime.publish([]byte("fresh output after revoke"))
	select {
	case payload, ok := <-viewer.Output:
		if ok {
			t.Fatalf("revoked viewer received fresh output: %q", payload)
		}
	default:
	}
}

func TestHandlerCreateShareReturnsSharePayload(t *testing.T) {
	repo := &terminalRepoStub{session: model.TerminalSession{
		ID:        "session-1",
		UserID:    "user-1",
		HostID:    "host-1",
		Status:    string(model.TerminalSessionStatusConnected),
		StartedAt: time.Now(),
	}}
	service := NewService(repo, nil, nil)
	defer service.Close()
	handler := NewHandler(service)

	body := strings.NewReader(`{"expires_in_minutes":10,"max_accesses":2,"password":"view-pass","sensitive_prompt":"Sensitive output"}`)
	req := httptest.NewRequest(http.MethodPost, "https://app.example.com/api/terminal/sessions/session-1/share", body)
	req.SetPathValue("sessionId", "session-1")
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
	recorder := httptest.NewRecorder()

	handler.CreateShare(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload CreateTerminalShareResult
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Token == "" || payload.Share.ID != "share-1" {
		t.Fatalf("unexpected share payload: %#v", payload)
	}
	if payload.Share.URL != "https://app.example.com/share/terminal/"+payload.Token {
		t.Fatalf("unexpected share url %q", payload.Share.URL)
	}
	if payload.Share.MaxAccesses == nil || *payload.Share.MaxAccesses != 2 || !payload.Share.PasswordRequired {
		t.Fatalf("unexpected share limits: %#v", payload.Share)
	}
}

func TestHandlerGenerateCommandReturnsResult(t *testing.T) {
	generator := &terminalCommandGeneratorStub{result: llm.CommandGeneration{Result: &llm.CommandResult{
		CommandText: "du -sh /var/log/* | sort -h",
		Name:        "Find large log directories",
		Category:    "Logs",
		Description: "Shows log directory sizes sorted by size.",
		RiskLevel:   "low",
		Notes:       []string{"Read-only command."},
	}}}
	handler := NewHandler(NewServiceWithOptions(&terminalRepoStub{}, nil, nil, ServiceOptions{CommandGenerator: generator}))

	req := httptest.NewRequest(http.MethodPost, "/api/terminal/command-assistant/generate", strings.NewReader(`{
		"prompt": "show large logs",
		"host_label": "prod-web-1",
		"shell_hint": "bash",
		"working_directory": "/var/log"
	}`))
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{
		SessionID: "session-1",
		UserID:    "user-1",
		User:      model.User{ID: "user-1"},
	}))
	recorder := httptest.NewRecorder()

	handler.GenerateCommand(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 generate command, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Result llm.CommandResult `json:"result"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Result.CommandText != "du -sh /var/log/* | sort -h" || payload.Result.Name == "" {
		t.Fatalf("unexpected result payload %#v", payload)
	}
	if len(generator.inputs) != 1 || generator.inputs[0].Prompt != "show large logs" {
		t.Fatalf("expected generator call, got %#v", generator.inputs)
	}
}

func TestHandlerGenerateCommandReturnsRawResponseWhenParsingFails(t *testing.T) {
	generator := &terminalCommandGeneratorStub{result: llm.CommandGeneration{
		RawResponse:     "Use top -b -n1 | head -20 to inspect processes.",
		InvalidResponse: true,
	}}
	handler := NewHandler(NewServiceWithOptions(&terminalRepoStub{}, nil, nil, ServiceOptions{CommandGenerator: generator}))

	req := httptest.NewRequest(http.MethodPost, "/api/terminal/command-assistant/generate", strings.NewReader(`{"prompt":"show memory processes"}`))
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{
		SessionID: "session-1",
		UserID:    "user-1",
		User:      model.User{ID: "user-1"},
	}))
	recorder := httptest.NewRecorder()

	handler.GenerateCommand(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 raw generate command, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		RawResponse     string `json:"raw_response"`
		InvalidResponse bool   `json:"invalid_response"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.InvalidResponse || !strings.Contains(payload.RawResponse, "top -b") {
		t.Fatalf("unexpected raw response payload %#v", payload)
	}
}

func TestHandlerGenerateCommandReturnsUnsupportedRequest(t *testing.T) {
	generator := &terminalCommandGeneratorStub{result: llm.CommandGeneration{
		UnsupportedRequest: true,
		RefusalMessage:     "无法根据该请求生成终端命令。",
		SuggestedPrompt:    "请描述希望在终端中完成的操作。",
	}}
	handler := NewHandler(NewServiceWithOptions(&terminalRepoStub{}, nil, nil, ServiceOptions{CommandGenerator: generator}))

	req := httptest.NewRequest(http.MethodPost, "/api/terminal/command-assistant/generate", strings.NewReader(`{
		"prompt":"write me a poem",
		"system_info":"OS: Ubuntu 22.04.2 LTS"
	}`))
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{
		SessionID: "session-1",
		UserID:    "user-1",
		User:      model.User{ID: "user-1"},
	}))
	recorder := httptest.NewRecorder()

	handler.GenerateCommand(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 unsupported generate command, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		UnsupportedRequest bool   `json:"unsupported_request"`
		RefusalMessage     string `json:"refusal_message"`
		SuggestedPrompt    string `json:"suggested_prompt"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.UnsupportedRequest || payload.RefusalMessage == "" || payload.SuggestedPrompt == "" {
		t.Fatalf("unexpected unsupported response payload %#v", payload)
	}
	if len(generator.inputs) != 1 || generator.inputs[0].SystemInfo != "OS: Ubuntu 22.04.2 LTS" {
		t.Fatalf("expected system info to be forwarded, got %#v", generator.inputs)
	}
}

func TestHandlerGenerateCommandRequiresAuthAndValidPrompt(t *testing.T) {
	handler := NewHandler(NewServiceWithOptions(&terminalRepoStub{}, nil, nil, ServiceOptions{
		CommandGenerator: &terminalCommandGeneratorStub{},
	}))

	unauthReq := httptest.NewRequest(http.MethodPost, "/api/terminal/command-assistant/generate", strings.NewReader(`{"prompt":"list logs"}`))
	unauthRecorder := httptest.NewRecorder()
	handler.GenerateCommand(unauthRecorder, unauthReq)
	if unauthRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without session, got %d body=%s", unauthRecorder.Code, unauthRecorder.Body.String())
	}

	req := httptest.NewRequest(http.MethodPost, "/api/terminal/command-assistant/generate", strings.NewReader(`{"prompt":"   "}`))
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{
		SessionID: "session-1",
		UserID:    "user-1",
		User:      model.User{ID: "user-1"},
	}))
	recorder := httptest.NewRecorder()
	handler.GenerateCommand(recorder, req)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for blank prompt, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestHandlerOpenShareAccessReturnsViewerToken(t *testing.T) {
	token := "share-token-value"
	passwordHash, err := hashSharePassword("view-pass")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken(token),
		PasswordHash:      &passwordHash,
		ExpiresAt:         time.Now().Add(10 * time.Minute),
	}}
	service := NewService(repo, nil, nil)
	defer service.Close()
	handler := NewHandler(service)

	req := httptest.NewRequest(http.MethodPost, "https://app.example.com/api/terminal/shares/open", strings.NewReader(`{"token":"share-token-value","password":"view-pass"}`))
	req.Header.Set("User-Agent", "viewer-agent")
	req.RemoteAddr = "203.0.113.8:1234"
	recorder := httptest.NewRecorder()

	handler.OpenShareAccess(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload OpenTerminalShareAccessResult
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.ViewerToken == "" {
		t.Fatalf("expected viewer token, got %#v", payload)
	}
	if payload.ViewerTokenExpiresAt.IsZero() {
		t.Fatalf("expected viewer token expiry, got %#v", payload)
	}
	if payload.WebSocket.Protocol != "terminal-share.v1" || payload.WebSocket.URL != "wss://app.example.com/ws/terminal/share?viewer_token="+payload.ViewerToken {
		t.Fatalf("unexpected websocket info: %#v", payload.WebSocket)
	}
}

func TestHandlerOpenShareAccessDeduplicatesIdempotencyKey(t *testing.T) {
	token := "share-token-value"
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken(token),
		ExpiresAt:         time.Now().Add(10 * time.Minute),
	}}
	service := NewService(repo, nil, nil)
	defer service.Close()
	handler := NewHandler(service)

	body := `{"token":"share-token-value","idempotency_key":"safari-tab-open-1"}`
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "https://app.example.com/api/terminal/shares/open", strings.NewReader(body))
		recorder := httptest.NewRecorder()
		handler.OpenShareAccess(recorder, req)
		if recorder.Code != http.StatusOK {
			t.Fatalf("expected 200 on request %d, got %d body=%s", i+1, recorder.Code, recorder.Body.String())
		}
	}
	if repo.share.AccessCount != 1 {
		t.Fatalf("expected handler idempotency key to count once, got %d", repo.share.AccessCount)
	}
	if len(repo.accessLogs) != 1 {
		t.Fatalf("expected one access log, got %#v", repo.accessLogs)
	}
}

func TestHandlerStreamShareRejectsViewerInput(t *testing.T) {
	viewerToken := "viewer-token-value"
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken("share-token"),
		ExpiresAt:         time.Now().Add(10 * time.Minute),
	}}
	repo.viewerTokenCreated = model.TerminalShareViewerToken{
		ID:        "viewer-token-1",
		ShareID:   "share-1",
		TokenHash: hashShareToken(viewerToken),
		ExpiresAt: time.Now().Add(5 * time.Minute),
		CreatedAt: time.Now(),
		Share:     repo.share,
	}
	service := NewService(repo, nil, nil)
	defer service.Close()
	stdin := &terminalWriteSpy{}
	runtime := runtimeForHubTest(service.hub, "user-1", "session-1", time.Now())
	runtime.runtime.Stdin = stdin
	runtime.buffer = newOutputRing(1024)
	service.hub.sessions[terminalRuntimeKey("user-1", "session-1")] = runtime
	handler := NewHandler(service)
	server := httptest.NewServer(http.HandlerFunc(handler.StreamShare))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/terminal/share?viewer_token=" + viewerToken
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial share websocket: %v", err)
	}
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ready event: %v", err)
	}
	if messageType != websocket.TextMessage || !strings.Contains(string(payload), `"readonly":true`) {
		t.Fatalf("expected readonly ready event, got type=%d payload=%s", messageType, payload)
	}

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"input","data":"whoami\n"}`)); err != nil {
		t.Fatalf("write viewer input: %v", err)
	}
	messageType, payload, err = conn.ReadMessage()
	if err != nil {
		t.Fatalf("read readonly error: %v", err)
	}
	if messageType != websocket.TextMessage || !strings.Contains(string(payload), `"code":"READ_ONLY_TERMINAL"`) {
		t.Fatalf("expected readonly error, got type=%d payload=%s", messageType, payload)
	}
	if stdin.String() != "" {
		t.Fatalf("viewer input reached SSH stdin: %q", stdin.String())
	}
}

func TestHandlerStreamShareAllowsValidatedViewerTokenBehindHostRewritingProxy(t *testing.T) {
	viewerToken := "viewer-token-value"
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken("share-token"),
		ExpiresAt:         time.Now().Add(10 * time.Minute),
	}}
	repo.viewerTokenCreated = model.TerminalShareViewerToken{
		ID:        "viewer-token-1",
		ShareID:   "share-1",
		TokenHash: hashShareToken(viewerToken),
		ExpiresAt: time.Now().Add(5 * time.Minute),
		CreatedAt: time.Now(),
		Share:     repo.share,
	}
	service := NewService(repo, nil, nil)
	defer service.Close()
	runtime := runtimeForHubTest(service.hub, "user-1", "session-1", time.Now())
	runtime.runtime.Stdin = &terminalWriteSpy{}
	runtime.buffer = newOutputRing(1024)
	service.hub.sessions[terminalRuntimeKey("user-1", "session-1")] = runtime
	handler := NewHandler(service)
	server := httptest.NewServer(http.HandlerFunc(handler.StreamShare))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/terminal/share?viewer_token=" + viewerToken
	headers := http.Header{}
	headers.Set("Origin", "http://203.0.113.118:7583")
	conn, response, err := websocket.DefaultDialer.Dial(wsURL, headers)
	if err != nil {
		status := 0
		if response != nil {
			status = response.StatusCode
		}
		t.Fatalf("dial share websocket with validated viewer token: %v status=%d", err, status)
	}
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ready event: %v", err)
	}
	if messageType != websocket.TextMessage || !strings.Contains(string(payload), `"readonly":true`) {
		t.Fatalf("expected readonly ready event, got type=%d payload=%s", messageType, payload)
	}
}

func TestHandlerStreamShareClosesWhenShareExpires(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	viewerToken := "viewer-token-value"
	expiresAt := time.Now().Add(40 * time.Millisecond)
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken("share-token"),
		ExpiresAt:         expiresAt,
	}}
	repo.viewerTokenCreated = model.TerminalShareViewerToken{
		ID:        "viewer-token-1",
		ShareID:   "share-1",
		TokenHash: hashShareToken(viewerToken),
		ExpiresAt: expiresAt,
		CreatedAt: time.Now(),
		Share:     repo.share,
	}
	service := NewService(repo, nil, nil)
	defer service.Close()
	runtime := runtimeForHubTest(service.hub, "user-1", "session-1", time.Now())
	runtime.buffer = newOutputRing(1024)
	service.hub.sessions[terminalRuntimeKey("user-1", "session-1")] = runtime
	handler := NewHandler(service)
	server := httptest.NewServer(http.HandlerFunc(handler.StreamShare))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/terminal/share?viewer_token=" + viewerToken
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial share websocket: %v", err)
	}
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read ready event: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read expiry exit event: %v", err)
	}
	if messageType != websocket.TextMessage || !strings.Contains(string(payload), `"type":"exit"`) || !strings.Contains(string(payload), "terminal share expired") {
		t.Fatalf("expected terminal share expiry exit event, got type=%d payload=%s", messageType, payload)
	}

	records := make([]map[string]any, 0)
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("decode share expiry log line %q: %v", line, err)
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
	expired := events["terminal_share_viewer_expired"]
	if expired == nil {
		t.Fatalf("expected terminal share viewer expired log, got %#v", records)
	}
	if expired["user_id"] != "user-1" ||
		expired["session_id"] != "session-1" ||
		expired["share_id"] != "share-1" ||
		expired["host_id"] != "host-1" ||
		expired["reason_kind"] != "share_expired" {
		t.Fatalf("unexpected share viewer expired log: %#v", expired)
	}
	if strings.Contains(output.String(), "terminal share expired") {
		t.Fatalf("structured share expiry log leaked raw close message: %s", output.String())
	}
}

func TestHandlerStreamShareUpdatesExpiryWhenShareIsExtendedAfterAttach(t *testing.T) {
	viewerToken := "viewer-token-value"
	initialExpiresAt := time.Now().Add(80 * time.Millisecond)
	extendedExpiresAt := time.Now().Add(500 * time.Millisecond)
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken("share-token"),
		ExpiresAt:         initialExpiresAt,
	}}
	repo.viewerTokenCreated = model.TerminalShareViewerToken{
		ID:        "viewer-token-1",
		ShareID:   "share-1",
		TokenHash: hashShareToken(viewerToken),
		ExpiresAt: initialExpiresAt,
		CreatedAt: time.Now(),
		Share:     repo.share,
	}
	service := NewService(repo, nil, nil)
	defer service.Close()
	runtime := runtimeForHubTest(service.hub, "user-1", "session-1", time.Now())
	runtime.buffer = newOutputRing(1024)
	service.hub.sessions[terminalRuntimeKey("user-1", "session-1")] = runtime
	handler := NewHandler(service)
	server := httptest.NewServer(http.HandlerFunc(handler.StreamShare))
	defer server.Close()

	previousCheckEvery := terminalShareAvailabilityCheckEvery
	terminalShareAvailabilityCheckEvery = 10 * time.Millisecond
	defer func() {
		terminalShareAvailabilityCheckEvery = previousCheckEvery
	}()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/terminal/share?viewer_token=" + viewerToken
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial share websocket: %v", err)
	}
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ready event: %v", err)
	}
	if messageType != websocket.TextMessage || !strings.Contains(string(payload), `"expires_at"`) {
		t.Fatalf("expected ready expiry event, got type=%d payload=%s", messageType, payload)
	}

	repo.setShareExpiresAt(extendedExpiresAt)

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	messageType, payload, err = conn.ReadMessage()
	if err != nil {
		t.Fatalf("read share update event: %v", err)
	}
	if messageType != websocket.TextMessage || !strings.Contains(string(payload), `"type":"share_update"`) || !strings.Contains(string(payload), extendedExpiresAt.Format(time.RFC3339Nano)) {
		t.Fatalf("expected share update expiry event, got type=%d payload=%s", messageType, payload)
	}

	if sleep := time.Until(initialExpiresAt.Add(80 * time.Millisecond)); sleep > 0 {
		time.Sleep(sleep)
	}
	_ = conn.SetReadDeadline(time.Now().Add(40 * time.Millisecond))
	messageType, payload, err = conn.ReadMessage()
	if err == nil && messageType == websocket.TextMessage && strings.Contains(string(payload), "terminal share expired") {
		t.Fatalf("share websocket expired at old deadline after extension: %s", payload)
	}
}

func TestHandlerStreamShareClosesWhenShareIsRevokedAfterAttach(t *testing.T) {
	viewerToken := "viewer-token-value"
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken("share-token"),
		PublicToken:       "share-token",
		ExpiresAt:         time.Now().Add(10 * time.Minute),
	}}
	repo.viewerTokenCreated = model.TerminalShareViewerToken{
		ID:        "viewer-token-1",
		ShareID:   "share-1",
		TokenHash: hashShareToken(viewerToken),
		ExpiresAt: time.Now().Add(5 * time.Minute),
		CreatedAt: time.Now(),
		Share:     repo.share,
	}
	service := NewService(repo, nil, nil)
	defer service.Close()
	runtime := runtimeForHubTest(service.hub, "user-1", "session-1", time.Now())
	runtime.buffer = newOutputRing(1024)
	service.hub.sessions[terminalRuntimeKey("user-1", "session-1")] = runtime
	handler := NewHandler(service)
	server := httptest.NewServer(http.HandlerFunc(handler.StreamShare))
	defer server.Close()

	previousCheckEvery := terminalShareAvailabilityCheckEvery
	terminalShareAvailabilityCheckEvery = 20 * time.Millisecond
	defer func() {
		terminalShareAvailabilityCheckEvery = previousCheckEvery
	}()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws/terminal/share?viewer_token=" + viewerToken
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial share websocket: %v", err)
	}
	defer conn.Close()

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := conn.ReadMessage(); err != nil {
		t.Fatalf("read ready event: %v", err)
	}
	revokedAt := time.Now()
	repo.setShareRevokedAt(revokedAt)

	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read revoke exit event: %v", err)
	}
	if messageType != websocket.TextMessage || !strings.Contains(string(payload), `"type":"exit"`) || !strings.Contains(string(payload), "terminal share revoked") {
		t.Fatalf("expected terminal share revoke exit event, got type=%d payload=%s", messageType, payload)
	}

	runtime.publish([]byte("fresh output after revoke"))
	_ = conn.SetReadDeadline(time.Now().Add(80 * time.Millisecond))
	if nextType, nextPayload, readErr := conn.ReadMessage(); readErr == nil && nextType == websocket.BinaryMessage {
		t.Fatalf("revoked websocket received output after exit: %q", string(nextPayload))
	}
}

func TestHandlerManageShareEndpoints(t *testing.T) {
	repo := &terminalRepoStub{share: model.TerminalShare{
		ID:                "share-1",
		UserID:            "user-1",
		TerminalSessionID: "session-1",
		HostID:            "host-1",
		TokenHash:         hashShareToken("share-token"),
		ExpiresAt:         time.Now().Add(10 * time.Minute),
	}}
	repo.accessLogs = []model.TerminalShareAccessLog{{
		ID:                "log-1",
		ShareID:           "share-1",
		TerminalSessionID: "session-1",
		Result:            string(model.AuditResultSuccess),
		AccessedAt:        time.Now(),
	}}
	service := NewService(repo, nil, nil)
	defer service.Close()
	handler := NewHandler(service)

	getReq := httptest.NewRequest(http.MethodGet, "/api/terminal/sessions/session-1/share", nil)
	getReq.SetPathValue("sessionId", "session-1")
	getReq = getReq.WithContext(auth.WithSession(getReq.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
	getRecorder := httptest.NewRecorder()
	handler.GetActiveShare(getRecorder, getReq)
	if getRecorder.Code != http.StatusOK {
		t.Fatalf("expected get 200, got %d body=%s", getRecorder.Code, getRecorder.Body.String())
	}

	extendReq := httptest.NewRequest(http.MethodPatch, "/api/terminal/shares/share-1", strings.NewReader(`{"expires_in_minutes":30}`))
	extendReq.SetPathValue("shareId", "share-1")
	extendReq = extendReq.WithContext(auth.WithSession(extendReq.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
	extendRecorder := httptest.NewRecorder()
	handler.ExtendShare(extendRecorder, extendReq)
	if extendRecorder.Code != http.StatusOK {
		t.Fatalf("expected extend 200, got %d body=%s", extendRecorder.Code, extendRecorder.Body.String())
	}

	logReq := httptest.NewRequest(http.MethodGet, "/api/terminal/shares/share-1/access-logs", nil)
	logReq.SetPathValue("shareId", "share-1")
	logReq = logReq.WithContext(auth.WithSession(logReq.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
	logRecorder := httptest.NewRecorder()
	handler.ListShareAccessLogs(logRecorder, logReq)
	if logRecorder.Code != http.StatusOK || !strings.Contains(logRecorder.Body.String(), `"total":1`) {
		t.Fatalf("expected access log payload, got %d body=%s", logRecorder.Code, logRecorder.Body.String())
	}

	revokeReq := httptest.NewRequest(http.MethodDelete, "/api/terminal/shares/share-1", nil)
	revokeReq.SetPathValue("shareId", "share-1")
	revokeReq = revokeReq.WithContext(auth.WithSession(revokeReq.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
	revokeRecorder := httptest.NewRecorder()
	handler.RevokeShare(revokeRecorder, revokeReq)
	if revokeRecorder.Code != http.StatusOK {
		t.Fatalf("expected revoke 200, got %d body=%s", revokeRecorder.Code, revokeRecorder.Body.String())
	}
}

func TestWriteTerminalErrorIncludesConnectionLog(t *testing.T) {
	handler := NewHandler(nil)
	occurredAt := time.Date(2026, 5, 3, 22, 34, 32, 0, time.UTC)
	recorder := httptest.NewRecorder()

	handler.writeTerminalError(recorder, &ConnectionFailedError{
		Message: "TCP connection refused",
		ConnectionLog: []host.ConnectionLogEntry{
			{Level: "info", Message: "Connecting to 203.0.113.227 port 221", OccurredAt: occurredAt},
			{Level: "error", Message: "Connection error: connect ECONNREFUSED 203.0.113.227:221", OccurredAt: occurredAt},
		},
	})

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", recorder.Code)
	}

	var payload struct {
		Code          string                    `json:"code"`
		Message       string                    `json:"message"`
		ConnectionLog []host.ConnectionLogEntry `json:"connection_log"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Code != "TERMINAL_BOOTSTRAP_CONNECT_FAILED" || payload.Message != "TCP connection refused" {
		t.Fatalf("unexpected error payload: %#v", payload)
	}
	if len(payload.ConnectionLog) != 2 {
		t.Fatalf("expected connection log entries, got %#v", payload.ConnectionLog)
	}
	if payload.ConnectionLog[1].Message != "Connection error: connect ECONNREFUSED 203.0.113.227:221" {
		t.Fatalf("unexpected connection log: %#v", payload.ConnectionLog)
	}
}

func TestInitialDirectoryCommandQuotesRemotePath(t *testing.T) {
	command := initialDirectoryCommand([]string{"/srv/app's current"})
	want := "if [ -d '/srv/app'\\''s current' ]; then cd -- '/srv/app'\\''s current'; fi\n"
	if command != want {
		t.Fatalf("unexpected command %q, want %q", command, want)
	}
}

func TestInitialDirectoryCommandFallsBackAcrossCandidatePaths(t *testing.T) {
	command := initialDirectoryCommand([]string{"/srv/missing", "/home/deploy", "/"})
	want := "if [ -d '/srv/missing' ]; then cd -- '/srv/missing'; elif [ -d '/home/deploy' ]; then cd -- '/home/deploy'; elif [ -d '/' ]; then cd -- '/'; fi\n"
	if command != want {
		t.Fatalf("unexpected command %q, want %q", command, want)
	}
}

func TestNormalizeInitialDirectoryRejectsUnsafePath(t *testing.T) {
	if _, err := normalizeInitialDirectories([]string{"/tmp\nwhoami"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for newline path, got %v", err)
	}
}
