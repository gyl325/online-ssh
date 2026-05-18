package audit

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	pagination := webutil.ParsePagination(r)
	filter := ListFilter{
		Limit:        pagination.PageSize,
		Offset:       pagination.Offset,
		EventType:    r.URL.Query().Get("event_type"),
		TargetHostID: r.URL.Query().Get("target_host_id"),
		Result:       r.URL.Query().Get("result"),
		StartTime:    parseTime(r.URL.Query().Get("start_time")),
		EndTime:      parseTime(r.URL.Query().Get("end_time")),
	}

	items, total, err := h.service.List(r.Context(), session.UserID, filter)
	if err != nil {
		webutil.WriteError(w, http.StatusInternalServerError, "LIST_AUDIT_LOGS_FAILED", "list audit logs failed")
		return
	}

	respItems := make([]map[string]any, 0, len(items))
	for _, item := range items {
		respItems = append(respItems, auditLogResponse(item))
	}

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"items":     respItems,
		"page":      pagination.Page,
		"page_size": pagination.PageSize,
		"total":     total,
	})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	item, err := h.service.Get(r.Context(), session.UserID, r.PathValue("logId"))
	if err != nil {
		if db.IsNotFound(err) {
			webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "audit log not found")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "GET_AUDIT_LOG_FAILED", "get audit log failed")
		return
	}

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"log": auditLogResponse(item),
	})
}

func auditLogResponse(item model.AuditLog) map[string]any {
	return map[string]any{
		"id":                  item.ID,
		"session_id":          nil,
		"terminal_session_id": item.TerminalSessionID,
		"target_host_id":      item.TargetHostID,
		"event_type":          item.EventType,
		"resource_type":       item.ResourceType,
		"resource_id":         item.ResourceID,
		"target_path":         item.TargetPath,
		"result":              item.Result,
		"message":             item.Message,
		"metadata":            parseMetadata(item.MetadataJSON),
		"client_ip":           item.ClientIP,
		"user_agent":          item.UserAgent,
		"occurred_at":         item.OccurredAt,
	}
}

func parseMetadata(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return map[string]any{}
	}
	return result
}

func parseTime(raw string) *time.Time {
	if raw == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil
	}
	return &parsed
}
