package admin

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

func TestPostgresRepositoryAdminUserAndSessionManagement(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	adminID := pgtest.InsertUser(t, database, "admin@example.com")
	userID := pgtest.InsertUser(t, database, "user@example.com")
	pgtest.MustExecContext(t, database, `UPDATE users SET role = 'admin' WHERE id = $1`, adminID)
	pgtest.MustExecContext(t, database, `UPDATE users SET role = 'user' WHERE id = $1`, userID)
	pgtest.MustExecContext(t, database, `
		INSERT INTO roles (key, name, description, is_system, is_active)
		VALUES ('auditor', 'Auditor', 'Read audit data', false, true)
	`)
	pgtest.MustExecContext(t, database, `
		INSERT INTO role_permissions (role_key, permission)
		VALUES ('auditor', 'audit.read')
	`)

	adminSessionID := insertUserSession(t, database, adminID, "admin-session-hash", time.Now().Add(time.Hour))
	userSessionID := insertUserSession(t, database, userID, "user-session-hash", time.Now().Add(time.Hour))

	roles, err := repo.ListRoles(ctx)
	if err != nil {
		t.Fatalf("list roles: %v", err)
	}
	if len(roles) < 3 {
		t.Fatalf("expected seeded roles and custom role, got %#v", roles)
	}
	adminRole, err := repo.GetRole(ctx, "admin")
	if err != nil {
		t.Fatalf("get admin role: %v", err)
	}
	if !adminRole.HasPermission(model.PermissionAdminAccess) {
		t.Fatalf("expected admin role to include admin access, got %#v", adminRole.Permissions)
	}
	count, err := repo.CountUsersWithPermission(ctx, model.PermissionAdminAccess)
	if err != nil {
		t.Fatalf("count users with admin access: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one admin access holder, got %d", count)
	}

	users, err := repo.ListUsers(ctx)
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if len(users) != 2 {
		t.Fatalf("expected 2 users, got %#v", users)
	}
	var foundAdmin bool
	for _, item := range users {
		if item.ID == adminID {
			foundAdmin = true
			if item.Role != string(model.UserRoleAdmin) {
				t.Fatalf("expected migrated admin role, got %q", item.Role)
			}
			if item.ActiveSessionCount != 1 {
				t.Fatalf("expected active session count 1, got %d", item.ActiveSessionCount)
			}
		}
	}
	if !foundAdmin {
		t.Fatalf("expected admin user %s in list %#v", adminID, users)
	}

	updatedUser, err := repo.UpdateUserRole(ctx, userID, "auditor")
	if err != nil {
		t.Fatalf("update user role: %v", err)
	}
	if updatedUser.Role != "auditor" {
		t.Fatalf("expected custom auditor role, got %q", updatedUser.Role)
	}

	disabledUser, err := repo.UpdateUserStatus(ctx, userID, model.UserStatusDisabled)
	if err != nil {
		t.Fatalf("update user status: %v", err)
	}
	if disabledUser.Status != string(model.UserStatusDisabled) {
		t.Fatalf("expected disabled status, got %q", disabledUser.Status)
	}

	sessions, err := repo.ListSessions(ctx, time.Now())
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %#v", sessions)
	}

	revoked, err := repo.RevokeSessionsByUserID(ctx, userID, "", time.Now())
	if err != nil {
		t.Fatalf("revoke user sessions: %v", err)
	}
	if revoked != 1 {
		t.Fatalf("expected one revoked user session, got %d", revoked)
	}

	sessions, err = repo.ListSessions(ctx, time.Now())
	if err != nil {
		t.Fatalf("list sessions after revoke: %v", err)
	}
	if len(sessions) != 1 || sessions[0].ID != adminSessionID {
		t.Fatalf("expected only admin session %s, got %#v", adminSessionID, sessions)
	}

	revokedSessionUserID, err := repo.RevokeSession(ctx, adminSessionID, time.Now())
	if err != nil {
		t.Fatalf("revoke admin session: %v", err)
	}
	if revokedSessionUserID != adminID {
		t.Fatalf("expected revoked admin session user id %s, got %s", adminID, revokedSessionUserID)
	}

	sessions, err = repo.ListSessions(ctx, time.Now())
	if err != nil {
		t.Fatalf("list sessions after admin revoke: %v", err)
	}
	if len(sessions) != 0 {
		t.Fatalf("expected no active sessions after revoking %s and %s, got %#v", adminSessionID, userSessionID, sessions)
	}
}

func TestPostgresRepositoryDatabaseBackupLifecycle(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	userID := pgtest.InsertUser(t, database, "database-backup@example.com")
	groupID := pgtest.InsertHostGroup(t, database, userID, "Production")
	credentialID := pgtest.MustQueryRow(t, database,
		`INSERT INTO credentials (user_id, name, auth_type, encrypted_secret, key_version)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		userID,
		"Password credential",
		string(model.AuthTypePassword),
		"encrypted-secret",
		1,
	)
	hostID := pgtest.MustQueryRow(t, database,
		`INSERT INTO hosts (user_id, group_id, credential_id, name, host, port, username, auth_type, is_favorite)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
		 RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		userID,
		groupID,
		credentialID,
		"App server",
		"10.0.0.5",
		22,
		"deploy",
		string(model.AuthTypePassword),
	)

	groups, err := repo.ListDatabaseHostGroups(ctx)
	if err != nil {
		t.Fatalf("list database host groups: %v", err)
	}
	if len(groups) != 1 || groups[0].ID != groupID {
		t.Fatalf("unexpected database host groups: %#v", groups)
	}
	credentials, err := repo.ListDatabaseCredentials(ctx)
	if err != nil {
		t.Fatalf("list database credentials: %v", err)
	}
	if len(credentials) != 1 || credentials[0].ID != credentialID || credentials[0].EncryptedSecret == nil || *credentials[0].EncryptedSecret != "encrypted-secret" {
		t.Fatalf("unexpected database credentials: %#v", credentials)
	}
	hosts, err := repo.ListDatabaseHosts(ctx)
	if err != nil {
		t.Fatalf("list database hosts: %v", err)
	}
	if len(hosts) != 1 || hosts[0].ID != hostID || hosts[0].CredentialID == nil || *hosts[0].CredentialID != credentialID {
		t.Fatalf("unexpected database hosts: %#v", hosts)
	}

	newGroup, err := repo.CreateDatabaseHostGroup(ctx, model.HostGroup{
		UserID:    userID,
		Name:      "Staging",
		SortOrder: 30,
	})
	if err != nil {
		t.Fatalf("create database host group: %v", err)
	}
	newCredential, err := repo.CreateDatabaseCredential(ctx, model.Credential{
		UserID:              userID,
		Name:                "Key credential",
		AuthType:            string(model.AuthTypePrivateKey),
		EncryptedPrivateKey: stringPtr("encrypted-private-key"),
		EncryptedPassphrase: stringPtr("encrypted-passphrase"),
		KeyVersion:          2,
	})
	if err != nil {
		t.Fatalf("create database credential: %v", err)
	}
	lastConnectedAt := time.Date(2026, 5, 4, 9, 30, 0, 0, time.UTC)
	newHost, err := repo.CreateDatabaseHost(ctx, model.Host{
		UserID:          userID,
		GroupID:         &newGroup.ID,
		CredentialID:    &newCredential.ID,
		Name:            "Imported host",
		Host:            "10.0.0.6",
		Port:            2222,
		Username:        "ubuntu",
		AuthType:        string(model.AuthTypePrivateKey),
		Status:          string(model.HostStatusActive),
		IsFavorite:      true,
		LastConnectedAt: &lastConnectedAt,
	})
	if err != nil {
		t.Fatalf("create database host: %v", err)
	}
	if newHost.ID == "" || newHost.GroupID == nil || *newHost.GroupID != newGroup.ID || newHost.CredentialID == nil || *newHost.CredentialID != newCredential.ID {
		t.Fatalf("unexpected created database host: %#v", newHost)
	}
	if newHost.LastConnectedAt == nil || !newHost.LastConnectedAt.Equal(lastConnectedAt) {
		t.Fatalf("unexpected created host last_connected_at: %#v", newHost.LastConnectedAt)
	}
}

func TestPostgresRepositorySystemSettingsLifecycle(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()
	userID := pgtest.InsertUser(t, database, "settings-admin@example.com")
	now := time.Date(2026, 5, 5, 10, 0, 0, 0, time.UTC)

	if err := repo.UpsertSystemSettings(ctx, map[string]string{
		"allow_user_registration":                 "true",
		"host_connectivity_poll_interval_seconds": "45",
	}, userID, now); err != nil {
		t.Fatalf("upsert system settings: %v", err)
	}
	values, err := repo.ListSystemSettings(ctx)
	if err != nil {
		t.Fatalf("list system settings: %v", err)
	}
	if values["allow_user_registration"] != "true" || values["host_connectivity_poll_interval_seconds"] != "45" {
		t.Fatalf("unexpected system settings: %#v", values)
	}

	if err := repo.UpsertSystemSettings(ctx, map[string]string{
		"allow_user_registration": "false",
	}, userID, now.Add(time.Minute)); err != nil {
		t.Fatalf("upsert system setting update: %v", err)
	}
	values, err = repo.ListSystemSettings(ctx)
	if err != nil {
		t.Fatalf("list system settings after update: %v", err)
	}
	if values["allow_user_registration"] != "false" {
		t.Fatalf("expected updated setting, got %#v", values)
	}
}

func insertUserSession(t testing.TB, database *db.DB, userID string, tokenHash string, expiresAt time.Time) string {
	t.Helper()

	return pgtest.MustQueryRow(t, database,
		`INSERT INTO user_sessions (user_id, session_token_hash, expires_at, refresh_expires_at)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		userID,
		tokenHash,
		expiresAt,
		expiresAt.Add(24*time.Hour),
	)
}
