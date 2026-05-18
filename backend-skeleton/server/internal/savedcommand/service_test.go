package savedcommand

import (
	"context"
	"errors"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type savedCommandRepoStub struct {
	items       []model.SavedCommand
	createErr   error
	updateErr   error
	deleteErr   error
	createCalls []model.SavedCommand
	updateCalls []model.SavedCommand
	deleteCalls []string
}

func (s *savedCommandRepoStub) ListByUserID(context.Context, string) ([]model.SavedCommand, error) {
	return s.items, nil
}

func (s *savedCommandRepoStub) Create(_ context.Context, item model.SavedCommand) (model.SavedCommand, error) {
	s.createCalls = append(s.createCalls, item)
	if s.createErr != nil {
		return model.SavedCommand{}, s.createErr
	}
	item.ID = "command-1"
	s.items = append(s.items, item)
	return item, nil
}

func (s *savedCommandRepoStub) Update(_ context.Context, _ string, item model.SavedCommand) (model.SavedCommand, error) {
	s.updateCalls = append(s.updateCalls, item)
	if s.updateErr != nil {
		return model.SavedCommand{}, s.updateErr
	}
	return item, nil
}

func (s *savedCommandRepoStub) Delete(_ context.Context, _ string, commandID string) error {
	s.deleteCalls = append(s.deleteCalls, commandID)
	return s.deleteErr
}

type savedCommandAuditRecorder struct {
	logs []model.AuditLog
}

func (r *savedCommandAuditRecorder) Record(_ context.Context, log model.AuditLog) error {
	r.logs = append(r.logs, log)
	return nil
}

func TestServiceCreateSavedCommandNormalizesInputAndRecordsAudit(t *testing.T) {
	repo := &savedCommandRepoStub{}
	audit := &savedCommandAuditRecorder{}
	service := NewService(repo, audit)
	description := "  Disk usage  "
	category := "  System  "

	item, err := service.Create(context.Background(), " user-1 ", SaveInput{
		Name:        "  Check disk  ",
		CommandText: " df -h ",
		Category:    &category,
		Description: &description,
		SortOrder:   2,
	})
	if err != nil {
		t.Fatalf("create saved command: %v", err)
	}

	if item.ID != "command-1" || item.UserID != "user-1" || item.Name != "Check disk" {
		t.Fatalf("unexpected saved command identity: %#v", item)
	}
	if item.CommandText != " df -h " {
		t.Fatalf("expected command text to preserve typed spacing, got %q", item.CommandText)
	}
	if item.Category == nil || *item.Category != "System" {
		t.Fatalf("expected trimmed category, got %#v", item.Category)
	}
	if item.Description == nil || *item.Description != "Disk usage" {
		t.Fatalf("expected trimmed description, got %#v", item.Description)
	}
	if item.SortOrder != 2 {
		t.Fatalf("expected sort order 2, got %d", item.SortOrder)
	}
	if len(audit.logs) != 1 || audit.logs[0].EventType != "saved_command_create" {
		t.Fatalf("unexpected audit logs: %#v", audit.logs)
	}
}

func TestServiceRejectsInvalidSavedCommandInput(t *testing.T) {
	service := NewService(&savedCommandRepoStub{}, nil)

	if _, err := service.Create(context.Background(), "", SaveInput{Name: "Name", CommandText: "echo ok"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input for blank user id, got %v", err)
	}
	if _, err := service.Create(context.Background(), "user-1", SaveInput{Name: " ", CommandText: "echo ok"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input for blank name, got %v", err)
	}
	if _, err := service.Create(context.Background(), "user-1", SaveInput{Name: "Name", CommandText: "   "}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input for blank command, got %v", err)
	}

	description := makeString(501)
	if _, err := service.Create(context.Background(), "user-1", SaveInput{
		Name:        "Name",
		CommandText: "echo ok",
		Description: &description,
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input for long description, got %v", err)
	}

	category := makeString(81)
	if _, err := service.Create(context.Background(), "user-1", SaveInput{
		Name:        "Name",
		CommandText: "echo ok",
		Category:    &category,
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input for long category, got %v", err)
	}
}

func TestServiceDeleteSavedCommandRecordsAuditOnlyAfterSuccess(t *testing.T) {
	repo := &savedCommandRepoStub{}
	audit := &savedCommandAuditRecorder{}
	service := NewService(repo, audit)

	if err := service.Delete(context.Background(), "user-1", "command-1"); err != nil {
		t.Fatalf("delete saved command: %v", err)
	}
	if len(repo.deleteCalls) != 1 || repo.deleteCalls[0] != "command-1" {
		t.Fatalf("unexpected delete calls: %#v", repo.deleteCalls)
	}
	if len(audit.logs) != 1 || audit.logs[0].EventType != "saved_command_delete" {
		t.Fatalf("unexpected audit logs: %#v", audit.logs)
	}

	repo.deleteErr = db.ErrNotFound
	if err := service.Delete(context.Background(), "user-1", "missing"); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("expected not found, got %v", err)
	}
	if len(audit.logs) != 1 {
		t.Fatalf("delete failure should not record audit, got %#v", audit.logs)
	}
}

func makeString(length int) string {
	value := make([]byte, length)
	for index := range value {
		value[index] = 'x'
	}
	return string(value)
}
