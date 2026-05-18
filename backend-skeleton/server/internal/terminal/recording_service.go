package terminal

import (
	"context"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
)

const (
	defaultRecordingRetentionDays = 7
	maxRecordingRetentionDays     = 30
	defaultRecordingPageSize      = 20
	maxRecordingPageSize          = 100
	defaultRecordingChunkLimit    = 200
	maxRecordingChunkLimit        = 500
)

type RecordingSettingsInput struct {
	UserID        string `json:"-"`
	Enabled       bool   `json:"enabled"`
	RetentionDays int    `json:"retention_days"`
}

type RecordingListResult struct {
	Items    []model.TerminalRecording `json:"items"`
	Page     int                       `json:"page"`
	PageSize int                       `json:"page_size"`
	Total    int                       `json:"total"`
}

type RecordingChunkListResult struct {
	Items      []model.TerminalRecordingChunk `json:"items"`
	NextCursor int                            `json:"next_cursor"`
	HasMore    bool                           `json:"has_more"`
}

type RecordingBookmarkInput struct {
	UserID       string `json:"-"`
	RecordingID  string `json:"-"`
	IsBookmarked bool   `json:"is_bookmarked"`
}

func (s *Service) GetRecordingSettings(ctx context.Context, userID string) (model.TerminalRecordingSettings, error) {
	if strings.TrimSpace(userID) == "" {
		return model.TerminalRecordingSettings{}, ErrInvalidInput
	}
	if s.recordingRepo == nil {
		return defaultRecordingSettings(userID), nil
	}
	settings, err := s.recordingRepo.GetRecordingSettings(ctx, userID)
	if err != nil {
		if db.IsNotFound(err) {
			return defaultRecordingSettings(userID), nil
		}
		return model.TerminalRecordingSettings{}, err
	}
	return settings, nil
}

func (s *Service) UpdateRecordingSettings(ctx context.Context, input RecordingSettingsInput) (model.TerminalRecordingSettings, error) {
	if s.recordingRepo == nil || strings.TrimSpace(input.UserID) == "" {
		return model.TerminalRecordingSettings{}, ErrInvalidInput
	}
	retentionDays := input.RetentionDays
	if retentionDays == 0 {
		retentionDays = defaultRecordingRetentionDays
	}
	if retentionDays < 1 || retentionDays > maxRecordingRetentionDays {
		return model.TerminalRecordingSettings{}, ErrInvalidInput
	}
	settings, err := s.recordingRepo.UpsertRecordingSettings(ctx, model.TerminalRecordingSettings{
		UserID:        strings.TrimSpace(input.UserID),
		Enabled:       input.Enabled,
		RetentionDays: retentionDays,
	})
	if err != nil {
		return model.TerminalRecordingSettings{}, err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       settings.UserID,
		EventType:    "terminal_recording_settings_update",
		ResourceType: stringPtr("terminal_recording_settings"),
		Result:       string(model.AuditResultSuccess),
	})
	return settings, nil
}

func (s *Service) ListRecordings(ctx context.Context, userID string, page, pageSize int) (RecordingListResult, error) {
	if s.recordingRepo == nil || strings.TrimSpace(userID) == "" {
		return RecordingListResult{}, ErrInvalidInput
	}
	page, pageSize, err := normalizeRecordingPage(page, pageSize)
	if err != nil {
		return RecordingListResult{}, err
	}
	items, total, err := s.recordingRepo.ListRecordingsByUserID(ctx, userID, pageSize, (page-1)*pageSize)
	if err != nil {
		return RecordingListResult{}, err
	}
	return RecordingListResult{Items: items, Page: page, PageSize: pageSize, Total: total}, nil
}

func (s *Service) GetRecording(ctx context.Context, userID, recordingID string) (model.TerminalRecording, error) {
	if s.recordingRepo == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(recordingID) == "" {
		return model.TerminalRecording{}, ErrInvalidInput
	}
	return s.recordingRepo.GetRecordingByID(ctx, userID, strings.TrimSpace(recordingID))
}

func (s *Service) ListRecordingChunks(ctx context.Context, userID, recordingID string, cursor, limit int) (RecordingChunkListResult, error) {
	if s.recordingCollector == nil {
		return RecordingChunkListResult{}, ErrInvalidInput
	}
	recording, err := s.GetRecording(ctx, userID, recordingID)
	if err != nil {
		return RecordingChunkListResult{}, err
	}
	if cursor < 0 {
		return RecordingChunkListResult{}, ErrInvalidInput
	}
	if limit == 0 {
		limit = defaultRecordingChunkLimit
	}
	if limit < 1 || limit > maxRecordingChunkLimit {
		return RecordingChunkListResult{}, ErrInvalidInput
	}
	if s.recordingRepo == nil {
		return RecordingChunkListResult{}, ErrInvalidInput
	}
	items, err := s.recordingRepo.ListRecordingChunks(ctx, recording.ID, cursor, limit+1)
	if err != nil {
		return RecordingChunkListResult{}, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	nextCursor := cursor
	for index := range items {
		decrypted, decErr := credential.DecryptWithVersion(s.recordingCollector.encryptor, items[index].DataEnc, items[index].KeyVersion)
		if decErr != nil {
			return RecordingChunkListResult{}, decErr
		}
		items[index].Data = decrypted
		items[index].DataEnc = ""
		nextCursor = items[index].Sequence
	}
	return RecordingChunkListResult{Items: items, NextCursor: nextCursor, HasMore: hasMore}, nil
}

func (s *Service) DeleteRecording(ctx context.Context, userID, recordingID string) error {
	recording, err := s.GetRecording(ctx, userID, recordingID)
	if err != nil {
		return err
	}
	if err := s.recordingRepo.DeleteRecording(ctx, userID, recording.ID); err != nil {
		return err
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:            userID,
		TerminalSessionID: recording.TerminalSessionID,
		EventType:         "terminal_recording_delete",
		ResourceType:      stringPtr("terminal_recording"),
		ResourceID:        stringPtr(recording.ID),
		TargetHostID:      recording.HostID,
		Result:            string(model.AuditResultSuccess),
	})
	return nil
}

func (s *Service) UpdateRecordingBookmark(ctx context.Context, input RecordingBookmarkInput) (model.TerminalRecording, error) {
	userID := strings.TrimSpace(input.UserID)
	recordingID := strings.TrimSpace(input.RecordingID)
	if s.recordingRepo == nil || userID == "" || recordingID == "" {
		return model.TerminalRecording{}, ErrInvalidInput
	}

	recording, err := s.recordingRepo.UpdateRecordingBookmark(ctx, userID, recordingID, input.IsBookmarked)
	if err != nil {
		return model.TerminalRecording{}, err
	}
	eventType := "terminal_recording_bookmark_remove"
	if input.IsBookmarked {
		eventType = "terminal_recording_bookmark_add"
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:            userID,
		TerminalSessionID: recording.TerminalSessionID,
		EventType:         eventType,
		ResourceType:      stringPtr("terminal_recording"),
		ResourceID:        stringPtr(recording.ID),
		TargetHostID:      recording.HostID,
		Result:            string(model.AuditResultSuccess),
	})
	return recording, nil
}

func (s *Service) startRecording(ctx context.Context, session model.TerminalSession) *RecordingHandle {
	if s.recordingRepo == nil || s.recordingCollector == nil {
		return nil
	}
	if host.IsTemporaryHostID(session.HostID) || strings.HasPrefix(strings.TrimSpace(session.ID), "tmp-session-") {
		return nil
	}
	settings, err := s.GetRecordingSettings(ctx, session.UserID)
	if err != nil || !settings.Enabled {
		return nil
	}
	retentionDays := settings.RetentionDays
	if retentionDays <= 0 {
		retentionDays = defaultRecordingRetentionDays
	}
	startedAt := session.StartedAt
	if startedAt.IsZero() {
		startedAt = time.Now().UTC()
	}
	sessionID := session.ID
	hostID := session.HostID
	recording, err := s.recordingRepo.CreateRecording(ctx, model.TerminalRecording{
		UserID:            session.UserID,
		TerminalSessionID: &sessionID,
		HostID:            &hostID,
		Status:            string(model.TerminalRecordingStatusActive),
		StartedAt:         startedAt,
		ExpiresAt:         time.Now().AddDate(0, 0, retentionDays).UTC(),
	})
	if err != nil {
		return nil
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:            session.UserID,
		TerminalSessionID: stringPtr(session.ID),
		EventType:         "terminal_recording_start",
		ResourceType:      stringPtr("terminal_recording"),
		ResourceID:        stringPtr(recording.ID),
		TargetHostID:      stringPtr(session.HostID),
		Result:            string(model.AuditResultSuccess),
	})
	return s.recordingCollector.Handle(recording)
}

func (s *Service) finishRecording(ctx context.Context, userID, sessionID string, status model.TerminalSessionStatus, endedAt time.Time) {
	if s.recordingRepo == nil {
		return
	}
	recordingStatus := model.TerminalRecordingStatusCompleted
	if status == model.TerminalSessionStatusFailed {
		recordingStatus = model.TerminalRecordingStatusFailed
	}
	_ = s.recordingRepo.FinishRecordingBySession(ctx, userID, sessionID, string(recordingStatus), endedAt, 0)
}

func defaultRecordingSettings(userID string) model.TerminalRecordingSettings {
	return model.TerminalRecordingSettings{
		UserID:        strings.TrimSpace(userID),
		Enabled:       false,
		RetentionDays: defaultRecordingRetentionDays,
	}
}

func normalizeRecordingPage(page, pageSize int) (int, int, error) {
	if page == 0 {
		page = 1
	}
	if pageSize == 0 {
		pageSize = defaultRecordingPageSize
	}
	if page < 1 || pageSize < 1 || pageSize > maxRecordingPageSize {
		return 0, 0, ErrInvalidInput
	}
	return page, pageSize, nil
}
