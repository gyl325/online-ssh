package credential

import (
	"context"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

func TestPostgresRepositoryCredentialLifecycle(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	userID := pgtest.InsertUser(t, database, "credential-user@example.com")
	otherUserID := pgtest.InsertUser(t, database, "credential-other@example.com")

	passwordCredential, err := repo.Create(ctx, model.Credential{
		UserID:          userID,
		Name:            "Password Credential",
		AuthType:        string(model.AuthTypePassword),
		EncryptedSecret: stringRef("enc-password"),
		KeyVersion:      1,
	})
	if err != nil {
		t.Fatalf("create password credential: %v", err)
	}
	privateKeyCredential, err := repo.Create(ctx, model.Credential{
		UserID:              userID,
		Name:                "Private Key Credential",
		AuthType:            string(model.AuthTypePrivateKey),
		EncryptedPrivateKey: stringRef("enc-private-key"),
		EncryptedPassphrase: stringRef("enc-passphrase"),
		KeyVersion:          2,
	})
	if err != nil {
		t.Fatalf("create private key credential: %v", err)
	}
	if _, err := repo.Create(ctx, model.Credential{
		UserID:          otherUserID,
		Name:            "Other User Credential",
		AuthType:        string(model.AuthTypePassword),
		EncryptedSecret: stringRef("enc-password"),
		KeyVersion:      1,
	}); err != nil {
		t.Fatalf("create other user credential: %v", err)
	}

	items, total, err := repo.ListByUserID(ctx, userID, ListFilter{Limit: 20, Offset: 0})
	if err != nil {
		t.Fatalf("list credentials: %v", err)
	}
	if total != 2 || len(items) != 2 {
		t.Fatalf("expected 2 credentials, got total=%d len=%d", total, len(items))
	}

	items, total, err = repo.ListByUserID(ctx, userID, ListFilter{
		Limit:    20,
		Offset:   0,
		AuthType: string(model.AuthTypePrivateKey),
	})
	if err != nil {
		t.Fatalf("list filtered credentials: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ID != privateKeyCredential.ID {
		t.Fatalf("unexpected filtered credentials: total=%d items=%#v", total, items)
	}

	passwordCredential.Name = "Updated Password Credential"
	passwordCredential.EncryptedSecret = stringRef("enc-password-updated")
	passwordCredential.KeyVersion = 3
	updated, err := repo.Update(ctx, passwordCredential)
	if err != nil {
		t.Fatalf("update credential: %v", err)
	}
	if updated.Name != "Updated Password Credential" || updated.KeyVersion != 3 {
		t.Fatalf("unexpected updated credential: %#v", updated)
	}

	counts, err := repo.CountByKeyVersion(ctx)
	if err != nil {
		t.Fatalf("count credentials by key version: %v", err)
	}
	if len(counts) != 3 ||
		counts[0] != (KeyVersionCount{KeyVersion: 1, Count: 1}) ||
		counts[1] != (KeyVersionCount{KeyVersion: 2, Count: 1}) ||
		counts[2] != (KeyVersionCount{KeyVersion: 3, Count: 1}) {
		t.Fatalf("unexpected key version counts: %#v", counts)
	}

	loaded, err := repo.GetByID(ctx, userID, passwordCredential.ID)
	if err != nil {
		t.Fatalf("get credential: %v", err)
	}
	if loaded.EncryptedSecret == nil || *loaded.EncryptedSecret != "enc-password-updated" {
		t.Fatalf("unexpected loaded secret: %#v", loaded.EncryptedSecret)
	}

	if err := repo.Delete(ctx, userID, privateKeyCredential.ID); err != nil {
		t.Fatalf("delete credential: %v", err)
	}
	if _, err := repo.GetByID(ctx, userID, privateKeyCredential.ID); !db.IsNotFound(err) {
		t.Fatalf("expected deleted credential to be not found, got %v", err)
	}
}
