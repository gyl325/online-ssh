package savedcommand

import (
	"context"
	"errors"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/model"
)

var ErrInvalidInput = errors.New("invalid input")

const (
	maxCommandNameLength        = 120
	maxCommandTextLength        = 4096
	maxCommandCategoryLength    = 80
	maxCommandDescriptionLength = 500
)

type Service struct {
	repo  Repository
	audit AuditRecorder
}

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

type SaveInput struct {
	Name        string  `json:"name"`
	CommandText string  `json:"command_text"`
	Category    *string `json:"category"`
	Description *string `json:"description"`
	SortOrder   int     `json:"sort_order"`
}

func NewService(repo Repository, audit AuditRecorder) *Service {
	return &Service{repo: repo, audit: audit}
}

func (s *Service) List(ctx context.Context, userID string) ([]model.SavedCommand, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrInvalidInput
	}
	return s.repo.ListByUserID(ctx, userID)
}

func (s *Service) Create(ctx context.Context, userID string, input SaveInput) (model.SavedCommand, error) {
	item, err := normalizeInput(userID, "", input)
	if err != nil {
		return model.SavedCommand{}, err
	}
	created, err := s.repo.Create(ctx, item)
	if err != nil {
		return model.SavedCommand{}, err
	}
	s.recordAudit(ctx, "saved_command_create", created.UserID, created.ID)
	return created, nil
}

func (s *Service) Update(ctx context.Context, userID, commandID string, input SaveInput) (model.SavedCommand, error) {
	item, err := normalizeInput(userID, commandID, input)
	if err != nil {
		return model.SavedCommand{}, err
	}
	updated, err := s.repo.Update(ctx, userID, item)
	if err != nil {
		return model.SavedCommand{}, err
	}
	s.recordAudit(ctx, "saved_command_update", updated.UserID, updated.ID)
	return updated, nil
}

func (s *Service) Delete(ctx context.Context, userID, commandID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(commandID) == "" {
		return ErrInvalidInput
	}
	if err := s.repo.Delete(ctx, userID, commandID); err != nil {
		return err
	}
	s.recordAudit(ctx, "saved_command_delete", userID, commandID)
	return nil
}

func normalizeInput(userID, commandID string, input SaveInput) (model.SavedCommand, error) {
	name := strings.TrimSpace(input.Name)
	commandText := input.CommandText
	if strings.TrimSpace(userID) == "" || name == "" || strings.TrimSpace(commandText) == "" {
		return model.SavedCommand{}, ErrInvalidInput
	}
	if commandID != "" && strings.TrimSpace(commandID) == "" {
		return model.SavedCommand{}, ErrInvalidInput
	}
	if len(name) > maxCommandNameLength || len(commandText) > maxCommandTextLength {
		return model.SavedCommand{}, ErrInvalidInput
	}

	var description *string
	var category *string
	if input.Category != nil {
		trimmed := strings.TrimSpace(*input.Category)
		if len(trimmed) > maxCommandCategoryLength {
			return model.SavedCommand{}, ErrInvalidInput
		}
		if trimmed != "" {
			category = &trimmed
		}
	}
	if input.Description != nil {
		trimmed := strings.TrimSpace(*input.Description)
		if len(trimmed) > maxCommandDescriptionLength {
			return model.SavedCommand{}, ErrInvalidInput
		}
		if trimmed != "" {
			description = &trimmed
		}
	}

	return model.SavedCommand{
		ID:          strings.TrimSpace(commandID),
		UserID:      strings.TrimSpace(userID),
		Name:        name,
		CommandText: commandText,
		Category:    category,
		Description: description,
		SortOrder:   input.SortOrder,
	}, nil
}

func (s *Service) recordAudit(ctx context.Context, eventType, userID, commandID string) {
	if s.audit == nil {
		return
	}
	_ = s.audit.Record(ctx, model.AuditLog{
		UserID:       userID,
		EventType:    eventType,
		ResourceType: stringPtr("saved_command"),
		ResourceID:   stringPtr(commandID),
		Result:       string(model.AuditResultSuccess),
	})
}

func stringPtr(value string) *string {
	return &value
}
