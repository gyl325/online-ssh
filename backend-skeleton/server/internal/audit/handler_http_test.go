package audit

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type auditRepoStub struct {
	listByUserIDFn func(context.Context, string, ListFilter) ([]model.AuditLog, int, error)
	getByIDFn      func(context.Context, string, string) (model.AuditLog, error)
}

func (s *auditRepoStub) Insert(context.Context, model.AuditLog) error {
	return nil
}

func (s *auditRepoStub) ListByUserID(ctx context.Context, userID string, filter ListFilter) ([]model.AuditLog, int, error) {
	if s.listByUserIDFn == nil {
		return nil, 0, nil
	}
	return s.listByUserIDFn(ctx, userID, filter)
}

func (s *auditRepoStub) GetByID(ctx context.Context, userID, logID string) (model.AuditLog, error) {
	if s.getByIDFn == nil {
		return model.AuditLog{}, nil
	}
	return s.getByIDFn(ctx, userID, logID)
}

func TestHandlerListRequiresSession(t *testing.T) {
	handler := NewHandler(NewService(&auditRepoStub{}))
	req := httptest.NewRequest(http.MethodGet, "/api/audit/logs", nil)
	recorder := httptest.NewRecorder()

	handler.List(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestHandlerListParsesFiltersAndPagination(t *testing.T) {
	var receivedUserID string
	var receivedFilter ListFilter
	repo := &auditRepoStub{
		listByUserIDFn: func(_ context.Context, userID string, filter ListFilter) ([]model.AuditLog, int, error) {
			receivedUserID = userID
			receivedFilter = filter
			return []model.AuditLog{
				{
					ID:           "log-1",
					UserID:       userID,
					EventType:    "file_delete",
					Result:       string(model.AuditResultFailure),
					Message:      stringPtr("delete failed"),
					MetadataJSON: []byte(`{"path":"/tmp/a.txt"}`),
					OccurredAt:   time.Date(2026, 4, 24, 12, 0, 0, 0, time.UTC),
				},
			}, 1, nil
		},
	}
	handler := NewHandler(NewService(repo))

	start := "2026-04-24T11:00:00Z"
	end := "2026-04-24T12:30:00Z"
	req := httptest.NewRequest(http.MethodGet, "/api/audit/logs?page=2&page_size=50&event_type=file_delete&target_host_id=host-1&result=failure&start_time="+start+"&end_time="+end, nil)
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
	recorder := httptest.NewRecorder()

	handler.List(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if receivedUserID != "user-1" {
		t.Fatalf("expected user-1, got %q", receivedUserID)
	}
	if receivedFilter.Limit != 50 || receivedFilter.Offset != 50 {
		t.Fatalf("unexpected pagination filter: %#v", receivedFilter)
	}
	if receivedFilter.EventType != "file_delete" || receivedFilter.TargetHostID != "host-1" || receivedFilter.Result != "failure" {
		t.Fatalf("unexpected filter values: %#v", receivedFilter)
	}
	if receivedFilter.StartTime == nil || receivedFilter.StartTime.Format(time.RFC3339) != start {
		t.Fatalf("unexpected start time: %#v", receivedFilter.StartTime)
	}
	if receivedFilter.EndTime == nil || receivedFilter.EndTime.Format(time.RFC3339) != end {
		t.Fatalf("unexpected end time: %#v", receivedFilter.EndTime)
	}

	var payload struct {
		Items []map[string]any `json:"items"`
		Page  int              `json:"page"`
		Total int              `json:"total"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if payload.Page != 2 || payload.Total != 1 || len(payload.Items) != 1 {
		t.Fatalf("unexpected list payload: %#v", payload)
	}
	metadata, ok := payload.Items[0]["metadata"].(map[string]any)
	if !ok || metadata["path"] != "/tmp/a.txt" {
		t.Fatalf("expected parsed metadata, got %#v", payload.Items[0]["metadata"])
	}
}

func TestHandlerGetNotFound(t *testing.T) {
	handler := NewHandler(NewService(&auditRepoStub{
		getByIDFn: func(context.Context, string, string) (model.AuditLog, error) {
			return model.AuditLog{}, db.ErrNotFound
		},
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/audit/logs/log-1", nil)
	req.SetPathValue("logId", "log-1")
	req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
	recorder := httptest.NewRecorder()

	handler.Get(recorder, req)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func stringPtr(value string) *string {
	return &value
}
