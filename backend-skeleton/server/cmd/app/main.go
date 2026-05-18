package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/example/online-ssh-platform/server/internal/app"
	"github.com/example/online-ssh-platform/server/internal/config"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/migration"
)

func main() {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("load config failed: %v", err)
	}

	if err := runStartupMigrations(context.Background(), cfg); err != nil {
		log.Fatalf("run startup migrations failed: %v", err)
	}

	application, err := app.New(cfg)
	if err != nil {
		log.Fatalf("bootstrap app failed: %v", err)
	}
	defer application.Close()

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           application.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("server listening on %s", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server failed: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("http shutdown error: %v", err)
	}
}

func runStartupMigrations(ctx context.Context, cfg config.Config) error {
	if !cfg.AutoMigrate {
		return nil
	}

	database, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer database.Close()

	dir := cfg.MigrationsDir
	if strings.TrimSpace(dir) == "" {
		dir, err = findMigrationsDir()
		if err != nil {
			return err
		}
	}

	runner := migration.Runner{DB: database.SQL, Dir: dir, Logf: log.Printf}
	migrationCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	_, err = runner.Apply(migrationCtx)
	return err
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
