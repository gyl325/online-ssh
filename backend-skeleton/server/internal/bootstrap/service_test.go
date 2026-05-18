package bootstrap

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/model"
	"golang.org/x/crypto/bcrypt"
)

type repoStub struct {
	adminCount int
	created    auth.CreateUserInput
	createFn   func(context.Context, auth.CreateUserInput) (auth.UserRecord, error)
}

func (r *repoStub) CountUsersWithPermission(_ context.Context, permission string) (int, error) {
	if permission != model.PermissionAdminAccess {
		return 0, errors.New("unexpected permission")
	}
	return r.adminCount, nil
}

func (r *repoStub) CreateUser(ctx context.Context, input auth.CreateUserInput) (auth.UserRecord, error) {
	r.created = input
	if r.createFn != nil {
		return r.createFn(ctx, input)
	}
	now := time.Now()
	return auth.UserRecord{
		ID:          "admin-1",
		Email:       input.Email,
		DisplayName: input.DisplayName,
		Role:        input.Role,
		Status:      string(model.UserStatusActive),
		Permissions: []string{model.PermissionAdminAccess},
		CreatedAt:   now,
		UpdatedAt:   now,
	}, nil
}

func TestServiceStatusRequiresSetupWhenNoAdminExists(t *testing.T) {
	service := NewService(&repoStub{adminCount: 0}, nil)

	status, err := service.Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if !status.SetupRequired {
		t.Fatal("expected setup required when no admin access user exists")
	}
}

func TestServiceStatusInitializedWhenAdminExists(t *testing.T) {
	service := NewService(&repoStub{adminCount: 1}, nil)

	status, err := service.Status(context.Background())
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if status.SetupRequired {
		t.Fatal("expected setup not required when an admin access user exists")
	}
}

func TestServiceSetupCreatesAdminUser(t *testing.T) {
	repo := &repoStub{adminCount: 0}
	service := NewService(repo, nil)

	result, err := service.Setup(context.Background(), SetupInput{
		Email:           " Admin@Example.COM ",
		DisplayName:     " Admin User ",
		Password:        "strong-password",
		PasswordConfirm: "strong-password",
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	if result.User.Role != string(model.UserRoleAdmin) {
		t.Fatalf("expected admin role, got %q", result.User.Role)
	}
	if repo.created.Role != string(model.UserRoleAdmin) {
		t.Fatalf("expected repository role admin, got %q", repo.created.Role)
	}
	if repo.created.Email != "admin@example.com" || repo.created.DisplayName != "Admin User" {
		t.Fatalf("expected normalized input, got %#v", repo.created)
	}
	if bcrypt.CompareHashAndPassword([]byte(repo.created.PasswordHash), []byte("strong-password")) != nil {
		t.Fatal("expected password hash to match input password")
	}
}

func TestServiceSetupRejectsAfterInitialization(t *testing.T) {
	service := NewService(&repoStub{adminCount: 1}, nil)

	_, err := service.Setup(context.Background(), SetupInput{
		Email:           "admin@example.com",
		DisplayName:     "Admin",
		Password:        "strong-password",
		PasswordConfirm: "strong-password",
	})
	if !errors.Is(err, ErrAlreadyInitialized) {
		t.Fatalf("expected ErrAlreadyInitialized, got %v", err)
	}
}

func TestServiceSetupRejectsInvalidInput(t *testing.T) {
	service := NewService(&repoStub{adminCount: 0}, nil)

	_, err := service.Setup(context.Background(), SetupInput{
		Email:           "admin@example.com",
		DisplayName:     "Admin",
		Password:        "short",
		PasswordConfirm: "different",
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestServiceSetupSerializesConcurrentInitialization(t *testing.T) {
	repo := &concurrentRepoStub{}
	service := NewService(repo, nil)

	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := service.Setup(context.Background(), SetupInput{
				Email:           "admin@example.com",
				DisplayName:     "Admin",
				Password:        "strong-password",
				PasswordConfirm: "strong-password",
			})
			results <- err
		}()
	}
	wg.Wait()
	close(results)

	var successCount int
	var alreadyInitializedCount int
	for err := range results {
		switch {
		case err == nil:
			successCount++
		case errors.Is(err, ErrAlreadyInitialized):
			alreadyInitializedCount++
		default:
			t.Fatalf("unexpected setup error: %v", err)
		}
	}
	if successCount != 1 || alreadyInitializedCount != 1 {
		t.Fatalf("expected one success and one ErrAlreadyInitialized, got successes=%d already_initialized=%d", successCount, alreadyInitializedCount)
	}
	if repo.CreatedCount() != 1 {
		t.Fatalf("expected one admin created, got %d", repo.CreatedCount())
	}
}

type concurrentRepoStub struct {
	mu           sync.Mutex
	createdCount int
}

func (r *concurrentRepoStub) CountUsersWithPermission(_ context.Context, permission string) (int, error) {
	if permission != model.PermissionAdminAccess {
		return 0, errors.New("unexpected permission")
	}
	count := r.CreatedCount()
	if count == 0 {
		time.Sleep(25 * time.Millisecond)
		return r.CreatedCount(), nil
	}
	return count, nil
}

func (r *concurrentRepoStub) CreateUser(_ context.Context, input auth.CreateUserInput) (auth.UserRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.createdCount++
	now := time.Now()
	return auth.UserRecord{
		ID:          "admin-1",
		Email:       input.Email,
		DisplayName: input.DisplayName,
		Role:        input.Role,
		Status:      string(model.UserStatusActive),
		Permissions: []string{model.PermissionAdminAccess},
		CreatedAt:   now,
		UpdatedAt:   now,
	}, nil
}

func (r *concurrentRepoStub) CreatedCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.createdCount
}
