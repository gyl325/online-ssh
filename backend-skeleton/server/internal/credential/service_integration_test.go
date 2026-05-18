package credential

import (
	"context"
	"strings"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

type credentialEncryptorStub struct{}

func (credentialEncryptorStub) Encrypt(plain string) (string, error) {
	return "enc:" + plain, nil
}

func (credentialEncryptorStub) Decrypt(cipher string) (string, error) {
	return strings.TrimPrefix(cipher, "enc:"), nil
}

type credentialAuditRecorder struct {
	logs []model.AuditLog
}

func (r *credentialAuditRecorder) Record(_ context.Context, log model.AuditLog) error {
	r.logs = append(r.logs, log)
	return nil
}

func TestServiceCredentialLifecycle(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	audit := &credentialAuditRecorder{}
	service := NewService(repo, credentialEncryptorStub{}, audit)
	ctx := context.Background()

	userID := pgtest.InsertUser(t, database, "credential-service@example.com")

	if _, err := service.Create(ctx, CreateInput{
		UserID:   userID,
		Name:     "invalid",
		AuthType: string(model.AuthTypePassword),
	}); err != ErrInvalidInput {
		t.Fatalf("expected ErrInvalidInput for missing password, got %v", err)
	}

	item, err := service.Create(ctx, CreateInput{
		UserID:   userID,
		Name:     "  Main Credential  ",
		AuthType: string(model.AuthTypePassword),
		Password: "  secret  ",
	})
	if err != nil {
		t.Fatalf("create credential: %v", err)
	}
	if item.Name != "Main Credential" {
		t.Fatalf("expected trimmed name, got %q", item.Name)
	}
	if item.EncryptedSecret == nil || *item.EncryptedSecret != "enc:secret" {
		t.Fatalf("expected encrypted secret, got %#v", item.EncryptedSecret)
	}

	newName := " Updated Credential "
	newPassword := "  new-secret  "
	updated, err := service.Update(ctx, userID, item.ID, UpdateInput{
		Name:     &newName,
		Password: &newPassword,
	})
	if err != nil {
		t.Fatalf("update credential: %v", err)
	}
	if updated.Name != "Updated Credential" {
		t.Fatalf("expected trimmed updated name, got %q", updated.Name)
	}
	if updated.EncryptedSecret == nil || *updated.EncryptedSecret != "enc:new-secret" {
		t.Fatalf("expected updated encrypted secret, got %#v", updated.EncryptedSecret)
	}

	items, total, err := service.List(ctx, userID, ListFilter{Limit: 20, Offset: 0})
	if err != nil {
		t.Fatalf("list credentials: %v", err)
	}
	if total != 1 || len(items) != 1 {
		t.Fatalf("unexpected listed credentials: total=%d len=%d", total, len(items))
	}

	if err := service.Delete(ctx, userID, item.ID); err != nil {
		t.Fatalf("delete credential: %v", err)
	}
	if len(audit.logs) != 3 {
		t.Fatalf("expected 3 audit logs, got %d", len(audit.logs))
	}
	if audit.logs[0].EventType != "credential_create" || audit.logs[1].EventType != "credential_update" || audit.logs[2].EventType != "credential_delete" {
		t.Fatalf("unexpected credential audit sequence: %#v", audit.logs)
	}
}

func stringRef(value string) *string {
	return &value
}
