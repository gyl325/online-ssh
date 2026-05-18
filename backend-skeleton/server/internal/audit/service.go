package audit

import (
	"context"

	"github.com/example/online-ssh-platform/server/internal/model"
)

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Record(ctx context.Context, log model.AuditLog) error {
	return s.repo.Insert(ctx, log)
}

func (s *Service) List(ctx context.Context, userID string, filter ListFilter) ([]model.AuditLog, int, error) {
	return s.repo.ListByUserID(ctx, userID, filter)
}

func (s *Service) Get(ctx context.Context, userID, logID string) (model.AuditLog, error) {
	return s.repo.GetByID(ctx, userID, logID)
}
