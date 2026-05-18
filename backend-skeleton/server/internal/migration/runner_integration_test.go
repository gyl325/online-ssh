package migration

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

func TestRunnerApplyIsIdempotent(t *testing.T) {
	database := pgtest.OpenIsolatedDB(t)
	migrationsDir := repoMigrationsDir(t)
	files, err := LoadFiles(migrationsDir)
	if err != nil {
		t.Fatalf("LoadFiles returned error: %v", err)
	}
	runner := Runner{DB: database.SQL, Dir: migrationsDir}

	first, err := runner.Apply(context.Background())
	if err != nil {
		t.Fatalf("first Apply returned error: %v", err)
	}
	if len(first.Applied) != len(files) {
		t.Fatalf("expected %d applied migrations, got %#v", len(files), first)
	}

	second, err := runner.Apply(context.Background())
	if err != nil {
		t.Fatalf("second Apply returned error: %v", err)
	}
	if len(second.Applied) != 0 || len(second.Skipped) != len(files) {
		t.Fatalf("expected second run to be no-op, got %#v", second)
	}

	count := pgtest.MustQueryRow(t, database,
		`SELECT count(*) FROM schema_migrations`,
		func(row *sql.Row) (int, error) {
			var count int
			err := row.Scan(&count)
			return count, err
		},
	)
	if count != len(files) {
		t.Fatalf("expected %d schema_migrations rows, got %d", len(files), count)
	}
}

func TestRunnerBaselinesExistingSchemaBeforeApplyingMissingMigrations(t *testing.T) {
	database := pgtest.OpenIsolatedDB(t)
	files, err := LoadFiles(repoMigrationsDir(t))
	if err != nil {
		t.Fatalf("LoadFiles returned error: %v", err)
	}
	if _, err := database.SQL.ExecContext(context.Background(), stripOuterTransaction(files[0].SQL)); err != nil {
		t.Fatalf("seed initial schema: %v", err)
	}

	report, err := (Runner{DB: database.SQL, Dir: repoMigrationsDir(t)}).Apply(context.Background())
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if len(report.Baselined) != 1 || report.Baselined[0].Version != "000001_init_schema" {
		t.Fatalf("expected initial schema to be baselined, got %#v", report.Baselined)
	}
	if len(report.Applied) != len(files)-1 {
		t.Fatalf("expected remaining migrations to apply, got %#v", report.Applied)
	}
}

func TestRunnerUpgradesLegacySchemaMigrationsTable(t *testing.T) {
	database := pgtest.OpenIsolatedDB(t)
	files, err := LoadFiles(repoMigrationsDir(t))
	if err != nil {
		t.Fatalf("LoadFiles returned error: %v", err)
	}
	if _, err := database.SQL.ExecContext(context.Background(), stripOuterTransaction(files[0].SQL)); err != nil {
		t.Fatalf("seed initial schema: %v", err)
	}
	if _, err := database.SQL.ExecContext(context.Background(), `
		CREATE TABLE schema_migrations (
			version TEXT PRIMARY KEY
		)
	`); err != nil {
		t.Fatalf("seed legacy schema_migrations table: %v", err)
	}
	if _, err := database.SQL.ExecContext(context.Background(), `
		INSERT INTO schema_migrations (version) VALUES ('000001_init_schema')
	`); err != nil {
		t.Fatalf("seed legacy migration row: %v", err)
	}

	report, err := (Runner{DB: database.SQL, Dir: repoMigrationsDir(t)}).Apply(context.Background())
	if err != nil {
		t.Fatalf("Apply returned error: %v", err)
	}
	if len(report.Applied) != len(files)-1 || len(report.Skipped) != 1 {
		t.Fatalf("expected 1 skipped legacy row and 3 applied migrations, got %#v", report)
	}

	var name string
	var checksum string
	if err := database.SQL.QueryRowContext(context.Background(), `
		SELECT name, checksum FROM schema_migrations WHERE version = '000001_init_schema'
	`).Scan(&name, &checksum); err != nil {
		t.Fatalf("read upgraded legacy row: %v", err)
	}
	if name != "000001_init_schema" || checksum == "" {
		t.Fatalf("expected legacy row metadata to be backfilled, got name=%q checksum=%q", name, checksum)
	}
}

func TestRunnerDoesNotRecordFailedMigration(t *testing.T) {
	database := pgtest.OpenIsolatedDB(t)
	dir := t.TempDir()
	writeMigration(t, dir, "000001_create_good.up.sql", `CREATE TABLE good_migration (id INT PRIMARY KEY);`)
	writeMigration(t, dir, "000002_create_bad.up.sql", `CREATE TABLE bad_migration (id INT PRIMARY KEY); SELECT * FROM missing_table;`)

	_, err := (Runner{DB: database.SQL, Dir: dir}).Apply(context.Background())
	if err == nil {
		t.Fatal("expected Apply to fail")
	}

	count := pgtest.MustQueryRow(t, database,
		`SELECT count(*) FROM schema_migrations`,
		func(row *sql.Row) (int, error) {
			var count int
			err := row.Scan(&count)
			return count, err
		},
	)
	if count != 1 {
		t.Fatalf("expected only successful migration to be recorded, got %d", count)
	}

	var badTableExists bool
	if err := database.SQL.QueryRowContext(context.Background(), `SELECT to_regclass('bad_migration') IS NOT NULL`).Scan(&badTableExists); err != nil {
		t.Fatalf("check bad migration table: %v", err)
	}
	if badTableExists {
		t.Fatal("expected failed migration transaction to roll back created table")
	}
}

func writeMigration(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
		t.Fatalf("write migration %s: %v", name, err)
	}
}

func repoMigrationsDir(t *testing.T) string {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}
