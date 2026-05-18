package terminal

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

type terminalAttachToken struct {
	UserID    string
	SessionID string
	ExpiresAt time.Time
}

type terminalAttachTokenStore struct {
	mu    sync.Mutex
	ttl   time.Duration
	items map[string]terminalAttachToken
}

func newTerminalAttachTokenStore(ttl time.Duration) *terminalAttachTokenStore {
	if ttl <= 0 {
		ttl = defaultTerminalAttachTokenTTL
	}
	return &terminalAttachTokenStore{
		ttl:   ttl,
		items: map[string]terminalAttachToken{},
	}
}

func (s *Service) NewAttachToken(userID, sessionID string) (string, error) {
	if s == nil || s.attachTokens == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return "", ErrInvalidInput
	}
	return s.attachTokens.Issue(userID, sessionID)
}

func (s *Service) ValidateAttachToken(userID, sessionID, token string) bool {
	if s == nil || s.attachTokens == nil {
		return false
	}
	return s.attachTokens.Validate(userID, sessionID, token)
}

func (s *terminalAttachTokenStore) Issue(userID, sessionID string) (string, error) {
	userID = strings.TrimSpace(userID)
	sessionID = strings.TrimSpace(sessionID)
	if userID == "" || sessionID == "" {
		return "", ErrInvalidInput
	}
	token, err := randomAttachToken()
	if err != nil {
		return "", err
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleteExpiredLocked(now)
	s.items[hashAttachToken(token)] = terminalAttachToken{
		UserID:    userID,
		SessionID: sessionID,
		ExpiresAt: now.Add(s.ttl),
	}
	return token, nil
}

func (s *terminalAttachTokenStore) Validate(userID, sessionID, token string) bool {
	userID = strings.TrimSpace(userID)
	sessionID = strings.TrimSpace(sessionID)
	token = strings.TrimSpace(token)
	if userID == "" || sessionID == "" || token == "" {
		return false
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleteExpiredLocked(now)
	item, ok := s.items[hashAttachToken(token)]
	if !ok || now.After(item.ExpiresAt) {
		return false
	}
	return item.UserID == userID && item.SessionID == sessionID
}

func (s *terminalAttachTokenStore) deleteExpiredLocked(now time.Time) {
	for hash, item := range s.items {
		if !now.Before(item.ExpiresAt) {
			delete(s.items, hash)
		}
	}
}

func randomAttachToken() (string, error) {
	var buf [32]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf[:]), nil
}

func hashAttachToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}
