package terminal

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
)

func (s *Service) Bootstrap(ctx context.Context, input SessionBootstrapInput) (SessionBootstrapResult, error) {
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.HostID) == "" {
		return SessionBootstrapResult{}, ErrInvalidInput
	}
	if _, _, err := normalizeTerminalSize(input.Rows, input.Cols); err != nil {
		return SessionBootstrapResult{}, err
	}
	if s.repo == nil || s.hostService == nil {
		return SessionBootstrapResult{}, ErrInvalidInput
	}
	if s.hub != nil {
		if err := s.hub.EnsureCapacity(input.UserID, ""); err != nil {
			return SessionBootstrapResult{}, err
		}
	}

	testResult, err := s.hostService.TestConnection(ctx, input.UserID, input.HostID, host.TestConnectionInput{})
	if err != nil {
		return SessionBootstrapResult{}, err
	}
	if !testResult.OK {
		return SessionBootstrapResult{}, &ConnectionFailedError{
			Message:       testResult.Message,
			ConnectionLog: testResult.ConnectionLog,
		}
	}

	session, err := s.repo.CreateSession(
		ctx,
		input.UserID,
		input.HostID,
		string(model.TerminalSessionStatusConnecting),
		stringPtrOrNil(strings.TrimSpace(input.RemoteAddr)),
	)
	if err != nil {
		return SessionBootstrapResult{}, err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:            input.UserID,
		TerminalSessionID: stringPtr(session.ID),
		EventType:         "terminal_session_create",
		ResourceType:      stringPtr("terminal_session"),
		ResourceID:        stringPtr(session.ID),
		TargetHostID:      stringPtr(session.HostID),
		Result:            string(model.AuditResultSuccess),
		Message:           stringPtr("terminal session bootstrap created"),
	})

	rows, cols, _ := normalizeTerminalSize(input.Rows, input.Cols)
	attachToken, err := s.NewAttachToken(input.UserID, session.ID)
	if err != nil {
		return SessionBootstrapResult{}, err
	}
	return SessionBootstrapResult{
		Session: sessionInfoResponse(session),
		WebSocket: TerminalWebSocketInfo{
			URL:      buildTerminalWebSocketURL(input.WebSocketBaseURL, session.ID, rows, cols, attachToken),
			Protocol: "terminal.v1",
			Token:    &attachToken,
		},
		ConnectionLog: testResult.ConnectionLog,
	}, nil
}

func (s *Service) QuickConnect(ctx context.Context, input QuickConnectSessionInput) (SessionBootstrapResult, error) {
	if strings.TrimSpace(input.UserID) == "" {
		return SessionBootstrapResult{}, ErrInvalidInput
	}
	rows, cols, err := normalizeTerminalSize(input.Rows, input.Cols)
	if err != nil {
		return SessionBootstrapResult{}, err
	}
	if s.hostService == nil || s.temporarySessions == nil {
		return SessionBootstrapResult{}, ErrInvalidInput
	}
	if s.hub != nil {
		if err := s.hub.EnsureCapacity(input.UserID, ""); err != nil {
			return SessionBootstrapResult{}, err
		}
	}

	temporaryHost, err := s.hostService.CreateTemporaryConnection(ctx, host.TemporaryConnectionInput{
		UserID:       input.UserID,
		CredentialID: input.CredentialID,
		Host:         input.Host,
		Port:         input.Port,
		Username:     input.Username,
		AuthType:     input.AuthType,
		Password:     input.Password,
		PrivateKey:   input.PrivateKey,
		Passphrase:   input.Passphrase,
		KeyType:      input.KeyType,
	})
	if err != nil {
		return SessionBootstrapResult{}, err
	}

	sessionID, err := randomTemporarySessionID()
	if err != nil {
		return SessionBootstrapResult{}, err
	}
	now := time.Now()
	session := model.TerminalSession{
		ID:         sessionID,
		UserID:     strings.TrimSpace(input.UserID),
		HostID:     temporaryHost.ID,
		Status:     string(model.TerminalSessionStatusConnecting),
		RemoteAddr: stringPtrOrNil(strings.TrimSpace(input.RemoteAddr)),
		StartedAt:  now,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	s.temporarySessions.Set(session)

	attachToken, err := s.NewAttachToken(input.UserID, session.ID)
	if err != nil {
		return SessionBootstrapResult{}, err
	}
	return SessionBootstrapResult{
		Session: sessionInfoResponse(session),
		WebSocket: TerminalWebSocketInfo{
			URL:      buildTerminalWebSocketURL(input.WebSocketBaseURL, session.ID, rows, cols, attachToken),
			Protocol: "terminal.v1",
			Token:    &attachToken,
		},
	}, nil
}

func randomTemporarySessionID() (string, error) {
	var payload [12]byte
	if _, err := rand.Read(payload[:]); err != nil {
		return "", err
	}
	return "tmp-session-" + hex.EncodeToString(payload[:]), nil
}
