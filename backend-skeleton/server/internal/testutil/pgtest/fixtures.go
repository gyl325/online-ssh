package pgtest

import (
	"context"
	"database/sql"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/db"
)

func InsertUser(t testing.TB, database *db.DB, email string) string {
	t.Helper()

	return MustQueryRow(t, database,
		`INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		email,
		"password-hash",
		email,
	)
}

func InsertHostGroup(t testing.TB, database *db.DB, userID, name string) string {
	t.Helper()

	return MustQueryRow(t, database,
		`INSERT INTO host_groups (user_id, name) VALUES ($1, $2) RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		userID,
		name,
	)
}

func MustExecContext(t testing.TB, database *db.DB, query string, args ...any) {
	t.Helper()

	if _, err := database.SQL.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("exec query failed: %v", err)
	}
}
