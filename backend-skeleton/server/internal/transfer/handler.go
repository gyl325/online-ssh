package transfer

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

const maxUploadChunkBytes int64 = 8 * 1024 * 1024

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) CreateDownloadTask(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req CreateDownloadInput
	if err := decodeJSON(r, &req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	task, err := h.service.CreateDownloadTask(r.Context(), req)
	if err != nil {
		h.writeTransferError(w, err, "CREATE_DOWNLOAD_FAILED", "create download failed")
		return
	}
	webutil.WriteJSON(w, http.StatusAccepted, map[string]any{
		"task": taskResponse(r, task),
	})
}

func (h *Handler) InitUpload(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req InitUploadInput
	if err := decodeJSON(r, &req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID

	result, err := h.service.InitUpload(r.Context(), req)
	if err != nil {
		h.writeTransferError(w, err, "INIT_UPLOAD_FAILED", "init upload failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) UploadChunk(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	offset, err := parseOffset(r.URL.Query().Get("offset"))
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid upload offset")
		return
	}

	body := http.MaxBytesReader(w, r.Body, maxUploadChunkBytes)
	defer body.Close()
	payload, err := io.ReadAll(body)
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid upload chunk body")
		return
	}

	result, err := h.service.UploadChunk(r.Context(), session.UserID, r.PathValue("taskId"), offset, payload)
	if err != nil {
		if strings.Contains(err.Error(), "offset mismatch") {
			webutil.WriteError(w, http.StatusConflict, "UPLOAD_OFFSET_MISMATCH", "upload offset mismatch")
			return
		}
		h.writeTransferError(w, err, "UPLOAD_CHUNK_FAILED", "upload chunk failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	item, err := h.service.GetTask(r.Context(), session.UserID, r.PathValue("taskId"))
	if err != nil {
		h.writeTransferError(w, err, "GET_TRANSFER_FAILED", "get transfer failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"task": taskResponse(r, item),
	})
}

func (h *Handler) DownloadContent(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	task, filePath, err := h.service.DownloadContentPath(r.Context(), session.UserID, r.PathValue("taskId"))
	if err != nil {
		h.writeTransferError(w, err, "DOWNLOAD_CONTENT_FAILED", "download content unavailable")
		return
	}

	w.Header().Set("Content-Disposition", "attachment; filename=\""+filepath.Base(task.FileName)+"\"")
	http.ServeFile(w, r, filePath)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	pagination := webutil.ParsePagination(r)
	createdFrom, ok := parseTransferListTime(r.URL.Query().Get("created_from"))
	if !ok {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid created_from")
		return
	}
	createdTo, ok := parseTransferListTime(r.URL.Query().Get("created_to"))
	if !ok {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid created_to")
		return
	}
	items, total, err := h.service.ListTasks(r.Context(), session.UserID, ListFilter{
		Limit:       pagination.PageSize,
		Offset:      pagination.Offset,
		Status:      r.URL.Query().Get("status"),
		TaskType:    r.URL.Query().Get("task_type"),
		CreatedFrom: createdFrom,
		CreatedTo:   createdTo,
	})
	if err != nil {
		webutil.WriteError(w, http.StatusInternalServerError, "LIST_TRANSFERS_FAILED", "list transfers failed")
		return
	}

	respItems := make([]map[string]any, 0, len(items))
	for _, item := range items {
		respItems = append(respItems, taskResponse(r, item))
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"items":     respItems,
		"page":      pagination.Page,
		"page_size": pagination.PageSize,
		"total":     total,
	})
}

func parseTransferListTime(raw string) (*time.Time, bool) {
	if raw == "" {
		return nil, true
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, false
	}
	return &parsed, true
}

func (h *Handler) Pause(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	item, err := h.service.Pause(r.Context(), session.UserID, r.PathValue("taskId"))
	if err != nil {
		h.writeTransferError(w, err, "PAUSE_TRANSFER_FAILED", "pause transfer failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"task": taskResponse(r, item)})
}

func (h *Handler) Resume(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	item, err := h.service.Resume(r.Context(), session.UserID, r.PathValue("taskId"))
	if err != nil {
		h.writeTransferError(w, err, "RESUME_TRANSFER_FAILED", "resume transfer failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"task": taskResponse(r, item)})
}

func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	item, err := h.service.Cancel(r.Context(), session.UserID, r.PathValue("taskId"))
	if err != nil {
		h.writeTransferError(w, err, "CANCEL_TRANSFER_FAILED", "cancel transfer failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"task": taskResponse(r, item)})
}

func (h *Handler) Retry(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	item, err := h.service.Retry(r.Context(), session.UserID, r.PathValue("taskId"))
	if err != nil {
		h.writeTransferError(w, err, "RETRY_TRANSFER_FAILED", "retry transfer failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"task": taskResponse(r, item)})
}

func taskResponse(r *http.Request, item model.TransferTask) map[string]any {
	return map[string]any{
		"id":                item.ID,
		"task_type":         item.TaskType,
		"source_type":       item.SourceType,
		"target_type":       item.TargetType,
		"source_host_id":    item.SourceHostID,
		"target_host_id":    item.TargetHostID,
		"source_path":       item.SourcePath,
		"target_path":       item.TargetPath,
		"file_name":         item.FileName,
		"total_bytes":       item.TotalBytes,
		"transferred_bytes": item.TransferredBytes,
		"chunk_size":        item.ChunkSize,
		"status":            item.Status,
		"resumable":         item.Resumable,
		"retry_count":       item.RetryCount,
		"error_code":        item.ErrorCode,
		"error_message":     item.ErrorMessage,
		"download_url":      downloadURL(r, item),
		"started_at":        item.StartedAt,
		"finished_at":       item.FinishedAt,
		"created_at":        item.CreatedAt,
		"updated_at":        item.UpdatedAt,
	}
}

func downloadURL(r *http.Request, item model.TransferTask) any {
	if item.TaskType != string(model.TransferTaskTypeDownload) || item.Status != string(model.TransferTaskStatusCompleted) {
		return nil
	}
	scheme := "http"
	if strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") || r.TLS != nil {
		scheme = "https"
	}
	hostValue := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if hostValue == "" {
		hostValue = strings.TrimSpace(r.Host)
	}
	if hostValue == "" {
		return nil
	}
	return scheme + "://" + hostValue + "/api/transfers/" + item.ID + "/content"
}

func (h *Handler) writeTransferError(w http.ResponseWriter, err error, internalCode, internalMessage string) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid transfer request")
	case errors.Is(err, ErrInvalidTransition):
		webutil.WriteError(w, http.StatusConflict, "TRANSFER_STATE_CONFLICT", "invalid transfer state transition")
	case errors.Is(err, ErrRetryNotAllowed):
		webutil.WriteError(w, http.StatusConflict, "TRANSFER_RETRY_NOT_ALLOWED", "retry not allowed for current transfer task")
	case db.IsNotFound(err):
		webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "transfer task or host not found")
	default:
		message := strings.TrimSpace(err.Error())
		if message == "" {
			message = internalMessage
		}
		webutil.WriteError(w, http.StatusInternalServerError, internalCode, message)
	}
}

func parseOffset(raw string) (int64, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, ErrInvalidInput
	}
	return strconv.ParseInt(value, 10, 64)
}

func decodeJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(r.Body)
	return decoder.Decode(target)
}
