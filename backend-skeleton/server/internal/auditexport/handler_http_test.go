package auditexport

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

func TestHandlerCreateRequiresSession(t *testing.T) {
	handler := NewHandler(NewService(&exportRepoStub{}, &auditListerStub{}, nil))
	req := httptest.NewRequest(http.MethodPost, "/api/audit/exports", bytes.NewBufferString(`{}`))
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestHandlerCreateRejectsInvalidBody(t *testing.T) {
	handler := NewHandler(NewService(&exportRepoStub{}, &auditListerStub{}, nil))
	req := httptest.NewRequest(http.MethodPost, "/api/audit/exports", bytes.NewBufferString(`{invalid`))
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
	recorder := httptest.NewRecorder()

	handler.Create(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestHandlerDownloadMapsNotReady(t *testing.T) {
	repo := &exportRepoStub{
		task: model.AuditExportTask{
			ID:        "export-1",
			UserID:    "user-1",
			Status:    string(model.AuditExportTaskStatusRunning),
			ExpiresAt: time.Now().Add(time.Hour),
		},
	}
	handler := NewHandler(NewService(repo, &auditListerStub{}, nil))
	req := httptest.NewRequest(http.MethodGet, "/api/audit/exports/export-1/download", nil)
	req.SetPathValue("exportId", "export-1")
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
	recorder := httptest.NewRecorder()

	handler.Download(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestHandlerGetMapsNotFound(t *testing.T) {
	service := &Service{repo: missingExportRepo{}}
	handler := NewHandler(service)
	req := httptest.NewRequest(http.MethodGet, "/api/audit/exports/export-1", nil)
	req.SetPathValue("exportId", "export-1")
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
	recorder := httptest.NewRecorder()

	handler.Get(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

type missingExportRepo struct{}

func (missingExportRepo) Create(context.Context, model.AuditExportTask) (model.AuditExportTask, error) {
	return model.AuditExportTask{}, db.ErrNotFound
}
func (missingExportRepo) ListByUserID(context.Context, string, int, int) ([]model.AuditExportTask, int, error) {
	return nil, 0, db.ErrNotFound
}
func (missingExportRepo) GetByID(context.Context, string, string) (model.AuditExportTask, error) {
	return model.AuditExportTask{}, db.ErrNotFound
}
func (missingExportRepo) GetByIDAny(context.Context, string) (model.AuditExportTask, error) {
	return model.AuditExportTask{}, db.ErrNotFound
}
func (missingExportRepo) CountActiveByUser(context.Context, string) (int, error) { return 0, nil }
func (missingExportRepo) Start(context.Context, string) error                    { return nil }
func (missingExportRepo) UpdateProgress(context.Context, string, int, int) error { return nil }
func (missingExportRepo) Finish(context.Context, string, string, string, string, string, int, int) error {
	return nil
}
func (missingExportRepo) Cancel(context.Context, string, string) (model.AuditExportTask, error) {
	return model.AuditExportTask{}, db.ErrNotFound
}
func (missingExportRepo) Delete(context.Context, string, string) error {
	return db.ErrNotFound
}
