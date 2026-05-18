package terminal

import (
	"encoding/json"
	"net/http"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func (h *Handler) GetRecordingSettings(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	settings, err := h.service.GetRecordingSettings(r.Context(), session.UserID)
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"settings": recordingSettingsResponse(settings)})
}

func (h *Handler) UpdateRecordingSettings(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req RecordingSettingsInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID
	settings, err := h.service.UpdateRecordingSettings(r.Context(), req)
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"settings": recordingSettingsResponse(settings)})
}

func (h *Handler) ListRecordings(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	page, pageSize, err := paginationFromQuery(r, defaultRecordingPageSize, maxRecordingPageSize)
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid pagination")
		return
	}

	result, err := h.service.ListRecordings(r.Context(), session.UserID, page, pageSize)
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}
	items := make([]map[string]any, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, recordingResponse(item))
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"items":     items,
		"page":      result.Page,
		"page_size": result.PageSize,
		"total":     result.Total,
	})
}

func (h *Handler) GetRecording(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	recording, err := h.service.GetRecording(r.Context(), session.UserID, r.PathValue("recordingId"))
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"recording": recordingResponse(recording)})
}

func (h *Handler) ListRecordingChunks(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	cursor, err := intQueryParam(r, "cursor", 0)
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid cursor")
		return
	}
	limit, err := intQueryParam(r, "limit", defaultRecordingChunkLimit)
	if err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid limit")
		return
	}

	result, err := h.service.ListRecordingChunks(r.Context(), session.UserID, r.PathValue("recordingId"), cursor, limit)
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}
	items := make([]map[string]any, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, recordingChunkResponse(item))
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"items":       items,
		"next_cursor": result.NextCursor,
		"has_more":    result.HasMore,
	})
}

func (h *Handler) DeleteRecording(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	if err := h.service.DeleteRecording(r.Context(), session.UserID, r.PathValue("recordingId")); err != nil {
		h.writeTerminalError(w, err)
		return
	}
	webutil.WriteNoContent(w)
}

func (h *Handler) UpdateRecordingBookmark(w http.ResponseWriter, r *http.Request) {
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	var req RecordingBookmarkInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.UserID = session.UserID
	req.RecordingID = r.PathValue("recordingId")

	recording, err := h.service.UpdateRecordingBookmark(r.Context(), req)
	if err != nil {
		h.writeTerminalError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{"recording": recordingResponse(recording)})
}

func recordingSettingsResponse(item model.TerminalRecordingSettings) map[string]any {
	return map[string]any{
		"enabled":        item.Enabled,
		"retention_days": item.RetentionDays,
		"updated_at":     zeroTimeToNil(item.UpdatedAt),
	}
}

func recordingResponse(item model.TerminalRecording) map[string]any {
	return map[string]any{
		"id":                  item.ID,
		"terminal_session_id": item.TerminalSessionID,
		"host_id":             item.HostID,
		"status":              item.Status,
		"started_at":          item.StartedAt,
		"ended_at":            item.EndedAt,
		"expires_at":          item.ExpiresAt,
		"is_bookmarked":       item.IsBookmarked,
		"input_bytes":         item.InputBytes,
		"output_bytes":        item.OutputBytes,
		"dropped_bytes":       item.DroppedBytes,
		"created_at":          item.CreatedAt,
	}
}

func recordingChunkResponse(item model.TerminalRecordingChunk) map[string]any {
	return map[string]any{
		"sequence":    item.Sequence,
		"direction":   item.Direction,
		"occurred_at": item.OccurredAt,
		"data":        item.Data,
		"byte_count":  item.ByteCount,
	}
}
