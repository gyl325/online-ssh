package terminal

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"golang.org/x/crypto/bcrypt"
)

const (
	defaultShareViewerTokenTTL = 5 * time.Minute
	minShareDurationMinutes    = 2
	maxShareDurationMinutes    = 24 * 60
	maxShareAccesses           = 1000
	maxSharePasswordLength     = 128
	maxShareSensitiveLength    = 500
)

var (
	ErrShareNotAvailable    = errors.New("terminal share not available")
	ErrSharePasswordInvalid = errors.New("terminal share password invalid")
	ErrShareAccessLimit     = errors.New("terminal share access limit reached")
)

type CreateTerminalShareRecordInput struct {
	UserID            string
	TerminalSessionID string
	HostID            string
	TokenHash         string
	PublicToken       string
	PasswordHash      *string
	ExpiresAt         time.Time
	MaxAccesses       *int
	SensitivePrompt   string
}

type CreateTerminalShareViewerTokenInput struct {
	ShareID   string
	TokenHash string
	ExpiresAt time.Time
}

type CreateTerminalShareInput struct {
	UserID           string
	SessionID        string
	ExpiresInMinutes int
	MaxAccesses      *int
	Password         string
	SensitivePrompt  string
	PublicBaseURL    string
}

type OpenTerminalShareAccessInput struct {
	Token            string
	Password         string
	IdempotencyKey   string
	ClientIP         string
	UserAgent        string
	WebSocketBaseURL string
}

type ExtendTerminalShareInput struct {
	UserID           string
	ShareID          string
	ExpiresInMinutes int
}

type TerminalShareInfo struct {
	ID                string     `json:"id"`
	TerminalSessionID string     `json:"terminal_session_id"`
	HostID            string     `json:"host_id"`
	ExpiresAt         time.Time  `json:"expires_at"`
	RevokedAt         *time.Time `json:"revoked_at,omitempty"`
	MaxAccesses       *int       `json:"max_accesses"`
	AccessCount       int        `json:"access_count"`
	PasswordRequired  bool       `json:"password_required"`
	SensitivePrompt   string     `json:"sensitive_prompt"`
	ViewerCount       int        `json:"viewer_count"`
	URL               string     `json:"url,omitempty"`
}

type CreateTerminalShareResult struct {
	Share TerminalShareInfo `json:"share"`
	Token string            `json:"token"`
}

type TerminalShareWebSocketInfo struct {
	URL      string `json:"url"`
	Protocol string `json:"protocol"`
}

type OpenTerminalShareAccessResult struct {
	Share                TerminalShareInfo          `json:"share"`
	ViewerToken          string                     `json:"viewer_token"`
	ViewerTokenExpiresAt time.Time                  `json:"viewer_token_expires_at"`
	WebSocket            TerminalShareWebSocketInfo `json:"websocket"`
}

type TerminalShareAccessLogListResult struct {
	Items    []model.TerminalShareAccessLog `json:"items"`
	Page     int                            `json:"page"`
	PageSize int                            `json:"page_size"`
	Total    int                            `json:"total"`
}

type terminalShareOpenAccessIdempotencyStore struct {
	mu        sync.Mutex
	ttl       time.Duration
	completed map[string]terminalShareOpenAccessIdempotencyEntry
	inFlight  map[string]*terminalShareOpenAccessIdempotencyFlight
}

type terminalShareOpenAccessIdempotencyEntry struct {
	result    OpenTerminalShareAccessResult
	expiresAt time.Time
}

type terminalShareOpenAccessIdempotencyFlight struct {
	done   chan struct{}
	result OpenTerminalShareAccessResult
	err    error
}

func newTerminalShareOpenAccessIdempotencyStore(ttl time.Duration) *terminalShareOpenAccessIdempotencyStore {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &terminalShareOpenAccessIdempotencyStore{
		ttl:       ttl,
		completed: map[string]terminalShareOpenAccessIdempotencyEntry{},
		inFlight:  map[string]*terminalShareOpenAccessIdempotencyFlight{},
	}
}

func (s *terminalShareOpenAccessIdempotencyStore) Do(key string, now time.Time, fn func() (OpenTerminalShareAccessResult, error)) (OpenTerminalShareAccessResult, error) {
	if s == nil || strings.TrimSpace(key) == "" {
		return fn()
	}
	s.mu.Lock()
	s.pruneLocked(now)
	if entry, ok := s.completed[key]; ok && entry.expiresAt.After(now) {
		result := entry.result
		s.mu.Unlock()
		return result, nil
	}
	if flight, ok := s.inFlight[key]; ok {
		done := flight.done
		s.mu.Unlock()
		<-done
		return flight.result, flight.err
	}
	flight := &terminalShareOpenAccessIdempotencyFlight{done: make(chan struct{})}
	s.inFlight[key] = flight
	s.mu.Unlock()

	result, err := fn()

	s.mu.Lock()
	flight.result = result
	flight.err = err
	if err == nil {
		expiresAt := now.Add(s.ttl)
		if !result.ViewerTokenExpiresAt.IsZero() && result.ViewerTokenExpiresAt.Before(expiresAt) {
			expiresAt = result.ViewerTokenExpiresAt
		}
		if expiresAt.After(time.Now()) {
			s.completed[key] = terminalShareOpenAccessIdempotencyEntry{
				result:    result,
				expiresAt: expiresAt,
			}
		}
	}
	delete(s.inFlight, key)
	close(flight.done)
	s.mu.Unlock()

	return result, err
}

func (s *terminalShareOpenAccessIdempotencyStore) pruneLocked(now time.Time) {
	for key, entry := range s.completed {
		if !entry.expiresAt.After(now) {
			delete(s.completed, key)
		}
	}
}

func terminalShareOpenAccessIdempotencyKey(shareID string, input OpenTerminalShareAccessInput) string {
	idempotencyKey := normalizeTerminalShareOpenAccessIdempotencyKey(input.IdempotencyKey)
	if shareID == "" || idempotencyKey == "" {
		return ""
	}
	return strings.Join([]string{
		shareID,
		hashShareToken(idempotencyKey),
		hashShareToken(input.Password),
		hashShareToken(input.WebSocketBaseURL),
	}, "\x00")
}

func normalizeTerminalShareOpenAccessIdempotencyKey(value string) string {
	key := strings.TrimSpace(value)
	if key == "" || len(key) > 160 {
		return ""
	}
	return key
}

func (s *Service) CreateShare(ctx context.Context, input CreateTerminalShareInput) (CreateTerminalShareResult, error) {
	userID := strings.TrimSpace(input.UserID)
	sessionID := strings.TrimSpace(input.SessionID)
	if userID == "" || sessionID == "" || input.ExpiresInMinutes < minShareDurationMinutes || input.ExpiresInMinutes > maxShareDurationMinutes {
		return CreateTerminalShareResult{}, ErrInvalidInput
	}
	if input.MaxAccesses != nil && (*input.MaxAccesses <= 0 || *input.MaxAccesses > maxShareAccesses) {
		return CreateTerminalShareResult{}, ErrInvalidInput
	}
	if utf8.RuneCountInString(input.Password) > maxSharePasswordLength || utf8.RuneCountInString(input.SensitivePrompt) > maxShareSensitiveLength {
		return CreateTerminalShareResult{}, ErrInvalidInput
	}
	if s.repo == nil {
		return CreateTerminalShareResult{}, ErrInvalidInput
	}

	session, err := s.repo.GetSessionByID(ctx, userID, sessionID)
	if err != nil {
		return CreateTerminalShareResult{}, err
	}
	if session.Status != string(model.TerminalSessionStatusConnected) {
		return CreateTerminalShareResult{}, ErrInvalidState
	}

	token, err := randomShareToken()
	if err != nil {
		return CreateTerminalShareResult{}, err
	}
	var passwordHash *string
	if strings.TrimSpace(input.Password) != "" {
		hashed, hashErr := hashSharePassword(input.Password)
		if hashErr != nil {
			return CreateTerminalShareResult{}, hashErr
		}
		passwordHash = &hashed
	}

	share, err := s.repo.CreateTerminalShare(ctx, CreateTerminalShareRecordInput{
		UserID:            userID,
		TerminalSessionID: session.ID,
		HostID:            session.HostID,
		TokenHash:         hashShareToken(token),
		PublicToken:       token,
		PasswordHash:      passwordHash,
		ExpiresAt:         time.Now().Add(time.Duration(input.ExpiresInMinutes) * time.Minute),
		MaxAccesses:       cloneInt(input.MaxAccesses),
		SensitivePrompt:   strings.TrimSpace(input.SensitivePrompt),
	})
	if err != nil {
		return CreateTerminalShareResult{}, err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:            userID,
		TerminalSessionID: stringPtr(session.ID),
		EventType:         "terminal_share_create",
		ResourceType:      stringPtr("terminal_share"),
		ResourceID:        stringPtr(share.ID),
		TargetHostID:      stringPtr(session.HostID),
		Result:            string(model.AuditResultSuccess),
		Message:           stringPtr("terminal share created"),
	})

	return CreateTerminalShareResult{
		Share: s.terminalShareInfo(share, token, input.PublicBaseURL),
		Token: token,
	}, nil
}

func (s *Service) OpenShareAccess(ctx context.Context, input OpenTerminalShareAccessInput) (OpenTerminalShareAccessResult, error) {
	token := strings.TrimSpace(input.Token)
	if token == "" || s.repo == nil {
		return OpenTerminalShareAccessResult{}, ErrInvalidInput
	}
	now := time.Now()
	share, err := s.repo.GetTerminalShareByTokenHash(ctx, hashShareToken(token), now)
	if err != nil {
		if db.IsNotFound(err) {
			return OpenTerminalShareAccessResult{}, ErrShareNotAvailable
		}
		return OpenTerminalShareAccessResult{}, err
	}
	if share.RevokedAt != nil || !share.ExpiresAt.After(now) {
		s.recordShareAccess(ctx, share, input, string(model.AuditResultFailure), "unavailable")
		return OpenTerminalShareAccessResult{}, ErrShareNotAvailable
	}

	open := func() (OpenTerminalShareAccessResult, error) {
		currentShare := share
		if currentShare.MaxAccesses != nil && currentShare.AccessCount >= *currentShare.MaxAccesses {
			s.recordShareAccess(ctx, currentShare, input, string(model.AuditResultFailure), "access_limit")
			return OpenTerminalShareAccessResult{}, ErrShareAccessLimit
		}
		if currentShare.PasswordHash != nil && !verifySharePassword(*currentShare.PasswordHash, input.Password) {
			s.recordShareAccess(ctx, currentShare, input, string(model.AuditResultFailure), "invalid_password")
			return OpenTerminalShareAccessResult{}, ErrSharePasswordInvalid
		}

		currentShare, err = s.repo.IncrementTerminalShareAccess(ctx, currentShare.ID, now)
		if err != nil {
			return OpenTerminalShareAccessResult{}, err
		}
		viewerToken, err := randomShareToken()
		if err != nil {
			return OpenTerminalShareAccessResult{}, err
		}
		expiresAt := now.Add(defaultShareViewerTokenTTL)
		if currentShare.ExpiresAt.Before(expiresAt) {
			expiresAt = currentShare.ExpiresAt
		}
		if _, err := s.repo.CreateTerminalShareViewerToken(ctx, CreateTerminalShareViewerTokenInput{
			ShareID:   currentShare.ID,
			TokenHash: hashShareToken(viewerToken),
			ExpiresAt: expiresAt,
		}); err != nil {
			return OpenTerminalShareAccessResult{}, err
		}
		s.recordShareAccess(ctx, currentShare, input, string(model.AuditResultSuccess), "")

		return OpenTerminalShareAccessResult{
			Share:                s.terminalShareInfo(currentShare, "", ""),
			ViewerToken:          viewerToken,
			ViewerTokenExpiresAt: expiresAt,
			WebSocket: TerminalShareWebSocketInfo{
				URL:      buildTerminalShareWebSocketURL(input.WebSocketBaseURL, viewerToken),
				Protocol: "terminal-share.v1",
			},
		}, nil
	}

	if s.shareOpenAccess != nil {
		if key := terminalShareOpenAccessIdempotencyKey(share.ID, input); key != "" {
			return s.shareOpenAccess.Do(key, now, open)
		}
	}
	return open()
}

func (s *Service) GetActiveShare(ctx context.Context, userID, sessionID string) (TerminalShareInfo, error) {
	userID = strings.TrimSpace(userID)
	sessionID = strings.TrimSpace(sessionID)
	if userID == "" || sessionID == "" || s.repo == nil {
		return TerminalShareInfo{}, ErrInvalidInput
	}
	share, err := s.repo.GetActiveTerminalShare(ctx, userID, sessionID, time.Now())
	if err != nil {
		return TerminalShareInfo{}, err
	}
	return s.terminalShareInfo(share, "", ""), nil
}

func (s *Service) ExtendShare(ctx context.Context, input ExtendTerminalShareInput) (TerminalShareInfo, error) {
	userID := strings.TrimSpace(input.UserID)
	shareID := strings.TrimSpace(input.ShareID)
	if userID == "" || shareID == "" || input.ExpiresInMinutes < minShareDurationMinutes || input.ExpiresInMinutes > maxShareDurationMinutes || s.repo == nil {
		return TerminalShareInfo{}, ErrInvalidInput
	}
	share, err := s.repo.ExtendTerminalShare(ctx, userID, shareID, time.Now().Add(time.Duration(input.ExpiresInMinutes)*time.Minute))
	if err != nil {
		return TerminalShareInfo{}, err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:            userID,
		TerminalSessionID: stringPtr(share.TerminalSessionID),
		EventType:         "terminal_share_extend",
		ResourceType:      stringPtr("terminal_share"),
		ResourceID:        stringPtr(share.ID),
		TargetHostID:      stringPtr(share.HostID),
		Result:            string(model.AuditResultSuccess),
		Message:           stringPtr("terminal share extended"),
	})
	return s.terminalShareInfo(share, "", ""), nil
}

func (s *Service) RevokeShare(ctx context.Context, userID, shareID string) (TerminalShareInfo, error) {
	userID = strings.TrimSpace(userID)
	shareID = strings.TrimSpace(shareID)
	if userID == "" || shareID == "" || s.repo == nil {
		return TerminalShareInfo{}, ErrInvalidInput
	}
	share, err := s.repo.RevokeTerminalShare(ctx, userID, shareID, time.Now())
	if err != nil {
		return TerminalShareInfo{}, err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:            userID,
		TerminalSessionID: stringPtr(share.TerminalSessionID),
		EventType:         "terminal_share_revoke",
		ResourceType:      stringPtr("terminal_share"),
		ResourceID:        stringPtr(share.ID),
		TargetHostID:      stringPtr(share.HostID),
		Result:            string(model.AuditResultSuccess),
		Message:           stringPtr("terminal share revoked"),
	})
	if s.hub != nil {
		s.hub.CloseShareViewers(userID, share.TerminalSessionID, share.ID, "terminal share revoked")
		s.hub.CloseShareViewersByShareID(share.ID, "terminal share revoked")
	}
	return s.terminalShareInfo(share, "", ""), nil
}

func (s *Service) ListShareAccessLogs(ctx context.Context, userID, shareID string, page, pageSize int) (TerminalShareAccessLogListResult, error) {
	userID = strings.TrimSpace(userID)
	shareID = strings.TrimSpace(shareID)
	if userID == "" || shareID == "" || page < 1 || pageSize < 1 || pageSize > maxRecordingPageSize || s.repo == nil {
		return TerminalShareAccessLogListResult{}, ErrInvalidInput
	}
	offset := (page - 1) * pageSize
	items, total, err := s.repo.ListTerminalShareAccessLogs(ctx, userID, shareID, pageSize, offset)
	if err != nil {
		return TerminalShareAccessLogListResult{}, err
	}
	return TerminalShareAccessLogListResult{
		Items:    items,
		Page:     page,
		PageSize: pageSize,
		Total:    total,
	}, nil
}

func (s *Service) AttachShareViewer(ctx context.Context, viewerToken string) (*TerminalShareAttachment, error) {
	if strings.TrimSpace(viewerToken) == "" || s.repo == nil || s.hub == nil {
		return nil, ErrInvalidInput
	}
	record, err := s.repo.GetTerminalShareViewerTokenByHash(ctx, hashShareToken(viewerToken), time.Now())
	if err != nil {
		if db.IsNotFound(err) {
			return nil, ErrShareNotAvailable
		}
		return nil, err
	}
	share := record.Share
	if share.ID == "" || share.RevokedAt != nil || !share.ExpiresAt.After(time.Now()) {
		return nil, ErrShareNotAvailable
	}
	attachment, err := s.hub.AttachViewer(share.UserID, share.TerminalSessionID, share.ID)
	if err != nil {
		return nil, err
	}
	attachment.ExpiresAt = share.ExpiresAt
	return attachment, nil
}

func (s *Service) TerminalShareUnavailableReason(ctx context.Context, userID, shareID string) (string, error) {
	reason, _, err := s.TerminalShareAvailability(ctx, userID, shareID)
	return reason, err
}

func (s *Service) TerminalShareAvailability(ctx context.Context, userID, shareID string) (string, time.Time, error) {
	userID = strings.TrimSpace(userID)
	shareID = strings.TrimSpace(shareID)
	if userID == "" || shareID == "" || s.repo == nil {
		return "terminal share is not available", time.Time{}, nil
	}
	share, err := s.repo.GetTerminalShareByID(ctx, userID, shareID)
	if err != nil {
		if db.IsNotFound(err) {
			return "terminal share is not available", time.Time{}, nil
		}
		return "", time.Time{}, err
	}
	if share.RevokedAt != nil {
		return "terminal share revoked", share.ExpiresAt, nil
	}
	if !share.ExpiresAt.After(time.Now()) {
		return "terminal share expired", share.ExpiresAt, nil
	}
	return "", share.ExpiresAt, nil
}

func (s *Service) terminalShareInfo(share model.TerminalShare, token string, publicBaseURL string) TerminalShareInfo {
	viewerCount := 0
	if s.hub != nil {
		viewerCount = s.hub.ViewerCount(share.UserID, share.TerminalSessionID, share.ID)
	}
	publicToken := strings.TrimSpace(token)
	if publicToken == "" {
		publicToken = strings.TrimSpace(share.PublicToken)
	}
	return TerminalShareInfo{
		ID:                share.ID,
		TerminalSessionID: share.TerminalSessionID,
		HostID:            share.HostID,
		ExpiresAt:         share.ExpiresAt,
		RevokedAt:         share.RevokedAt,
		MaxAccesses:       cloneInt(share.MaxAccesses),
		AccessCount:       share.AccessCount,
		PasswordRequired:  share.PasswordHash != nil,
		SensitivePrompt:   share.SensitivePrompt,
		ViewerCount:       viewerCount,
		URL:               buildTerminalShareURL(publicBaseURL, publicToken),
	}
}

func (s *Service) recordShareAccess(ctx context.Context, share model.TerminalShare, input OpenTerminalShareAccessInput, result, reason string) {
	if s.repo == nil || share.ID == "" {
		return
	}
	var failureReason *string
	if strings.TrimSpace(reason) != "" {
		failureReason = stringPtr(strings.TrimSpace(reason))
	}
	_ = s.repo.CreateTerminalShareAccessLog(ctx, model.TerminalShareAccessLog{
		ShareID:           share.ID,
		TerminalSessionID: share.TerminalSessionID,
		ClientIP:          stringPtrOrNil(strings.TrimSpace(input.ClientIP)),
		UserAgent:         stringPtrOrNil(strings.TrimSpace(input.UserAgent)),
		Result:            result,
		FailureReason:     failureReason,
		AccessedAt:        time.Now(),
	})
}

func randomShareToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func hashShareToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func hashSharePassword(password string) (string, error) {
	raw, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func verifySharePassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func buildTerminalShareURL(baseURL, token string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.TrimSpace(token) == "" {
		return ""
	}
	path := "/share/terminal/" + strings.TrimSpace(token)
	if base == "" {
		return path
	}
	return base + path
}

func buildTerminalShareWebSocketURL(baseURL, viewerToken string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" || strings.TrimSpace(viewerToken) == "" {
		return ""
	}
	return base + "/ws/terminal/share?viewer_token=" + strings.TrimSpace(viewerToken)
}

func cloneInt(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}
