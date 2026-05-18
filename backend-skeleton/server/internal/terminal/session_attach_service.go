package terminal

import (
	"context"
	"errors"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
)

func (s *Service) AttachRuntime(ctx context.Context, userID, authSessionID, sessionID string, rows, cols int, initialDirectories []string) (*TerminalAttachment, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return nil, ErrInvalidInput
	}
	rows, cols, err := normalizeTerminalSize(rows, cols)
	if err != nil {
		return nil, err
	}
	if s.hostService == nil {
		return nil, ErrInvalidInput
	}
	if s.hub == nil {
		return nil, ErrInvalidState
	}

	if attachment, err := s.hub.Attach(userID, authSessionID, sessionID, rows, cols); err == nil {
		return attachment, nil
	} else if !errors.Is(err, ErrRuntimeNotFound) {
		return nil, err
	}
	initialDirectories, err = normalizeInitialDirectories(initialDirectories)
	if err != nil {
		return nil, err
	}

	session, isTemporary, err := s.sessionForAttach(ctx, userID, sessionID)
	if err != nil {
		return nil, err
	}
	if session.Status != string(model.TerminalSessionStatusConnecting) {
		return nil, ErrInvalidState
	}
	if err := s.hub.EnsureCapacity(userID, sessionID); err != nil {
		_ = s.failSession(context.Background(), userID, session.ID, session.HostID, isTemporary, err.Error())
		return nil, err
	}

	client, fingerprint, err := s.hostService.OpenSSHClient(ctx, userID, session.HostID, host.TestConnectionInput{})
	if err != nil {
		_ = s.failSession(context.Background(), userID, session.ID, session.HostID, isTemporary, err.Error())
		return nil, err
	}

	runtime, err := newRuntime(client, rows, cols, initialDirectories)
	if err != nil {
		_ = client.Close()
		_ = s.failSession(context.Background(), userID, session.ID, session.HostID, isTemporary, err.Error())
		return nil, &ConnectionFailedError{
			Message:       "failed to initialize SSH terminal session",
			ConnectionLog: nil,
		}
	}

	var updatedSession model.TerminalSession
	if isTemporary {
		var ok bool
		updatedSession, ok = s.temporarySessions.UpdateStatus(userID, session.ID, string(model.TerminalSessionStatusConnected), nil)
		if !ok {
			_ = runtime.Close()
			return nil, db.ErrNotFound
		}
	} else {
		updatedSession, err = s.repo.UpdateSessionStatus(ctx, userID, session.ID, string(model.TerminalSessionStatusConnected), nil)
		if err != nil {
			_ = runtime.Close()
			return nil, err
		}

		s.recordAudit(ctx, model.AuditLog{
			UserID:            userID,
			TerminalSessionID: stringPtr(updatedSession.ID),
			EventType:         "terminal_session_connect",
			ResourceType:      stringPtr("terminal_session"),
			ResourceID:        stringPtr(updatedSession.ID),
			TargetHostID:      stringPtr(updatedSession.HostID),
			Result:            string(model.AuditResultSuccess),
			Message:           stringPtr("terminal session connected"),
		})
	}

	runtime.Session = updatedSession
	runtime.AuthSessionID = strings.TrimSpace(authSessionID)
	runtime.Fingerprint = fingerprint
	if recorder := s.startRecording(ctx, updatedSession); recorder != nil {
		runtime.Recorder = recorder
	}
	attachment, err := s.hub.Register(userID, authSessionID, runtime, rows, cols)
	if err != nil {
		_ = runtime.Close()
		if runtime.Recorder != nil {
			runtime.Recorder.Finish(model.TerminalRecordingStatusFailed)
		}
		_ = s.failSession(context.Background(), userID, session.ID, session.HostID, isTemporary, err.Error())
		return nil, err
	}
	return attachment, nil
}

func (s *Service) sessionForAttach(ctx context.Context, userID, sessionID string) (model.TerminalSession, bool, error) {
	if item, ok := s.temporarySessions.Get(userID, sessionID); ok {
		return item, true, nil
	}
	if s.repo == nil {
		return model.TerminalSession{}, false, ErrInvalidInput
	}
	item, err := s.repo.GetSessionByID(ctx, userID, sessionID)
	return item, false, err
}
