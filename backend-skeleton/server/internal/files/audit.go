package files

import (
	"context"
	"encoding/json"

	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
)

func (s *Service) recordFileOperation(ctx context.Context, userID, hostID, targetPath, eventType string, result model.AuditResult, message string, metadata map[string]any) {
	var targetHostID *string
	if !host.IsTemporaryHostID(hostID) {
		targetHostID = stringPtr(hostID)
	}
	s.recordAudit(ctx, model.AuditLog{
		UserID:       userID,
		EventType:    eventType,
		ResourceType: stringPtr("file"),
		TargetHostID: targetHostID,
		TargetPath:   stringPtr(targetPath),
		Result:       string(result),
		Message:      stringPtr(message),
		MetadataJSON: mustJSON(metadata),
	})
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

func stringPtr(value string) *string {
	return &value
}
