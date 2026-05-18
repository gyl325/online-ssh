package audit

import (
	"context"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

func TestPostgresRepositoryListByUserIDFilters(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	userID := insertAuditTestUser(t, database, "audit-user@example.com")
	otherUserID := insertAuditTestUser(t, database, "audit-other@example.com")
	hostID := insertAuditTestHost(t, database, userID, "filter-host")
	otherHostID := insertAuditTestHost(t, database, userID, "other-host")

	start := time.Now().Add(-2 * time.Hour).UTC()
	mid := start.Add(30 * time.Minute)
	end := start.Add(90 * time.Minute)

	if err := repo.Insert(ctx, model.AuditLog{
		UserID:       userID,
		TargetHostID: auditStringRef(hostID),
		EventType:    "auth_login",
		Result:       string(model.AuditResultSuccess),
		OccurredAt:   start,
	}); err != nil {
		t.Fatalf("insert audit log 1: %v", err)
	}

	if err := repo.Insert(ctx, model.AuditLog{
		UserID:       userID,
		TargetHostID: auditStringRef(otherHostID),
		EventType:    "file_delete",
		Result:       string(model.AuditResultFailure),
		OccurredAt:   mid,
		Message:      auditStringRef("delete failed"),
	}); err != nil {
		t.Fatalf("insert audit log 2: %v", err)
	}

	if err := repo.Insert(ctx, model.AuditLog{
		UserID:     otherUserID,
		EventType:  "auth_login",
		Result:     string(model.AuditResultSuccess),
		OccurredAt: end,
	}); err != nil {
		t.Fatalf("insert audit log 3: %v", err)
	}

	items, total, err := repo.ListByUserID(ctx, userID, ListFilter{
		Limit:     20,
		Offset:    0,
		EventType: "file_delete",
	})
	if err != nil {
		t.Fatalf("list by event type: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].EventType != "file_delete" {
		t.Fatalf("unexpected event_type filter result: total=%d items=%d first=%#v", total, len(items), firstAuditEvent(items))
	}

	items, total, err = repo.ListByUserID(ctx, userID, ListFilter{
		Limit:        20,
		Offset:       0,
		TargetHostID: hostID,
	})
	if err != nil {
		t.Fatalf("list by host id: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].TargetHostID == nil || *items[0].TargetHostID != hostID {
		t.Fatalf("unexpected target_host_id filter result: total=%d items=%d", total, len(items))
	}

	items, total, err = repo.ListByUserID(ctx, userID, ListFilter{
		Limit:  20,
		Offset: 0,
		Result: string(model.AuditResultFailure),
	})
	if err != nil {
		t.Fatalf("list by result: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].Result != string(model.AuditResultFailure) {
		t.Fatalf("unexpected result filter result: total=%d items=%d", total, len(items))
	}

	items, total, err = repo.ListByUserID(ctx, userID, ListFilter{
		Limit:     20,
		Offset:    0,
		StartTime: &mid,
		EndTime:   &end,
	})
	if err != nil {
		t.Fatalf("list by time range: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].EventType != "file_delete" {
		t.Fatalf("unexpected time filter result: total=%d items=%d first=%#v", total, len(items), firstAuditEvent(items))
	}

	item, err := repo.GetByID(ctx, userID, items[0].ID)
	if err != nil {
		t.Fatalf("get by id: %v", err)
	}
	if item.Message == nil || *item.Message != "delete failed" {
		t.Fatalf("expected loaded message, got %#v", item.Message)
	}
}

func TestPostgresRepositoryInsertAllowsAnonymousAuditLogs(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	if err := repo.Insert(ctx, model.AuditLog{
		EventType:    "auth_login_failed",
		ResourceType: auditStringRef("auth"),
		Result:       string(model.AuditResultFailure),
		Message:      auditStringRef("login failed"),
		ClientIP:     auditStringRef("198.51.100.10"),
		OccurredAt:   time.Now().UTC(),
	}); err != nil {
		t.Fatalf("insert anonymous audit log: %v", err)
	}
}

func insertAuditTestUser(t *testing.T, database *db.DB, email string) string {
	t.Helper()
	var id string
	err := database.SQL.QueryRowContext(
		context.Background(),
		`INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id`,
		email,
		"password-hash",
		email,
	).Scan(&id)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return id
}

func insertAuditTestHost(t *testing.T, database *db.DB, userID, name string) string {
	t.Helper()
	var id string
	err := database.SQL.QueryRowContext(
		context.Background(),
		`INSERT INTO hosts (user_id, name, host, port, username, auth_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		userID,
		name,
		"127.0.0.1",
		22,
		"root",
		"password",
	).Scan(&id)
	if err != nil {
		t.Fatalf("insert host: %v", err)
	}
	return id
}

func firstAuditEvent(items []model.AuditLog) any {
	if len(items) == 0 {
		return nil
	}
	return items[0].EventType
}

func auditStringRef(value string) *string {
	return &value
}
