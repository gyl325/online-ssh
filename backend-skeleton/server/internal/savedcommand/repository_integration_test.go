package savedcommand

import (
	"context"
	"errors"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

func TestPostgresRepositorySavedCommandCRUD(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	userID := pgtest.InsertUser(t, database, "saved-command-user@example.com")
	otherUserID := pgtest.InsertUser(t, database, "saved-command-other@example.com")
	description := "List files"
	category := "Filesystem"

	first, err := repo.Create(ctx, model.SavedCommand{
		UserID:      userID,
		Name:        "List",
		CommandText: "ls -la",
		Category:    &category,
		Description: &description,
		SortOrder:   2,
	})
	if err != nil {
		t.Fatalf("create first command: %v", err)
	}
	second, err := repo.Create(ctx, model.SavedCommand{
		UserID:      userID,
		Name:        "Disk",
		CommandText: "df -h",
		SortOrder:   1,
	})
	if err != nil {
		t.Fatalf("create second command: %v", err)
	}
	if _, err := repo.Create(ctx, model.SavedCommand{
		UserID:      otherUserID,
		Name:        "Other",
		CommandText: "pwd",
		SortOrder:   0,
	}); err != nil {
		t.Fatalf("create other command: %v", err)
	}

	items, err := repo.ListByUserID(ctx, userID)
	if err != nil {
		t.Fatalf("list commands: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 commands, got %d", len(items))
	}
	if items[0].ID != second.ID || items[1].ID != first.ID {
		t.Fatalf("expected commands ordered by sort_order, got %#v", items)
	}
	if items[1].Category == nil || *items[1].Category != category {
		t.Fatalf("unexpected listed category: %#v", items[1].Category)
	}

	updatedDescription := "Disk usage"
	updatedCategory := "Diagnostics"
	updated, err := repo.Update(ctx, userID, model.SavedCommand{
		ID:          first.ID,
		Name:        "Disk usage",
		CommandText: "du -sh .",
		Category:    &updatedCategory,
		Description: &updatedDescription,
		SortOrder:   0,
	})
	if err != nil {
		t.Fatalf("update command: %v", err)
	}
	if updated.Name != "Disk usage" || updated.CommandText != "du -sh ." {
		t.Fatalf("unexpected updated command: %#v", updated)
	}
	if updated.Description == nil || *updated.Description != updatedDescription {
		t.Fatalf("unexpected updated description: %#v", updated.Description)
	}
	if updated.Category == nil || *updated.Category != updatedCategory {
		t.Fatalf("unexpected updated category: %#v", updated.Category)
	}

	if _, err := repo.Update(ctx, otherUserID, model.SavedCommand{ID: first.ID, Name: "Cross", CommandText: "id"}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("expected cross-user update to be not found, got %v", err)
	}

	if err := repo.Delete(ctx, userID, first.ID); err != nil {
		t.Fatalf("delete command: %v", err)
	}
	items, err = repo.ListByUserID(ctx, userID)
	if err != nil {
		t.Fatalf("list commands after delete: %v", err)
	}
	if len(items) != 1 || items[0].ID != second.ID {
		t.Fatalf("unexpected commands after delete: %#v", items)
	}
	if err := repo.Delete(ctx, otherUserID, second.ID); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("expected cross-user delete to be not found, got %v", err)
	}
}
