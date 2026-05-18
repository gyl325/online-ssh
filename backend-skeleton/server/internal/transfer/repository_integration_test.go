package transfer

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

func TestPostgresRepositoryTransferTaskLifecycle(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	userID := pgtest.InsertUser(t, database, "transfer-user@example.com")
	otherUserID := pgtest.InsertUser(t, database, "transfer-other@example.com")
	hostID := pgtest.MustQueryRow(t, database,
		`INSERT INTO hosts (user_id, name, host, port, username, auth_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		userID,
		"Transfer Host",
		"192.0.2.20",
		22,
		"root",
		string(model.AuthTypePassword),
	)

	uploadTask, err := repo.CreateTask(ctx, model.TransferTask{
		UserID:           userID,
		TaskType:         string(model.TransferTaskTypeUpload),
		SourceType:       "local",
		TargetType:       "remote",
		TargetHostID:     &hostID,
		TargetPath:       transferStringRef("/tmp/uploads"),
		FileName:         "artifact.tar.gz",
		TotalBytes:       100,
		TransferredBytes: 0,
		ChunkSize:        32,
		Resumable:        true,
		Status:           string(model.TransferTaskStatusUploadingToPlatform),
	})
	if err != nil {
		t.Fatalf("create upload task: %v", err)
	}

	downloadTask, err := repo.CreateTask(ctx, model.TransferTask{
		UserID:           userID,
		TaskType:         string(model.TransferTaskTypeDownload),
		SourceType:       "remote",
		TargetType:       "local",
		SourceHostID:     &hostID,
		SourcePath:       transferStringRef("/var/log/syslog"),
		FileName:         "syslog",
		TotalBytes:       200,
		TransferredBytes: 50,
		ChunkSize:        64,
		Resumable:        false,
		Status:           string(model.TransferTaskStatusFailed),
		ErrorCode:        transferStringRef(errorCodeDownloadRetryable),
		ErrorMessage:     transferStringRef("connection reset"),
	})
	if err != nil {
		t.Fatalf("create download task: %v", err)
	}
	uploadCreatedAt := time.Date(2026, 4, 18, 8, 0, 0, 0, time.UTC)
	downloadCreatedAt := time.Date(2026, 4, 19, 8, 0, 0, 0, time.UTC)
	if _, err := database.SQL.ExecContext(ctx, `UPDATE transfer_tasks SET created_at = $1, updated_at = $1 WHERE id = $2`, uploadCreatedAt, uploadTask.ID); err != nil {
		t.Fatalf("set upload created_at: %v", err)
	}
	if _, err := database.SQL.ExecContext(ctx, `UPDATE transfer_tasks SET created_at = $1, updated_at = $1 WHERE id = $2`, downloadCreatedAt, downloadTask.ID); err != nil {
		t.Fatalf("set download created_at: %v", err)
	}

	if _, err := repo.CreateTask(ctx, model.TransferTask{
		UserID:           otherUserID,
		TaskType:         string(model.TransferTaskTypeUpload),
		SourceType:       "local",
		TargetType:       "remote",
		FileName:         "other-user.bin",
		TotalBytes:       1,
		TransferredBytes: 0,
		ChunkSize:        1,
		Resumable:        true,
		Status:           string(model.TransferTaskStatusPending),
	}); err != nil {
		t.Fatalf("create other user task: %v", err)
	}

	items, total, err := repo.ListTasksByUserID(ctx, userID, ListFilter{
		Limit:    20,
		Offset:   0,
		Status:   string(model.TransferTaskStatusFailed),
		TaskType: string(model.TransferTaskTypeDownload),
	})
	if err != nil {
		t.Fatalf("list filtered transfer tasks: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ID != downloadTask.ID {
		t.Fatalf("unexpected filtered transfer tasks: total=%d items=%#v", total, items)
	}

	from := downloadCreatedAt.Add(-time.Hour)
	to := downloadCreatedAt.Add(time.Hour)
	items, total, err = repo.ListTasksByUserID(ctx, userID, ListFilter{
		Limit:       20,
		Offset:      0,
		CreatedFrom: &from,
		CreatedTo:   &to,
	})
	if err != nil {
		t.Fatalf("list transfer tasks by created range: %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].ID != downloadTask.ID {
		t.Fatalf("unexpected created range transfer tasks: total=%d items=%#v", total, items)
	}

	foundUpload, err := repo.FindLatestUploadTask(ctx, userID, hostID, "/tmp/uploads", "artifact.tar.gz", 100, []string{
		string(model.TransferTaskStatusUploadingToPlatform),
		string(model.TransferTaskStatusQueuedForRemoteTransfer),
	})
	if err != nil {
		t.Fatalf("find latest upload task: %v", err)
	}
	if foundUpload.ID != uploadTask.ID {
		t.Fatalf("expected latest upload task %s, got %s", uploadTask.ID, foundUpload.ID)
	}

	if err := repo.UpdateTaskStatus(ctx, uploadTask.ID, string(model.TransferTaskStatusCompleted), 100, "", ""); err != nil {
		t.Fatalf("update task status: %v", err)
	}
	loadedUpload, err := repo.GetTaskByID(ctx, userID, uploadTask.ID)
	if err != nil {
		t.Fatalf("get upload task: %v", err)
	}
	if loadedUpload.Status != string(model.TransferTaskStatusCompleted) || loadedUpload.TransferredBytes != 100 || loadedUpload.FinishedAt == nil {
		t.Fatalf("unexpected completed upload task: %#v", loadedUpload)
	}

	if err := repo.IncrementRetryCount(ctx, downloadTask.ID); err != nil {
		t.Fatalf("increment retry count: %v", err)
	}
	loadedDownload, err := repo.GetTaskByIDAny(ctx, downloadTask.ID)
	if err != nil {
		t.Fatalf("get task by id any: %v", err)
	}
	if loadedDownload.RetryCount != 1 {
		t.Fatalf("expected retry_count=1, got %d", loadedDownload.RetryCount)
	}

	recoverable, err := repo.ListTasksByStatuses(ctx, []string{
		string(model.TransferTaskStatusCompleted),
		string(model.TransferTaskStatusFailed),
	}, 10)
	if err != nil {
		t.Fatalf("list tasks by statuses: %v", err)
	}
	if len(recoverable) < 2 {
		t.Fatalf("expected at least 2 tasks in recoverable list, got %d", len(recoverable))
	}

	if _, err := repo.GetTaskByID(ctx, userID, "11111111-1111-1111-1111-111111111111"); !db.IsNotFound(err) {
		t.Fatalf("expected missing task to be not found, got %v", err)
	}
}

func transferStringRef(value string) *string {
	return &value
}
