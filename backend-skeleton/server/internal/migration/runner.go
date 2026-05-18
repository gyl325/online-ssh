package migration

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const advisoryLockKey int64 = 20260428

type Runner struct {
	DB   *sql.DB
	Dir  string
	Logf func(format string, args ...any)
}

type MigrationFile struct {
	Version  string
	Name     string
	Path     string
	Checksum string
	SQL      string
}

type AppliedMigration struct {
	Version  string
	Name     string
	Checksum string
}

type Report struct {
	Applied   []AppliedMigration
	Skipped   []AppliedMigration
	Baselined []AppliedMigration
}

type Status struct {
	Version          string
	Name             string
	Applied          bool
	Checksum         string
	AppliedChecksum  string
	ChecksumMismatch bool
}

func (r Runner) Apply(ctx context.Context) (Report, error) {
	var report Report
	if r.DB == nil {
		return report, errors.New("migration database is nil")
	}

	files, err := LoadFiles(r.Dir)
	if err != nil {
		return report, err
	}

	conn, err := r.DB.Conn(ctx)
	if err != nil {
		return report, fmt.Errorf("open migration connection: %w", err)
	}
	defer conn.Close()

	if err := acquireLock(ctx, conn); err != nil {
		return report, err
	}
	defer releaseLock(conn)

	if err := ensureSchemaMigrations(ctx, conn); err != nil {
		return report, err
	}
	if err := backfillExistingMigrationMetadata(ctx, conn, files); err != nil {
		return report, err
	}

	baselined, err := baselineHistoricalMigrations(ctx, conn, files)
	if err != nil {
		return report, err
	}
	report.Baselined = baselined
	for _, item := range baselined {
		r.logf("baselined %s", item.Version)
	}

	applied, err := listApplied(ctx, conn)
	if err != nil {
		return report, err
	}

	for _, file := range files {
		if existing, ok := applied[file.Version]; ok {
			if existing.Checksum != file.Checksum {
				return report, fmt.Errorf("migration %s checksum mismatch: recorded %s, file %s", file.Version, existing.Checksum, file.Checksum)
			}
			report.Skipped = append(report.Skipped, existing)
			r.logf("skipped %s", file.Version)
			continue
		}

		item := AppliedMigration{
			Version:  file.Version,
			Name:     file.Name,
			Checksum: file.Checksum,
		}
		if err := applyOne(ctx, conn, file); err != nil {
			return report, err
		}
		applied[file.Version] = item
		report.Applied = append(report.Applied, item)
		r.logf("applied %s", file.Version)
	}

	return report, nil
}

func (r Runner) Status(ctx context.Context) ([]Status, error) {
	if r.DB == nil {
		return nil, errors.New("migration database is nil")
	}

	files, err := LoadFiles(r.Dir)
	if err != nil {
		return nil, err
	}

	conn, err := r.DB.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("open migration connection: %w", err)
	}
	defer conn.Close()

	exists, err := schemaMigrationsExists(ctx, conn)
	if err != nil {
		return nil, err
	}
	if exists {
		if err := ensureSchemaMigrations(ctx, conn); err != nil {
			return nil, err
		}
		if err := backfillExistingMigrationMetadata(ctx, conn, files); err != nil {
			return nil, err
		}
	}

	applied := map[string]AppliedMigration{}
	if exists {
		applied, err = listApplied(ctx, conn)
		if err != nil {
			return nil, err
		}
	}

	result := make([]Status, 0, len(files))
	for _, file := range files {
		existing, ok := applied[file.Version]
		result = append(result, Status{
			Version:          file.Version,
			Name:             file.Name,
			Applied:          ok,
			Checksum:         file.Checksum,
			AppliedChecksum:  existing.Checksum,
			ChecksumMismatch: ok && existing.Checksum != file.Checksum,
		})
	}
	return result, nil
}

func LoadFiles(dir string) ([]MigrationFile, error) {
	if strings.TrimSpace(dir) == "" {
		return nil, errors.New("migration directory is required")
	}

	paths, err := filepath.Glob(filepath.Join(dir, "*.up.sql"))
	if err != nil {
		return nil, fmt.Errorf("list migration files: %w", err)
	}
	sort.Strings(paths)

	files := make([]MigrationFile, 0, len(paths))
	for _, path := range paths {
		sqlBytes, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read migration file %s: %w", filepath.Base(path), err)
		}

		base := filepath.Base(path)
		version := strings.TrimSuffix(base, ".up.sql")
		sqlText := string(sqlBytes)
		sum := sha256.Sum256(sqlBytes)
		files = append(files, MigrationFile{
			Version:  version,
			Name:     version,
			Path:     path,
			Checksum: hex.EncodeToString(sum[:]),
			SQL:      sqlText,
		})
	}
	return files, nil
}

func applyOne(ctx context.Context, conn *sql.Conn, file MigrationFile) error {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration %s: %w", file.Version, err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, stripOuterTransaction(file.SQL)); err != nil {
		return fmt.Errorf("apply migration %s: %w", file.Version, err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO schema_migrations (version, name, checksum)
		VALUES ($1, $2, $3)
	`, file.Version, file.Name, file.Checksum); err != nil {
		return fmt.Errorf("record migration %s: %w", file.Version, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %s: %w", file.Version, err)
	}
	return nil
}

func ensureSchemaMigrations(ctx context.Context, conn *sql.Conn) error {
	_, err := conn.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			checksum TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)
	`)
	if err != nil {
		return fmt.Errorf("ensure schema_migrations table: %w", err)
	}
	for _, stmt := range []string{
		`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS name TEXT`,
		`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`,
		`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
	} {
		if _, err := conn.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("upgrade schema_migrations table: %w", err)
		}
	}
	return nil
}

func schemaMigrationsExists(ctx context.Context, conn *sql.Conn) (bool, error) {
	var exists bool
	if err := conn.QueryRowContext(ctx, `SELECT to_regclass('schema_migrations') IS NOT NULL`).Scan(&exists); err != nil {
		return false, fmt.Errorf("check schema_migrations table: %w", err)
	}
	return exists, nil
}

func listApplied(ctx context.Context, conn *sql.Conn) (map[string]AppliedMigration, error) {
	rows, err := conn.QueryContext(ctx, `SELECT version, COALESCE(name, version), COALESCE(checksum, '') FROM schema_migrations ORDER BY version`)
	if err != nil {
		return nil, fmt.Errorf("list applied migrations: %w", err)
	}
	defer rows.Close()

	result := map[string]AppliedMigration{}
	for rows.Next() {
		var item AppliedMigration
		if err := rows.Scan(&item.Version, &item.Name, &item.Checksum); err != nil {
			return nil, fmt.Errorf("scan applied migration: %w", err)
		}
		result[item.Version] = item
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate applied migrations: %w", err)
	}
	return result, nil
}

func backfillExistingMigrationMetadata(ctx context.Context, conn *sql.Conn, files []MigrationFile) error {
	for _, file := range files {
		if _, err := conn.ExecContext(ctx, `
			UPDATE schema_migrations
			SET name = COALESCE(NULLIF(name, ''), $2),
			    checksum = COALESCE(NULLIF(checksum, ''), $3)
			WHERE version = $1
		`, file.Version, file.Name, file.Checksum); err != nil {
			return fmt.Errorf("backfill schema_migrations metadata for %s: %w", file.Version, err)
		}
	}
	return nil
}

func baselineHistoricalMigrations(ctx context.Context, conn *sql.Conn, files []MigrationFile) ([]AppliedMigration, error) {
	var count int
	if err := conn.QueryRowContext(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&count); err != nil {
		return nil, fmt.Errorf("count applied migrations: %w", err)
	}
	if count > 0 {
		return nil, nil
	}

	var baselined []AppliedMigration
	for _, file := range files {
		exists, err := historicalMigrationMarkerExists(ctx, conn, file.Version)
		if err != nil {
			return nil, err
		}
		if !exists {
			continue
		}

		item := AppliedMigration{
			Version:  file.Version,
			Name:     file.Name,
			Checksum: file.Checksum,
		}
		if _, err := conn.ExecContext(ctx, `
			INSERT INTO schema_migrations (version, name, checksum)
			VALUES ($1, $2, $3)
			ON CONFLICT (version) DO NOTHING
		`, item.Version, item.Name, item.Checksum); err != nil {
			return nil, fmt.Errorf("baseline migration %s: %w", item.Version, err)
		}
		baselined = append(baselined, item)
	}
	return baselined, nil
}

func historicalMigrationMarkerExists(ctx context.Context, conn *sql.Conn, version string) (bool, error) {
	switch version {
	case "000001_init_schema":
		return relationExists(ctx, conn, "users")
	case "000002_auth_refresh":
		return columnExists(ctx, conn, "user_sessions", "refresh_expires_at")
	case "000003_file_search_tasks":
		return relationExists(ctx, conn, "file_search_tasks")
	case "000004_audit_export_tasks":
		return relationExists(ctx, conn, "audit_export_tasks")
	default:
		return false, nil
	}
}

func relationExists(ctx context.Context, conn *sql.Conn, name string) (bool, error) {
	var exists bool
	if err := conn.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = current_schema()
				AND c.relname = $1
				AND c.relkind IN ('r', 'p', 'v', 'm')
		)
	`, name).Scan(&exists); err != nil {
		return false, fmt.Errorf("check relation %s: %w", name, err)
	}
	return exists, nil
}

func columnExists(ctx context.Context, conn *sql.Conn, tableName, columnName string) (bool, error) {
	var exists bool
	if err := conn.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = current_schema()
				AND table_name = $1
				AND column_name = $2
		)
	`, tableName, columnName).Scan(&exists); err != nil {
		return false, fmt.Errorf("check column %s.%s: %w", tableName, columnName, err)
	}
	return exists, nil
}

func acquireLock(ctx context.Context, conn *sql.Conn) error {
	if _, err := conn.ExecContext(ctx, `SELECT pg_advisory_lock($1)`, advisoryLockKey); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	return nil
}

func releaseLock(conn *sql.Conn) {
	_, _ = conn.ExecContext(context.Background(), `SELECT pg_advisory_unlock($1)`, advisoryLockKey)
}

func (r Runner) logf(format string, args ...any) {
	if r.Logf != nil {
		r.Logf(format, args...)
	}
}

var (
	leadingBegin   = regexp.MustCompile(`(?is)^\s*BEGIN\s*;\s*`)
	trailingCommit = regexp.MustCompile(`(?is)\s*COMMIT\s*;\s*$`)
)

func stripOuterTransaction(sqlText string) string {
	result := leadingBegin.ReplaceAllString(sqlText, "")
	result = trailingCommit.ReplaceAllString(result, "")
	return result
}
