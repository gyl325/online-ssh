package files

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

func TestPostgresRepositoryFileSearchTaskLifecycle(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	userID := pgtest.InsertUser(t, database, "file-search-user@example.com")
	otherUserID := pgtest.InsertUser(t, database, "file-search-other@example.com")
	hostID := pgtest.MustQueryRow(t, database,
		`INSERT INTO hosts (user_id, name, host, port, username, auth_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		userID,
		"Search Host",
		"192.0.2.30",
		22,
		"root",
		string(model.AuthTypePassword),
	)

	task, err := repo.CreateSearchTask(ctx, model.FileSearchTask{
		UserID:            userID,
		HostID:            hostID,
		BasePath:          "/var/log",
		Keyword:           "nginx",
		MatchMode:         "name",
		Recursive:         true,
		IncludeHidden:     false,
		MaxDepth:          6,
		MaxResults:        500,
		MaxScannedEntries: 50000,
		TimeoutSeconds:    30,
		Status:            string(model.FileSearchTaskStatusPending),
		ExpiresAt:         time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("create file search task: %v", err)
	}

	if _, err := repo.GetSearchTaskByID(ctx, otherUserID, task.ID); err != db.ErrNotFound {
		t.Fatalf("expected other user isolation, got %v", err)
	}

	if err := repo.StartSearchTask(ctx, task.ID); err != nil {
		t.Fatalf("start file search task: %v", err)
	}
	warnings := []SearchTaskWarning{{Path: "/var/log/private", Message: "permission denied"}}
	progress := SearchTaskProgress{
		ScannedDirs:        2,
		ScannedEntries:     12,
		MatchedEntries:     1,
		SkippedErrorsCount: 1,
		Warnings:           warnings,
	}
	if err := repo.UpdateSearchTaskProgress(ctx, task.ID, progress); err != nil {
		t.Fatalf("update search progress: %v", err)
	}
	if err := repo.InsertSearchResults(ctx, task.ID, []model.FileSearchResult{{
		Rank:        1,
		Name:        "nginx.log",
		Path:        "/var/log/nginx.log",
		EntryType:   "file",
		SizeBytes:   42,
		Permissions: "0644",
		ModifiedAt:  time.Now(),
	}}); err != nil {
		t.Fatalf("insert search results: %v", err)
	}
	if err := repo.FinishSearchTask(ctx, task.ID, string(model.FileSearchTaskStatusCompleted), "", "", progress); err != nil {
		t.Fatalf("finish search task: %v", err)
	}

	loaded, err := repo.GetSearchTaskByID(ctx, userID, task.ID)
	if err != nil {
		t.Fatalf("get file search task: %v", err)
	}
	if loaded.Status != string(model.FileSearchTaskStatusCompleted) || loaded.ScannedEntries != 12 || loaded.SkippedErrorsCount != 1 || loaded.FinishedAt == nil {
		t.Fatalf("unexpected loaded task: %#v", loaded)
	}
	var loadedWarnings []SearchTaskWarning
	if err := json.Unmarshal(loaded.WarningsJSON, &loadedWarnings); err != nil {
		t.Fatalf("decode warnings: %v", err)
	}
	if len(loadedWarnings) != 1 || loadedWarnings[0].Path != warnings[0].Path {
		t.Fatalf("unexpected warnings: %#v", loadedWarnings)
	}

	results, total, err := repo.ListSearchResults(ctx, userID, task.ID, 10, 0)
	if err != nil {
		t.Fatalf("list search results: %v", err)
	}
	if total != 1 || len(results) != 1 || results[0].Path != "/var/log/nginx.log" {
		t.Fatalf("unexpected results total=%d items=%#v", total, results)
	}

	pending, err := repo.CreateSearchTask(ctx, model.FileSearchTask{
		UserID:            userID,
		HostID:            hostID,
		BasePath:          "/tmp",
		Keyword:           "log",
		MatchMode:         "name",
		Recursive:         true,
		MaxDepth:          1,
		MaxResults:        10,
		MaxScannedEntries: 100,
		TimeoutSeconds:    10,
		Status:            string(model.FileSearchTaskStatusPending),
		ExpiresAt:         time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("create pending search task: %v", err)
	}
	canceled, err := repo.CancelSearchTask(ctx, userID, pending.ID)
	if err != nil {
		t.Fatalf("cancel search task: %v", err)
	}
	if canceled.Status != string(model.FileSearchTaskStatusCanceled) || canceled.FinishedAt == nil {
		t.Fatalf("unexpected canceled task: %#v", canceled)
	}
}
