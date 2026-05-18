package transfer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"strings"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type transferRepoStub struct {
	task             model.TransferTask
	getErr           error
	listFilter       ListFilter
	listItems        []model.TransferTask
	listTotal        int
	listErr          error
	updateCalls      []transferStatusUpdate
	incrementRetries int
}

type transferStatusUpdate struct {
	taskID           string
	status           string
	transferredBytes int64
	errorCode        string
	errorMessage     string
}

func (s *transferRepoStub) CreateTask(context.Context, model.TransferTask) (model.TransferTask, error) {
	return model.TransferTask{}, errors.New("unexpected CreateTask call")
}

func (s *transferRepoStub) UpdateTaskStatus(_ context.Context, taskID string, status string, transferredBytes int64, errorCode, errorMessage string) error {
	s.updateCalls = append(s.updateCalls, transferStatusUpdate{
		taskID:           taskID,
		status:           status,
		transferredBytes: transferredBytes,
		errorCode:        errorCode,
		errorMessage:     errorMessage,
	})
	s.task.Status = status
	s.task.TransferredBytes = transferredBytes
	if errorCode == "" {
		s.task.ErrorCode = nil
	} else {
		s.task.ErrorCode = transferStringRef(errorCode)
	}
	if errorMessage == "" {
		s.task.ErrorMessage = nil
	} else {
		s.task.ErrorMessage = transferStringRef(errorMessage)
	}
	return nil
}

func (s *transferRepoStub) GetTaskByID(context.Context, string, string) (model.TransferTask, error) {
	if s.getErr != nil {
		return model.TransferTask{}, s.getErr
	}
	return s.task, nil
}

func (s *transferRepoStub) GetTaskByIDAny(context.Context, string) (model.TransferTask, error) {
	return model.TransferTask{ID: "worker-ignore", Status: string(model.TransferTaskStatusCompleted)}, nil
}

func (s *transferRepoStub) FindLatestUploadTask(context.Context, string, string, string, string, int64, []string) (model.TransferTask, error) {
	return model.TransferTask{}, db.ErrNotFound
}

func (s *transferRepoStub) ListTasksByUserID(_ context.Context, _ string, filter ListFilter) ([]model.TransferTask, int, error) {
	s.listFilter = filter
	return s.listItems, s.listTotal, s.listErr
}

func (s *transferRepoStub) ListTasksByStatuses(context.Context, []string, int) ([]model.TransferTask, error) {
	return nil, nil
}

func (s *transferRepoStub) IncrementRetryCount(context.Context, string) error {
	s.incrementRetries++
	s.task.RetryCount++
	return nil
}

type transferAuditRecorder struct {
	logs []model.AuditLog
}

func (r *transferAuditRecorder) Record(_ context.Context, log model.AuditLog) error {
	r.logs = append(r.logs, log)
	return nil
}

func TestServicePauseResumeAndRetry(t *testing.T) {
	ctx := context.Background()

	t.Run("pause upload task uses local upload progress", func(t *testing.T) {
		taskID := "pause-upload"
		cleanupTransferArtifacts(t, taskID)
		writeTransferFile(t, localUploadPath(taskID), []byte("1234"))

		repo := &transferRepoStub{
			task: model.TransferTask{
				ID:               taskID,
				UserID:           "user-1",
				TaskType:         string(model.TransferTaskTypeUpload),
				TargetHostID:     transferStringRef("host-1"),
				TargetPath:       transferStringRef("/tmp"),
				TotalBytes:       10,
				TransferredBytes: 0,
				Status:           string(model.TransferTaskStatusUploadingToPlatform),
			},
		}
		audit := &transferAuditRecorder{}
		service := NewService(repo, nil, nil, audit)
		defer service.Close()

		item, err := service.Pause(ctx, "user-1", taskID)
		if err != nil {
			t.Fatalf("pause task: %v", err)
		}
		if item.Status != string(model.TransferTaskStatusPaused) || item.TransferredBytes != 4 {
			t.Fatalf("unexpected paused task: %#v", item)
		}
		if len(repo.updateCalls) != 1 || repo.updateCalls[0].status != string(model.TransferTaskStatusPaused) || repo.updateCalls[0].transferredBytes != 4 {
			t.Fatalf("unexpected update calls: %#v", repo.updateCalls)
		}
		if len(audit.logs) != 1 || audit.logs[0].EventType != "transfer_task_pause" {
			t.Fatalf("unexpected audit logs: %#v", audit.logs)
		}
	})

	t.Run("resume paused upload with partial local file returns to platform upload", func(t *testing.T) {
		taskID := "resume-upload"
		cleanupTransferArtifacts(t, taskID)
		writeTransferFile(t, localUploadPath(taskID), []byte("12345"))

		repo := &transferRepoStub{
			task: model.TransferTask{
				ID:               taskID,
				UserID:           "user-1",
				TaskType:         string(model.TransferTaskTypeUpload),
				TargetHostID:     transferStringRef("host-1"),
				TargetPath:       transferStringRef("/tmp"),
				TotalBytes:       10,
				TransferredBytes: 8,
				Status:           string(model.TransferTaskStatusPaused),
			},
		}
		audit := &transferAuditRecorder{}
		service := NewService(repo, nil, nil, audit)
		defer service.Close()

		item, err := service.Resume(ctx, "user-1", taskID)
		if err != nil {
			t.Fatalf("resume task: %v", err)
		}
		if item.Status != string(model.TransferTaskStatusUploadingToPlatform) || item.TransferredBytes != 5 {
			t.Fatalf("unexpected resumed task: %#v", item)
		}
		if len(repo.updateCalls) != 1 || repo.updateCalls[0].status != string(model.TransferTaskStatusUploadingToPlatform) || repo.updateCalls[0].transferredBytes != 5 {
			t.Fatalf("unexpected update calls: %#v", repo.updateCalls)
		}
		if len(audit.logs) != 1 || audit.logs[0].EventType != "transfer_task_resume" {
			t.Fatalf("unexpected audit logs: %#v", audit.logs)
		}
	})

	t.Run("retry failed download increments retry count and resets to pending", func(t *testing.T) {
		taskID := "retry-download"
		cleanupTransferArtifacts(t, taskID)
		writeTransferFile(t, localDownloadPath(taskID), []byte("123456"))

		repo := &transferRepoStub{
			task: model.TransferTask{
				ID:               taskID,
				UserID:           "user-1",
				TaskType:         string(model.TransferTaskTypeDownload),
				SourceHostID:     transferStringRef("host-1"),
				SourcePath:       transferStringRef("/var/log/app.log"),
				TotalBytes:       20,
				TransferredBytes: 3,
				Status:           string(model.TransferTaskStatusFailed),
				ErrorCode:        transferStringRef(errorCodeDownloadRetryable),
			},
		}
		audit := &transferAuditRecorder{}
		service := NewService(repo, nil, nil, audit)
		defer service.Close()

		item, err := service.Retry(ctx, "user-1", taskID)
		if err != nil {
			t.Fatalf("retry task: %v", err)
		}
		if item.Status != string(model.TransferTaskStatusPending) || item.TransferredBytes != 6 || item.RetryCount != 1 {
			t.Fatalf("unexpected retried task: %#v", item)
		}
		if repo.incrementRetries != 1 {
			t.Fatalf("expected retry count increment once, got %d", repo.incrementRetries)
		}
		if len(repo.updateCalls) != 1 || repo.updateCalls[0].status != string(model.TransferTaskStatusPending) || repo.updateCalls[0].transferredBytes != 6 {
			t.Fatalf("unexpected update calls: %#v", repo.updateCalls)
		}
		if len(audit.logs) != 1 || audit.logs[0].EventType != "transfer_task_retry" {
			t.Fatalf("unexpected audit logs: %#v", audit.logs)
		}
	})

	t.Run("retry rejects non retryable failure", func(t *testing.T) {
		repo := &transferRepoStub{
			task: model.TransferTask{
				ID:        "retry-reject",
				UserID:    "user-1",
				TaskType:  string(model.TransferTaskTypeDownload),
				Status:    string(model.TransferTaskStatusFailed),
				ErrorCode: transferStringRef(errorCodeDownloadFailed),
			},
		}
		service := NewService(repo, nil, nil, nil)
		defer service.Close()

		_, err := service.Retry(ctx, "user-1", "retry-reject")
		if !errors.Is(err, ErrRetryNotAllowed) {
			t.Fatalf("expected ErrRetryNotAllowed, got %v", err)
		}
	})
}

func TestTransferRemotePathValidation(t *testing.T) {
	ctx := context.Background()

	t.Run("init upload rejects relative and root target paths before host lookup", func(t *testing.T) {
		service := NewService(&transferRepoStub{}, nil, nil, nil)
		defer service.Close()

		invalid := []string{"relative", "../tmp", "/"}
		for _, targetPath := range invalid {
			_, err := service.InitUpload(ctx, InitUploadInput{
				UserID:       "user-1",
				TargetHostID: "host-1",
				TargetPath:   targetPath,
				FileName:     "app.log",
				FileSize:     1,
			})
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput for target path %q, got %v", targetPath, err)
			}
		}
	})

	t.Run("create download rejects relative and root source paths before host service", func(t *testing.T) {
		service := NewService(&transferRepoStub{}, nil, nil, nil)
		defer service.Close()

		invalid := []string{"relative.log", "../tmp/app.log", "/"}
		for _, sourcePath := range invalid {
			_, err := service.CreateDownloadTask(ctx, CreateDownloadInput{
				UserID:     "user-1",
				HostID:     "host-1",
				SourcePath: sourcePath,
			})
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput for source path %q, got %v", sourcePath, err)
			}
		}
	})

	t.Run("helper cleans absolute transfer paths", func(t *testing.T) {
		cleanPath, err := cleanTransferRemotePath(" /var/../var/log/app.log ")
		if err != nil {
			t.Fatalf("clean transfer path: %v", err)
		}
		if cleanPath != "/var/log/app.log" {
			t.Fatalf("expected cleaned path, got %q", cleanPath)
		}
	})
}

func TestServiceFailTaskWritesStructuredOperationalLog(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	taskID := "failed-download"
	repo := &transferRepoStub{
		task: model.TransferTask{
			ID:               taskID,
			UserID:           "user-1",
			TaskType:         string(model.TransferTaskTypeDownload),
			SourceHostID:     transferStringRef("host-1"),
			SourcePath:       transferStringRef("/var/log/secret.log"),
			TotalBytes:       20,
			TransferredBytes: 7,
			Status:           string(model.TransferTaskStatusTransferring),
		},
	}
	service := NewService(repo, nil, nil, nil)
	defer service.Close()

	service.failTask(context.Background(), repo.task, errorCodeDownloadPermissionDenied, "permission denied: /var/log/secret.log")

	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatalf("decode structured log: %v; output=%s", err, output.String())
	}
	if record["msg"] != "transfer task failed" ||
		record["component"] != "transfer" ||
		record["event"] != "transfer_task_failed" ||
		record["user_id"] != "user-1" ||
		record["task_id"] != taskID ||
		record["host_id"] != "host-1" ||
		record["task_type"] != string(model.TransferTaskTypeDownload) ||
		record["status"] != string(model.TransferTaskStatusFailed) ||
		record["error_code"] != errorCodeDownloadPermissionDenied ||
		record["error_kind"] != "permission_denied" {
		t.Fatalf("unexpected log record: %#v", record)
	}
	if strings.Contains(output.String(), "/var/log/secret.log") || strings.Contains(output.String(), "permission denied:") {
		t.Fatalf("structured operational log leaked sensitive path or raw error message: %s", output.String())
	}
}

func TestServiceCancelWritesStructuredOperationalLog(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	taskID := "cancel-upload"
	repo := &transferRepoStub{
		task: model.TransferTask{
			ID:               taskID,
			UserID:           "user-1",
			TaskType:         string(model.TransferTaskTypeUpload),
			TargetHostID:     transferStringRef("host-1"),
			TargetPath:       transferStringRef("/home/user/private.txt"),
			TotalBytes:       20,
			TransferredBytes: 8,
			Status:           string(model.TransferTaskStatusPaused),
		},
	}
	service := NewService(repo, nil, nil, nil)
	defer service.Close()

	if _, err := service.Cancel(context.Background(), "user-1", taskID); err != nil {
		t.Fatalf("cancel transfer task: %v", err)
	}

	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatalf("decode structured log: %v; output=%s", err, output.String())
	}
	if record["msg"] != "transfer task canceled" ||
		record["component"] != "transfer" ||
		record["event"] != "transfer_task_canceled" ||
		record["user_id"] != "user-1" ||
		record["task_id"] != taskID ||
		record["host_id"] != "host-1" ||
		record["task_type"] != string(model.TransferTaskTypeUpload) ||
		record["status"] != string(model.TransferTaskStatusCanceled) ||
		record["transferred_bytes"] != float64(8) {
		t.Fatalf("unexpected log record: %#v", record)
	}
	if strings.Contains(output.String(), "/home/user/private.txt") {
		t.Fatalf("structured operational log leaked remote path: %s", output.String())
	}
}

func TestLogTransferTaskCompletedWritesStructuredOperationalLog(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	task := model.TransferTask{
		ID:           "completed-download",
		UserID:       "user-1",
		TaskType:     string(model.TransferTaskTypeDownload),
		SourceHostID: transferStringRef("host-1"),
		SourcePath:   transferStringRef("/var/log/private.log"),
		TotalBytes:   32,
	}

	logTransferTaskCompleted(context.Background(), task)

	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatalf("decode structured log: %v; output=%s", err, output.String())
	}
	if record["msg"] != "transfer task completed" ||
		record["component"] != "transfer" ||
		record["event"] != "transfer_task_completed" ||
		record["user_id"] != "user-1" ||
		record["task_id"] != "completed-download" ||
		record["host_id"] != "host-1" ||
		record["task_type"] != string(model.TransferTaskTypeDownload) ||
		record["status"] != string(model.TransferTaskStatusCompleted) ||
		record["transferred_bytes"] != float64(32) {
		t.Fatalf("unexpected log record: %#v", record)
	}
	if strings.Contains(output.String(), "/var/log/private.log") {
		t.Fatalf("structured operational log leaked remote path: %s", output.String())
	}
}

func writeTransferFile(t *testing.T, filePath string, data []byte) {
	t.Helper()
	if err := ensureTransferTmpDir(); err != nil {
		t.Fatalf("ensure transfer tmp dir: %v", err)
	}
	if err := os.WriteFile(filePath, data, 0o600); err != nil {
		t.Fatalf("write transfer temp file: %v", err)
	}
}

func cleanupTransferArtifacts(t *testing.T, taskID string) {
	t.Helper()
	_ = os.Remove(localUploadPath(taskID))
	_ = os.Remove(localDownloadPath(taskID))
	t.Cleanup(func() {
		_ = os.Remove(localUploadPath(taskID))
		_ = os.Remove(localDownloadPath(taskID))
	})
}
