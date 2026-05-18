package credential

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type credentialRepoStub struct {
	item        model.Credential
	createErr   error
	updateErr   error
	deleteErr   error
	getErr      error
	createCalls []model.Credential
	updateCalls []model.Credential
	deleteCalls []string
}

func (s *credentialRepoStub) ListByUserID(context.Context, string, ListFilter) ([]model.Credential, int, error) {
	return []model.Credential{s.item}, 1, nil
}

func (s *credentialRepoStub) Create(_ context.Context, item model.Credential) (model.Credential, error) {
	s.createCalls = append(s.createCalls, item)
	if s.createErr != nil {
		return model.Credential{}, s.createErr
	}
	item.ID = "credential-1"
	s.item = item
	return item, nil
}

func (s *credentialRepoStub) Update(_ context.Context, item model.Credential) (model.Credential, error) {
	s.updateCalls = append(s.updateCalls, item)
	if s.updateErr != nil {
		return model.Credential{}, s.updateErr
	}
	s.item = item
	return item, nil
}

func (s *credentialRepoStub) Delete(_ context.Context, _ string, credentialID string) error {
	s.deleteCalls = append(s.deleteCalls, credentialID)
	return s.deleteErr
}

func (s *credentialRepoStub) GetByID(context.Context, string, string) (model.Credential, error) {
	if s.getErr != nil {
		return model.Credential{}, s.getErr
	}
	return s.item, nil
}

func TestServiceCreatePasswordCredential(t *testing.T) {
	repo := &credentialRepoStub{}
	audit := &credentialAuditRecorder{}
	service := NewService(repo, credentialEncryptorStub{}, audit)

	item, err := service.Create(context.Background(), CreateInput{
		UserID:   "user-1",
		Name:     "  Main Password  ",
		AuthType: string(model.AuthTypePassword),
		Password: "  secret  ",
	})
	if err != nil {
		t.Fatalf("create credential: %v", err)
	}

	if item.Name != "Main Password" {
		t.Fatalf("expected trimmed name, got %q", item.Name)
	}
	if item.EncryptedSecret == nil || *item.EncryptedSecret != "enc:secret" {
		t.Fatalf("expected encrypted trimmed password, got %#v", item.EncryptedSecret)
	}
	if item.EncryptedPrivateKey != nil || item.EncryptedPassphrase != nil {
		t.Fatalf("password credential should not store key fields: %#v", item)
	}
	if item.KeyVersion != 1 {
		t.Fatalf("expected key version 1, got %d", item.KeyVersion)
	}
	if len(audit.logs) != 1 || audit.logs[0].EventType != "credential_create" {
		t.Fatalf("unexpected audit logs: %#v", audit.logs)
	}
}

func TestServiceCreateUsesActiveCredentialKeyVersion(t *testing.T) {
	repo := &credentialRepoStub{}
	service := NewService(repo, credentialVersionedEncryptorStub{activeVersion: 7}, nil)

	item, err := service.Create(context.Background(), CreateInput{
		UserID:   "user-1",
		Name:     "Main Password",
		AuthType: string(model.AuthTypePassword),
		Password: "secret",
	})
	if err != nil {
		t.Fatalf("create credential: %v", err)
	}

	if item.KeyVersion != 7 {
		t.Fatalf("expected key version 7, got %d", item.KeyVersion)
	}
	if item.EncryptedSecret == nil || *item.EncryptedSecret != "enc:7:secret" {
		t.Fatalf("expected active-version ciphertext, got %#v", item.EncryptedSecret)
	}
}

func TestServiceUpdatePasswordCredentialPreservesSecretWhenOmitted(t *testing.T) {
	repo := &credentialRepoStub{item: model.Credential{
		ID:              "credential-1",
		UserID:          "user-1",
		Name:            "Old",
		AuthType:        string(model.AuthTypePassword),
		EncryptedSecret: credentialTestStringPtr("enc:old-secret"),
		KeyVersion:      1,
	}}
	audit := &credentialAuditRecorder{}
	service := NewService(repo, credentialEncryptorStub{}, audit)
	name := "  New Name  "

	item, err := service.Update(context.Background(), "user-1", "credential-1", UpdateInput{Name: &name})
	if err != nil {
		t.Fatalf("update credential: %v", err)
	}

	if item.Name != "New Name" {
		t.Fatalf("expected trimmed updated name, got %q", item.Name)
	}
	if item.EncryptedSecret == nil || *item.EncryptedSecret != "enc:old-secret" {
		t.Fatalf("expected secret to be preserved, got %#v", item.EncryptedSecret)
	}
	if len(repo.updateCalls) != 1 {
		t.Fatalf("expected one update call, got %d", len(repo.updateCalls))
	}
	if len(audit.logs) != 1 || audit.logs[0].EventType != "credential_update" {
		t.Fatalf("unexpected audit logs: %#v", audit.logs)
	}
}

func TestServiceUpdatePrivateKeyPassphrase(t *testing.T) {
	repo := &credentialRepoStub{item: model.Credential{
		ID:                  "credential-1",
		UserID:              "user-1",
		Name:                "Key",
		AuthType:            string(model.AuthTypePrivateKey),
		EncryptedPrivateKey: credentialTestStringPtr("enc:old-key"),
		EncryptedPassphrase: credentialTestStringPtr("enc:old-passphrase"),
		KeyVersion:          1,
	}}
	service := NewService(repo, credentialEncryptorStub{}, nil)

	emptyPassphrase := "   "
	item, err := service.Update(context.Background(), "user-1", "credential-1", UpdateInput{Passphrase: &emptyPassphrase})
	if err != nil {
		t.Fatalf("update credential: %v", err)
	}
	if item.EncryptedPrivateKey == nil || *item.EncryptedPrivateKey != "enc:old-key" {
		t.Fatalf("expected private key to be preserved, got %#v", item.EncryptedPrivateKey)
	}
	if item.EncryptedPassphrase != nil {
		t.Fatalf("expected passphrase to be cleared, got %#v", item.EncryptedPassphrase)
	}

	newKey := "  new-key  "
	newPassphrase := "  new-passphrase  "
	item, err = service.Update(context.Background(), "user-1", "credential-1", UpdateInput{
		PrivateKey: &newKey,
		Passphrase: &newPassphrase,
	})
	if err != nil {
		t.Fatalf("update credential: %v", err)
	}
	if item.EncryptedPrivateKey == nil || *item.EncryptedPrivateKey != "enc:new-key" {
		t.Fatalf("expected updated private key, got %#v", item.EncryptedPrivateKey)
	}
	if item.EncryptedPassphrase == nil || *item.EncryptedPassphrase != "enc:new-passphrase" {
		t.Fatalf("expected updated passphrase, got %#v", item.EncryptedPassphrase)
	}
}

func TestServiceUpdatePrivateKeyRewritesAllSensitiveFieldsToActiveVersion(t *testing.T) {
	repo := &credentialRepoStub{item: model.Credential{
		ID:                  "credential-1",
		UserID:              "user-1",
		Name:                "Key",
		AuthType:            string(model.AuthTypePrivateKey),
		EncryptedPrivateKey: credentialTestStringPtr("enc:1:old-key"),
		EncryptedPassphrase: credentialTestStringPtr("enc:1:old-passphrase"),
		KeyVersion:          1,
	}}
	service := NewService(repo, credentialVersionedEncryptorStub{activeVersion: 2}, nil)

	newPassphrase := "  new-passphrase  "
	item, err := service.Update(context.Background(), "user-1", "credential-1", UpdateInput{Passphrase: &newPassphrase})
	if err != nil {
		t.Fatalf("update credential: %v", err)
	}

	if item.KeyVersion != 2 {
		t.Fatalf("expected active key version 2, got %d", item.KeyVersion)
	}
	if item.EncryptedPrivateKey == nil || *item.EncryptedPrivateKey != "enc:2:old-key" {
		t.Fatalf("expected private key reencrypted with active key, got %#v", item.EncryptedPrivateKey)
	}
	if item.EncryptedPassphrase == nil || *item.EncryptedPassphrase != "enc:2:new-passphrase" {
		t.Fatalf("expected new passphrase encrypted with active key, got %#v", item.EncryptedPassphrase)
	}
}

func TestServiceRejectsInvalidInputs(t *testing.T) {
	repo := &credentialRepoStub{item: model.Credential{
		ID:              "credential-1",
		UserID:          "user-1",
		Name:            "Password",
		AuthType:        string(model.AuthTypePassword),
		EncryptedSecret: credentialTestStringPtr("enc:old-secret"),
		KeyVersion:      1,
	}}
	service := NewService(repo, credentialEncryptorStub{}, nil)

	if _, err := service.Create(context.Background(), CreateInput{
		UserID:   "user-1",
		Name:     "No Secret",
		AuthType: string(model.AuthTypePassword),
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for missing password, got %v", err)
	}

	emptyPassword := " "
	if _, err := service.Update(context.Background(), "user-1", "credential-1", UpdateInput{Password: &emptyPassword}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for blank password update, got %v", err)
	}

	emptyName := " "
	if _, err := service.Update(context.Background(), "user-1", "credential-1", UpdateInput{Name: &emptyName}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for blank name update, got %v", err)
	}
}

func TestServiceDeleteRecordsAuditAfterRepositoryDelete(t *testing.T) {
	repo := &credentialRepoStub{item: model.Credential{
		ID:       "credential-1",
		UserID:   "user-1",
		Name:     "Password",
		AuthType: string(model.AuthTypePassword),
	}}
	audit := &credentialAuditRecorder{}
	service := NewService(repo, credentialEncryptorStub{}, audit)

	if err := service.Delete(context.Background(), "user-1", "credential-1"); err != nil {
		t.Fatalf("delete credential: %v", err)
	}
	if len(repo.deleteCalls) != 1 || repo.deleteCalls[0] != "credential-1" {
		t.Fatalf("unexpected delete calls: %#v", repo.deleteCalls)
	}
	if len(audit.logs) != 1 || audit.logs[0].EventType != "credential_delete" {
		t.Fatalf("unexpected audit logs: %#v", audit.logs)
	}

	repo.deleteErr = db.ErrNotFound
	if err := service.Delete(context.Background(), "user-1", "credential-1"); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("expected delete error, got %v", err)
	}
	if len(audit.logs) != 1 {
		t.Fatalf("delete failure should not record audit, got %#v", audit.logs)
	}
}

func credentialTestStringPtr(value string) *string {
	return &value
}

type credentialVersionedEncryptorStub struct {
	activeVersion int
}

func (s credentialVersionedEncryptorStub) Encrypt(plain string) (string, error) {
	value, err := s.EncryptWithActiveVersion(plain)
	return value.CipherText, err
}

func (s credentialVersionedEncryptorStub) Decrypt(cipher string) (string, error) {
	return s.DecryptWithVersion(cipher, s.activeVersion)
}

func (s credentialVersionedEncryptorStub) EncryptWithActiveVersion(plain string) (EncryptedValue, error) {
	return EncryptedValue{
		CipherText: "enc:" + strconv.Itoa(s.activeVersion) + ":" + strings.TrimSpace(plain),
		KeyVersion: s.activeVersion,
	}, nil
}

func (s credentialVersionedEncryptorStub) DecryptWithVersion(cipher string, keyVersion int) (string, error) {
	return strings.TrimPrefix(cipher, "enc:"+strconv.Itoa(keyVersion)+":"), nil
}

func (s credentialVersionedEncryptorStub) ActiveKeyVersion() int {
	return s.activeVersion
}

func (s credentialVersionedEncryptorStub) ConfiguredKeyVersions() []int {
	return []int{s.activeVersion}
}

func (s credentialVersionedEncryptorStub) IsKeyVersionConfigured(keyVersion int) bool {
	return keyVersion == s.activeVersion
}
