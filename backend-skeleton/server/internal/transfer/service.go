package transfer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/observability"
	"github.com/pkg/sftp"
)

const (
	defaultChunkSize        int64 = 5 * 1024 * 1024
	localTransferTmpDir           = "online-ssh-transfers"
	transferWorkerQueueSize       = 64
	recoverTaskBatchSize          = 128
	transferCopyBufferSize        = 64 * 1024

	errorCodeUploadWriteFailed        = "UPLOAD_WRITE_FAILED"
	errorCodeUploadRecoveryMissingTmp = "UPLOAD_RECOVERY_MISSING_TMP"
	errorCodeUploadPlatformStateLost  = "UPLOAD_PLATFORM_STATE_LOST"
	errorCodeUploadRetryable          = "REMOTE_UPLOAD_RETRYABLE"
	errorCodeUploadTargetNotFound     = "REMOTE_UPLOAD_TARGET_NOT_FOUND"
	errorCodeUploadPermissionDenied   = "REMOTE_UPLOAD_PERMISSION_DENIED"
	errorCodeUploadNoSpaceLeft        = "REMOTE_UPLOAD_NO_SPACE_LEFT"
	errorCodeUploadFailed             = "REMOTE_UPLOAD_FAILED"
	errorCodeDownloadRetryable        = "DOWNLOAD_RETRYABLE"
	errorCodeDownloadSourceNotFound   = "DOWNLOAD_SOURCE_NOT_FOUND"
	errorCodeDownloadPermissionDenied = "DOWNLOAD_PERMISSION_DENIED"
	errorCodeDownloadNoSpaceLeft      = "DOWNLOAD_NO_SPACE_LEFT"
	errorCodeDownloadFailed           = "DOWNLOAD_FAILED"
)

var (
	ErrInvalidInput      = errors.New("invalid input")
	ErrInvalidTransition = errors.New("invalid transfer status transition")
	ErrRetryNotAllowed   = errors.New("retry not allowed")
)

type Service struct {
	repo        Repository
	hostRepo    host.Repository
	hostService *host.Service
	audit       AuditRecorder

	workerCtx    context.Context
	workerCancel context.CancelFunc
	workerQueue  chan string
	workerWG     sync.WaitGroup

	mu          sync.Mutex
	activeTasks map[string]context.CancelFunc
}

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

func NewService(repo Repository, hostRepo host.Repository, hostService *host.Service, audit AuditRecorder) *Service {
	workerCtx, workerCancel := context.WithCancel(context.Background())
	s := &Service{
		repo:         repo,
		hostRepo:     hostRepo,
		hostService:  hostService,
		audit:        audit,
		workerCtx:    workerCtx,
		workerCancel: workerCancel,
		workerQueue:  make(chan string, transferWorkerQueueSize),
		activeTasks:  make(map[string]context.CancelFunc),
	}
	s.workerWG.Add(1)
	go s.workerLoop()
	return s
}

type InitUploadInput struct {
	UserID       string `json:"-"`
	TargetHostID string `json:"target_host_id"`
	TargetPath   string `json:"target_path"`
	FileName     string `json:"file_name"`
	FileSize     int64  `json:"file_size"`
}

type InitUploadResult struct {
	TaskID       string `json:"task_id"`
	ChunkSize    int64  `json:"chunk_size"`
	ResumeOffset int64  `json:"resume_offset"`
	Status       string `json:"status"`
}

type UploadChunkResult struct {
	AcceptedBytes int64  `json:"accepted_bytes"`
	ReceivedBytes int64  `json:"received_bytes"`
	NextOffset    int64  `json:"next_offset"`
	Status        string `json:"status"`
}

type CreateDownloadInput struct {
	UserID     string `json:"-"`
	HostID     string `json:"host_id"`
	SourcePath string `json:"source_path"`
}

func (s *Service) Close() {
	s.workerCancel()
	s.cancelAllActiveTasks()
	s.workerWG.Wait()
}

func (s *Service) RecoverPending(ctx context.Context) error {
	if s.repo == nil {
		return nil
	}
	items, err := s.repo.ListTasksByStatuses(ctx, []string{
		string(model.TransferTaskStatusUploadingToPlatform),
		string(model.TransferTaskStatusPending),
		string(model.TransferTaskStatusQueuedForRemoteTransfer),
		string(model.TransferTaskStatusTransferring),
		string(model.TransferTaskStatusPaused),
	}, recoverTaskBatchSize)
	if err != nil {
		return err
	}

	for _, item := range items {
		switch item.TaskType {
		case string(model.TransferTaskTypeUpload):
			localBytes, statErr := uploadTempSize(item.ID)
			switch item.Status {
			case string(model.TransferTaskStatusUploadingToPlatform):
				if statErr != nil {
					if errors.Is(statErr, os.ErrNotExist) && item.TransferredBytes == 0 {
						continue
					}
					s.failTask(ctx, item, errorCodeUploadPlatformStateLost, "platform upload temp file missing during recovery")
					continue
				}
				if localBytes != item.TransferredBytes {
					_ = s.repo.UpdateTaskStatus(ctx, item.ID, item.Status, localBytes, "", "")
				}
				if localBytes == item.TotalBytes {
					_ = s.repo.UpdateTaskStatus(ctx, item.ID, string(model.TransferTaskStatusQueuedForRemoteTransfer), localBytes, "", "")
					s.enqueue(item.ID)
				}
			case string(model.TransferTaskStatusQueuedForRemoteTransfer), string(model.TransferTaskStatusTransferring):
				if statErr != nil {
					s.failTask(ctx, item, errorCodeUploadRecoveryMissingTmp, "upload temp file missing during recovery")
					continue
				}
				if localBytes < item.TotalBytes {
					_ = s.repo.UpdateTaskStatus(ctx, item.ID, string(model.TransferTaskStatusUploadingToPlatform), localBytes, "", "")
					continue
				}
				s.enqueue(item.ID)
			case string(model.TransferTaskStatusPaused):
				if statErr == nil && localBytes != item.TransferredBytes && localBytes < item.TotalBytes {
					_ = s.repo.UpdateTaskStatus(ctx, item.ID, item.Status, localBytes, "", "")
				}
			}
		case string(model.TransferTaskTypeDownload):
			localBytes, statErr := downloadTempSize(item.ID)
			if statErr == nil && localBytes != item.TransferredBytes {
				_ = s.repo.UpdateTaskStatus(ctx, item.ID, item.Status, localBytes, "", "")
			}
			if item.Status == string(model.TransferTaskStatusPending) || item.Status == string(model.TransferTaskStatusTransferring) {
				s.enqueue(item.ID)
			}
		}
	}
	return nil
}

func (s *Service) InitUpload(ctx context.Context, input InitUploadInput) (InitUploadResult, error) {
	targetHostID := strings.TrimSpace(input.TargetHostID)
	targetPath, err := cleanTransferRemotePath(input.TargetPath)
	if err != nil {
		return InitUploadResult{}, err
	}
	fileName := strings.TrimSpace(input.FileName)
	if input.UserID == "" || targetHostID == "" || targetPath == "" || fileName == "" || input.FileSize < 0 {
		return InitUploadResult{}, ErrInvalidInput
	}
	if s.hostRepo == nil {
		return InitUploadResult{}, fmt.Errorf("host repository is required")
	}
	if _, err := s.hostRepo.GetByID(ctx, input.UserID, targetHostID); err != nil {
		if db.IsNotFound(err) {
			return InitUploadResult{}, ErrInvalidInput
		}
		return InitUploadResult{}, err
	}

	existing, err := s.repo.FindLatestUploadTask(ctx, input.UserID, targetHostID, targetPath, fileName, input.FileSize, []string{
		string(model.TransferTaskStatusUploadingToPlatform),
		string(model.TransferTaskStatusQueuedForRemoteTransfer),
		string(model.TransferTaskStatusTransferring),
		string(model.TransferTaskStatusPaused),
	})
	if err == nil {
		resumeOffset, status, reuse, reuseErr := s.reconcileUploadInitState(ctx, existing)
		if reuseErr != nil {
			return InitUploadResult{}, reuseErr
		}
		if reuse {
			return InitUploadResult{
				TaskID:       existing.ID,
				ChunkSize:    existing.ChunkSize,
				ResumeOffset: resumeOffset,
				Status:       status,
			}, nil
		}
	} else if !db.IsNotFound(err) {
		return InitUploadResult{}, err
	}

	task := model.TransferTask{
		UserID:           input.UserID,
		TaskType:         string(model.TransferTaskTypeUpload),
		SourceType:       "local",
		TargetType:       "remote",
		TargetHostID:     &targetHostID,
		TargetPath:       ptr(targetPath),
		FileName:         fileName,
		TotalBytes:       input.FileSize,
		TransferredBytes: 0,
		ChunkSize:        defaultChunkSize,
		Resumable:        true,
		Status:           string(model.TransferTaskStatusUploadingToPlatform),
		StartedAt:        timePtr(time.Now()),
	}

	created, err := s.repo.CreateTask(ctx, task)
	if err != nil {
		return InitUploadResult{}, err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:       created.UserID,
		EventType:    "transfer_upload_init",
		ResourceType: stringPtr("transfer_task"),
		ResourceID:   stringPtr(created.ID),
		TargetHostID: created.TargetHostID,
		TargetPath:   created.TargetPath,
		Result:       string(model.AuditResultSuccess),
	})

	return InitUploadResult{
		TaskID:       created.ID,
		ChunkSize:    created.ChunkSize,
		ResumeOffset: created.TransferredBytes,
		Status:       created.Status,
	}, nil
}

func (s *Service) UploadChunk(ctx context.Context, userID, taskID string, offset int64, payload []byte) (UploadChunkResult, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(taskID) == "" || offset < 0 {
		return UploadChunkResult{}, ErrInvalidInput
	}
	task, err := s.repo.GetTaskByID(ctx, userID, taskID)
	if err != nil {
		return UploadChunkResult{}, err
	}
	if task.TaskType != string(model.TransferTaskTypeUpload) || task.TargetHostID == nil || task.TargetPath == nil {
		return UploadChunkResult{}, ErrInvalidInput
	}
	if task.Status != string(model.TransferTaskStatusUploadingToPlatform) {
		return UploadChunkResult{}, ErrInvalidTransition
	}
	currentOffset, err := uploadTempSize(task.ID)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return UploadChunkResult{}, fmt.Errorf("stat upload temp file: %w", err)
	}
	if offset != currentOffset {
		return UploadChunkResult{}, fmt.Errorf("offset mismatch")
	}

	acceptedBytes := int64(len(payload))
	if currentOffset+acceptedBytes > task.TotalBytes {
		return UploadChunkResult{}, ErrInvalidInput
	}

	if err := ensureTransferTmpDir(); err != nil {
		return UploadChunkResult{}, err
	}
	localPath := localUploadPath(task.ID)
	if err := writeChunk(localPath, offset, payload); err != nil {
		_ = s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusFailed), currentOffset, errorCodeUploadWriteFailed, err.Error())
		return UploadChunkResult{}, fmt.Errorf("write upload chunk: %w", err)
	}

	receivedBytes, err := uploadTempSize(task.ID)
	if err != nil {
		return UploadChunkResult{}, fmt.Errorf("stat upload temp file after write: %w", err)
	}
	status := string(model.TransferTaskStatusUploadingToPlatform)
	if receivedBytes == task.TotalBytes {
		status = string(model.TransferTaskStatusQueuedForRemoteTransfer)
	}
	if err := s.repo.UpdateTaskStatus(ctx, task.ID, status, receivedBytes, "", ""); err != nil {
		return UploadChunkResult{}, err
	}

	if receivedBytes == task.TotalBytes {
		s.recordAudit(ctx, model.AuditLog{
			UserID:       userID,
			EventType:    "file_upload_start",
			ResourceType: stringPtr("transfer_task"),
			ResourceID:   stringPtr(task.ID),
			TargetHostID: task.TargetHostID,
			TargetPath:   task.TargetPath,
			Result:       string(model.AuditResultSuccess),
			Message:      stringPtr("upload payload queued for remote transfer"),
			MetadataJSON: mustJSON(map[string]any{
				"received_bytes": receivedBytes,
			}),
		})
		s.enqueue(task.ID)
	} else {
		s.recordAudit(ctx, model.AuditLog{
			UserID:       userID,
			EventType:    "file_upload_start",
			ResourceType: stringPtr("transfer_task"),
			ResourceID:   stringPtr(task.ID),
			TargetHostID: task.TargetHostID,
			TargetPath:   task.TargetPath,
			Result:       string(model.AuditResultSuccess),
			Message:      stringPtr("upload chunk accepted"),
			MetadataJSON: mustJSON(map[string]any{
				"accepted_bytes": acceptedBytes,
				"received_bytes": receivedBytes,
			}),
		})
	}

	return UploadChunkResult{
		AcceptedBytes: acceptedBytes,
		ReceivedBytes: receivedBytes,
		NextOffset:    receivedBytes,
		Status:        status,
	}, nil
}

func (s *Service) CreateDownloadTask(ctx context.Context, input CreateDownloadInput) (model.TransferTask, error) {
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.HostID) == "" || strings.TrimSpace(input.SourcePath) == "" {
		return model.TransferTask{}, ErrInvalidInput
	}
	sourcePath, err := cleanTransferRemotePath(input.SourcePath)
	if err != nil {
		return model.TransferTask{}, err
	}
	if s.hostService == nil {
		return model.TransferTask{}, fmt.Errorf("host service is required")
	}

	sshClient, _, err := s.hostService.OpenSSHClient(ctx, input.UserID, input.HostID, host.TestConnectionInput{})
	if err != nil {
		return model.TransferTask{}, err
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		return model.TransferTask{}, fmt.Errorf("create sftp client: %w", err)
	}
	defer sftpClient.Close()

	info, err := sftpClient.Stat(sourcePath)
	if err != nil {
		return model.TransferTask{}, fmt.Errorf("stat remote file: %w", err)
	}
	if info.IsDir() {
		return model.TransferTask{}, ErrInvalidInput
	}

	task := model.TransferTask{
		UserID:           input.UserID,
		TaskType:         string(model.TransferTaskTypeDownload),
		SourceType:       "remote",
		TargetType:       "local",
		SourceHostID:     &input.HostID,
		SourcePath:       &sourcePath,
		FileName:         info.Name(),
		TotalBytes:       info.Size(),
		TransferredBytes: 0,
		ChunkSize:        defaultChunkSize,
		Resumable:        false,
		Status:           string(model.TransferTaskStatusPending),
		StartedAt:        timePtr(time.Now()),
	}

	created, err := s.repo.CreateTask(ctx, task)
	if err != nil {
		return model.TransferTask{}, err
	}

	s.recordAudit(ctx, model.AuditLog{
		UserID:       input.UserID,
		EventType:    "file_download_start",
		ResourceType: stringPtr("transfer_task"),
		ResourceID:   stringPtr(created.ID),
		TargetHostID: created.SourceHostID,
		TargetPath:   created.SourcePath,
		Result:       string(model.AuditResultSuccess),
		Message:      stringPtr("download task created"),
	})
	s.enqueue(created.ID)
	return created, nil
}

func (s *Service) GetTask(ctx context.Context, userID, taskID string) (model.TransferTask, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(taskID) == "" {
		return model.TransferTask{}, ErrInvalidInput
	}
	return s.repo.GetTaskByID(ctx, userID, taskID)
}

func (s *Service) DownloadContentPath(ctx context.Context, userID, taskID string) (model.TransferTask, string, error) {
	task, err := s.GetTask(ctx, userID, taskID)
	if err != nil {
		return model.TransferTask{}, "", err
	}
	if task.TaskType != string(model.TransferTaskTypeDownload) || task.Status != string(model.TransferTaskStatusCompleted) {
		return model.TransferTask{}, "", ErrInvalidTransition
	}
	filePath := localDownloadPath(task.ID)
	if _, err := os.Stat(filePath); err != nil {
		return model.TransferTask{}, "", err
	}
	return task, filePath, nil
}

func (s *Service) ListTasks(ctx context.Context, userID string, filter ListFilter) ([]model.TransferTask, int, error) {
	return s.repo.ListTasksByUserID(ctx, userID, filter)
}

func (s *Service) Pause(ctx context.Context, userID, taskID string) (model.TransferTask, error) {
	task, err := s.repo.GetTaskByID(ctx, userID, taskID)
	if err != nil {
		return model.TransferTask{}, err
	}
	if !canPause(task) {
		return model.TransferTask{}, ErrInvalidTransition
	}
	progress := s.currentTaskProgress(task)
	s.cancelActiveTask(task.ID)
	if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusPaused), progress, "", ""); err != nil {
		return model.TransferTask{}, err
	}
	item, err := s.repo.GetTaskByID(ctx, userID, taskID)
	if err != nil {
		return model.TransferTask{}, err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       userID,
		EventType:    "transfer_task_pause",
		ResourceType: stringPtr("transfer_task"),
		ResourceID:   stringPtr(item.ID),
		TargetHostID: coalesceHostID(item),
		TargetPath:   coalescePath(item),
		Result:       string(model.AuditResultSuccess),
		Message:      stringPtr("transfer task paused"),
	})
	return item, nil
}

func (s *Service) Resume(ctx context.Context, userID, taskID string) (model.TransferTask, error) {
	task, err := s.repo.GetTaskByID(ctx, userID, taskID)
	if err != nil {
		return model.TransferTask{}, err
	}
	if task.Status != string(model.TransferTaskStatusPaused) {
		return model.TransferTask{}, ErrInvalidTransition
	}

	nextStatus, nextBytes, err := s.resumeState(task)
	if err != nil {
		return model.TransferTask{}, err
	}
	if err := s.repo.UpdateTaskStatus(ctx, task.ID, nextStatus, nextBytes, "", ""); err != nil {
		return model.TransferTask{}, err
	}
	if nextStatus == string(model.TransferTaskStatusPending) || nextStatus == string(model.TransferTaskStatusQueuedForRemoteTransfer) {
		s.enqueue(task.ID)
	}
	item, err := s.repo.GetTaskByID(ctx, userID, taskID)
	if err != nil {
		return model.TransferTask{}, err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       userID,
		EventType:    "transfer_task_resume",
		ResourceType: stringPtr("transfer_task"),
		ResourceID:   stringPtr(item.ID),
		TargetHostID: coalesceHostID(item),
		TargetPath:   coalescePath(item),
		Result:       string(model.AuditResultSuccess),
		Message:      stringPtr("transfer task resumed"),
	})
	return item, nil
}

func (s *Service) Cancel(ctx context.Context, userID, taskID string) (model.TransferTask, error) {
	task, err := s.repo.GetTaskByID(ctx, userID, taskID)
	if err != nil {
		return model.TransferTask{}, err
	}
	if isTerminalTransferStatus(task.Status) {
		return model.TransferTask{}, ErrInvalidTransition
	}

	s.cancelActiveTask(task.ID)
	if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusCanceled), task.TransferredBytes, "", ""); err != nil {
		return model.TransferTask{}, err
	}
	s.cleanupTaskArtifacts(task)
	item, err := s.repo.GetTaskByID(ctx, userID, taskID)
	if err != nil {
		return model.TransferTask{}, err
	}
	logTransferTaskCanceled(ctx, item)
	s.recordAudit(ctx, model.AuditLog{
		UserID:       userID,
		EventType:    "transfer_task_cancel",
		ResourceType: stringPtr("transfer_task"),
		ResourceID:   stringPtr(item.ID),
		TargetHostID: coalesceHostID(item),
		TargetPath:   coalescePath(item),
		Result:       string(model.AuditResultSuccess),
		Message:      stringPtr("transfer task canceled"),
	})
	return item, nil
}

func (s *Service) Retry(ctx context.Context, userID, taskID string) (model.TransferTask, error) {
	task, err := s.repo.GetTaskByID(ctx, userID, taskID)
	if err != nil {
		return model.TransferTask{}, err
	}
	if task.Status != string(model.TransferTaskStatusFailed) {
		return model.TransferTask{}, ErrRetryNotAllowed
	}
	if !isRetryableTaskFailure(task) {
		return model.TransferTask{}, ErrRetryNotAllowed
	}

	nextStatus, nextBytes, err := s.retryState(task)
	if err != nil {
		return model.TransferTask{}, err
	}
	if err := s.repo.IncrementRetryCount(ctx, task.ID); err != nil {
		return model.TransferTask{}, err
	}
	if err := s.repo.UpdateTaskStatus(ctx, task.ID, nextStatus, nextBytes, "", ""); err != nil {
		return model.TransferTask{}, err
	}
	if nextStatus == string(model.TransferTaskStatusPending) || nextStatus == string(model.TransferTaskStatusQueuedForRemoteTransfer) {
		s.enqueue(task.ID)
	}
	item, err := s.repo.GetTaskByID(ctx, userID, taskID)
	if err != nil {
		return model.TransferTask{}, err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       userID,
		EventType:    "transfer_task_retry",
		ResourceType: stringPtr("transfer_task"),
		ResourceID:   stringPtr(item.ID),
		TargetHostID: coalesceHostID(item),
		TargetPath:   coalescePath(item),
		Result:       string(model.AuditResultSuccess),
		Message:      stringPtr("transfer task retried"),
	})
	return item, nil
}

func (s *Service) workerLoop() {
	defer s.workerWG.Done()
	for {
		select {
		case <-s.workerCtx.Done():
			return
		case taskID := <-s.workerQueue:
			s.processTask(taskID)
		}
	}
}

func (s *Service) processTask(taskID string) {
	if strings.TrimSpace(taskID) == "" {
		return
	}
	task, err := s.repo.GetTaskByIDAny(s.workerCtx, taskID)
	if err != nil {
		return
	}
	if isTerminalTransferStatus(task.Status) || task.Status == string(model.TransferTaskStatusPaused) {
		return
	}

	taskCtx, cancel := context.WithCancel(s.workerCtx)
	if !s.registerActiveTask(task.ID, cancel) {
		cancel()
		return
	}
	defer s.unregisterActiveTask(task.ID)

	switch task.TaskType {
	case string(model.TransferTaskTypeUpload):
		s.runUploadTask(taskCtx, task)
	case string(model.TransferTaskTypeDownload):
		s.runDownloadTask(taskCtx, task)
	}
}

func (s *Service) runUploadTask(ctx context.Context, task model.TransferTask) {
	if task.Status != string(model.TransferTaskStatusQueuedForRemoteTransfer) && task.Status != string(model.TransferTaskStatusTransferring) {
		return
	}

	localPath := localUploadPath(task.ID)
	localBytes, err := uploadTempSize(task.ID)
	if err != nil {
		s.failTask(ctx, task, errorCodeUploadRecoveryMissingTmp, "upload temp file missing")
		return
	}
	if localBytes < task.TotalBytes {
		if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusUploadingToPlatform), localBytes, "", ""); err != nil {
			return
		}
		return
	}
	if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusTransferring), minInt64(task.TransferredBytes, task.TotalBytes), "", ""); err != nil {
		return
	}
	if err := s.performRemoteUpload(ctx, task, localPath); err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		errorCode, message := classifyUploadFailure(err)
		s.failTask(ctx, task, errorCode, message)
		return
	}
	if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusCompleted), task.TotalBytes, "", ""); err != nil {
		return
	}
	_ = os.Remove(localPath)
	logTransferTaskCompleted(ctx, task)
	s.recordAudit(ctx, model.AuditLog{
		UserID:       task.UserID,
		EventType:    "file_upload_success",
		ResourceType: stringPtr("transfer_task"),
		ResourceID:   stringPtr(task.ID),
		TargetHostID: task.TargetHostID,
		TargetPath:   task.TargetPath,
		Result:       string(model.AuditResultSuccess),
		Message:      stringPtr("remote upload completed"),
	})
}

func (s *Service) runDownloadTask(ctx context.Context, task model.TransferTask) {
	if task.Status != string(model.TransferTaskStatusPending) && task.Status != string(model.TransferTaskStatusTransferring) {
		return
	}
	progress := s.currentTaskProgress(task)
	if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusTransferring), progress, "", ""); err != nil {
		return
	}
	if err := s.performDownload(ctx, task); err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		errorCode, message := classifyDownloadFailure(err)
		s.failTask(ctx, task, errorCode, message)
		return
	}
	if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusCompleted), task.TotalBytes, "", ""); err != nil {
		return
	}
	logTransferTaskCompleted(ctx, task)
	s.recordAudit(ctx, model.AuditLog{
		UserID:       task.UserID,
		EventType:    "file_download_success",
		ResourceType: stringPtr("transfer_task"),
		ResourceID:   stringPtr(task.ID),
		TargetHostID: task.SourceHostID,
		TargetPath:   task.SourcePath,
		Result:       string(model.AuditResultSuccess),
		Message:      stringPtr("download task completed"),
	})
}

func (s *Service) performRemoteUpload(ctx context.Context, task model.TransferTask, localPath string) error {
	if task.TargetHostID == nil || task.TargetPath == nil || s.hostService == nil {
		return ErrInvalidInput
	}

	localFile, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open local upload file: %w", err)
	}
	defer localFile.Close()

	localInfo, err := localFile.Stat()
	if err != nil {
		return fmt.Errorf("stat local upload file: %w", err)
	}

	sshClient, _, err := s.hostService.OpenSSHClient(ctx, task.UserID, *task.TargetHostID, host.TestConnectionInput{})
	if err != nil {
		return err
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		return fmt.Errorf("create sftp client: %w", err)
	}
	defer sftpClient.Close()

	remotePath := path.Join(strings.TrimSpace(*task.TargetPath), task.FileName)
	remoteTmpPath := remotePath + ".part"

	remoteFinalInfo, finalErr := sftpClient.Stat(remotePath)
	if finalErr == nil && remoteFinalInfo.Size() == localInfo.Size() {
		return nil
	}

	remoteOffset := int64(0)
	remoteInfo, statErr := sftpClient.Stat(remoteTmpPath)
	if statErr == nil {
		remoteOffset = remoteInfo.Size()
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return fmt.Errorf("stat remote temp file: %w", statErr)
	}

	if remoteOffset > localInfo.Size() {
		_ = sftpClient.Remove(remoteTmpPath)
		remoteOffset = 0
	}
	if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusTransferring), remoteOffset, "", ""); err != nil {
		return err
	}
	if remoteOffset == localInfo.Size() {
		_ = sftpClient.Remove(remotePath)
		if err := sftpClient.PosixRename(remoteTmpPath, remotePath); err != nil {
			return fmt.Errorf("rename remote temp file: %w", err)
		}
		return nil
	}

	if _, err := localFile.Seek(remoteOffset, io.SeekStart); err != nil {
		return fmt.Errorf("seek local upload file: %w", err)
	}

	flags := os.O_CREATE | os.O_WRONLY
	if remoteOffset == 0 {
		flags |= os.O_TRUNC
	}
	remoteFile, err := sftpClient.OpenFile(remoteTmpPath, flags)
	if err != nil {
		return fmt.Errorf("open remote temp file: %w", err)
	}
	if remoteOffset > 0 {
		if _, err := remoteFile.Seek(remoteOffset, io.SeekStart); err != nil {
			_ = remoteFile.Close()
			return fmt.Errorf("seek remote temp file: %w", err)
		}
	}

	buf := make([]byte, transferCopyBufferSize)
	currentOffset := remoteOffset
	for {
		select {
		case <-ctx.Done():
			_ = remoteFile.Close()
			return ctx.Err()
		default:
		}

		n, readErr := localFile.Read(buf)
		if n > 0 {
			if _, writeErr := remoteFile.Write(buf[:n]); writeErr != nil {
				_ = remoteFile.Close()
				return fmt.Errorf("write remote temp file: %w", writeErr)
			}
			currentOffset += int64(n)
			if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusTransferring), currentOffset, "", ""); err != nil {
				_ = remoteFile.Close()
				return err
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				break
			}
			_ = remoteFile.Close()
			return fmt.Errorf("read local upload file: %w", readErr)
		}
	}
	if err := remoteFile.Close(); err != nil {
		return fmt.Errorf("close remote temp file: %w", err)
	}

	_ = sftpClient.Remove(remotePath)
	if err := sftpClient.PosixRename(remoteTmpPath, remotePath); err != nil {
		return fmt.Errorf("rename remote temp file: %w", err)
	}
	return nil
}

func (s *Service) performDownload(ctx context.Context, task model.TransferTask) error {
	if task.SourceHostID == nil || task.SourcePath == nil || s.hostService == nil {
		return ErrInvalidInput
	}

	sshClient, _, err := s.hostService.OpenSSHClient(ctx, task.UserID, *task.SourceHostID, host.TestConnectionInput{})
	if err != nil {
		return err
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		return fmt.Errorf("create sftp client: %w", err)
	}
	defer sftpClient.Close()

	sourceFile, err := sftpClient.Open(path.Clean(*task.SourcePath))
	if err != nil {
		return fmt.Errorf("open remote download file: %w", err)
	}
	defer sourceFile.Close()

	if err := ensureTransferTmpDir(); err != nil {
		return err
	}
	localPath := localDownloadPath(task.ID)
	localOffset, err := downloadTempSize(task.ID)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("stat local download file: %w", err)
	}
	if localOffset > task.TotalBytes {
		_ = os.Remove(localPath)
		localOffset = 0
	}
	localFlags := os.O_CREATE | os.O_WRONLY
	if localOffset == 0 {
		localFlags |= os.O_TRUNC
	}
	localFile, err := os.OpenFile(localPath, localFlags, 0o600)
	if err != nil {
		return fmt.Errorf("open local download file: %w", err)
	}
	defer localFile.Close()
	if localOffset > 0 {
		if _, err := localFile.Seek(localOffset, io.SeekStart); err != nil {
			return fmt.Errorf("seek local download file: %w", err)
		}
		if _, err := sourceFile.Seek(localOffset, io.SeekStart); err != nil {
			return fmt.Errorf("seek remote download file: %w", err)
		}
	}
	if localOffset == task.TotalBytes {
		return nil
	}

	buf := make([]byte, transferCopyBufferSize)
	transferred := localOffset
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		n, readErr := sourceFile.Read(buf)
		if n > 0 {
			if _, writeErr := localFile.Write(buf[:n]); writeErr != nil {
				return fmt.Errorf("write local download file: %w", writeErr)
			}
			transferred += int64(n)
			if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusTransferring), transferred, "", ""); err != nil {
				return err
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				break
			}
			return fmt.Errorf("read remote download file: %w", readErr)
		}
	}
	return nil
}

func (s *Service) failTask(ctx context.Context, task model.TransferTask, errorCode, message string) {
	progress := task.TransferredBytes
	current, err := s.repo.GetTaskByIDAny(ctx, task.ID)
	if err == nil {
		progress = current.TransferredBytes
	}
	_ = s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusFailed), progress, errorCode, message)
	logTransferTaskFailed(ctx, task, errorCode)
	eventType := "transfer_task_failed"
	if task.TaskType == string(model.TransferTaskTypeUpload) {
		eventType = "file_upload_failed"
	} else if task.TaskType == string(model.TransferTaskTypeDownload) {
		eventType = "file_download_failed"
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       task.UserID,
		EventType:    eventType,
		ResourceType: stringPtr("transfer_task"),
		ResourceID:   stringPtr(task.ID),
		TargetHostID: coalesceHostID(task),
		TargetPath:   coalescePath(task),
		Result:       string(model.AuditResultFailure),
		Message:      stringPtr(message),
	})
}

func logTransferTaskFailed(ctx context.Context, task model.TransferTask, errorCode string) {
	hostID := ""
	if value := coalesceHostID(task); value != nil {
		hostID = *value
	}
	observability.Warn(ctx, "transfer task failed",
		slog.String("component", "transfer"),
		slog.String("event", "transfer_task_failed"),
		slog.String("user_id", task.UserID),
		slog.String("task_id", task.ID),
		slog.String("host_id", hostID),
		slog.String("task_type", task.TaskType),
		slog.String("status", string(model.TransferTaskStatusFailed)),
		slog.String("error_code", errorCode),
		slog.String("error_kind", observability.ErrorKindFromCode(errorCode)),
	)
}

func logTransferTaskCompleted(ctx context.Context, task model.TransferTask) {
	logTransferTaskLifecycle(ctx, "transfer task completed", "transfer_task_completed", task, string(model.TransferTaskStatusCompleted), task.TotalBytes)
}

func logTransferTaskCanceled(ctx context.Context, task model.TransferTask) {
	logTransferTaskLifecycle(ctx, "transfer task canceled", "transfer_task_canceled", task, string(model.TransferTaskStatusCanceled), task.TransferredBytes)
}

func logTransferTaskLifecycle(ctx context.Context, message, event string, task model.TransferTask, status string, transferredBytes int64) {
	hostID := ""
	if value := coalesceHostID(task); value != nil {
		hostID = *value
	}
	observability.Info(ctx, message,
		slog.String("component", "transfer"),
		slog.String("event", event),
		slog.String("user_id", task.UserID),
		slog.String("task_id", task.ID),
		slog.String("host_id", hostID),
		slog.String("task_type", task.TaskType),
		slog.String("status", status),
		slog.Int64("transferred_bytes", transferredBytes),
	)
}

func (s *Service) enqueue(taskID string) {
	select {
	case s.workerQueue <- taskID:
	default:
		go func() {
			select {
			case s.workerQueue <- taskID:
			case <-s.workerCtx.Done():
			}
		}()
	}
}

func (s *Service) registerActiveTask(taskID string, cancel context.CancelFunc) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.activeTasks[taskID]; exists {
		return false
	}
	s.activeTasks[taskID] = cancel
	return true
}

func (s *Service) unregisterActiveTask(taskID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.activeTasks, taskID)
}

func (s *Service) cancelActiveTask(taskID string) {
	s.mu.Lock()
	cancel, ok := s.activeTasks[taskID]
	s.mu.Unlock()
	if ok {
		cancel()
	}
}

func (s *Service) cancelAllActiveTasks() {
	s.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(s.activeTasks))
	for _, cancel := range s.activeTasks {
		cancels = append(cancels, cancel)
	}
	s.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

func (s *Service) cleanupTaskArtifacts(task model.TransferTask) {
	switch task.TaskType {
	case string(model.TransferTaskTypeUpload):
		_ = os.Remove(localUploadPath(task.ID))
	case string(model.TransferTaskTypeDownload):
		_ = os.Remove(localDownloadPath(task.ID))
	}
}

func ensureTransferTmpDir() error {
	return os.MkdirAll(filepath.Join(os.TempDir(), localTransferTmpDir), 0o700)
}

func localUploadPath(taskID string) string {
	return filepath.Join(os.TempDir(), localTransferTmpDir, taskID+".uploading")
}

func localDownloadPath(taskID string) string {
	return filepath.Join(os.TempDir(), localTransferTmpDir, taskID+".download")
}

func uploadTempSize(taskID string) (int64, error) {
	return localFileSize(localUploadPath(taskID))
}

func downloadTempSize(taskID string) (int64, error) {
	return localFileSize(localDownloadPath(taskID))
}

func localFileSize(filePath string) (int64, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

func writeChunk(filePath string, offset int64, payload []byte) error {
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()

	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return err
	}
	_, err = file.Write(payload)
	return err
}

func canPause(task model.TransferTask) bool {
	switch task.Status {
	case string(model.TransferTaskStatusUploadingToPlatform),
		string(model.TransferTaskStatusPending),
		string(model.TransferTaskStatusQueuedForRemoteTransfer),
		string(model.TransferTaskStatusTransferring):
		return true
	default:
		return false
	}
}

func isTerminalTransferStatus(status string) bool {
	switch status {
	case string(model.TransferTaskStatusCompleted),
		string(model.TransferTaskStatusFailed),
		string(model.TransferTaskStatusCanceled):
		return true
	default:
		return false
	}
}

func coalesceHostID(task model.TransferTask) *string {
	if task.TargetHostID != nil {
		return task.TargetHostID
	}
	return task.SourceHostID
}

func coalescePath(task model.TransferTask) *string {
	if task.TargetPath != nil {
		return task.TargetPath
	}
	return task.SourcePath
}

func (s *Service) recordAudit(ctx context.Context, log model.AuditLog) {
	if s.audit == nil {
		return
	}
	_ = s.audit.Record(ctx, log)
}

func mustJSON(payload map[string]any) json.RawMessage {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil
	}
	return raw
}

func ptr(value string) *string {
	return &value
}

func stringPtr(value string) *string {
	return &value
}

func timePtr(value time.Time) *time.Time {
	return &value
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func isRetryableTaskFailure(task model.TransferTask) bool {
	return isRetryableErrorCode(task.ErrorCode)
}

func isRetryableErrorCode(code *string) bool {
	if code == nil {
		return false
	}
	switch *code {
	case errorCodeUploadRetryable, errorCodeDownloadRetryable:
		return true
	default:
		return false
	}
}

func classifyUploadFailure(err error) (string, string) {
	msg := err.Error()
	switch {
	case isNotExistMessage(msg):
		return errorCodeUploadTargetNotFound, msg
	case isPermissionMessage(msg):
		return errorCodeUploadPermissionDenied, msg
	case isNoSpaceMessage(msg):
		return errorCodeUploadNoSpaceLeft, msg
	case isRetryableMessage(msg):
		return errorCodeUploadRetryable, msg
	default:
		return errorCodeUploadFailed, msg
	}
}

func classifyDownloadFailure(err error) (string, string) {
	msg := err.Error()
	switch {
	case isNotExistMessage(msg):
		return errorCodeDownloadSourceNotFound, msg
	case isPermissionMessage(msg):
		return errorCodeDownloadPermissionDenied, msg
	case isNoSpaceMessage(msg):
		return errorCodeDownloadNoSpaceLeft, msg
	case isRetryableMessage(msg):
		return errorCodeDownloadRetryable, msg
	default:
		return errorCodeDownloadFailed, msg
	}
}

func isRetryableMessage(msg string) bool {
	value := strings.ToLower(msg)
	return strings.Contains(value, "timeout") ||
		strings.Contains(value, "broken pipe") ||
		strings.Contains(value, "connection reset") ||
		strings.Contains(value, "connection refused") ||
		strings.Contains(value, "connection aborted") ||
		strings.Contains(value, "connection closed") ||
		strings.Contains(value, "unexpected eof") ||
		strings.Contains(value, "i/o timeout") ||
		strings.Contains(value, "handshake failed") ||
		strings.Contains(value, "read tcp") ||
		strings.Contains(value, "write tcp") ||
		strings.Contains(value, "ssh:") ||
		strings.Contains(value, "eof")
}

func isPermissionMessage(msg string) bool {
	value := strings.ToLower(msg)
	return strings.Contains(value, "permission denied")
}

func isNotExistMessage(msg string) bool {
	value := strings.ToLower(msg)
	return strings.Contains(value, "no such file") ||
		strings.Contains(value, "file does not exist") ||
		strings.Contains(value, "cannot find the file")
}

func isNoSpaceMessage(msg string) bool {
	value := strings.ToLower(msg)
	return strings.Contains(value, "no space left") || strings.Contains(value, "disk quota exceeded")
}

func (s *Service) currentTaskProgress(task model.TransferTask) int64 {
	switch task.TaskType {
	case string(model.TransferTaskTypeUpload):
		size, err := uploadTempSize(task.ID)
		if err == nil && size < task.TotalBytes {
			return size
		}
	case string(model.TransferTaskTypeDownload):
		size, err := downloadTempSize(task.ID)
		if err == nil {
			return minInt64(size, task.TotalBytes)
		}
	}
	return minInt64(task.TransferredBytes, task.TotalBytes)
}

func cleanTransferRemotePath(raw string) (string, error) {
	cleanPath := path.Clean(strings.TrimSpace(raw))
	if cleanPath == "." || !strings.HasPrefix(cleanPath, "/") || cleanPath == "/" {
		return "", ErrInvalidInput
	}
	return cleanPath, nil
}

func (s *Service) reconcileUploadInitState(ctx context.Context, task model.TransferTask) (int64, string, bool, error) {
	localBytes, err := uploadTempSize(task.ID)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if task.Status == string(model.TransferTaskStatusUploadingToPlatform) && task.TransferredBytes > 0 {
				s.failTask(ctx, task, errorCodeUploadPlatformStateLost, "platform upload temp file missing during init")
				return 0, "", false, nil
			}
			return 0, task.Status, true, nil
		}
		return 0, "", false, err
	}
	localBytes = minInt64(localBytes, task.TotalBytes)

	if localBytes < task.TotalBytes {
		if task.Status == string(model.TransferTaskStatusQueuedForRemoteTransfer) || task.Status == string(model.TransferTaskStatusTransferring) {
			if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusUploadingToPlatform), localBytes, "", ""); err != nil {
				return 0, "", false, err
			}
			return localBytes, string(model.TransferTaskStatusUploadingToPlatform), true, nil
		}
		if task.TransferredBytes != localBytes {
			if err := s.repo.UpdateTaskStatus(ctx, task.ID, task.Status, localBytes, "", ""); err != nil {
				return 0, "", false, err
			}
		}
		return localBytes, task.Status, true, nil
	}

	if task.Status == string(model.TransferTaskStatusUploadingToPlatform) {
		if err := s.repo.UpdateTaskStatus(ctx, task.ID, string(model.TransferTaskStatusQueuedForRemoteTransfer), task.TotalBytes, "", ""); err != nil {
			return 0, "", false, err
		}
		s.enqueue(task.ID)
		return task.TotalBytes, string(model.TransferTaskStatusQueuedForRemoteTransfer), true, nil
	}
	return task.TotalBytes, task.Status, true, nil
}

func (s *Service) resumeState(task model.TransferTask) (string, int64, error) {
	switch task.TaskType {
	case string(model.TransferTaskTypeUpload):
		localBytes, err := uploadTempSize(task.ID)
		if err != nil {
			return "", 0, ErrInvalidTransition
		}
		localBytes = minInt64(localBytes, task.TotalBytes)
		if localBytes < task.TotalBytes {
			return string(model.TransferTaskStatusUploadingToPlatform), localBytes, nil
		}
		return string(model.TransferTaskStatusQueuedForRemoteTransfer), minInt64(task.TransferredBytes, task.TotalBytes), nil
	case string(model.TransferTaskTypeDownload):
		localBytes, err := downloadTempSize(task.ID)
		if err == nil {
			return string(model.TransferTaskStatusPending), minInt64(localBytes, task.TotalBytes), nil
		}
		if errors.Is(err, os.ErrNotExist) {
			return string(model.TransferTaskStatusPending), 0, nil
		}
		return "", 0, ErrInvalidTransition
	default:
		return "", 0, ErrInvalidTransition
	}
}

func (s *Service) retryState(task model.TransferTask) (string, int64, error) {
	switch task.TaskType {
	case string(model.TransferTaskTypeUpload):
		localBytes, err := uploadTempSize(task.ID)
		if err != nil {
			return "", 0, ErrRetryNotAllowed
		}
		localBytes = minInt64(localBytes, task.TotalBytes)
		if localBytes < task.TotalBytes {
			return string(model.TransferTaskStatusUploadingToPlatform), localBytes, nil
		}
		return string(model.TransferTaskStatusQueuedForRemoteTransfer), minInt64(task.TransferredBytes, task.TotalBytes), nil
	case string(model.TransferTaskTypeDownload):
		localBytes, err := downloadTempSize(task.ID)
		if err == nil {
			return string(model.TransferTaskStatusPending), minInt64(localBytes, task.TotalBytes), nil
		}
		if errors.Is(err, os.ErrNotExist) {
			return string(model.TransferTaskStatusPending), 0, nil
		}
		return "", 0, ErrRetryNotAllowed
	default:
		return "", 0, ErrRetryNotAllowed
	}
}
