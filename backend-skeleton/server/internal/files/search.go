package files

import (
	"context"
	"errors"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/pkg/sftp"
)

const (
	defaultSearchMaxDepth          = 6
	defaultSearchMaxResults        = 500
	defaultSearchMaxScannedEntries = 50000
	defaultSearchTimeoutSeconds    = 30
	defaultSearchTaskTTL           = 24 * time.Hour
	maxSearchKeywordLength         = 128
	maxSearchMaxDepth              = 10
	maxSearchMaxResults            = 2000
	maxSearchMaxScannedEntries     = 200000
	maxSearchTimeoutSeconds        = 60
	searchWorkerQueueSize          = 64
	searchResultBatchSize          = 100
	searchProgressEveryEntries     = 500
	searchMaxWarnings              = 20

	errorCodeFileSearchCanceled = "FILE_SEARCH_CANCELED"
	errorCodeFileSearchFailed   = "FILE_SEARCH_FAILED"
)

func (s *Service) SearchFiles(ctx context.Context, input SearchFilesInput) (SearchFilesResult, error) {
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.HostID) == "" || strings.TrimSpace(input.BasePath) == "" || strings.TrimSpace(input.Keyword) == "" {
		return SearchFilesResult{}, ErrInvalidInput
	}
	if s.hostService == nil {
		return SearchFilesResult{}, ErrInvalidInput
	}
	basePath, err := cleanRemotePath(input.BasePath, remotePathOptions{})
	if err != nil {
		return SearchFilesResult{}, err
	}

	lease, err := s.openSFTPLease(ctx, input.UserID, input.HostID)
	if err != nil {
		return SearchFilesResult{}, err
	}
	defer lease.Release()
	sftpClient := lease.Client()

	keyword := strings.ToLower(strings.TrimSpace(input.Keyword))

	var items []FileEntry
	if input.Recursive {
		items, err = s.searchRecursive(ctx, sftpClient, basePath, keyword)
	} else {
		items, err = s.searchCurrentDirectory(ctx, sftpClient, basePath, keyword)
	}
	if err != nil {
		lease.DiscardIfConnectionError(err)
		s.recordFileOperation(ctx, input.UserID, input.HostID, basePath, "file_search", model.AuditResultFailure, "remote file search failed", map[string]any{
			"keyword":   input.Keyword,
			"recursive": input.Recursive,
			"error":     err.Error(),
		})
		return SearchFilesResult{}, err
	}

	sort.Slice(items, func(i, j int) bool {
		leftDir := items[i].EntryType == "directory"
		rightDir := items[j].EntryType == "directory"
		if leftDir != rightDir {
			return leftDir
		}
		return strings.ToLower(items[i].Path) < strings.ToLower(items[j].Path)
	})

	s.recordFileOperation(ctx, input.UserID, input.HostID, basePath, "file_search", model.AuditResultSuccess, "remote file search completed", map[string]any{
		"keyword":   input.Keyword,
		"recursive": input.Recursive,
		"count":     len(items),
	})

	return SearchFilesResult{
		HostID:   input.HostID,
		BasePath: basePath,
		Keyword:  input.Keyword,
		Items:    items,
	}, nil
}

func (s *Service) CreateSearchTask(ctx context.Context, input CreateSearchTaskInput) (model.FileSearchTask, error) {
	if s.searchRepo == nil {
		return model.FileSearchTask{}, ErrInvalidInput
	}
	task, err := normalizeSearchTaskInput(input)
	if err != nil {
		return model.FileSearchTask{}, err
	}

	created, err := s.searchRepo.CreateSearchTask(ctx, task)
	if err != nil {
		return model.FileSearchTask{}, err
	}
	if err := s.enqueueSearchTask(created.ID); err != nil {
		progress := SearchTaskProgress{}
		_ = s.searchRepo.FinishSearchTask(ctx, created.ID, string(model.FileSearchTaskStatusFailed), "FILE_SEARCH_QUEUE_FULL", err.Error(), progress)
		created.Status = string(model.FileSearchTaskStatusFailed)
		created.ErrorCode = stringPtr("FILE_SEARCH_QUEUE_FULL")
		created.ErrorMessage = stringPtr(err.Error())
		return created, nil
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:       created.UserID,
		EventType:    "file_search_task_created",
		ResourceType: stringPtr("file"),
		TargetHostID: stringPtr(created.HostID),
		TargetPath:   stringPtr(created.BasePath),
		Result:       string(model.AuditResultSuccess),
		Message:      stringPtr("file search task created"),
		MetadataJSON: mustJSON(map[string]any{
			"task_id":     created.ID,
			"recursive":   created.Recursive,
			"max_depth":   created.MaxDepth,
			"max_results": created.MaxResults,
		}),
	})

	return created, nil
}

func (s *Service) GetSearchTask(ctx context.Context, userID, taskID string) (model.FileSearchTask, error) {
	if s.searchRepo == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(taskID) == "" {
		return model.FileSearchTask{}, ErrInvalidInput
	}
	return s.searchRepo.GetSearchTaskByID(ctx, userID, taskID)
}

func (s *Service) ListSearchResults(ctx context.Context, userID, taskID string, page, pageSize int) (SearchResultsResult, error) {
	if s.searchRepo == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(taskID) == "" {
		return SearchResultsResult{}, ErrInvalidInput
	}
	if page < 1 || pageSize < 1 || pageSize > 200 {
		return SearchResultsResult{}, ErrInvalidInput
	}
	offset := (page - 1) * pageSize
	items, total, err := s.searchRepo.ListSearchResults(ctx, userID, taskID, pageSize, offset)
	if err != nil {
		return SearchResultsResult{}, err
	}
	return SearchResultsResult{
		Items:    items,
		Page:     page,
		PageSize: pageSize,
		Total:    total,
	}, nil
}

func (s *Service) CancelSearchTask(ctx context.Context, userID, taskID string) (model.FileSearchTask, error) {
	if s.searchRepo == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(taskID) == "" {
		return model.FileSearchTask{}, ErrInvalidInput
	}
	task, err := s.searchRepo.CancelSearchTask(ctx, userID, taskID)
	if err != nil {
		return model.FileSearchTask{}, err
	}
	s.cancelActiveSearch(taskID)
	if task.Status == string(model.FileSearchTaskStatusCanceled) {
		logFileSearchTaskCancelRequested(ctx, task)
		s.recordAudit(ctx, model.AuditLog{
			UserID:       userID,
			EventType:    "file_search_task_canceled",
			ResourceType: stringPtr("file"),
			TargetHostID: stringPtr(task.HostID),
			TargetPath:   stringPtr(task.BasePath),
			Result:       string(model.AuditResultSuccess),
			Message:      stringPtr("file search task canceled"),
			MetadataJSON: mustJSON(map[string]any{"task_id": task.ID}),
		})
	}
	return task, nil
}

func (s *Service) searchCurrentDirectory(ctx context.Context, client *sftp.Client, basePath, keyword string) ([]FileEntry, error) {
	items, err := client.ReadDir(basePath)
	if err != nil {
		return nil, fmt.Errorf("search remote directory: %w", err)
	}

	result := make([]FileEntry, 0)
	for _, item := range items {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		if !strings.Contains(strings.ToLower(item.Name()), keyword) {
			continue
		}
		result = append(result, fileEntryFromInfo(basePath, item))
	}
	return result, nil
}

func (s *Service) searchRecursive(ctx context.Context, client *sftp.Client, basePath, keyword string) ([]FileEntry, error) {
	walker := client.Walk(basePath)
	result := make([]FileEntry, 0)
	for walker.Step() {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		if err := walker.Err(); err != nil {
			return nil, fmt.Errorf("walk remote directory: %w", err)
		}
		currentPath := path.Clean(walker.Path())
		if currentPath == basePath {
			continue
		}
		stat := walker.Stat()
		if stat == nil {
			continue
		}
		if !strings.Contains(strings.ToLower(stat.Name()), keyword) {
			continue
		}
		result = append(result, fileEntryFromInfo(path.Dir(currentPath), stat))
	}
	return result, nil
}

func (s *Service) executeSearchTask(ctx context.Context, task model.FileSearchTask) (SearchTaskProgress, error) {
	if s.hostService == nil {
		return SearchTaskProgress{}, ErrInvalidInput
	}

	lease, err := s.openSFTPLease(ctx, task.UserID, task.HostID)
	if err != nil {
		return SearchTaskProgress{}, err
	}
	discardLease := false
	defer func() {
		if discardLease {
			lease.Discard()
			return
		}
		lease.Release()
	}()

	progress, err := s.searchRemoteBFS(ctx, lease.Client(), task)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) || errors.Is(ctx.Err(), context.DeadlineExceeded) || isSFTPConnectionError(err) {
			discardLease = true
		}
		return progress, err
	}
	return progress, nil
}
