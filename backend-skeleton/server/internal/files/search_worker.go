package files

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/observability"
)

func (s *Service) enqueueSearchTask(taskID string) error {
	if s.searchWorkerQueue == nil {
		return ErrInvalidInput
	}
	select {
	case s.searchWorkerQueue <- taskID:
		return nil
	default:
		return ErrSearchQueueFull
	}
}

func (s *Service) searchWorkerLoop() {
	defer s.searchWorkerWG.Done()
	for {
		select {
		case <-s.searchWorkerCtx.Done():
			return
		case taskID := <-s.searchWorkerQueue:
			s.runSearchTask(taskID)
		}
	}
}

func (s *Service) runSearchTask(taskID string) {
	if s.searchRepo == nil {
		return
	}

	task, err := s.searchRepo.GetSearchTaskByIDAny(s.searchWorkerCtx, taskID)
	if err != nil {
		return
	}

	taskCtx, cancel := context.WithTimeout(s.searchWorkerCtx, time.Duration(task.TimeoutSeconds)*time.Second)
	if !s.registerActiveSearch(taskID, cancel) {
		cancel()
		return
	}
	defer s.unregisterActiveSearch(taskID)
	defer cancel()

	if err := s.searchRepo.StartSearchTask(taskCtx, taskID); err != nil {
		return
	}
	logFileSearchTaskStarted(taskCtx, task)

	s.recordAudit(taskCtx, model.AuditLog{
		UserID:       task.UserID,
		EventType:    "file_search_task_started",
		ResourceType: stringPtr("file"),
		TargetHostID: stringPtr(task.HostID),
		TargetPath:   stringPtr(task.BasePath),
		Result:       string(model.AuditResultSuccess),
		Message:      stringPtr("file search task started"),
		MetadataJSON: mustJSON(map[string]any{"task_id": task.ID}),
	})

	progress, err := s.executeSearchTask(taskCtx, task)
	if err != nil {
		status := string(model.FileSearchTaskStatusFailed)
		errorCode := errorCodeFileSearchFailed
		if errors.Is(taskCtx.Err(), context.Canceled) {
			status = string(model.FileSearchTaskStatusCanceled)
			errorCode = errorCodeFileSearchCanceled
		} else if errors.Is(taskCtx.Err(), context.DeadlineExceeded) {
			errorCode = "FILE_SEARCH_TIMEOUT"
			progress.LimitReached = true
		}
		_ = s.searchRepo.FinishSearchTask(context.Background(), taskID, status, errorCode, err.Error(), progress)
		logFileSearchTaskFinished(context.Background(), task, status, errorCode, progress)
		s.recordAudit(context.Background(), model.AuditLog{
			UserID:       task.UserID,
			EventType:    "file_search_task_failed",
			ResourceType: stringPtr("file"),
			TargetHostID: stringPtr(task.HostID),
			TargetPath:   stringPtr(task.BasePath),
			Result:       string(model.AuditResultFailure),
			Message:      stringPtr("file search task failed"),
			MetadataJSON: mustJSON(map[string]any{"task_id": task.ID, "error": err.Error()}),
		})
		return
	}

	_ = s.searchRepo.FinishSearchTask(context.Background(), taskID, string(model.FileSearchTaskStatusCompleted), "", "", progress)
	logFileSearchTaskFinished(context.Background(), task, string(model.FileSearchTaskStatusCompleted), "", progress)
	s.recordAudit(context.Background(), model.AuditLog{
		UserID:       task.UserID,
		EventType:    "file_search_task_completed",
		ResourceType: stringPtr("file"),
		TargetHostID: stringPtr(task.HostID),
		TargetPath:   stringPtr(task.BasePath),
		Result:       string(model.AuditResultSuccess),
		Message:      stringPtr("file search task completed"),
		MetadataJSON: mustJSON(map[string]any{
			"task_id":              task.ID,
			"scanned_entries":      progress.ScannedEntries,
			"matched_entries":      progress.MatchedEntries,
			"skipped_errors_count": progress.SkippedErrorsCount,
			"limit_reached":        progress.LimitReached,
		}),
	})
}

func logFileSearchTaskStarted(ctx context.Context, task model.FileSearchTask) {
	observability.Info(ctx, "file search task started",
		slog.String("component", "files"),
		slog.String("event", "file_search_task_started"),
		slog.String("user_id", task.UserID),
		slog.String("task_id", task.ID),
		slog.String("host_id", task.HostID),
		slog.String("status", string(model.FileSearchTaskStatusRunning)),
	)
}

func logFileSearchTaskFinished(ctx context.Context, task model.FileSearchTask, status string, errorCode string, progress SearchTaskProgress) {
	attrs := []slog.Attr{
		slog.String("component", "files"),
		slog.String("event", "file_search_task_finished"),
		slog.String("user_id", task.UserID),
		slog.String("task_id", task.ID),
		slog.String("host_id", task.HostID),
		slog.String("status", status),
		slog.Int("scanned_entries", progress.ScannedEntries),
		slog.Int("matched_entries", progress.MatchedEntries),
		slog.Int("skipped_errors_count", progress.SkippedErrorsCount),
		slog.Bool("limit_reached", progress.LimitReached),
	}
	if errorCode != "" {
		attrs = append(attrs,
			slog.String("error_code", errorCode),
			slog.String("error_kind", observability.ErrorKindFromCode(errorCode)),
		)
	}
	if status == string(model.FileSearchTaskStatusCompleted) {
		observability.Info(ctx, "file search task finished", attrs...)
		return
	}
	observability.Warn(ctx, "file search task finished", attrs...)
}

func logFileSearchTaskCancelRequested(ctx context.Context, task model.FileSearchTask) {
	observability.Info(ctx, "file search task cancel requested",
		slog.String("component", "files"),
		slog.String("event", "file_search_task_cancel_requested"),
		slog.String("user_id", task.UserID),
		slog.String("task_id", task.ID),
		slog.String("host_id", task.HostID),
		slog.String("status", task.Status),
	)
}

func (s *Service) registerActiveSearch(taskID string, cancel context.CancelFunc) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.activeSearches[taskID]; exists {
		return false
	}
	s.activeSearches[taskID] = cancel
	return true
}

func (s *Service) unregisterActiveSearch(taskID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.activeSearches, taskID)
}

func (s *Service) cancelActiveSearch(taskID string) {
	s.mu.Lock()
	cancel, ok := s.activeSearches[taskID]
	s.mu.Unlock()
	if ok {
		cancel()
	}
}

func (s *Service) cancelAllActiveSearches() {
	s.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(s.activeSearches))
	for _, cancel := range s.activeSearches {
		cancels = append(cancels, cancel)
	}
	s.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}
