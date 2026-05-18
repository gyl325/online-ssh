package terminal

import (
	"context"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/model"
)

func (s *Service) GetSession(ctx context.Context, userID, sessionID string) (model.TerminalSession, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return model.TerminalSession{}, ErrInvalidInput
	}
	if item, ok := s.temporarySessions.Get(userID, sessionID); ok {
		return item, nil
	}
	if s.repo == nil {
		return model.TerminalSession{}, ErrInvalidInput
	}
	return s.repo.GetSessionByID(ctx, userID, sessionID)
}

func (s *Service) RuntimeState(userID, sessionID string) (RuntimeState, bool) {
	if s == nil || s.hub == nil {
		return RuntimeState{}, false
	}
	return s.hub.State(userID, sessionID)
}

func (s *Service) ListRecoverableSessions(ctx context.Context, userID string) ([]SessionInfo, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidInput
	}
	if s.hub == nil {
		return nil, ErrInvalidState
	}

	_ = ctx
	snapshots := s.hub.List(userID)
	items := make([]SessionInfo, 0, len(snapshots))
	for _, snapshot := range snapshots {
		item := sessionInfoResponseWithRuntimeState(snapshot.Session, snapshot.State, true)
		attachToken, err := s.NewAttachToken(userID, item.ID)
		if err != nil {
			return nil, err
		}
		item.AttachToken = &attachToken
		items = append(items, item)
	}
	return items, nil
}
