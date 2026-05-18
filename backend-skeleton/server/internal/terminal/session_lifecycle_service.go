package terminal

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

func (s *Service) CloseSession(ctx context.Context, userID, sessionID string) (model.TerminalSession, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return model.TerminalSession{}, ErrInvalidInput
	}
	if item, ok := s.temporarySessions.Get(userID, sessionID); ok {
		if item.Status == string(model.TerminalSessionStatusDisconnected) || item.Status == string(model.TerminalSessionStatusFailed) {
			return item, nil
		}
		if s.hub != nil {
			err := s.hub.CloseRuntime(userID, sessionID, "terminal session closed by user")
			if err == nil {
				updated, _ := s.temporarySessions.Get(userID, sessionID)
				return updated, nil
			}
			if !errors.Is(err, ErrRuntimeNotFound) {
				return model.TerminalSession{}, err
			}
		}
		return s.FinishRuntime(ctx, userID, sessionID, model.TerminalSessionStatusDisconnected, "terminal session closed by user")
	}
	if s.repo == nil {
		return model.TerminalSession{}, ErrInvalidInput
	}

	item, err := s.repo.GetSessionByID(ctx, userID, sessionID)
	if err != nil {
		return model.TerminalSession{}, err
	}
	if item.Status == string(model.TerminalSessionStatusDisconnected) || item.Status == string(model.TerminalSessionStatusFailed) {
		return item, nil
	}

	if s.hub != nil {
		err = s.hub.CloseRuntime(userID, sessionID, "terminal session closed by user")
		if err == nil {
			return s.repo.GetSessionByID(ctx, userID, sessionID)
		}
		if !errors.Is(err, ErrRuntimeNotFound) {
			return model.TerminalSession{}, err
		}
	}

	return s.FinishRuntime(ctx, userID, sessionID, model.TerminalSessionStatusDisconnected, "terminal session closed by user")
}

func (s *Service) CloseUserRuntimes(ctx context.Context, userID, message string) int {
	if s == nil || s.hub == nil || strings.TrimSpace(userID) == "" {
		return 0
	}
	_ = ctx
	return s.hub.CloseUserRuntimes(strings.TrimSpace(userID), strings.TrimSpace(message))
}

func (s *Service) CloseUserRuntimesForce(ctx context.Context, userID, message string) int {
	if s == nil || s.hub == nil || strings.TrimSpace(userID) == "" {
		return 0
	}
	_ = ctx
	return s.hub.CloseUserRuntimesForce(strings.TrimSpace(userID), strings.TrimSpace(message))
}

func (s *Service) CloseAuthSessionRuntimes(ctx context.Context, userID, authSessionID, message string) int {
	if s == nil || s.hub == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(authSessionID) == "" {
		return 0
	}
	_ = ctx
	return s.hub.CloseAuthSessionRuntimes(strings.TrimSpace(userID), strings.TrimSpace(authSessionID), strings.TrimSpace(message))
}

func (s *Service) CloseAuthSessionRuntimesForce(ctx context.Context, userID, authSessionID, message string) int {
	if s == nil || s.hub == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(authSessionID) == "" {
		return 0
	}
	_ = ctx
	return s.hub.CloseAuthSessionRuntimesForce(strings.TrimSpace(userID), strings.TrimSpace(authSessionID), strings.TrimSpace(message))
}

func (s *Service) CloseRuntime(ctx context.Context, userID, sessionID, message string) error {
	if s == nil || s.hub == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return ErrInvalidInput
	}
	_ = ctx
	err := s.hub.CloseRuntime(strings.TrimSpace(userID), strings.TrimSpace(sessionID), strings.TrimSpace(message))
	if errors.Is(err, ErrRuntimeNotFound) {
		return nil
	}
	return err
}

func (s *Service) FinishRuntime(ctx context.Context, userID, sessionID string, status model.TerminalSessionStatus, message string) (model.TerminalSession, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return model.TerminalSession{}, ErrInvalidInput
	}
	if status != model.TerminalSessionStatusDisconnected && status != model.TerminalSessionStatusFailed {
		return model.TerminalSession{}, ErrInvalidInput
	}
	endedAt := time.Now()
	if item, ok := s.temporarySessions.UpdateStatus(userID, sessionID, string(status), &endedAt); ok {
		return item, nil
	}
	if s.repo == nil {
		return model.TerminalSession{}, ErrInvalidInput
	}

	item, err := s.repo.UpdateSessionStatus(ctx, userID, sessionID, string(status), &endedAt)
	if err != nil {
		return model.TerminalSession{}, err
	}
	s.finishRecording(ctx, userID, sessionID, status, endedAt)

	eventType := "terminal_session_disconnected"
	result := model.AuditResultSuccess
	if status == model.TerminalSessionStatusFailed {
		eventType = "terminal_session_failed"
		result = model.AuditResultFailure
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:            userID,
		TerminalSessionID: stringPtr(item.ID),
		EventType:         eventType,
		ResourceType:      stringPtr("terminal_session"),
		ResourceID:        stringPtr(item.ID),
		TargetHostID:      stringPtr(item.HostID),
		Result:            string(result),
		Message:           stringPtr(strings.TrimSpace(message)),
	})

	return item, nil
}

func (s *Service) failSession(ctx context.Context, userID, sessionID, hostID string, isTemporary bool, message string) error {
	endedAt := time.Now()
	if isTemporary {
		_, ok := s.temporarySessions.UpdateStatus(userID, sessionID, string(model.TerminalSessionStatusFailed), &endedAt)
		if !ok {
			return db.ErrNotFound
		}
		return nil
	}
	if _, err := s.repo.UpdateSessionStatus(ctx, userID, sessionID, string(model.TerminalSessionStatusFailed), &endedAt); err != nil {
		return err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:            userID,
		TerminalSessionID: stringPtr(sessionID),
		EventType:         "terminal_session_failed",
		ResourceType:      stringPtr("terminal_session"),
		ResourceID:        stringPtr(sessionID),
		TargetHostID:      stringPtr(hostID),
		Result:            string(model.AuditResultFailure),
		Message:           stringPtr(strings.TrimSpace(message)),
	})
	return nil
}
