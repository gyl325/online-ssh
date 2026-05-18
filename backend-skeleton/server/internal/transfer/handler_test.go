package transfer

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func TestHandlerTransferControls(t *testing.T) {
	t.Run("requires login", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/api/transfers/task-1/pause", nil)

		NewHandler(nil).Pause(recorder, req)

		assertTransferError(t, recorder, http.StatusUnauthorized, "UNAUTHORIZED")
	})

	t.Run("pause returns updated task", func(t *testing.T) {
		taskID := "pause-handler"
		cleanupTransferArtifacts(t, taskID)
		writeTransferFile(t, localUploadPath(taskID), []byte("123"))
		repo := &transferRepoStub{task: model.TransferTask{
			ID:               taskID,
			UserID:           "user-1",
			TaskType:         string(model.TransferTaskTypeUpload),
			TargetHostID:     transferStringRef("host-1"),
			TargetPath:       transferStringRef("/tmp"),
			TotalBytes:       10,
			TransferredBytes: 0,
			Status:           string(model.TransferTaskStatusUploadingToPlatform),
		}}
		service := NewService(repo, nil, nil, nil)
		defer service.Close()

		recorder := httptest.NewRecorder()
		req := authenticatedTransferRequest("POST", "/api/transfers/"+taskID+"/pause", taskID)

		NewHandler(service).Pause(recorder, req)

		if recorder.Code != http.StatusOK {
			t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, recorder.Code, recorder.Body.String())
		}

		var payload struct {
			Task map[string]any `json:"task"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if payload.Task["id"] != taskID || payload.Task["status"] != string(model.TransferTaskStatusPaused) {
			t.Fatalf("unexpected task response: %#v", payload.Task)
		}
	})

	t.Run("invalid state maps to conflict", func(t *testing.T) {
		repo := &transferRepoStub{task: model.TransferTask{
			ID:       "resume-handler",
			UserID:   "user-1",
			TaskType: string(model.TransferTaskTypeDownload),
			Status:   string(model.TransferTaskStatusCompleted),
		}}
		service := NewService(repo, nil, nil, nil)
		defer service.Close()

		recorder := httptest.NewRecorder()
		req := authenticatedTransferRequest("POST", "/api/transfers/resume-handler/resume", "resume-handler")

		NewHandler(service).Resume(recorder, req)

		assertTransferError(t, recorder, http.StatusConflict, "TRANSFER_STATE_CONFLICT")
	})

	t.Run("retry not allowed maps to conflict", func(t *testing.T) {
		repo := &transferRepoStub{task: model.TransferTask{
			ID:        "retry-handler",
			UserID:    "user-1",
			TaskType:  string(model.TransferTaskTypeDownload),
			Status:    string(model.TransferTaskStatusFailed),
			ErrorCode: transferStringRef(errorCodeDownloadFailed),
		}}
		service := NewService(repo, nil, nil, nil)
		defer service.Close()

		recorder := httptest.NewRecorder()
		req := authenticatedTransferRequest("POST", "/api/transfers/retry-handler/retry", "retry-handler")

		NewHandler(service).Retry(recorder, req)

		assertTransferError(t, recorder, http.StatusConflict, "TRANSFER_RETRY_NOT_ALLOWED")
	})

	t.Run("not found maps to 404", func(t *testing.T) {
		repo := &transferRepoStub{getErr: db.ErrNotFound}
		service := NewService(repo, nil, nil, nil)
		defer service.Close()

		recorder := httptest.NewRecorder()
		req := authenticatedTransferRequest("POST", "/api/transfers/missing/cancel", "missing")

		NewHandler(service).Cancel(recorder, req)

		assertTransferError(t, recorder, http.StatusNotFound, "NOT_FOUND")
	})
}

func TestHandlerUploadChunkRejectsInvalidOffset(t *testing.T) {
	service := NewService(&transferRepoStub{}, nil, nil, nil)
	defer service.Close()

	recorder := httptest.NewRecorder()
	req := authenticatedTransferRequest("POST", "/api/transfers/task-1/chunks?offset=-1", "task-1")

	NewHandler(service).UploadChunk(recorder, req)

	assertTransferError(t, recorder, http.StatusBadRequest, "BAD_REQUEST")
}

func TestHandlerListTransferCreatedRange(t *testing.T) {
	t.Run("passes created range filters to service", func(t *testing.T) {
		from := "2026-04-18T00:00:00Z"
		to := "2026-04-19T00:00:00Z"
		repo := &transferRepoStub{
			listItems: []model.TransferTask{{
				ID:        "task-1",
				UserID:    "user-1",
				TaskType:  string(model.TransferTaskTypeDownload),
				FileName:  "archive.tar",
				Status:    string(model.TransferTaskStatusCompleted),
				CreatedAt: time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC),
				UpdatedAt: time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC),
			}},
			listTotal: 1,
		}
		service := NewService(repo, nil, nil, nil)
		defer service.Close()

		recorder := httptest.NewRecorder()
		req := authenticatedTransferRequest("GET", "/api/transfers?created_from="+from+"&created_to="+to, "")

		NewHandler(service).List(recorder, req)

		if recorder.Code != http.StatusOK {
			t.Fatalf("expected status %d, got %d body=%s", http.StatusOK, recorder.Code, recorder.Body.String())
		}
		if repo.listFilter.CreatedFrom == nil || repo.listFilter.CreatedFrom.Format(time.RFC3339) != from {
			t.Fatalf("expected created_from %s, got %#v", from, repo.listFilter.CreatedFrom)
		}
		if repo.listFilter.CreatedTo == nil || repo.listFilter.CreatedTo.Format(time.RFC3339) != to {
			t.Fatalf("expected created_to %s, got %#v", to, repo.listFilter.CreatedTo)
		}
	})

	t.Run("rejects invalid created range time", func(t *testing.T) {
		service := NewService(&transferRepoStub{}, nil, nil, nil)
		defer service.Close()

		recorder := httptest.NewRecorder()
		req := authenticatedTransferRequest("GET", "/api/transfers?created_from=not-a-time", "")

		NewHandler(service).List(recorder, req)

		assertTransferError(t, recorder, http.StatusBadRequest, "BAD_REQUEST")
	})
}

func authenticatedTransferRequest(method, target, taskID string) *http.Request {
	req := httptest.NewRequest(method, target, nil)
	req.SetPathValue("taskId", taskID)
	session := auth.AuthenticatedSession{
		SessionID: "session-1",
		UserID:    "user-1",
		User:      model.User{ID: "user-1", Email: "user@example.com"},
	}
	return req.WithContext(auth.WithSession(req.Context(), session))
}

func assertTransferError(t *testing.T, recorder *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if recorder.Code != status {
		t.Fatalf("expected status %d, got %d body=%s", status, recorder.Code, recorder.Body.String())
	}
	var payload webutil.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Code != code {
		t.Fatalf("expected error code %q, got %#v", code, payload)
	}
}
