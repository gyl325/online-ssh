package hostgroup

import (
	"context"
	"database/sql"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

func TestPostgresRepositoryHostGroupLifecycle(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	ctx := context.Background()

	userID := pgtest.InsertUser(t, database, "host-group@example.com")
	otherUserID := pgtest.InsertUser(t, database, "host-group-other@example.com")

	created, err := repo.Create(ctx, normalizeHostGroup(t, userID, "Ops", 20))
	if err != nil {
		t.Fatalf("create host group: %v", err)
	}
	if created.Name != "Ops" || created.SortOrder != 20 {
		t.Fatalf("unexpected created group: %#v", created)
	}

	if _, err := repo.Create(ctx, normalizeHostGroup(t, otherUserID, "Other", 10)); err != nil {
		t.Fatalf("create other user host group: %v", err)
	}

	items, err := repo.ListByUserID(ctx, userID)
	if err != nil {
		t.Fatalf("list host groups: %v", err)
	}
	if len(items) != 1 || items[0].ID != created.ID {
		t.Fatalf("unexpected listed groups: %#v", items)
	}

	loaded, err := repo.GetByID(ctx, userID, created.ID)
	if err != nil {
		t.Fatalf("get host group: %v", err)
	}
	if loaded.ID != created.ID {
		t.Fatalf("unexpected loaded group: %#v", loaded)
	}
	if _, err := repo.GetByID(ctx, otherUserID, created.ID); err == nil {
		t.Fatalf("expected cross-user get to fail")
	}

	created.Name = "Production"
	created.SortOrder = 5
	updated, err := repo.Update(ctx, userID, created)
	if err != nil {
		t.Fatalf("update host group: %v", err)
	}
	if updated.Name != "Production" || updated.SortOrder != 5 {
		t.Fatalf("unexpected updated group: %#v", updated)
	}

	hostID := pgtest.MustQueryRow(t, database,
		`INSERT INTO hosts (user_id, group_id, name, host, port, username, auth_type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		userID,
		updated.ID,
		"Grouped Host",
		"192.0.2.10",
		22,
		"root",
		"password",
	)

	if err := repo.Delete(ctx, userID, updated.ID); err != nil {
		t.Fatalf("delete host group: %v", err)
	}

	var groupID *string
	if err := database.SQL.QueryRowContext(ctx, `SELECT group_id FROM hosts WHERE id = $1`, hostID).Scan(&groupID); err != nil {
		t.Fatalf("load host group after delete: %v", err)
	}
	if groupID != nil {
		t.Fatalf("expected host group to be cleared after group delete, got %q", *groupID)
	}
}

func normalizeHostGroup(t testing.TB, userID, name string, sortOrder int) model.HostGroup {
	t.Helper()
	return model.HostGroup{
		UserID:    userID,
		Name:      name,
		SortOrder: sortOrder,
	}
}
