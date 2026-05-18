package terminal

import (
	"context"
	"errors"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/model"
)

func (s *Service) SetKeepAlive(ctx context.Context, userID, sessionID string, enabled bool) (SessionInfo, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return SessionInfo{}, ErrInvalidInput
	}
	if item, ok := s.temporarySessions.Get(userID, sessionID); ok {
		state, err := s.hub.SetKeepAlive(userID, sessionID, enabled)
		if err != nil {
			if errors.Is(err, ErrRuntimeNotFound) {
				return SessionInfo{}, ErrInvalidState
			}
			return SessionInfo{}, err
		}
		return sessionInfoResponseWithRuntimeState(item, state, true), nil
	}
	if s.repo == nil || s.hub == nil {
		return SessionInfo{}, ErrInvalidInput
	}

	item, err := s.repo.GetSessionByID(ctx, userID, sessionID)
	if err != nil {
		return SessionInfo{}, err
	}
	state, err := s.hub.SetKeepAlive(userID, sessionID, enabled)
	if err != nil {
		if errors.Is(err, ErrRuntimeNotFound) {
			return SessionInfo{}, ErrInvalidState
		}
		return SessionInfo{}, err
	}

	eventType := "terminal_session_keepalive_disabled"
	if enabled {
		eventType = "terminal_session_keepalive_enabled"
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:            userID,
		TerminalSessionID: stringPtr(item.ID),
		EventType:         eventType,
		ResourceType:      stringPtr("terminal_session"),
		ResourceID:        stringPtr(item.ID),
		TargetHostID:      stringPtr(item.HostID),
		Result:            string(model.AuditResultSuccess),
		Message:           stringPtr(eventType),
	})

	return sessionInfoResponseWithRuntimeState(item, state, true), nil
}
