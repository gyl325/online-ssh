package audit

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type ListFilter struct {
	Limit        int
	Offset       int
	EventType    string
	TargetHostID string
	Result       string
	StartTime    *time.Time
	EndTime      *time.Time
}

type Repository interface {
	Insert(ctx context.Context, log model.AuditLog) error
	ListByUserID(ctx context.Context, userID string, filter ListFilter) ([]model.AuditLog, int, error)
	GetByID(ctx context.Context, userID, logID string) (model.AuditLog, error)
}

type PostgresRepository struct {
	db *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{db: database}
}

func (r *PostgresRepository) Insert(ctx context.Context, log model.AuditLog) error {
	const query = `
		INSERT INTO audit_logs (
			user_id,
			terminal_session_id,
			event_type,
			resource_type,
			resource_id,
			target_host_id,
			target_path,
			result,
			message,
			client_ip,
			user_agent,
			audit_level,
			metadata_json,
			occurred_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, '{}'::jsonb), COALESCE($14, now()))
	`

	_, err := r.db.SQL.ExecContext(
		ctx,
		query,
		nullableString(log.UserID),
		log.TerminalSessionID,
		log.EventType,
		log.ResourceType,
		log.ResourceID,
		log.TargetHostID,
		log.TargetPath,
		emptyDefault(log.Result, string(model.AuditResultSuccess)),
		log.Message,
		log.ClientIP,
		log.UserAgent,
		emptyDefault(log.AuditLevel, string(model.AuditLevelBasic)),
		nullableJSON(log.MetadataJSON),
		nullableTime(log.OccurredAt),
	)
	if err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func (r *PostgresRepository) ListByUserID(ctx context.Context, userID string, filter ListFilter) ([]model.AuditLog, int, error) {
	whereParts := []string{"user_id = $1"}
	args := []any{userID}

	if filter.EventType != "" {
		args = append(args, filter.EventType)
		whereParts = append(whereParts, fmt.Sprintf("event_type = $%d", len(args)))
	}
	if filter.TargetHostID != "" {
		args = append(args, filter.TargetHostID)
		whereParts = append(whereParts, fmt.Sprintf("target_host_id = $%d", len(args)))
	}
	if filter.Result != "" {
		args = append(args, filter.Result)
		whereParts = append(whereParts, fmt.Sprintf("result = $%d", len(args)))
	}
	if filter.StartTime != nil {
		args = append(args, *filter.StartTime)
		whereParts = append(whereParts, fmt.Sprintf("occurred_at >= $%d", len(args)))
	}
	if filter.EndTime != nil {
		args = append(args, *filter.EndTime)
		whereParts = append(whereParts, fmt.Sprintf("occurred_at <= $%d", len(args)))
	}

	whereClause := strings.Join(whereParts, " AND ")
	countQuery := "SELECT COUNT(*) FROM audit_logs WHERE " + whereClause

	var total int
	if err := r.db.SQL.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count audit logs: %w", err)
	}

	args = append(args, filter.Limit, filter.Offset)
	listQuery := `
		SELECT id, user_id, terminal_session_id, event_type, resource_type, resource_id, target_host_id, target_path, result, message, client_ip, user_agent, audit_level, metadata_json, occurred_at
		FROM audit_logs
		WHERE ` + whereClause + `
		ORDER BY occurred_at DESC
		LIMIT $` + fmt.Sprint(len(args)-1) + ` OFFSET $` + fmt.Sprint(len(args))

	rows, err := r.db.SQL.QueryContext(ctx, listQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list audit logs: %w", err)
	}
	defer rows.Close()

	var logs []model.AuditLog
	for rows.Next() {
		item, scanErr := scanAuditLog(rows)
		if scanErr != nil {
			return nil, 0, scanErr
		}
		logs = append(logs, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate audit logs: %w", err)
	}

	return logs, total, nil
}

func (r *PostgresRepository) GetByID(ctx context.Context, userID, logID string) (model.AuditLog, error) {
	const query = `
		SELECT id, user_id, terminal_session_id, event_type, resource_type, resource_id, target_host_id, target_path, result, message, client_ip, user_agent, audit_level, metadata_json, occurred_at
		FROM audit_logs
		WHERE id = $1 AND user_id = $2
	`

	row := r.db.SQL.QueryRowContext(ctx, query, logID, userID)
	item, err := scanAuditLog(row)
	if err != nil {
		return model.AuditLog{}, err
	}
	return item, nil
}

func scanAuditLog(scanner interface {
	Scan(dest ...any) error
}) (model.AuditLog, error) {
	var item model.AuditLog
	var userID sql.NullString
	var terminalSessionID sql.NullString
	var resourceType sql.NullString
	var resourceID sql.NullString
	var targetHostID sql.NullString
	var targetPath sql.NullString
	var message sql.NullString
	var clientIP sql.NullString
	var userAgent sql.NullString
	var metadata []byte

	if err := scanner.Scan(
		&item.ID,
		&userID,
		&terminalSessionID,
		&item.EventType,
		&resourceType,
		&resourceID,
		&targetHostID,
		&targetPath,
		&item.Result,
		&message,
		&clientIP,
		&userAgent,
		&item.AuditLevel,
		&metadata,
		&item.OccurredAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.AuditLog{}, db.ErrNotFound
		}
		return model.AuditLog{}, fmt.Errorf("scan audit log: %w", err)
	}

	if userID.Valid {
		item.UserID = userID.String
	}
	item.TerminalSessionID = nullStringPtr(terminalSessionID)
	item.ResourceType = nullStringPtr(resourceType)
	item.ResourceID = nullStringPtr(resourceID)
	item.TargetHostID = nullStringPtr(targetHostID)
	item.TargetPath = nullStringPtr(targetPath)
	item.Message = nullStringPtr(message)
	item.ClientIP = nullStringPtr(clientIP)
	item.UserAgent = nullStringPtr(userAgent)
	item.MetadataJSON = metadata
	return item, nil
}

func nullableJSON(value []byte) any {
	if len(value) == 0 {
		return nil
	}
	return value
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}

func emptyDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
