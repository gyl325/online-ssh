package connection

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

var ErrInvalidInput = errors.New("invalid input")

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

type Service struct {
	database  *db.DB
	encryptor credential.Encryptor
	audit     AuditRecorder
}

func NewService(database *db.DB, encryptor credential.Encryptor, audit AuditRecorder) *Service {
	return &Service{database: database, encryptor: encryptor, audit: audit}
}

type QuickConnectInput struct {
	UserID         string  `json:"-"`
	GroupID        *string `json:"group_id"`
	CredentialID   *string `json:"credential_id"`
	Name           string  `json:"name"`
	Host           string  `json:"host"`
	Port           int     `json:"port"`
	Username       string  `json:"username"`
	AuthType       string  `json:"auth_type"`
	CredentialName string  `json:"credential_name"`
	Password       string  `json:"password"`
	PrivateKey     string  `json:"private_key"`
	Passphrase     string  `json:"passphrase"`
	IsFavorite     bool    `json:"is_favorite"`
}

type QuickConnectResult struct {
	Credential        model.Credential
	Host              model.Host
	CreatedCredential bool
}

func (s *Service) QuickConnect(ctx context.Context, input QuickConnectInput) (QuickConnectResult, error) {
	if s == nil || s.database == nil || s.database.SQL == nil {
		return QuickConnectResult{}, ErrInvalidInput
	}
	name := buildConnectionName(input)
	hostName := strings.TrimSpace(input.Host)
	username := strings.TrimSpace(input.Username)
	authType := strings.TrimSpace(input.AuthType)
	port := normalizePort(input.Port)
	if input.UserID == "" || name == "" || hostName == "" || username == "" {
		return QuickConnectResult{}, ErrInvalidInput
	}
	if port <= 0 || port > 65535 {
		return QuickConnectResult{}, ErrInvalidInput
	}
	if authType != string(model.AuthTypePassword) && authType != string(model.AuthTypePrivateKey) {
		return QuickConnectResult{}, ErrInvalidInput
	}

	tx, err := s.database.SQL.BeginTx(ctx, nil)
	if err != nil {
		return QuickConnectResult{}, fmt.Errorf("begin quick connect transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	credentialID := trimOptional(input.CredentialID)
	createdCredential := false
	var credentialItem model.Credential
	if credentialID == "" {
		credentialItem, err = s.createCredential(ctx, tx, input, name, authType)
		if err != nil {
			return QuickConnectResult{}, err
		}
		createdCredential = true
		credentialID = credentialItem.ID
	} else {
		credentialItem, err = getCredentialForUser(ctx, tx, input.UserID, credentialID)
		if err != nil {
			if db.IsNotFound(err) {
				return QuickConnectResult{}, ErrInvalidInput
			}
			return QuickConnectResult{}, err
		}
		if credentialItem.AuthType != authType {
			return QuickConnectResult{}, ErrInvalidInput
		}
	}

	groupID := trimOptional(input.GroupID)
	if groupID != "" {
		if err := ensureHostGroup(ctx, tx, input.UserID, groupID); err != nil {
			return QuickConnectResult{}, err
		}
	}

	hostItem, err := createHost(ctx, tx, model.Host{
		UserID:       input.UserID,
		GroupID:      optionalString(groupID),
		CredentialID: optionalString(credentialID),
		Name:         name,
		Host:         hostName,
		Port:         port,
		Username:     username,
		AuthType:     authType,
		Status:       string(model.HostStatusActive),
		IsFavorite:   input.IsFavorite,
	})
	if err != nil {
		return QuickConnectResult{}, err
	}

	if err := tx.Commit(); err != nil {
		return QuickConnectResult{}, fmt.Errorf("commit quick connect transaction: %w", err)
	}
	committed = true

	if createdCredential {
		s.recordAudit(ctx, model.AuditLog{
			UserID:       credentialItem.UserID,
			EventType:    "credential_create",
			ResourceType: stringPtr("credential"),
			ResourceID:   stringPtr(credentialItem.ID),
			Result:       string(model.AuditResultSuccess),
		})
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       hostItem.UserID,
		EventType:    "host_create",
		ResourceType: stringPtr("host"),
		ResourceID:   stringPtr(hostItem.ID),
		TargetHostID: stringPtr(hostItem.ID),
		Result:       string(model.AuditResultSuccess),
	})

	return QuickConnectResult{
		Credential:        credentialItem,
		Host:              hostItem,
		CreatedCredential: createdCredential,
	}, nil
}

func (s *Service) createCredential(ctx context.Context, tx *sql.Tx, input QuickConnectInput, connectionName, authType string) (model.Credential, error) {
	if s.encryptor == nil {
		return model.Credential{}, ErrInvalidInput
	}

	credentialName := strings.TrimSpace(input.CredentialName)
	if credentialName == "" {
		credentialName = connectionName + " credential"
	}

	item := model.Credential{
		UserID:   input.UserID,
		Name:     credentialName,
		AuthType: authType,
	}

	switch authType {
	case string(model.AuthTypePassword):
		if strings.TrimSpace(input.Password) == "" {
			return model.Credential{}, ErrInvalidInput
		}
		encrypted, err := credential.EncryptWithActiveVersion(s.encryptor, strings.TrimSpace(input.Password))
		if err != nil {
			return model.Credential{}, err
		}
		item.EncryptedSecret = stringPtr(encrypted.CipherText)
		item.KeyVersion = encrypted.KeyVersion
	case string(model.AuthTypePrivateKey):
		if strings.TrimSpace(input.PrivateKey) == "" {
			return model.Credential{}, ErrInvalidInput
		}
		encryptedKey, err := credential.EncryptWithActiveVersion(s.encryptor, strings.TrimSpace(input.PrivateKey))
		if err != nil {
			return model.Credential{}, err
		}
		item.EncryptedPrivateKey = stringPtr(encryptedKey.CipherText)
		item.KeyVersion = encryptedKey.KeyVersion
		if strings.TrimSpace(input.Passphrase) != "" {
			encryptedPassphrase, encErr := credential.EncryptWithActiveVersion(s.encryptor, strings.TrimSpace(input.Passphrase))
			if encErr != nil {
				return model.Credential{}, encErr
			}
			item.EncryptedPassphrase = stringPtr(encryptedPassphrase.CipherText)
			item.KeyVersion = encryptedPassphrase.KeyVersion
		}
	default:
		return model.Credential{}, ErrInvalidInput
	}

	return createCredential(ctx, tx, item)
}

func buildConnectionName(input QuickConnectInput) string {
	if name := strings.TrimSpace(input.Name); name != "" {
		return name
	}
	username := strings.TrimSpace(input.Username)
	hostName := strings.TrimSpace(input.Host)
	if username != "" && hostName != "" {
		return username + "@" + hostName
	}
	if hostName != "" {
		return hostName
	}
	return username
}

func normalizePort(port int) int {
	if port == 0 {
		return 22
	}
	return port
}

func trimOptional(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return stringPtr(value)
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
