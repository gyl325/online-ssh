package auditexport

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/audit"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type exportRepoStub struct {
	mu          sync.Mutex
	task        model.AuditExportTask
	activeCount int
	finished    []model.AuditExportTask
}

func (s *exportRepoStub) Create(_ context.Context, task model.AuditExportTask) (model.AuditExportTask, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task.ID = "export-1"
	s.task = task
	return task, nil
}

func (s *exportRepoStub) ListByUserID(context.Context, string, int, int) ([]model.AuditExportTask, int, error) {
	return nil, 0, nil
}

func (s *exportRepoStub) GetByID(_ context.Context, userID, taskID string) (model.AuditExportTask, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.task.ID != taskID || s.task.UserID != userID {
		return model.AuditExportTask{}, db.ErrNotFound
	}
	return s.task, nil
}

func (s *exportRepoStub) GetByIDAny(_ context.Context, taskID string) (model.AuditExportTask, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.task.ID != taskID {
		return model.AuditExportTask{}, db.ErrNotFound
	}
	return s.task, nil
}

func (s *exportRepoStub) CountActiveByUser(context.Context, string) (int, error) {
	return s.activeCount, nil
}

func (s *exportRepoStub) Start(_ context.Context, taskID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.task.ID != taskID || s.task.Status != string(model.AuditExportTaskStatusPending) {
		return db.ErrNotFound
	}
	s.task.Status = string(model.AuditExportTaskStatusRunning)
	return nil
}

func (s *exportRepoStub) UpdateProgress(_ context.Context, taskID string, totalRows, exportedRows int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.task.ID != taskID {
		return db.ErrNotFound
	}
	s.task.TotalRows = totalRows
	s.task.ExportedRows = exportedRows
	return nil
}

func (s *exportRepoStub) Finish(_ context.Context, taskID, status, resultCSV, errorCode, errorMessage string, totalRows, exportedRows int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.task.ID != taskID {
		return db.ErrNotFound
	}
	s.task.Status = status
	s.task.ResultCSV = resultCSV
	s.task.TotalRows = totalRows
	s.task.ExportedRows = exportedRows
	if errorCode != "" {
		s.task.ErrorCode = stringPtr(errorCode)
	}
	if errorMessage != "" {
		s.task.ErrorMessage = stringPtr(errorMessage)
	}
	s.finished = append(s.finished, s.task)
	return nil
}

func (s *exportRepoStub) Cancel(context.Context, string, string) (model.AuditExportTask, error) {
	return model.AuditExportTask{}, nil
}

func (s *exportRepoStub) Delete(_ context.Context, userID, taskID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.task.ID != taskID || s.task.UserID != userID {
		return db.ErrNotFound
	}
	s.task = model.AuditExportTask{}
	return nil
}

type auditListerStub struct {
	items []model.AuditLog
	total int
	err   error
}

func (s *auditListerStub) List(_ context.Context, _ string, filter audit.ListFilter) ([]model.AuditLog, int, error) {
	if s.err != nil {
		return nil, 0, s.err
	}
	if filter.Offset >= len(s.items) {
		return nil, s.total, nil
	}
	end := filter.Offset + filter.Limit
	if end > len(s.items) {
		end = len(s.items)
	}
	return s.items[filter.Offset:end], s.total, nil
}

type exportAuditRecorder struct {
	logs []model.AuditLog
}

func (r *exportAuditRecorder) Record(_ context.Context, log model.AuditLog) error {
	r.logs = append(r.logs, log)
	return nil
}

func TestServiceRunCompletesCSVExport(t *testing.T) {
	repo := &exportRepoStub{
		task: model.AuditExportTask{
			ID:        "export-1",
			UserID:    "user-1",
			Status:    string(model.AuditExportTaskStatusPending),
			ExpiresAt: time.Now().Add(time.Hour),
		},
	}
	message := "login ok"
	auditLogs := &auditListerStub{
		total: 1,
		items: []model.AuditLog{
			{
				ID:         "log-1",
				UserID:     "user-1",
				EventType:  "auth_login",
				Result:     string(model.AuditResultSuccess),
				Message:    &message,
				OccurredAt: time.Date(2026, 4, 28, 8, 0, 0, 0, time.UTC),
			},
		},
	}
	recorder := &exportAuditRecorder{}
	service := &Service{
		repo:          repo,
		audit:         auditLogs,
		log:           recorder,
		workerCtx:     context.Background(),
		activeExports: make(map[string]context.CancelFunc),
	}

	service.run("export-1")

	if repo.task.Status != string(model.AuditExportTaskStatusCompleted) {
		t.Fatalf("expected completed export, got %#v", repo.task)
	}
	if repo.task.TotalRows != 1 || repo.task.ExportedRows != 1 {
		t.Fatalf("unexpected export counts: %#v", repo.task)
	}
	if !strings.Contains(repo.task.ResultCSV, "id,occurred_at,event_type,result") || !strings.Contains(repo.task.ResultCSV, "log-1") {
		t.Fatalf("unexpected CSV: %q", repo.task.ResultCSV)
	}
	if len(recorder.logs) != 2 || recorder.logs[1].EventType != "audit_export_task_completed" {
		t.Fatalf("unexpected audit events: %#v", recorder.logs)
	}
}

func TestServiceRunFailsWhenExportLimitReached(t *testing.T) {
	repo := &exportRepoStub{
		task: model.AuditExportTask{
			ID:        "export-1",
			UserID:    "user-1",
			Status:    string(model.AuditExportTaskStatusPending),
			ExpiresAt: time.Now().Add(time.Hour),
		},
	}
	service := &Service{
		repo: repo,
		audit: &auditListerStub{
			total: maxExportRows + 1,
		},
		workerCtx:     context.Background(),
		activeExports: make(map[string]context.CancelFunc),
	}

	service.run("export-1")

	if repo.task.Status != string(model.AuditExportTaskStatusFailed) || repo.task.ErrorCode == nil || *repo.task.ErrorCode != errorCodeLimitReached {
		t.Fatalf("expected limit failure, got %#v", repo.task)
	}
}

func TestServiceCreateRejectsActiveTaskLimit(t *testing.T) {
	service := NewService(&exportRepoStub{activeCount: maxActiveTasksPerUser}, &auditListerStub{}, nil)
	defer service.Close()

	_, err := service.Create(context.Background(), CreateInput{UserID: "user-1"})
	if !errors.Is(err, ErrQueueFull) {
		t.Fatalf("expected queue full, got %v", err)
	}
}
