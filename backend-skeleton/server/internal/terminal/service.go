package terminal

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/llm"
	"github.com/example/online-ssh-platform/server/internal/model"
)

const (
	defaultTerminalRows           = 36
	defaultTerminalCols           = 120
	maxInitialDirectoryLength     = 4096
	defaultTerminalAttachTokenTTL = 2 * time.Minute
)

var (
	ErrInvalidInput = errors.New("invalid input")
	ErrInvalidState = errors.New("invalid state")
)

type Service struct {
	repo               Repository
	recordingRepo      RecordingRepository
	hostService        *host.Service
	audit              AuditRecorder
	hub                *TerminalHub
	recordingCollector *RecordingCollector
	temporarySessions  *temporarySessionStore
	shareOpenAccess    *terminalShareOpenAccessIdempotencyStore
	attachTokens       *terminalAttachTokenStore
	commandGenerator   CommandGenerator
}

type ServiceOptions struct {
	KeepAliveTTL       time.Duration
	MaxSessionsPerUser int
	MaxSessionsTotal   int
	RecordingEncryptor credential.Encryptor
	RecordingQueueSize int
	SettingsProvider   func() TerminalHubRuntimeSettings
	CommandGenerator   CommandGenerator
}

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

type CommandGenerator interface {
	GenerateCommand(ctx context.Context, input llm.CommandRequest) (llm.CommandGeneration, error)
}

type SessionBootstrapInput struct {
	UserID           string `json:"-"`
	HostID           string `json:"host_id"`
	Rows             int    `json:"rows"`
	Cols             int    `json:"cols"`
	RemoteAddr       string `json:"-"`
	WebSocketBaseURL string `json:"-"`
}

type QuickConnectSessionInput struct {
	UserID           string  `json:"-"`
	CredentialID     *string `json:"credential_id"`
	Host             string  `json:"host"`
	Port             int     `json:"port"`
	Username         string  `json:"username"`
	AuthType         string  `json:"auth_type"`
	Password         string  `json:"password"`
	PrivateKey       string  `json:"private_key"`
	Passphrase       string  `json:"passphrase"`
	KeyType          string  `json:"key_type"`
	Rows             int     `json:"rows"`
	Cols             int     `json:"cols"`
	RemoteAddr       string  `json:"-"`
	WebSocketBaseURL string  `json:"-"`
}

type SessionBootstrapResult struct {
	Session       SessionInfo               `json:"session"`
	WebSocket     TerminalWebSocketInfo     `json:"websocket"`
	ConnectionLog []host.ConnectionLogEntry `json:"connection_log,omitempty"`
}

type SessionInfo struct {
	ID             string     `json:"id"`
	HostID         string     `json:"host_id"`
	Status         string     `json:"status"`
	StartedAt      time.Time  `json:"started_at"`
	EndedAt        *time.Time `json:"ended_at"`
	Attached       *bool      `json:"attached,omitempty"`
	DetachedAt     *time.Time `json:"detached_at,omitempty"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	KeepAliveUntil *time.Time `json:"keep_alive_until,omitempty"`
	AttachToken    *string    `json:"attach_token,omitempty"`
}

type TerminalWebSocketInfo struct {
	URL      string  `json:"url"`
	Protocol string  `json:"protocol"`
	Token    *string `json:"token"`
}

type ConnectionFailedError struct {
	Message       string
	ConnectionLog []host.ConnectionLogEntry
}

func (e *ConnectionFailedError) Error() string {
	return e.Message
}

func NewService(repo Repository, hostService *host.Service, audit AuditRecorder) *Service {
	return NewServiceWithOptions(repo, hostService, audit, ServiceOptions{})
}

func NewServiceWithOptions(repo Repository, hostService *host.Service, audit AuditRecorder, options ServiceOptions) *Service {
	recordingRepo, _ := repo.(RecordingRepository)
	service := &Service{
		repo:              repo,
		recordingRepo:     recordingRepo,
		hostService:       hostService,
		audit:             audit,
		temporarySessions: newTemporarySessionStore(),
		shareOpenAccess:   newTerminalShareOpenAccessIdempotencyStore(30 * time.Second),
		attachTokens:      newTerminalAttachTokenStore(defaultTerminalAttachTokenTTL),
		commandGenerator:  options.CommandGenerator,
	}
	if recordingRepo != nil && options.RecordingEncryptor != nil {
		service.recordingCollector = NewRecordingCollector(recordingRepo, options.RecordingEncryptor, options.RecordingQueueSize)
	}
	service.hub = NewTerminalHub(TerminalHubOptions{
		KeepAliveTTL:       options.KeepAliveTTL,
		MaxSessionsPerUser: options.MaxSessionsPerUser,
		MaxSessionsTotal:   options.MaxSessionsTotal,
		SettingsProvider:   options.SettingsProvider,
	}, func(userID, sessionID string, status model.TerminalSessionStatus, message string) {
		_, _ = service.FinishRuntime(context.Background(), userID, sessionID, status, message)
	})
	return service
}

func (s *Service) GenerateCommand(ctx context.Context, userID string, input llm.CommandRequest) (llm.CommandGeneration, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(input.Prompt) == "" {
		return llm.CommandGeneration{}, ErrInvalidInput
	}
	if s == nil || s.commandGenerator == nil {
		return llm.CommandGeneration{}, ErrInvalidState
	}
	input.Prompt = strings.TrimSpace(input.Prompt)
	input.HostLabel = strings.TrimSpace(input.HostLabel)
	input.ShellHint = strings.TrimSpace(input.ShellHint)
	input.WorkingDirectory = strings.TrimSpace(input.WorkingDirectory)
	input.SystemInfo = strings.TrimSpace(input.SystemInfo)
	return s.commandGenerator.GenerateCommand(ctx, input)
}

func (s *Service) Close() {
	if s == nil {
		return
	}
	if s.hub != nil {
		s.hub.Close()
	}
	if s.recordingCollector != nil {
		s.recordingCollector.Close()
	}
}

func normalizeTerminalSize(rows, cols int) (int, int, error) {
	if rows == 0 {
		rows = defaultTerminalRows
	}
	if cols == 0 {
		cols = defaultTerminalCols
	}
	if rows < 5 || rows > 200 || cols < 20 || cols > 500 {
		return 0, 0, ErrInvalidInput
	}
	return rows, cols, nil
}

func buildTerminalWebSocketURL(baseURL, sessionID string, rows, cols int, attachToken string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return ""
	}
	result := base + "/ws/terminal?session_id=" + sessionID + "&rows=" + fmtInt(rows) + "&cols=" + fmtInt(cols)
	if strings.TrimSpace(attachToken) != "" {
		result += "&attach_token=" + attachToken
	}
	return result
}

func sessionInfoResponse(item model.TerminalSession) SessionInfo {
	return SessionInfo{
		ID:        item.ID,
		HostID:    item.HostID,
		Status:    item.Status,
		StartedAt: item.StartedAt,
		EndedAt:   item.EndedAt,
	}
}

func sessionInfoResponseWithRuntimeState(item model.TerminalSession, state RuntimeState, ok bool) SessionInfo {
	response := sessionInfoResponse(item)
	if !ok {
		return response
	}
	response.Attached = boolPtr(state.Attached)
	response.DetachedAt = state.DetachedAt
	response.ExpiresAt = state.ExpiresAt
	response.KeepAliveUntil = state.KeepAliveUntil
	return response
}

func (s *Service) recordAudit(ctx context.Context, log model.AuditLog) {
	if s.audit == nil {
		return
	}
	_ = s.audit.Record(ctx, log)
}

func fmtInt(value int) string {
	return strconv.Itoa(value)
}

func stringPtr(value string) *string {
	return &value
}

func boolPtr(value bool) *bool {
	return &value
}

func stringPtrOrNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
