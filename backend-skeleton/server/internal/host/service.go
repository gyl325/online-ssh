package host

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"golang.org/x/crypto/ssh"
)

var ErrInvalidInput = errors.New("invalid input")

type Service struct {
	repo                 Repository
	groupRepo            HostGroupRepository
	credentialRepo       credential.Repository
	credentialEncryptor  credential.Encryptor
	audit                AuditRecorder
	temporaryConnections *temporaryConnectionStore
}

type HostGroupRepository interface {
	GetByID(ctx context.Context, userID, groupID string) (model.HostGroup, error)
}

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

func NewService(repo Repository, groupRepo HostGroupRepository, credentialRepo credential.Repository, credentialEncryptor credential.Encryptor, audit AuditRecorder) *Service {
	return &Service{
		repo:                 repo,
		groupRepo:            groupRepo,
		credentialRepo:       credentialRepo,
		credentialEncryptor:  credentialEncryptor,
		audit:                audit,
		temporaryConnections: newTemporaryConnectionStore(),
	}
}

type CreateInput struct {
	UserID       string  `json:"-"`
	GroupID      *string `json:"group_id"`
	CredentialID *string `json:"credential_id"`
	Name         string  `json:"name"`
	Host         string  `json:"host"`
	Port         int     `json:"port"`
	Username     string  `json:"username"`
	AuthType     string  `json:"auth_type"`
	IsFavorite   bool    `json:"is_favorite"`
}

type UpdateInput struct {
	GroupID              *string `json:"group_id"`
	CredentialID         *string `json:"credential_id"`
	Name                 *string `json:"name"`
	Host                 *string `json:"host"`
	Port                 *int    `json:"port"`
	Username             *string `json:"username"`
	AuthType             *string `json:"auth_type"`
	IsFavorite           *bool   `json:"is_favorite"`
	groupIDProvided      bool
	credentialIDProvided bool
}

func (input *UpdateInput) UnmarshalJSON(data []byte) error {
	type updateInputJSON struct {
		GroupID      *string `json:"group_id"`
		CredentialID *string `json:"credential_id"`
		Name         *string `json:"name"`
		Host         *string `json:"host"`
		Port         *int    `json:"port"`
		Username     *string `json:"username"`
		AuthType     *string `json:"auth_type"`
		IsFavorite   *bool   `json:"is_favorite"`
	}
	var decoded updateInputJSON
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	input.GroupID = decoded.GroupID
	input.CredentialID = decoded.CredentialID
	input.Name = decoded.Name
	input.Host = decoded.Host
	input.Port = decoded.Port
	input.Username = decoded.Username
	input.AuthType = decoded.AuthType
	input.IsFavorite = decoded.IsFavorite

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	_, input.groupIDProvided = raw["group_id"]
	_, input.credentialIDProvided = raw["credential_id"]
	return nil
}

type TestConnectionInput struct {
	Host         *string `json:"host"`
	Port         *int    `json:"port"`
	Username     *string `json:"username"`
	AuthType     *string `json:"auth_type"`
	CredentialID *string `json:"credential_id"`
	Password     *string `json:"password"`
	PrivateKey   *string `json:"private_key"`
	Passphrase   *string `json:"passphrase"`
}

type TemporaryConnectionInput struct {
	UserID       string  `json:"-"`
	CredentialID *string `json:"credential_id"`
	Host         string  `json:"host"`
	Port         int     `json:"port"`
	Username     string  `json:"username"`
	AuthType     string  `json:"auth_type"`
	Password     string  `json:"password"`
	PrivateKey   string  `json:"private_key"`
	Passphrase   string  `json:"passphrase"`
	KeyType      string  `json:"key_type"`
}

type TemporaryConnection struct {
	Host       model.Host
	Password   string
	PrivateKey string
	Passphrase string
	KeyType    string
}

type temporaryConnectionStore struct {
	mu    sync.RWMutex
	items map[string]TemporaryConnection
}

func newTemporaryConnectionStore() *temporaryConnectionStore {
	return &temporaryConnectionStore{items: map[string]TemporaryConnection{}}
}

func (s *temporaryConnectionStore) Set(userID string, item TemporaryConnection) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[temporaryConnectionKey(userID, item.Host.ID)] = item
}

func (s *temporaryConnectionStore) Get(userID, hostID string) (TemporaryConnection, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.items[temporaryConnectionKey(userID, hostID)]
	return item, ok
}

func temporaryConnectionKey(userID, hostID string) string {
	return strings.TrimSpace(userID) + "\x00" + strings.TrimSpace(hostID)
}

func IsTemporaryHostID(hostID string) bool {
	return strings.HasPrefix(strings.TrimSpace(hostID), "tmp-host-")
}

type TestConnectionResult struct {
	OK            bool
	Message       string
	Fingerprint   model.HostFingerprint
	ConnectionLog []ConnectionLogEntry
}

type FingerprintConflictError struct {
	Code                string
	Message             string
	CurrentFingerprint  model.HostFingerprint
	PreviousFingerprint *model.HostFingerprint
}

func (e *FingerprintConflictError) Error() string {
	return e.Message
}

type SSHConnectionFailedError struct {
	Message       string
	Cause         error
	ConnectionLog []ConnectionLogEntry
}

func (e *SSHConnectionFailedError) Error() string {
	return e.Message
}

func (e *SSHConnectionFailedError) Unwrap() error {
	return e.Cause
}

type ConfirmFingerprintInput struct {
	Algorithm   string `json:"algorithm"`
	Fingerprint string `json:"fingerprint"`
}

func (s *Service) List(ctx context.Context, userID string, filter ListFilter) ([]model.Host, int, error) {
	return s.repo.ListByUserID(ctx, userID, filter)
}

func (s *Service) Create(ctx context.Context, input CreateInput) (model.Host, error) {
	if err := s.validateInput(ctx, input.UserID, input.GroupID, input.CredentialID, input.Name, input.Host, input.Port, input.Username, input.AuthType); err != nil {
		return model.Host{}, err
	}

	item := model.Host{
		UserID:       input.UserID,
		GroupID:      input.GroupID,
		CredentialID: input.CredentialID,
		Name:         strings.TrimSpace(input.Name),
		Host:         strings.TrimSpace(input.Host),
		Port:         normalizePort(input.Port),
		Username:     strings.TrimSpace(input.Username),
		AuthType:     input.AuthType,
		Status:       string(model.HostStatusActive),
		IsFavorite:   input.IsFavorite,
	}
	created, err := s.repo.Create(ctx, item)
	if err != nil {
		return model.Host{}, err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:       created.UserID,
		EventType:    "host_create",
		ResourceType: stringPtr("host"),
		ResourceID:   stringPtr(created.ID),
		TargetHostID: stringPtr(created.ID),
		Result:       string(model.AuditResultSuccess),
	})

	return created, nil
}

func (s *Service) Update(ctx context.Context, userID, hostID string, input UpdateInput) (model.Host, error) {
	item, err := s.repo.GetByID(ctx, userID, hostID)
	if err != nil {
		return model.Host{}, err
	}

	if input.groupIDProvided {
		item.GroupID = input.GroupID
	}
	if input.credentialIDProvided {
		item.CredentialID = input.CredentialID
	}
	if input.Name != nil {
		item.Name = strings.TrimSpace(*input.Name)
	}
	if input.Host != nil {
		item.Host = strings.TrimSpace(*input.Host)
	}
	if input.Port != nil {
		item.Port = *input.Port
	}
	if input.Username != nil {
		item.Username = strings.TrimSpace(*input.Username)
	}
	if input.AuthType != nil {
		item.AuthType = *input.AuthType
	}
	if input.IsFavorite != nil {
		item.IsFavorite = *input.IsFavorite
	}

	if err := s.validateInput(ctx, userID, item.GroupID, item.CredentialID, item.Name, item.Host, item.Port, item.Username, item.AuthType); err != nil {
		return model.Host{}, err
	}
	item.Port = normalizePort(item.Port)
	updated, err := s.repo.Update(ctx, item)
	if err != nil {
		return model.Host{}, err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:       updated.UserID,
		EventType:    "host_update",
		ResourceType: stringPtr("host"),
		ResourceID:   stringPtr(updated.ID),
		TargetHostID: stringPtr(updated.ID),
		Result:       string(model.AuditResultSuccess),
	})

	return updated, nil
}

func (s *Service) Delete(ctx context.Context, userID, hostID string) error {
	item, err := s.repo.GetByID(ctx, userID, hostID)
	if err != nil {
		return err
	}
	if err := s.repo.Delete(ctx, userID, hostID); err != nil {
		return err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:       item.UserID,
		EventType:    "host_delete",
		ResourceType: stringPtr("host"),
		ResourceID:   stringPtr(item.ID),
		TargetHostID: stringPtr(item.ID),
		Result:       string(model.AuditResultSuccess),
	})

	return nil
}

func (s *Service) Get(ctx context.Context, userID, hostID string) (model.Host, error) {
	if item, ok := s.temporaryConnections.Get(userID, hostID); ok {
		return item.Host, nil
	}
	return s.repo.GetByID(ctx, userID, hostID)
}

func (s *Service) CreateTemporaryConnection(ctx context.Context, input TemporaryConnectionInput) (model.Host, error) {
	if s == nil || s.temporaryConnections == nil {
		return model.Host{}, ErrInvalidInput
	}
	userID := strings.TrimSpace(input.UserID)
	hostName := strings.TrimSpace(input.Host)
	username := strings.TrimSpace(input.Username)
	authType := strings.TrimSpace(input.AuthType)
	port := normalizePort(input.Port)
	if userID == "" || hostName == "" || username == "" {
		return model.Host{}, ErrInvalidInput
	}
	if port <= 0 || port > 65535 {
		return model.Host{}, ErrInvalidInput
	}
	if authType != string(model.AuthTypePassword) && authType != string(model.AuthTypePrivateKey) {
		return model.Host{}, ErrInvalidInput
	}

	credentialID := strings.TrimSpace(trimStringPtr(input.CredentialID))
	if credentialID != "" {
		if s.credentialRepo == nil {
			return model.Host{}, ErrInvalidInput
		}
		credentialItem, err := s.credentialRepo.GetByID(ctx, userID, credentialID)
		if err != nil {
			if db.IsNotFound(err) {
				return model.Host{}, ErrInvalidInput
			}
			return model.Host{}, err
		}
		if credentialItem.AuthType != authType {
			return model.Host{}, ErrInvalidInput
		}
	} else {
		switch authType {
		case string(model.AuthTypePassword):
			if strings.TrimSpace(input.Password) == "" {
				return model.Host{}, ErrInvalidInput
			}
		case string(model.AuthTypePrivateKey):
			if strings.TrimSpace(input.PrivateKey) == "" {
				return model.Host{}, ErrInvalidInput
			}
		}
	}

	now := time.Now()
	id, err := randomTemporaryHostID()
	if err != nil {
		return model.Host{}, err
	}
	item := model.Host{
		ID:           id,
		UserID:       userID,
		CredentialID: optionalStringPtr(credentialID),
		Name:         username + "@" + hostName,
		Host:         hostName,
		Port:         port,
		Username:     username,
		AuthType:     authType,
		Status:       string(model.HostStatusActive),
		IsFavorite:   false,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	s.temporaryConnections.Set(userID, TemporaryConnection{
		Host:       item,
		Password:   strings.TrimSpace(input.Password),
		PrivateKey: strings.TrimSpace(input.PrivateKey),
		Passphrase: strings.TrimSpace(input.Passphrase),
		KeyType:    strings.TrimSpace(input.KeyType),
	})
	return item, nil
}

func (s *Service) TestConnection(ctx context.Context, userID, hostID string, input TestConnectionInput) (TestConnectionResult, error) {
	client, fingerprint, connectionLog, err := s.openSSHClientWithLog(ctx, userID, hostID, input)
	if err != nil {
		var fingerprintErr *FingerprintConflictError
		var connErr *SSHConnectionFailedError
		switch {
		case errors.As(err, &fingerprintErr):
			eventType := "host_fingerprint_conflict"
			message := "host fingerprint conflict detected"
			metadata := map[string]any{
				"current_fingerprint": fingerprintErr.CurrentFingerprint.Fingerprint,
				"current_algorithm":   fingerprintErr.CurrentFingerprint.Algorithm,
			}
			if fingerprintErr.Code == "HOST_FINGERPRINT_CONFIRMATION_REQUIRED" {
				eventType = "host_test_blocked_no_fingerprint"
				message = "host fingerprint confirmation required"
			}
			if fingerprintErr.PreviousFingerprint != nil {
				metadata["previous_fingerprint"] = fingerprintErr.PreviousFingerprint.Fingerprint
				metadata["previous_algorithm"] = fingerprintErr.PreviousFingerprint.Algorithm
			}
			s.recordHostTestAudit(ctx, userID, hostID, eventType, model.AuditResultFailure, message, metadata)
			return TestConnectionResult{}, err
		case errors.As(err, &connErr):
			metadata := map[string]any{}
			if connErr.Cause != nil {
				metadata["error"] = connErr.Cause.Error()
			}
			if fingerprint.Fingerprint != "" {
				metadata["fingerprint"] = fingerprint.Fingerprint
				metadata["algorithm"] = fingerprint.Algorithm
			}
			s.recordHostTestAudit(ctx, userID, hostID, "host_test_failure", model.AuditResultFailure, connErr.Message, metadata)
			return TestConnectionResult{
				OK:            false,
				Message:       connErr.Message,
				Fingerprint:   fingerprint,
				ConnectionLog: append([]ConnectionLogEntry(nil), connErr.ConnectionLog...),
			}, nil
		default:
			return TestConnectionResult{}, err
		}
	}
	defer client.Close()

	s.recordHostTestAudit(ctx, userID, hostID, "host_test_success", model.AuditResultSuccess, "SSH connectivity test succeeded", map[string]any{
		"fingerprint": fingerprint.Fingerprint,
		"algorithm":   fingerprint.Algorithm,
	})

	return TestConnectionResult{
		OK:            true,
		Message:       "SSH connectivity test succeeded",
		Fingerprint:   fingerprint,
		ConnectionLog: append([]ConnectionLogEntry(nil), connectionLog...),
	}, nil
}

func (s *Service) OpenSSHClient(ctx context.Context, userID, hostID string, input TestConnectionInput) (*ssh.Client, model.HostFingerprint, error) {
	client, fingerprint, _, err := s.openSSHClientWithLog(ctx, userID, hostID, input)
	return client, fingerprint, err
}

func (s *Service) openSSHClientWithLog(ctx context.Context, userID, hostID string, input TestConnectionInput) (*ssh.Client, model.HostFingerprint, []ConnectionLogEntry, error) {
	hostItem, temporaryConnection, isTemporary, err := s.resolveHostForConnection(ctx, userID, hostID, input)
	if err != nil {
		return nil, model.HostFingerprint{}, nil, err
	}
	connectionLog := buildSSHConnectionLog(hostItem, input, time.Now())

	authInput := input
	if isTemporary {
		if temporaryConnection.Password != "" {
			authInput.Password = &temporaryConnection.Password
		}
		if temporaryConnection.PrivateKey != "" {
			authInput.PrivateKey = &temporaryConnection.PrivateKey
		}
		if temporaryConnection.Passphrase != "" {
			authInput.Passphrase = &temporaryConnection.Passphrase
		}
	}
	authMethod, err := s.resolveAuthMethod(ctx, userID, hostItem, authInput)
	if err != nil {
		return nil, model.HostFingerprint{}, connectionLog.entriesCopy(), err
	}
	connectionLog.authResolved()

	dialResult, dialErr := dialSSHWithLog(ctx, hostItem, authMethod, connectionLog)
	if dialErr != nil && dialResult.fingerprint == nil {
		return nil, model.HostFingerprint{}, connectionLog.entriesCopy(), &SSHConnectionFailedError{
			Message:       classifySSHProbeError(dialErr),
			Cause:         dialErr,
			ConnectionLog: connectionLog.entriesCopy(),
		}
	}
	if dialResult.fingerprint == nil {
		return nil, model.HostFingerprint{}, connectionLog.entriesCopy(), &SSHConnectionFailedError{
			Message:       "SSH host fingerprint was not captured",
			ConnectionLog: connectionLog.entriesCopy(),
		}
	}
	connectionLog.fingerprintCaptured(*dialResult.fingerprint)

	if isTemporary {
		if dialErr != nil {
			if dialResult.client != nil {
				_ = dialResult.client.Close()
			}
			return nil, *dialResult.fingerprint, connectionLog.entriesCopy(), &SSHConnectionFailedError{
				Message:       classifySSHProbeError(dialErr),
				Cause:         dialErr,
				ConnectionLog: connectionLog.entriesCopy(),
			}
		}
		fingerprint := *dialResult.fingerprint
		fingerprint.HostID = hostID
		fingerprint.Status = string(model.FingerprintStatusTrusted)
		now := time.Now()
		fingerprint.FirstSeenAt = now
		fingerprint.LastVerifiedAt = &now
		fingerprint.CreatedAt = now
		fingerprint.UpdatedAt = now
		return dialResult.client, fingerprint, connectionLog.entriesCopy(), nil
	}

	trustedFingerprints, err := s.listTrustedFingerprints(ctx, hostID)
	if err != nil {
		if dialResult.client != nil {
			_ = dialResult.client.Close()
		}
		return nil, model.HostFingerprint{}, connectionLog.entriesCopy(), err
	}

	matchedFingerprint, previousFingerprint, trustState := evaluateFingerprintTrust(dialResult.fingerprint, trustedFingerprints)
	switch trustState {
	case trustStateNeedsConfirmation:
		connectionLog.fingerprintNeedsConfirmation(*dialResult.fingerprint)
		if dialResult.client != nil {
			_ = dialResult.client.Close()
		}
		return nil, *dialResult.fingerprint, connectionLog.entriesCopy(), &FingerprintConflictError{
			Code:               "HOST_FINGERPRINT_CONFIRMATION_REQUIRED",
			Message:            "host fingerprint must be confirmed before test",
			CurrentFingerprint: *dialResult.fingerprint,
		}
	case trustStateConflict:
		connectionLog.fingerprintConflict(*dialResult.fingerprint)
		if dialResult.client != nil {
			_ = dialResult.client.Close()
		}
		return nil, *dialResult.fingerprint, connectionLog.entriesCopy(), &FingerprintConflictError{
			Code:                "HOST_FINGERPRINT_CONFLICT",
			Message:             "host fingerprint changed; confirmation is required",
			CurrentFingerprint:  *dialResult.fingerprint,
			PreviousFingerprint: previousFingerprint,
		}
	}

	verifiedFingerprint, err := s.repo.UpsertFingerprint(
		ctx,
		hostID,
		matchedFingerprint.Algorithm,
		matchedFingerprint.Fingerprint,
		string(model.FingerprintStatusTrusted),
	)
	if err != nil {
		if dialResult.client != nil {
			_ = dialResult.client.Close()
		}
		return nil, model.HostFingerprint{}, connectionLog.entriesCopy(), err
	}

	if dialErr != nil {
		if dialResult.client != nil {
			_ = dialResult.client.Close()
		}
		return nil, verifiedFingerprint, connectionLog.entriesCopy(), &SSHConnectionFailedError{
			Message:       classifySSHProbeError(dialErr),
			Cause:         dialErr,
			ConnectionLog: connectionLog.entriesCopy(),
		}
	}

	if err := s.repo.UpdateLastConnectedAt(ctx, userID, hostID, time.Now()); err != nil {
		if dialResult.client != nil {
			_ = dialResult.client.Close()
		}
		return nil, model.HostFingerprint{}, connectionLog.entriesCopy(), err
	}

	connectionLog.fingerprintTrusted(verifiedFingerprint)
	return dialResult.client, verifiedFingerprint, connectionLog.entriesCopy(), nil
}

func (s *Service) resolveHostForConnection(ctx context.Context, userID, hostID string, input TestConnectionInput) (model.Host, TemporaryConnection, bool, error) {
	if item, ok := s.temporaryConnections.Get(userID, hostID); ok {
		hostItem, err := applyTestConnectionOverrides(item.Host, input)
		if err != nil {
			return model.Host{}, TemporaryConnection{}, false, err
		}
		return hostItem, item, true, nil
	}
	hostItem, err := s.repo.GetByID(ctx, userID, hostID)
	if err != nil {
		return model.Host{}, TemporaryConnection{}, false, err
	}
	hostItem, err = applyTestConnectionOverrides(hostItem, input)
	if err != nil {
		return model.Host{}, TemporaryConnection{}, false, err
	}
	return hostItem, TemporaryConnection{}, false, nil
}

func (s *Service) ConfirmFingerprint(ctx context.Context, userID, hostID string, input ConfirmFingerprintInput) (model.HostFingerprint, error) {
	if strings.TrimSpace(input.Algorithm) == "" || strings.TrimSpace(input.Fingerprint) == "" {
		return model.HostFingerprint{}, ErrInvalidInput
	}

	if _, err := s.repo.GetByID(ctx, userID, hostID); err != nil {
		return model.HostFingerprint{}, err
	}

	item, err := s.repo.UpsertFingerprint(
		ctx,
		hostID,
		strings.TrimSpace(input.Algorithm),
		strings.TrimSpace(input.Fingerprint),
		string(model.FingerprintStatusTrusted),
	)
	if err != nil {
		return model.HostFingerprint{}, err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:       userID,
		EventType:    "host_fingerprint_confirm",
		ResourceType: stringPtr("host_fingerprint"),
		ResourceID:   stringPtr(item.ID),
		TargetHostID: stringPtr(hostID),
		Result:       string(model.AuditResultSuccess),
	})

	return item, nil
}

func (s *Service) validateInput(ctx context.Context, userID string, groupID, credentialID *string, name, hostName string, port int, username, authType string) error {
	if strings.TrimSpace(name) == "" || strings.TrimSpace(hostName) == "" || strings.TrimSpace(username) == "" {
		return ErrInvalidInput
	}
	if normalizePort(port) <= 0 || normalizePort(port) > 65535 {
		return ErrInvalidInput
	}
	if authType != string(model.AuthTypePassword) && authType != string(model.AuthTypePrivateKey) {
		return ErrInvalidInput
	}
	if groupID != nil && strings.TrimSpace(*groupID) != "" {
		if s.groupRepo == nil {
			return ErrInvalidInput
		}
		if _, err := s.groupRepo.GetByID(ctx, userID, strings.TrimSpace(*groupID)); err != nil {
			if db.IsNotFound(err) {
				return ErrInvalidInput
			}
			return err
		}
	}
	if credentialID != nil && strings.TrimSpace(*credentialID) != "" {
		if s.credentialRepo == nil {
			return ErrInvalidInput
		}
		if _, err := s.credentialRepo.GetByID(ctx, userID, strings.TrimSpace(*credentialID)); err != nil {
			if db.IsNotFound(err) {
				return ErrInvalidInput
			}
			return err
		}
	}
	return nil
}

func normalizePort(port int) int {
	if port == 0 {
		return 22
	}
	return port
}

func (s *Service) resolveAuthMethod(ctx context.Context, userID string, hostItem model.Host, input TestConnectionInput) (ssh.AuthMethod, error) {
	var credentialItem *model.Credential
	if hostItem.CredentialID != nil && strings.TrimSpace(*hostItem.CredentialID) != "" {
		if s.credentialRepo == nil {
			return nil, ErrInvalidInput
		}
		item, err := s.credentialRepo.GetByID(ctx, userID, strings.TrimSpace(*hostItem.CredentialID))
		if err != nil {
			if db.IsNotFound(err) {
				return nil, ErrInvalidInput
			}
			return nil, err
		}
		credentialItem = &item
	}

	switch hostItem.AuthType {
	case string(model.AuthTypePassword):
		password, err := s.resolvePassword(input, credentialItem)
		if err != nil {
			return nil, err
		}
		return ssh.Password(password), nil
	case string(model.AuthTypePrivateKey):
		privateKey, passphrase, err := s.resolvePrivateKey(input, credentialItem)
		if err != nil {
			return nil, err
		}
		authMethod, err := parsePrivateKeyAuth(privateKey, passphrase)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidInput, err)
		}
		return authMethod, nil
	default:
		return nil, ErrInvalidInput
	}
}

func applyTestConnectionOverrides(hostItem model.Host, input TestConnectionInput) (model.Host, error) {
	next := hostItem
	if input.Host != nil {
		hostName := strings.TrimSpace(*input.Host)
		if hostName == "" {
			return model.Host{}, ErrInvalidInput
		}
		next.Host = hostName
	}
	if input.Port != nil {
		port := normalizePort(*input.Port)
		if port <= 0 || port > 65535 {
			return model.Host{}, ErrInvalidInput
		}
		next.Port = port
	}
	if input.Username != nil {
		username := strings.TrimSpace(*input.Username)
		if username == "" {
			return model.Host{}, ErrInvalidInput
		}
		next.Username = username
	}
	if input.AuthType != nil {
		authType := strings.TrimSpace(*input.AuthType)
		if authType != string(model.AuthTypePassword) && authType != string(model.AuthTypePrivateKey) {
			return model.Host{}, ErrInvalidInput
		}
		next.AuthType = authType
	}
	if input.CredentialID != nil {
		credentialID := strings.TrimSpace(*input.CredentialID)
		if credentialID == "" {
			next.CredentialID = nil
		} else {
			next.CredentialID = &credentialID
		}
	}
	return next, nil
}

func (s *Service) resolvePassword(input TestConnectionInput, credentialItem *model.Credential) (string, error) {
	if input.Password != nil {
		password := strings.TrimSpace(*input.Password)
		if password == "" {
			return "", ErrInvalidInput
		}
		return password, nil
	}
	if credentialItem == nil || credentialItem.AuthType != string(model.AuthTypePassword) || credentialItem.EncryptedSecret == nil {
		return "", ErrInvalidInput
	}
	if s.credentialEncryptor == nil {
		return "", ErrInvalidInput
	}
	password, err := credential.DecryptWithVersion(s.credentialEncryptor, *credentialItem.EncryptedSecret, credentialItem.KeyVersion)
	if err != nil {
		return "", fmt.Errorf("decrypt password credential: %w", err)
	}
	password = strings.TrimSpace(password)
	if password == "" {
		return "", ErrInvalidInput
	}
	return password, nil
}

func (s *Service) resolvePrivateKey(input TestConnectionInput, credentialItem *model.Credential) (string, string, error) {
	var privateKey string
	if input.PrivateKey != nil {
		privateKey = strings.TrimSpace(*input.PrivateKey)
		if privateKey == "" {
			return "", "", ErrInvalidInput
		}
	} else {
		if credentialItem == nil || credentialItem.AuthType != string(model.AuthTypePrivateKey) || credentialItem.EncryptedPrivateKey == nil {
			return "", "", ErrInvalidInput
		}
		if s.credentialEncryptor == nil {
			return "", "", ErrInvalidInput
		}
		decryptedKey, err := credential.DecryptWithVersion(s.credentialEncryptor, *credentialItem.EncryptedPrivateKey, credentialItem.KeyVersion)
		if err != nil {
			return "", "", fmt.Errorf("decrypt private key credential: %w", err)
		}
		privateKey = strings.TrimSpace(decryptedKey)
		if privateKey == "" {
			return "", "", ErrInvalidInput
		}
	}

	if input.Passphrase != nil {
		return privateKey, strings.TrimSpace(*input.Passphrase), nil
	}
	if credentialItem == nil || credentialItem.EncryptedPassphrase == nil {
		return privateKey, "", nil
	}
	if s.credentialEncryptor == nil {
		return "", "", ErrInvalidInput
	}
	passphrase, err := credential.DecryptWithVersion(s.credentialEncryptor, *credentialItem.EncryptedPassphrase, credentialItem.KeyVersion)
	if err != nil {
		return "", "", fmt.Errorf("decrypt private key passphrase: %w", err)
	}
	return privateKey, strings.TrimSpace(passphrase), nil
}

func (s *Service) listTrustedFingerprints(ctx context.Context, hostID string) ([]model.HostFingerprint, error) {
	items, err := s.repo.ListFingerprintsByHostID(ctx, hostID)
	if err != nil {
		return nil, err
	}

	trusted := make([]model.HostFingerprint, 0, len(items))
	for _, item := range items {
		if item.Status == string(model.FingerprintStatusTrusted) {
			trusted = append(trusted, item)
		}
	}
	return trusted, nil
}

type fingerprintTrustState string

const (
	trustStateMatched           fingerprintTrustState = "matched"
	trustStateNeedsConfirmation fingerprintTrustState = "needs_confirmation"
	trustStateConflict          fingerprintTrustState = "conflict"
)

func evaluateFingerprintTrust(current *model.HostFingerprint, trusted []model.HostFingerprint) (model.HostFingerprint, *model.HostFingerprint, fingerprintTrustState) {
	if current == nil {
		return model.HostFingerprint{}, nil, trustStateMatched
	}
	if len(trusted) == 0 {
		return model.HostFingerprint{}, nil, trustStateNeedsConfirmation
	}
	for i := range trusted {
		if trusted[i].Algorithm == current.Algorithm && trusted[i].Fingerprint == current.Fingerprint {
			return trusted[i], &trusted[i], trustStateMatched
		}
	}
	for i := range trusted {
		if trusted[i].Algorithm == current.Algorithm {
			return model.HostFingerprint{}, &trusted[i], trustStateConflict
		}
	}
	return model.HostFingerprint{}, &trusted[0], trustStateConflict
}

func (s *Service) recordHostTestAudit(ctx context.Context, userID, hostID, eventType string, result model.AuditResult, message string, metadata map[string]any) {
	s.recordAudit(ctx, model.AuditLog{
		UserID:       userID,
		EventType:    eventType,
		ResourceType: stringPtr("host"),
		ResourceID:   stringPtr(hostID),
		TargetHostID: stringPtr(hostID),
		Result:       string(result),
		Message:      stringPtr(message),
		MetadataJSON: s.mustJSON(metadata),
	})
}

func (s *Service) mustJSON(payload map[string]any) json.RawMessage {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil
	}
	return raw
}

func (s *Service) recordAudit(ctx context.Context, log model.AuditLog) {
	if s.audit == nil {
		return
	}
	_ = s.audit.Record(ctx, log)
}

func stringPtr(value string) *string {
	return &value
}

func trimStringPtr(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func optionalStringPtr(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func randomTemporaryHostID() (string, error) {
	var payload [12]byte
	if _, err := rand.Read(payload[:]); err != nil {
		return "", fmt.Errorf("generate temporary host id: %w", err)
	}
	return "tmp-host-" + hex.EncodeToString(payload[:]), nil
}
