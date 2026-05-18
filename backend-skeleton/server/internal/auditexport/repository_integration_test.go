package auditexport

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

func TestPostgresRepositoryAuditExportTaskLifecycle(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	userID := pgtest.InsertUser(t, database, "audit-export-user@example.com")
	otherUserID := pgtest.InsertUser(t, database, "audit-export-other@example.com")
	hostID := insertExportTestHost(t, database, userID)
	start := time.Now().Add(-time.Hour).UTC()
	end := time.Now().UTC()

	created, err := repo.Create(ctx, model.AuditExportTask{
		UserID:             userID,
		FilterEventType:    "auth_login",
		FilterTargetHostID: &hostID,
		FilterResult:       string(model.AuditResultSuccess),
		FilterStartTime:    &start,
		FilterEndTime:      &end,
		Status:             string(model.AuditExportTaskStatusPending),
		ExpiresAt:          time.Now().Add(24 * time.Hour).UTC(),
	})
	if err != nil {
		t.Fatalf("create audit export task: %v", err)
	}
	if created.ID == "" || created.FilterTargetHostID == nil || *created.FilterTargetHostID != hostID {
		t.Fatalf("unexpected created task: %#v", created)
	}

	activeCount, err := repo.CountActiveByUser(ctx, userID)
	if err != nil {
		t.Fatalf("count active tasks: %v", err)
	}
	if activeCount != 1 {
		t.Fatalf("expected 1 active task, got %d", activeCount)
	}

	if err := repo.Start(ctx, created.ID); err != nil {
		t.Fatalf("start task: %v", err)
	}
	if err := repo.UpdateProgress(ctx, created.ID, 10, 5); err != nil {
		t.Fatalf("update progress: %v", err)
	}

	loaded, err := repo.GetByID(ctx, userID, created.ID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if loaded.Status != string(model.AuditExportTaskStatusRunning) || loaded.TotalRows != 10 || loaded.ExportedRows != 5 {
		t.Fatalf("unexpected running task: %#v", loaded)
	}

	if err := repo.Finish(ctx, created.ID, string(model.AuditExportTaskStatusCompleted), "id\nlog-1\n", "", "", 10, 10); err != nil {
		t.Fatalf("finish task: %v", err)
	}
	loaded, err = repo.GetByID(ctx, userID, created.ID)
	if err != nil {
		t.Fatalf("get completed task: %v", err)
	}
	if loaded.Status != string(model.AuditExportTaskStatusCompleted) || loaded.ResultCSV == "" || loaded.FinishedAt == nil {
		t.Fatalf("unexpected completed task: %#v", loaded)
	}

	items, total, err := repo.ListByUserID(ctx, userID, 20, 0)
	if err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ID != created.ID {
		t.Fatalf("unexpected list result: total=%d items=%#v", total, items)
	}

	if _, err := repo.GetByID(ctx, otherUserID, created.ID); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("expected cross-user get to be not found, got %v", err)
	}
	if err := repo.Delete(ctx, userID, created.ID); err != nil {
		t.Fatalf("delete completed task: %v", err)
	}
	if _, err := repo.GetByID(ctx, userID, created.ID); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("expected deleted task to be not found, got %v", err)
	}

	cancelTask, err := repo.Create(ctx, model.AuditExportTask{
		UserID:    userID,
		Status:    string(model.AuditExportTaskStatusPending),
		ExpiresAt: time.Now().Add(24 * time.Hour).UTC(),
	})
	if err != nil {
		t.Fatalf("create cancel task: %v", err)
	}
	canceled, err := repo.Cancel(ctx, userID, cancelTask.ID)
	if err != nil {
		t.Fatalf("cancel task: %v", err)
	}
	if canceled.Status != string(model.AuditExportTaskStatusCanceled) || canceled.FinishedAt == nil {
		t.Fatalf("unexpected canceled task: %#v", canceled)
	}
}

func insertExportTestHost(t testing.TB, database *db.DB, userID string) string {
	t.Helper()
	return pgtest.MustQueryRow(t, database,
		`INSERT INTO hosts (user_id, name, host, port, username, auth_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		userID,
		"Export Host",
		"127.0.0.1",
		22,
		"root",
		"password",
	)
}
