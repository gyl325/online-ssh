package migration

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestLoadFilesSortsAndChecksums(t *testing.T) {
	dir := t.TempDir()
	files := map[string]string{
		"000002_second.up.sql":  "SELECT 2;",
		"000001_first.up.sql":   "SELECT 1;",
		"000001_first.down.sql": "SELECT 0;",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatalf("write migration file: %v", err)
		}
	}

	migrations, err := LoadFiles(dir)
	if err != nil {
		t.Fatalf("LoadFiles returned error: %v", err)
	}
	if len(migrations) != 2 {
		t.Fatalf("expected 2 up migrations, got %d", len(migrations))
	}
	if migrations[0].Version != "000001_first" || migrations[1].Version != "000002_second" {
		t.Fatalf("migrations are not sorted by filename: %#v", migrations)
	}
	if migrations[0].Checksum == "" || migrations[0].Checksum == migrations[1].Checksum {
		t.Fatalf("expected stable non-empty checksums, got %#v", migrations)
	}
}

func TestStripOuterTransaction(t *testing.T) {
	sqlText := "BEGIN;\nCREATE TABLE example (id INT);\nCOMMIT;\n"
	result := stripOuterTransaction(sqlText)

	if strings.Contains(strings.ToUpper(result), "BEGIN;") {
		t.Fatalf("expected BEGIN to be stripped, got %q", result)
	}
	if strings.Contains(strings.ToUpper(result), "COMMIT;") {
		t.Fatalf("expected COMMIT to be stripped, got %q", result)
	}
	if !strings.Contains(result, "CREATE TABLE example") {
		t.Fatalf("expected body to remain, got %q", result)
	}
}

func TestTerminalSharePublicTokenUsesForwardMigration(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	migrationsDir := filepath.Join(filepath.Dir(file), "..", "..", "migrations")

	originalMigration, err := os.ReadFile(filepath.Join(migrationsDir, "000017_terminal_shares.up.sql"))
	if err != nil {
		t.Fatalf("read 000017 migration: %v", err)
	}
	sum := sha256.Sum256(originalMigration)
	const expectedAppliedChecksum = "bf58e296ab283dddb86b5c7327fbee1052570a8ac94e1c2abc85afe969f3bcd8"
	if got := hex.EncodeToString(sum[:]); got != expectedAppliedChecksum {
		t.Fatalf("000017_terminal_shares was changed after being applied; got checksum %s, want %s. Add schema changes in a new migration.", got, expectedAppliedChecksum)
	}

	forwardMigration, err := os.ReadFile(filepath.Join(migrationsDir, "000018_terminal_shares_public_token.up.sql"))
	if err != nil {
		t.Fatalf("read 000018 public token migration: %v", err)
	}
	content := string(forwardMigration)
	for _, snippet := range []string{
		"ADD COLUMN IF NOT EXISTS public_token",
		"uq_terminal_shares_public_token",
		"ALTER COLUMN public_token SET NOT NULL",
	} {
		if !strings.Contains(content, snippet) {
			t.Fatalf("000018 migration is missing %q", snippet)
		}
	}
}
