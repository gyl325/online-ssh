package hostgroup

import (
	"context"
	"errors"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/model"
)

var ErrInvalidInput = errors.New("invalid input")

const maxHostGroupNameLength = 100

type Service struct {
	repo  Repository
	audit AuditRecorder
}

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

type SaveInput struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
}

func NewService(repo Repository, audit AuditRecorder) *Service {
	return &Service{repo: repo, audit: audit}
}

func (s *Service) List(ctx context.Context, userID string) ([]model.HostGroup, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.ListByUserID(ctx, userID)
}

func (s *Service) Create(ctx context.Context, userID string, input SaveInput) (model.HostGroup, error) {
	item, err := normalizeInput(userID, "", input)
	if err != nil {
		return model.HostGroup{}, err
	}
	created, err := s.repo.Create(ctx, item)
	if err != nil {
		return model.HostGroup{}, err
	}
	s.recordAudit(ctx, "host_group_create", created.UserID, created.ID)
	return created, nil
}

func (s *Service) Update(ctx context.Context, userID, groupID string, input SaveInput) (model.HostGroup, error) {
	item, err := normalizeInput(userID, groupID, input)
	if err != nil {
		return model.HostGroup{}, err
	}
	updated, err := s.repo.Update(ctx, userID, item)
	if err != nil {
		return model.HostGroup{}, err
	}
	s.recordAudit(ctx, "host_group_update", updated.UserID, updated.ID)
	return updated, nil
}

func (s *Service) Delete(ctx context.Context, userID, groupID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(groupID) == "" {
		return ErrInvalidInput
	}
	if err := s.repo.Delete(ctx, userID, groupID); err != nil {
		return err
	}
	s.recordAudit(ctx, "host_group_delete", userID, groupID)
	return nil
}

func normalizeInput(userID, groupID string, input SaveInput) (model.HostGroup, error) {
	name := strings.TrimSpace(input.Name)
	if strings.TrimSpace(userID) == "" || name == "" || len(name) > maxHostGroupNameLength {
		return model.HostGroup{}, ErrInvalidInput
	}
	if groupID != "" && strings.TrimSpace(groupID) == "" {
		return model.HostGroup{}, ErrInvalidInput
	}

	return model.HostGroup{
		ID:        strings.TrimSpace(groupID),
		UserID:    strings.TrimSpace(userID),
		Name:      name,
		SortOrder: input.SortOrder,
	}, nil
}

func (s *Service) recordAudit(ctx context.Context, eventType, userID, groupID string) {
	if s.audit == nil {
		return
	}
	_ = s.audit.Record(ctx, model.AuditLog{
		UserID:       userID,
		EventType:    eventType,
		ResourceType: stringPtr("host_group"),
		ResourceID:   stringPtr(groupID),
		Result:       string(model.AuditResultSuccess),
	})
}

func stringPtr(value string) *string {
	return &value
}
