package terminal

import (
	"strings"
	"sync"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
)

type temporarySessionStore struct {
	mu    sync.RWMutex
	items map[string]model.TerminalSession
}

func newTemporarySessionStore() *temporarySessionStore {
	return &temporarySessionStore{items: map[string]model.TerminalSession{}}
}

func (s *temporarySessionStore) Set(session model.TerminalSession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[temporarySessionKey(session.UserID, session.ID)] = session
}

func (s *temporarySessionStore) Get(userID, sessionID string) (model.TerminalSession, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.items[temporarySessionKey(userID, sessionID)]
	return item, ok
}

func (s *temporarySessionStore) UpdateStatus(userID, sessionID, status string, endedAt *time.Time) (model.TerminalSession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := temporarySessionKey(userID, sessionID)
	item, ok := s.items[key]
	if !ok {
		return model.TerminalSession{}, false
	}
	item.Status = status
	item.EndedAt = endedAt
	item.UpdatedAt = time.Now()
	s.items[key] = item
	return item, true
}

func temporarySessionKey(userID, sessionID string) string {
	return strings.TrimSpace(userID) + "\x00" + strings.TrimSpace(sessionID)
}
