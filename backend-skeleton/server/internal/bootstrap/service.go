package bootstrap

import (
	"context"
	"errors"
	"strings"
	"sync"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/model"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrAlreadyInitialized = errors.New("already initialized")
	ErrInvalidInput       = errors.New("invalid input")
)

type Repository interface {
	CountUsersWithPermission(ctx context.Context, permission string) (int, error)
	CreateUser(ctx context.Context, input auth.CreateUserInput) (auth.UserRecord, error)
}

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

type Service struct {
	mu    sync.Mutex
	repo  Repository
	audit AuditRecorder
}

type Status struct {
	SetupRequired      bool `json:"setup_required"`
	SetupTokenRequired bool `json:"setup_token_required,omitempty"`
}

type SetupInput struct {
	Email           string `json:"email"`
	DisplayName     string `json:"display_name"`
	Password        string `json:"password"`
	PasswordConfirm string `json:"password_confirm"`
}

type SetupResult struct {
	User model.User `json:"user"`
}

func NewService(repo Repository, audit AuditRecorder) *Service {
	return &Service{repo: repo, audit: audit}
}

func (s *Service) Status(ctx context.Context) (Status, error) {
	count, err := s.repo.CountUsersWithPermission(ctx, model.PermissionAdminAccess)
	if err != nil {
		return Status{}, err
	}
	return Status{SetupRequired: count == 0}, nil
}

func (s *Service) Setup(ctx context.Context, input SetupInput) (SetupResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	status, err := s.Status(ctx)
	if err != nil {
		return SetupResult{}, err
	}
	if !status.SetupRequired {
		return SetupResult{}, ErrAlreadyInitialized
	}

	email := normalizeEmail(input.Email)
	displayName := strings.TrimSpace(input.DisplayName)
	if email == "" || displayName == "" || len(input.Password) < 8 || input.Password != input.PasswordConfirm {
		return SetupResult{}, ErrInvalidInput
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return SetupResult{}, err
	}

	record, err := s.repo.CreateUser(ctx, auth.CreateUserInput{
		Email:        email,
		PasswordHash: string(passwordHash),
		DisplayName:  displayName,
		Role:         string(model.UserRoleAdmin),
	})
	if err != nil {
		return SetupResult{}, err
	}

	if s.audit != nil {
		_ = s.audit.Record(ctx, model.AuditLog{
			UserID:    record.ID,
			EventType: "bootstrap_admin_created",
			Result:    string(model.AuditResultSuccess),
		})
	}

	return SetupResult{User: userRecordToModel(record)}, nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func userRecordToModel(record auth.UserRecord) model.User {
	return model.User{
		ID:              record.ID,
		Email:           record.Email,
		DisplayName:     record.DisplayName,
		PreferredLocale: record.PreferredLocale,
		Theme:           record.Theme,
		Status:          record.Status,
		Role:            record.Role,
		AuthType:        record.AuthType,
		Permissions:     append([]string(nil), record.Permissions...),
		LastLoginAt:     record.LastLoginAt,
		CreatedAt:       record.CreatedAt,
		UpdatedAt:       record.UpdatedAt,
	}
}
