package host

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

func TestPostgresRepositoryHostLifecycleAndFingerprint(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	userID := pgtest.InsertUser(t, database, "host-user@example.com")
	otherUserID := pgtest.InsertUser(t, database, "host-other@example.com")
	groupID := pgtest.InsertHostGroup(t, database, userID, "Ops")

	credentialID := pgtest.MustQueryRow(t, database,
		`INSERT INTO credentials (user_id, name, auth_type, encrypted_secret, key_version) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		userID,
		"Host Credential",
		string(model.AuthTypePassword),
		"enc-secret",
		1,
	)

	primary, err := repo.Create(ctx, model.Host{
		UserID:       userID,
		GroupID:      &groupID,
		CredentialID: &credentialID,
		Name:         "Primary Host",
		Host:         "192.0.2.10",
		Port:         22,
		Username:     "root",
		AuthType:     string(model.AuthTypePassword),
		Status:       string(model.HostStatusActive),
		IsFavorite:   true,
	})
	if err != nil {
		t.Fatalf("create host: %v", err)
	}
	if _, err := repo.Create(ctx, model.Host{
		UserID:     userID,
		Name:       "Secondary Host",
		Host:       "198.51.100.20",
		Port:       2022,
		Username:   "deploy",
		AuthType:   string(model.AuthTypePrivateKey),
		Status:     string(model.HostStatusActive),
		IsFavorite: false,
	}); err != nil {
		t.Fatalf("create secondary host: %v", err)
	}
	if _, err := repo.Create(ctx, model.Host{
		UserID:     otherUserID,
		Name:       "Other User Host",
		Host:       "203.0.113.30",
		Port:       22,
		Username:   "ubuntu",
		AuthType:   string(model.AuthTypePassword),
		Status:     string(model.HostStatusActive),
		IsFavorite: false,
	}); err != nil {
		t.Fatalf("create other user host: %v", err)
	}

	items, total, err := repo.ListByUserID(ctx, userID, ListFilter{
		Limit:        20,
		Offset:       0,
		Keyword:      "Primary",
		FavoriteOnly: true,
		GroupID:      groupID,
	})
	if err != nil {
		t.Fatalf("list hosts: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ID != primary.ID {
		t.Fatalf("unexpected listed hosts: total=%d items=%#v", total, items)
	}

	primary.Name = "Updated Host"
	primary.Port = 2222
	updated, err := repo.Update(ctx, primary)
	if err != nil {
		t.Fatalf("update host: %v", err)
	}
	if updated.Name != "Updated Host" || updated.Port != 2222 {
		t.Fatalf("unexpected updated host: %#v", updated)
	}

	connectedAt := time.Now().UTC().Truncate(time.Second)
	if err := repo.UpdateLastConnectedAt(ctx, userID, primary.ID, connectedAt); err != nil {
		t.Fatalf("update last connected at: %v", err)
	}
	loaded, err := repo.GetByID(ctx, userID, primary.ID)
	if err != nil {
		t.Fatalf("get host: %v", err)
	}
	if loaded.LastConnectedAt == nil || !loaded.LastConnectedAt.Equal(connectedAt) {
		t.Fatalf("unexpected last_connected_at: %#v", loaded.LastConnectedAt)
	}

	firstFingerprint, err := repo.UpsertFingerprint(ctx, primary.ID, "ssh-ed25519", "fp-1", string(model.FingerprintStatusChanged))
	if err != nil {
		t.Fatalf("insert fingerprint: %v", err)
	}
	secondFingerprint, err := repo.UpsertFingerprint(ctx, primary.ID, "ssh-rsa", "fp-2", string(model.FingerprintStatusTrusted))
	if err != nil {
		t.Fatalf("insert trusted fingerprint: %v", err)
	}
	updatedFingerprint, err := repo.UpsertFingerprint(ctx, primary.ID, "ssh-ed25519", "fp-1b", string(model.FingerprintStatusRevoked))
	if err != nil {
		t.Fatalf("update fingerprint: %v", err)
	}
	if updatedFingerprint.ID != firstFingerprint.ID || updatedFingerprint.Fingerprint != "fp-1b" {
		t.Fatalf("unexpected upserted fingerprint: %#v", updatedFingerprint)
	}

	fingerprints, err := repo.ListFingerprintsByHostID(ctx, primary.ID)
	if err != nil {
		t.Fatalf("list fingerprints: %v", err)
	}
	if len(fingerprints) != 2 {
		t.Fatalf("expected 2 fingerprints, got %d", len(fingerprints))
	}
	if fingerprints[0].ID != secondFingerprint.ID {
		t.Fatalf("expected trusted fingerprint first, got %#v", fingerprints)
	}

	primaryFingerprint, err := repo.GetPrimaryFingerprintByHostID(ctx, primary.ID)
	if err != nil {
		t.Fatalf("get primary fingerprint: %v", err)
	}
	if primaryFingerprint.ID != secondFingerprint.ID {
		t.Fatalf("expected trusted primary fingerprint, got %#v", primaryFingerprint)
	}

	if err := repo.Delete(ctx, userID, primary.ID); err != nil {
		t.Fatalf("delete host: %v", err)
	}
	if _, err := repo.GetByID(ctx, userID, primary.ID); !db.IsNotFound(err) {
		t.Fatalf("expected archived host to be hidden, got %v", err)
	}
}
