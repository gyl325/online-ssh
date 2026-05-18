package connection

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

type testEncryptor struct{}

func (testEncryptor) Encrypt(plain string) (string, error) {
	return "enc:" + plain, nil
}

func (testEncryptor) Decrypt(cipherText string) (string, error) {
	return strings.TrimPrefix(cipherText, "enc:"), nil
}

type auditRecorder struct {
	logs []model.AuditLog
}

func (r *auditRecorder) Record(_ context.Context, log model.AuditLog) error {
	r.logs = append(r.logs, log)
	return nil
}

func TestServiceQuickConnectCreatesCredentialAndHost(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	audit := &auditRecorder{}
	service := NewService(database, testEncryptor{}, audit)
	ctx := context.Background()
	userID := pgtest.InsertUser(t, database, "quick-connect@example.com")
	groupID := pgtest.InsertHostGroup(t, database, userID, "Production")

	result, err := service.QuickConnect(ctx, QuickConnectInput{
		UserID:         userID,
		GroupID:        &groupID,
		Name:           "  Prod SSH  ",
		Host:           " 203.0.113.10 ",
		Port:           0,
		Username:       " root ",
		AuthType:       string(model.AuthTypePassword),
		CredentialName: " Prod password ",
		Password:       " secret-password ",
		IsFavorite:     true,
	})
	if err != nil {
		t.Fatalf("quick connect: %v", err)
	}

	if !result.CreatedCredential {
		t.Fatalf("expected a new credential to be created")
	}
	if result.Credential.Name != "Prod password" || result.Credential.EncryptedSecret == nil || *result.Credential.EncryptedSecret != "enc:secret-password" {
		t.Fatalf("unexpected credential: %#v", result.Credential)
	}
	if result.Host.Name != "Prod SSH" || result.Host.Host != "203.0.113.10" || result.Host.Username != "root" || result.Host.Port != 22 {
		t.Fatalf("unexpected host normalization: %#v", result.Host)
	}
	if result.Host.CredentialID == nil || *result.Host.CredentialID != result.Credential.ID {
		t.Fatalf("expected host to reference created credential, got %#v", result.Host.CredentialID)
	}
	if result.Host.GroupID == nil || *result.Host.GroupID != groupID || !result.Host.IsFavorite {
		t.Fatalf("unexpected host group/favorite: %#v", result.Host)
	}
	if len(audit.logs) != 2 || audit.logs[0].EventType != "credential_create" || audit.logs[1].EventType != "host_create" {
		t.Fatalf("unexpected audit sequence: %#v", audit.logs)
	}
}

func TestServiceQuickConnectUsesExistingCredential(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	service := NewService(database, testEncryptor{}, nil)
	ctx := context.Background()
	userID := pgtest.InsertUser(t, database, "quick-connect-existing@example.com")
	credentialID := insertCredential(t, database, userID, string(model.AuthTypePassword))

	result, err := service.QuickConnect(ctx, QuickConnectInput{
		UserID:       userID,
		CredentialID: &credentialID,
		Name:         "Existing credential host",
		Host:         "203.0.113.11",
		Port:         2222,
		Username:     "deploy",
		AuthType:     string(model.AuthTypePassword),
		IsFavorite:   false,
	})
	if err != nil {
		t.Fatalf("quick connect with existing credential: %v", err)
	}

	if result.CreatedCredential {
		t.Fatalf("expected existing credential to be reused")
	}
	if result.Credential.ID != credentialID {
		t.Fatalf("expected credential %s, got %#v", credentialID, result.Credential)
	}
	if result.Host.CredentialID == nil || *result.Host.CredentialID != credentialID {
		t.Fatalf("expected host to reference existing credential, got %#v", result.Host.CredentialID)
	}

	count := countRows(t, database, `SELECT COUNT(*) FROM credentials WHERE user_id = $1`, userID)
	if count != 1 {
		t.Fatalf("expected one credential, got %d", count)
	}
}

func TestServiceQuickConnectRollsBackCredentialWhenHostValidationFails(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	service := NewService(database, testEncryptor{}, nil)
	ctx := context.Background()
	userID := pgtest.InsertUser(t, database, "quick-connect-rollback@example.com")
	missingGroupID := "11111111-1111-1111-1111-111111111111"

	_, err := service.QuickConnect(ctx, QuickConnectInput{
		UserID:         userID,
		GroupID:        &missingGroupID,
		Name:           "Rollback host",
		Host:           "203.0.113.12",
		Port:           22,
		Username:       "root",
		AuthType:       string(model.AuthTypePassword),
		CredentialName: "Rollback credential",
		Password:       "secret-password",
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}

	credentialCount := countRows(t, database, `SELECT COUNT(*) FROM credentials WHERE user_id = $1`, userID)
	hostCount := countRows(t, database, `SELECT COUNT(*) FROM hosts WHERE user_id = $1`, userID)
	if credentialCount != 0 || hostCount != 0 {
		t.Fatalf("expected transaction rollback, got credentials=%d hosts=%d", credentialCount, hostCount)
	}
}

func insertCredential(t *testing.T, database *db.DB, userID, authType string) string {
	t.Helper()

	return pgtest.MustQueryRow(t, database,
		`INSERT INTO credentials (user_id, name, auth_type, encrypted_secret, key_version) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		userID,
		"Existing credential",
		authType,
		"enc:secret",
		1,
	)
}

func countRows(t *testing.T, database *db.DB, query string, args ...any) int {
	t.Helper()

	var count int
	if err := database.SQL.QueryRowContext(context.Background(), query, args...).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return count
}
