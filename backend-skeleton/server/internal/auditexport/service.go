package auditexport

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/example/online-ssh-platform/server/internal/audit"
	"github.com/example/online-ssh-platform/server/internal/model"
)

var (
	ErrInvalidInput = errors.New("invalid input")
	ErrQueueFull    = errors.New("audit export queue is full")
	ErrNotReady     = errors.New("audit export is not ready")
	ErrExpired      = errors.New("audit export is expired")
	ErrActive       = errors.New("audit export is active")
)

const (
	defaultTaskTTL        = 24 * time.Hour
	workerQueueSize       = 64
	exportPageSize        = 500
	maxExportRows         = 100000
	maxActiveTasksPerUser = 3

	errorCodeQueueFull    = "AUDIT_EXPORT_QUEUE_FULL"
	errorCodeNotReady     = "AUDIT_EXPORT_NOT_READY"
	errorCodeExpired      = "AUDIT_EXPORT_EXPIRED"
	errorCodeActive       = "AUDIT_EXPORT_ACTIVE"
	errorCodeLimitReached = "AUDIT_EXPORT_LIMIT_REACHED"
	errorCodeCanceled     = "AUDIT_EXPORT_CANCELED"
	errorCodeFailed       = "AUDIT_EXPORT_FAILED"
)

type AuditLister interface {
	List(ctx context.Context, userID string, filter audit.ListFilter) ([]model.AuditLog, int, error)
}

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

type CreateInput struct {
	UserID       string     `json:"-"`
	EventType    string     `json:"event_type"`
	TargetHostID string     `json:"target_host_id"`
	Result       string     `json:"result"`
	StartTime    *time.Time `json:"start_time"`
	EndTime      *time.Time `json:"end_time"`
}

type ListResult struct {
	Items    []model.AuditExportTask `json:"items"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"page_size"`
	Total    int                     `json:"total"`
}

type DownloadResult struct {
	Task     model.AuditExportTask
	CSV      string
	FileName string
}

type Service struct {
	repo  Repository
	audit AuditLister
	log   AuditRecorder

	workerCtx    context.Context
	workerCancel context.CancelFunc
	workerQueue  chan string
	workerWG     sync.WaitGroup

	mu            sync.Mutex
	activeExports map[string]context.CancelFunc
}

func NewService(repo Repository, auditLister AuditLister, auditRecorder AuditRecorder) *Service {
	workerCtx, workerCancel := context.WithCancel(context.Background())
	service := &Service{
		repo:          repo,
		audit:         auditLister,
		log:           auditRecorder,
		workerCtx:     workerCtx,
		workerCancel:  workerCancel,
		workerQueue:   make(chan string, workerQueueSize),
		activeExports: make(map[string]context.CancelFunc),
	}
	if repo != nil && auditLister != nil {
		service.workerWG.Add(1)
		go service.workerLoop()
	}
	return service
}

func (s *Service) Close() {
	if s == nil || s.workerCancel == nil {
		return
	}
	s.workerCancel()
	s.cancelAllActiveExports()
	s.workerWG.Wait()
}

func (s *Service) Create(ctx context.Context, input CreateInput) (model.AuditExportTask, error) {
	if s.repo == nil || s.audit == nil {
		return model.AuditExportTask{}, ErrInvalidInput
	}
	task, err := normalizeInput(input)
	if err != nil {
		return model.AuditExportTask{}, err
	}

	activeCount, err := s.repo.CountActiveByUser(ctx, task.UserID)
	if err != nil {
		return model.AuditExportTask{}, err
	}
	if activeCount >= maxActiveTasksPerUser {
		return model.AuditExportTask{}, ErrQueueFull
	}

	created, err := s.repo.Create(ctx, task)
	if err != nil {
		return model.AuditExportTask{}, err
	}
	if err := s.enqueue(created.ID); err != nil {
		_ = s.repo.Finish(ctx, created.ID, string(model.AuditExportTaskStatusFailed), "", errorCodeQueueFull, err.Error(), 0, 0)
		created.Status = string(model.AuditExportTaskStatusFailed)
		created.ErrorCode = stringPtr(errorCodeQueueFull)
		created.ErrorMessage = stringPtr(err.Error())
		return created, nil
	}

	s.record(ctx, "audit_export_task_created", created.UserID, created.ID, model.AuditResultSuccess, nil)
	return created, nil
}

func (s *Service) List(ctx context.Context, userID string, page, pageSize int) (ListResult, error) {
	if s.repo == nil || strings.TrimSpace(userID) == "" || page < 1 || pageSize < 1 || pageSize > 200 {
		return ListResult{}, ErrInvalidInput
	}
	offset := (page - 1) * pageSize
	items, total, err := s.repo.ListByUserID(ctx, userID, pageSize, offset)
	if err != nil {
		return ListResult{}, err
	}
	return ListResult{Items: items, Page: page, PageSize: pageSize, Total: total}, nil
}

func (s *Service) Get(ctx context.Context, userID, taskID string) (model.AuditExportTask, error) {
	if s.repo == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(taskID) == "" {
		return model.AuditExportTask{}, ErrInvalidInput
	}
	return s.repo.GetByID(ctx, userID, taskID)
}

func (s *Service) Download(ctx context.Context, userID, taskID string) (DownloadResult, error) {
	task, err := s.Get(ctx, userID, taskID)
	if err != nil {
		return DownloadResult{}, err
	}
	if task.Status != string(model.AuditExportTaskStatusCompleted) {
		return DownloadResult{}, ErrNotReady
	}
	if time.Now().After(task.ExpiresAt) {
		return DownloadResult{}, ErrExpired
	}
	return DownloadResult{
		Task:     task,
		CSV:      "\ufeff" + task.ResultCSV,
		FileName: fmt.Sprintf("audit-export-%s.csv", task.ID),
	}, nil
}

func (s *Service) Cancel(ctx context.Context, userID, taskID string) (model.AuditExportTask, error) {
	if s.repo == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(taskID) == "" {
		return model.AuditExportTask{}, ErrInvalidInput
	}
	task, err := s.repo.Cancel(ctx, userID, taskID)
	if err != nil {
		return model.AuditExportTask{}, err
	}
	s.cancelActiveExport(taskID)
	if task.Status == string(model.AuditExportTaskStatusCanceled) {
		s.record(ctx, "audit_export_task_canceled", userID, task.ID, model.AuditResultSuccess, nil)
	}
	return task, nil
}

func (s *Service) Delete(ctx context.Context, userID, taskID string) error {
	task, err := s.Get(ctx, userID, taskID)
	if err != nil {
		return err
	}
	if isActiveStatus(task.Status) {
		return ErrActive
	}
	if err := s.repo.Delete(ctx, userID, taskID); err != nil {
		return err
	}
	s.record(ctx, "audit_export_task_deleted", userID, task.ID, model.AuditResultSuccess, nil)
	return nil
}

func isActiveStatus(status string) bool {
	return status == string(model.AuditExportTaskStatusPending) || status == string(model.AuditExportTaskStatusRunning)
}

func normalizeInput(input CreateInput) (model.AuditExportTask, error) {
	userID := strings.TrimSpace(input.UserID)
	eventType := strings.TrimSpace(input.EventType)
	targetHostID := strings.TrimSpace(input.TargetHostID)
	result := strings.TrimSpace(input.Result)
	if userID == "" {
		return model.AuditExportTask{}, ErrInvalidInput
	}
	if result != "" && result != string(model.AuditResultSuccess) && result != string(model.AuditResultFailure) {
		return model.AuditExportTask{}, ErrInvalidInput
	}
	if input.StartTime != nil && input.EndTime != nil && input.StartTime.After(*input.EndTime) {
		return model.AuditExportTask{}, ErrInvalidInput
	}

	var targetHostIDPtr *string
	if targetHostID != "" {
		targetHostIDPtr = &targetHostID
	}

	return model.AuditExportTask{
		UserID:             userID,
		FilterEventType:    eventType,
		FilterTargetHostID: targetHostIDPtr,
		FilterResult:       result,
		FilterStartTime:    input.StartTime,
		FilterEndTime:      input.EndTime,
		Status:             string(model.AuditExportTaskStatusPending),
		ExpiresAt:          time.Now().Add(defaultTaskTTL).UTC(),
	}, nil
}

func (s *Service) enqueue(taskID string) error {
	select {
	case s.workerQueue <- taskID:
		return nil
	default:
		return ErrQueueFull
	}
}

func (s *Service) workerLoop() {
	defer s.workerWG.Done()
	for {
		select {
		case <-s.workerCtx.Done():
			return
		case taskID := <-s.workerQueue:
			s.run(taskID)
		}
	}
}

func (s *Service) run(taskID string) {
	task, err := s.repo.GetByIDAny(s.workerCtx, taskID)
	if err != nil {
		return
	}

	taskCtx, cancel := context.WithCancel(s.workerCtx)
	if !s.registerActiveExport(taskID, cancel) {
		cancel()
		return
	}
	defer s.unregisterActiveExport(taskID)
	defer cancel()

	if err := s.repo.Start(taskCtx, taskID); err != nil {
		return
	}

	s.record(taskCtx, "audit_export_task_started", task.UserID, task.ID, model.AuditResultSuccess, nil)
	resultCSV, totalRows, exportedRows, err := s.generateCSV(taskCtx, task)
	if err != nil {
		status := string(model.AuditExportTaskStatusFailed)
		errorCode := errorCodeFailed
		if errors.Is(taskCtx.Err(), context.Canceled) {
			status = string(model.AuditExportTaskStatusCanceled)
			errorCode = errorCodeCanceled
		} else if errors.Is(err, errLimitReached) {
			errorCode = errorCodeLimitReached
		}
		_ = s.repo.Finish(context.Background(), taskID, status, "", errorCode, err.Error(), totalRows, exportedRows)
		s.record(context.Background(), "audit_export_task_failed", task.UserID, task.ID, model.AuditResultFailure, map[string]any{"error": err.Error()})
		return
	}

	_ = s.repo.Finish(context.Background(), taskID, string(model.AuditExportTaskStatusCompleted), resultCSV, "", "", totalRows, exportedRows)
	s.record(context.Background(), "audit_export_task_completed", task.UserID, task.ID, model.AuditResultSuccess, map[string]any{
		"total_rows":    totalRows,
		"exported_rows": exportedRows,
	})
}

var errLimitReached = errors.New("audit export row limit reached")

func (s *Service) generateCSV(ctx context.Context, task model.AuditExportTask) (string, int, int, error) {
	var builder strings.Builder
	writer := csv.NewWriter(&builder)
	if err := writer.Write([]string{
		"id",
		"occurred_at",
		"event_type",
		"result",
		"resource_type",
		"resource_id",
		"target_host_id",
		"target_path",
		"message",
		"client_ip",
		"user_agent",
	}); err != nil {
		return "", 0, 0, err
	}

	totalRows := 0
	exportedRows := 0
	for page := 0; ; page++ {
		select {
		case <-ctx.Done():
			return "", totalRows, exportedRows, ctx.Err()
		default:
		}

		items, total, err := s.audit.List(ctx, task.UserID, audit.ListFilter{
			Limit:        exportPageSize,
			Offset:       page * exportPageSize,
			EventType:    task.FilterEventType,
			TargetHostID: derefString(task.FilterTargetHostID),
			Result:       task.FilterResult,
			StartTime:    task.FilterStartTime,
			EndTime:      task.FilterEndTime,
		})
		if err != nil {
			return "", totalRows, exportedRows, err
		}
		totalRows = total
		if totalRows > maxExportRows {
			return "", totalRows, exportedRows, errLimitReached
		}
		if len(items) == 0 {
			break
		}

		for _, item := range items {
			if err := writer.Write(auditLogCSVRecord(item)); err != nil {
				return "", totalRows, exportedRows, err
			}
			exportedRows++
		}
		if err := s.repo.UpdateProgress(ctx, task.ID, totalRows, exportedRows); err != nil {
			return "", totalRows, exportedRows, err
		}
		if exportedRows >= totalRows {
			break
		}
	}

	writer.Flush()
	if err := writer.Error(); err != nil {
		return "", totalRows, exportedRows, err
	}
	return builder.String(), totalRows, exportedRows, nil
}

func auditLogCSVRecord(item model.AuditLog) []string {
	return []string{
		item.ID,
		item.OccurredAt.Format(time.RFC3339),
		item.EventType,
		item.Result,
		derefString(item.ResourceType),
		derefString(item.ResourceID),
		derefString(item.TargetHostID),
		derefString(item.TargetPath),
		derefString(item.Message),
		derefString(item.ClientIP),
		derefString(item.UserAgent),
	}
}

func (s *Service) registerActiveExport(taskID string, cancel context.CancelFunc) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.activeExports[taskID]; exists {
		return false
	}
	s.activeExports[taskID] = cancel
	return true
}

func (s *Service) unregisterActiveExport(taskID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.activeExports, taskID)
}

func (s *Service) cancelActiveExport(taskID string) {
	s.mu.Lock()
	cancel, ok := s.activeExports[taskID]
	s.mu.Unlock()
	if ok {
		cancel()
	}
}

func (s *Service) cancelAllActiveExports() {
	s.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(s.activeExports))
	for _, cancel := range s.activeExports {
		cancels = append(cancels, cancel)
	}
	s.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

func (s *Service) record(ctx context.Context, eventType, userID, taskID string, result model.AuditResult, metadata map[string]any) {
	if s.log == nil {
		return
	}
	_ = s.log.Record(ctx, model.AuditLog{
		UserID:       userID,
		EventType:    eventType,
		ResourceType: stringPtr("audit_export"),
		ResourceID:   stringPtr(taskID),
		Result:       string(result),
		MetadataJSON: mustJSON(metadata),
	})
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func stringPtr(value string) *string {
	return &value
}

func mustJSON(value map[string]any) []byte {
	if value == nil {
		return nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return raw
}
