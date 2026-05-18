package credential

import (
	"context"
	"errors"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/model"
)

type Encryptor interface {
	Encrypt(plain string) (string, error)
	Decrypt(cipher string) (string, error)
}

var ErrInvalidInput = errors.New("invalid input")

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

type Service struct {
	repo      Repository
	encryptor Encryptor
	audit     AuditRecorder
}

func NewService(repo Repository, encryptor Encryptor, audit AuditRecorder) *Service {
	return &Service{repo: repo, encryptor: encryptor, audit: audit}
}

func (s *Service) List(ctx context.Context, userID string, filter ListFilter) ([]model.Credential, int, error) {
	return s.repo.ListByUserID(ctx, userID, filter)
}

type CreateInput struct {
	UserID     string `json:"-"`
	Name       string `json:"name"`
	AuthType   string `json:"auth_type"`
	Password   string `json:"password"`
	PrivateKey string `json:"private_key"`
	Passphrase string `json:"passphrase"`
}

type UpdateInput struct {
	Name       *string `json:"name"`
	Password   *string `json:"password"`
	PrivateKey *string `json:"private_key"`
	Passphrase *string `json:"passphrase"`
}

func (s *Service) Create(ctx context.Context, input CreateInput) (model.Credential, error) {
	if err := s.validateCreateInput(input); err != nil {
		return model.Credential{}, err
	}

	secret, privateKey, passphrase, keyVersion, err := s.encryptPayload(input.AuthType, input.Password, input.PrivateKey, input.Passphrase)
	if err != nil {
		return model.Credential{}, err
	}

	item, err := s.repo.Create(ctx, model.Credential{
		UserID:              input.UserID,
		Name:                strings.TrimSpace(input.Name),
		AuthType:            input.AuthType,
		EncryptedSecret:     secret,
		EncryptedPrivateKey: privateKey,
		EncryptedPassphrase: passphrase,
		KeyVersion:          keyVersion,
	})
	if err != nil {
		return model.Credential{}, err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:       item.UserID,
		EventType:    "credential_create",
		ResourceType: stringPtr("credential"),
		ResourceID:   stringPtr(item.ID),
		Result:       string(model.AuditResultSuccess),
	})

	return item, nil
}

func (s *Service) Update(ctx context.Context, userID, credentialID string, input UpdateInput) (model.Credential, error) {
	item, err := s.repo.GetByID(ctx, userID, credentialID)
	if err != nil {
		return model.Credential{}, err
	}

	if input.Name != nil {
		item.Name = strings.TrimSpace(*input.Name)
	}

	switch item.AuthType {
	case string(model.AuthTypePassword):
		if input.Password != nil {
			if strings.TrimSpace(*input.Password) == "" {
				return model.Credential{}, ErrInvalidInput
			}
			encrypted, encErr := s.encryptValue(*input.Password)
			if encErr != nil {
				return model.Credential{}, encErr
			}
			item.EncryptedSecret = stringPtr(encrypted.CipherText)
			item.KeyVersion = encrypted.KeyVersion
		}
	case string(model.AuthTypePrivateKey):
		shouldRewriteSensitive := input.PrivateKey != nil || input.Passphrase != nil
		if shouldRewriteSensitive {
			originalKeyVersion := item.KeyVersion
			originalEncryptedPassphrase := item.EncryptedPassphrase
			privateKey := ""
			if input.PrivateKey != nil {
				privateKey = strings.TrimSpace(*input.PrivateKey)
			} else {
				if item.EncryptedPrivateKey == nil {
					return model.Credential{}, ErrInvalidInput
				}
				decrypted, decErr := s.decryptValue(*item.EncryptedPrivateKey, originalKeyVersion)
				if decErr != nil {
					return model.Credential{}, decErr
				}
				privateKey = strings.TrimSpace(decrypted)
			}
			if privateKey == "" {
				return model.Credential{}, ErrInvalidInput
			}

			encryptedPrivateKey, encErr := s.encryptValue(privateKey)
			if encErr != nil {
				return model.Credential{}, encErr
			}
			item.EncryptedPrivateKey = stringPtr(encryptedPrivateKey.CipherText)
			item.KeyVersion = encryptedPrivateKey.KeyVersion

			var passphrase *string
			if input.Passphrase != nil {
				trimmed := strings.TrimSpace(*input.Passphrase)
				if trimmed != "" {
					passphrase = stringPtr(trimmed)
				}
			} else if originalEncryptedPassphrase != nil {
				decrypted, decErr := s.decryptValue(*originalEncryptedPassphrase, originalKeyVersion)
				if decErr != nil {
					return model.Credential{}, decErr
				}
				trimmed := strings.TrimSpace(decrypted)
				if trimmed != "" {
					passphrase = stringPtr(trimmed)
				}
			}
			if passphrase == nil {
				item.EncryptedPassphrase = nil
			} else {
				encryptedPassphrase, encErr := s.encryptValue(*passphrase)
				if encErr != nil {
					return model.Credential{}, encErr
				}
				item.EncryptedPassphrase = stringPtr(encryptedPassphrase.CipherText)
				item.KeyVersion = encryptedPassphrase.KeyVersion
			}
		}
	default:
		return model.Credential{}, ErrInvalidInput
	}

	if strings.TrimSpace(item.Name) == "" {
		return model.Credential{}, ErrInvalidInput
	}

	updated, err := s.repo.Update(ctx, item)
	if err != nil {
		return model.Credential{}, err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:       updated.UserID,
		EventType:    "credential_update",
		ResourceType: stringPtr("credential"),
		ResourceID:   stringPtr(updated.ID),
		Result:       string(model.AuditResultSuccess),
	})

	return updated, nil
}

func (s *Service) Delete(ctx context.Context, userID, credentialID string) error {
	item, err := s.repo.GetByID(ctx, userID, credentialID)
	if err != nil {
		return err
	}

	if err := s.repo.Delete(ctx, userID, credentialID); err != nil {
		return err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:       item.UserID,
		EventType:    "credential_delete",
		ResourceType: stringPtr("credential"),
		ResourceID:   stringPtr(item.ID),
		Result:       string(model.AuditResultSuccess),
	})

	return nil
}

func (s *Service) Get(ctx context.Context, userID, credentialID string) (model.Credential, error) {
	return s.repo.GetByID(ctx, userID, credentialID)
}

func (s *Service) validateCreateInput(input CreateInput) error {
	if input.UserID == "" || strings.TrimSpace(input.Name) == "" {
		return ErrInvalidInput
	}

	switch input.AuthType {
	case string(model.AuthTypePassword):
		if strings.TrimSpace(input.Password) == "" {
			return ErrInvalidInput
		}
	case string(model.AuthTypePrivateKey):
		if strings.TrimSpace(input.PrivateKey) == "" {
			return ErrInvalidInput
		}
	default:
		return ErrInvalidInput
	}

	return nil
}

func (s *Service) encryptPayload(authType, password, privateKey, passphrase string) (*string, *string, *string, int, error) {
	switch authType {
	case string(model.AuthTypePassword):
		secret, err := s.encryptValue(password)
		if err != nil {
			return nil, nil, nil, 0, err
		}
		return stringPtr(secret.CipherText), nil, nil, secret.KeyVersion, nil
	case string(model.AuthTypePrivateKey):
		encryptedKey, err := s.encryptValue(privateKey)
		if err != nil {
			return nil, nil, nil, 0, err
		}
		var encryptedPassphrase *string
		if strings.TrimSpace(passphrase) != "" {
			encrypted, encErr := s.encryptValue(passphrase)
			if encErr != nil {
				return nil, nil, nil, 0, encErr
			}
			encryptedPassphrase = stringPtr(encrypted.CipherText)
		}
		return nil, stringPtr(encryptedKey.CipherText), encryptedPassphrase, encryptedKey.KeyVersion, nil
	default:
		return nil, nil, nil, 0, ErrInvalidInput
	}
}

func (s *Service) encryptValue(value string) (EncryptedValue, error) {
	return EncryptWithActiveVersion(s.encryptor, strings.TrimSpace(value))
}

func (s *Service) decryptValue(value string, keyVersion int) (string, error) {
	return DecryptWithVersion(s.encryptor, value, keyVersion)
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
