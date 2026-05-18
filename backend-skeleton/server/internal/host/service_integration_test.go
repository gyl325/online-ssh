package host

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/hostgroup"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

type hostAuditRecorder struct {
	logs []model.AuditLog
}

func (r *hostAuditRecorder) Record(_ context.Context, log model.AuditLog) error {
	r.logs = append(r.logs, log)
	return nil
}

func TestServiceHostLifecycleAndConfirmFingerprint(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	hostRepo := NewPostgresRepository(database)
	groupRepo := hostgroup.NewPostgresRepository(database)
	credentialRepo := credential.NewPostgresRepository(database)
	audit := &hostAuditRecorder{}
	service := NewService(hostRepo, groupRepo, credentialRepo, nil, audit)
	ctx := context.Background()

	userID := pgtest.InsertUser(t, database, "host-service@example.com")
	otherUserID := pgtest.InsertUser(t, database, "host-service-other@example.com")
	groupID := pgtest.InsertHostGroup(t, database, userID, "Ops")
	otherGroupID := pgtest.InsertHostGroup(t, database, otherUserID, "Other Ops")

	credentialItem, err := credentialRepo.Create(ctx, model.Credential{
		UserID:          userID,
		Name:            "Host Credential",
		AuthType:        string(model.AuthTypePassword),
		EncryptedSecret: hostStringRef("enc-password"),
		KeyVersion:      1,
	})
	if err != nil {
		t.Fatalf("create credential: %v", err)
	}

	invalidCredentialID := "11111111-1111-1111-1111-111111111111"
	if _, err := service.Create(ctx, CreateInput{
		UserID:       userID,
		CredentialID: &invalidCredentialID,
		Name:         "invalid",
		Host:         "192.0.2.1",
		Port:         22,
		Username:     "root",
		AuthType:     string(model.AuthTypePassword),
		IsFavorite:   false,
	}); err != ErrInvalidInput {
		t.Fatalf("expected ErrInvalidInput for missing credential, got %v", err)
	}

	if _, err := service.Create(ctx, CreateInput{
		UserID:       userID,
		GroupID:      &otherGroupID,
		CredentialID: hostStringRef(credentialItem.ID),
		Name:         "invalid group",
		Host:         "192.0.2.1",
		Port:         22,
		Username:     "root",
		AuthType:     string(model.AuthTypePassword),
		IsFavorite:   false,
	}); err != ErrInvalidInput {
		t.Fatalf("expected ErrInvalidInput for cross-user group, got %v", err)
	}

	item, err := service.Create(ctx, CreateInput{
		UserID:       userID,
		GroupID:      &groupID,
		CredentialID: hostStringRef(credentialItem.ID),
		Name:         "  Main Host  ",
		Host:         " 192.0.2.1 ",
		Port:         0,
		Username:     " root ",
		AuthType:     string(model.AuthTypePassword),
		IsFavorite:   true,
	})
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	if item.Name != "Main Host" || item.Host != "192.0.2.1" || item.Username != "root" || item.Port != 22 {
		t.Fatalf("unexpected normalized host: %#v", item)
	}
	if item.GroupID == nil || *item.GroupID != groupID {
		t.Fatalf("expected host group %s, got %#v", groupID, item.GroupID)
	}

	newName := " Updated Host "
	newPort := 2200
	updated, err := service.Update(ctx, userID, item.ID, UpdateInput{
		Name:       &newName,
		Port:       &newPort,
		IsFavorite: boolRef(false),
	})
	if err != nil {
		t.Fatalf("update host: %v", err)
	}
	if updated.Name != "Updated Host" || updated.Port != 2200 || updated.IsFavorite {
		t.Fatalf("unexpected updated host: %#v", updated)
	}

	var clearInput UpdateInput
	if err := json.Unmarshal([]byte(`{"group_id":null,"credential_id":null}`), &clearInput); err != nil {
		t.Fatalf("decode clear update input: %v", err)
	}
	cleared, err := service.Update(ctx, userID, item.ID, clearInput)
	if err != nil {
		t.Fatalf("clear host group and credential: %v", err)
	}
	if cleared.GroupID != nil || cleared.CredentialID != nil {
		t.Fatalf("expected cleared group and credential, got group=%#v credential=%#v", cleared.GroupID, cleared.CredentialID)
	}

	fingerprint, err := service.ConfirmFingerprint(ctx, userID, item.ID, ConfirmFingerprintInput{
		Algorithm:   " ssh-ed25519 ",
		Fingerprint: " fp-value ",
	})
	if err != nil {
		t.Fatalf("confirm fingerprint: %v", err)
	}
	if fingerprint.Algorithm != "ssh-ed25519" || fingerprint.Fingerprint != "fp-value" {
		t.Fatalf("unexpected confirmed fingerprint: %#v", fingerprint)
	}

	if err := service.Delete(ctx, userID, item.ID); err != nil {
		t.Fatalf("delete host: %v", err)
	}
	if len(audit.logs) != 5 {
		t.Fatalf("expected 5 audit logs, got %d", len(audit.logs))
	}
	if audit.logs[0].EventType != "host_create" || audit.logs[1].EventType != "host_update" || audit.logs[2].EventType != "host_update" || audit.logs[3].EventType != "host_fingerprint_confirm" || audit.logs[4].EventType != "host_delete" {
		t.Fatalf("unexpected host audit sequence: %#v", audit.logs)
	}
}

func hostStringRef(value string) *string {
	return &value
}

func boolRef(value bool) *bool {
	return &value
}
