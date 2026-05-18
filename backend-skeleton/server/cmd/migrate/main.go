package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/example/online-ssh-platform/server/internal/config"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/migration"
)

func main() {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("load config failed: %v", err)
	}

	database, err := db.Open(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect database failed: %v", err)
	}
	defer database.Close()

	migrationsDir, err := findMigrationsDir()
	if err != nil {
		log.Fatalf("find migrations dir failed: %v", err)
	}

	command := "up"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}

	runner := migration.Runner{
		DB:   database.SQL,
		Dir:  migrationsDir,
		Logf: log.Printf,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	switch command {
	case "up":
		report, err := runner.Apply(ctx)
		if err != nil {
			log.Fatalf("run migrations failed: %v", err)
		}
		log.Printf("migration complete: applied=%d skipped=%d baselined=%d", len(report.Applied), len(report.Skipped), len(report.Baselined))
	case "status":
		statuses, err := runner.Status(ctx)
		if err != nil {
			log.Fatalf("read migration status failed: %v", err)
		}
		for _, status := range statuses {
			state := "pending"
			if status.Applied {
				state = "applied"
			}
			if status.ChecksumMismatch {
				state = "checksum_mismatch"
			}
			fmt.Printf("%s\t%s\n", state, status.Version)
		}
	default:
		log.Fatalf("unknown migration command %q, expected up or status", command)
	}
}

func findMigrationsDir() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	for dir := wd; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, "migrations")
		if info, statErr := os.Stat(candidate); statErr == nil && info.IsDir() {
			return candidate, nil
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return "", os.ErrNotExist
		}
	}
}
