package pgtest

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/config"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func OpenMigratedDB(t testing.TB) *db.DB {
	t.Helper()

	testDB := OpenIsolatedDB(t)

	migrations, err := migrationPaths()
	if err != nil {
		_ = testDB.Close()
		t.Fatalf("list migration files: %v", err)
	}
	for _, migration := range migrations {
		migrationSQL, err := os.ReadFile(migration)
		if err != nil {
			_ = testDB.Close()
			t.Fatalf("read migration file %s: %v", filepath.Base(migration), err)
		}
		if _, err := testDB.SQL.ExecContext(context.Background(), sanitizeMigrationSQL(string(migrationSQL))); err != nil {
			_ = testDB.Close()
			t.Fatalf("apply migration %s to test schema: %v", filepath.Base(migration), err)
		}
	}

	return testDB
}

func OpenIsolatedDB(t testing.TB) *db.DB {
	t.Helper()

	if os.Getenv("ONLINE_SSH_RUN_DB_TESTS") != "1" {
		t.Skip("skip postgres integration test: set ONLINE_SSH_RUN_DB_TESTS=1 to enable")
	}

	dsn, err := databaseURLFromEnv()
	if err != nil || strings.TrimSpace(dsn) == "" {
		t.Skipf("skip postgres integration test: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	adminDB, err := openWithSearchPath(ctx, dsn, "public")
	if err != nil {
		t.Fatalf("open admin postgres connection: %v", err)
	}
	if err := ensureExtensions(ctx, adminDB); err != nil {
		_ = adminDB.Close()
		t.Fatalf("ensure postgres extensions: %v", err)
	}

	schemaName := fmt.Sprintf("online_ssh_test_%d", time.Now().UnixNano())
	if _, err := adminDB.SQL.ExecContext(ctx, fmt.Sprintf(`CREATE SCHEMA "%s"`, schemaName)); err != nil {
		_ = adminDB.Close()
		t.Fatalf("create test schema: %v", err)
	}

	testDB, err := openWithSearchPath(ctx, dsn, schemaName+",public")
	if err != nil {
		_, _ = adminDB.SQL.ExecContext(ctx, fmt.Sprintf(`DROP SCHEMA IF EXISTS "%s" CASCADE`, schemaName))
		_ = adminDB.Close()
		t.Fatalf("open schema-scoped postgres connection: %v", err)
	}

	t.Cleanup(func() {
		_ = testDB.Close()
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		_, _ = adminDB.SQL.ExecContext(cleanupCtx, fmt.Sprintf(`DROP SCHEMA IF EXISTS "%s" CASCADE`, schemaName))
		_ = adminDB.Close()
	})

	return testDB
}

func databaseURLFromEnv() (string, error) {
	if override := strings.TrimSpace(os.Getenv("ONLINE_SSH_TEST_DATABASE_URL")); override != "" {
		return override, nil
	}
	if testDSN := strings.TrimSpace(os.Getenv("DATABASE_URL_TEST")); testDSN != "" {
		return testDSN, nil
	}

	cfg, err := config.LoadFromEnv()
	if err != nil {
		return "", err
	}
	return cfg.DatabaseURL, nil
}

func ensureExtensions(ctx context.Context, database *db.DB) error {
	const lockKey = int64(20260424)

	if _, err := database.SQL.ExecContext(ctx, `SELECT pg_advisory_lock($1)`, lockKey); err != nil {
		return fmt.Errorf("acquire extension lock: %w", err)
	}
	defer func() {
		_, _ = database.SQL.ExecContext(context.Background(), `SELECT pg_advisory_unlock($1)`, lockKey)
	}()

	for _, stmt := range []string{
		`CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public`,
		`CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public`,
	} {
		if _, err := database.SQL.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("exec %q: %w", stmt, err)
		}
	}
	return nil
}

func openWithSearchPath(ctx context.Context, dsn, searchPath string) (*db.DB, error) {
	connConfig, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse postgres config: %w", err)
	}
	if searchPath != "" {
		connConfig.RuntimeParams["search_path"] = searchPath
	}

	sqlDB := stdlib.OpenDB(*connConfig)
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(2)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(pingCtx); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	return &db.DB{SQL: sqlDB}, nil
}

func migrationPaths() ([]string, error) {
	_, file, _, _ := runtime.Caller(0)
	migrationsDir := filepath.Join(filepath.Dir(file), "..", "..", "..", "migrations")
	files, err := filepath.Glob(filepath.Join(migrationsDir, "*.up.sql"))
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	return files, nil
}

func sanitizeMigrationSQL(sqlText string) string {
	extensionStatement := regexp.MustCompile(`(?im)^\s*CREATE EXTENSION IF NOT EXISTS [^;]+;\s*$`)
	return extensionStatement.ReplaceAllString(sqlText, "")
}

func MustExec(t testing.TB, database *db.DB, query string, args ...any) sql.Result {
	t.Helper()
	result, err := database.SQL.ExecContext(context.Background(), query, args...)
	if err != nil {
		t.Fatalf("exec query failed: %v", err)
	}
	return result
}

func MustQueryRow[T any](t testing.TB, database *db.DB, query string, scan func(*sql.Row) (T, error), args ...any) T {
	t.Helper()
	value, err := scan(database.SQL.QueryRowContext(context.Background(), query, args...))
	if err != nil {
		t.Fatalf("query row failed: %v", err)
	}
	return value
}
