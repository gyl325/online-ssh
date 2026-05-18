package auditexport

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type Repository interface {
	Create(ctx context.Context, task model.AuditExportTask) (model.AuditExportTask, error)
	ListByUserID(ctx context.Context, userID string, limit, offset int) ([]model.AuditExportTask, int, error)
	GetByID(ctx context.Context, userID, taskID string) (model.AuditExportTask, error)
	GetByIDAny(ctx context.Context, taskID string) (model.AuditExportTask, error)
	CountActiveByUser(ctx context.Context, userID string) (int, error)
	Start(ctx context.Context, taskID string) error
	UpdateProgress(ctx context.Context, taskID string, totalRows, exportedRows int) error
	Finish(ctx context.Context, taskID, status, resultCSV, errorCode, errorMessage string, totalRows, exportedRows int) error
	Cancel(ctx context.Context, userID, taskID string) (model.AuditExportTask, error)
	Delete(ctx context.Context, userID, taskID string) error
}

type PostgresRepository struct {
	db *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{db: database}
}

func (r *PostgresRepository) Create(ctx context.Context, task model.AuditExportTask) (model.AuditExportTask, error) {
	row := r.db.SQL.QueryRowContext(ctx, `
		INSERT INTO audit_export_tasks (
			user_id, filter_event_type, filter_target_host_id, filter_result,
			filter_start_time, filter_end_time, status, expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, user_id, filter_event_type, filter_target_host_id, filter_result,
			filter_start_time, filter_end_time, status, total_rows, exported_rows, result_csv,
			error_code, error_message, started_at, finished_at, expires_at, created_at, updated_at`,
		task.UserID,
		task.FilterEventType,
		task.FilterTargetHostID,
		task.FilterResult,
		task.FilterStartTime,
		task.FilterEndTime,
		task.Status,
		task.ExpiresAt,
	)
	return scanTask(row)
}

func (r *PostgresRepository) ListByUserID(ctx context.Context, userID string, limit, offset int) ([]model.AuditExportTask, int, error) {
	var total int
	if err := r.db.SQL.QueryRowContext(ctx, `SELECT COUNT(*) FROM audit_export_tasks WHERE user_id = $1`, userID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count audit export tasks: %w", err)
	}

	rows, err := r.db.SQL.QueryContext(ctx, taskSelectSQL()+`
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`,
		userID,
		limit,
		offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list audit export tasks: %w", err)
	}
	defer rows.Close()

	items := make([]model.AuditExportTask, 0)
	for rows.Next() {
		item, scanErr := scanTask(rows)
		if scanErr != nil {
			return nil, 0, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate audit export tasks: %w", err)
	}
	return items, total, nil
}

func (r *PostgresRepository) GetByID(ctx context.Context, userID, taskID string) (model.AuditExportTask, error) {
	row := r.db.SQL.QueryRowContext(ctx, taskSelectSQL()+` WHERE user_id = $1 AND id = $2`, userID, taskID)
	return scanTask(row)
}

func (r *PostgresRepository) GetByIDAny(ctx context.Context, taskID string) (model.AuditExportTask, error) {
	row := r.db.SQL.QueryRowContext(ctx, taskSelectSQL()+` WHERE id = $1`, taskID)
	return scanTask(row)
}

func (r *PostgresRepository) CountActiveByUser(ctx context.Context, userID string) (int, error) {
	var count int
	if err := r.db.SQL.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM audit_export_tasks
		WHERE user_id = $1 AND status IN ('pending', 'running')`,
		userID,
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("count active audit export tasks: %w", err)
	}
	return count, nil
}

func (r *PostgresRepository) Start(ctx context.Context, taskID string) error {
	result, err := r.db.SQL.ExecContext(ctx, `
		UPDATE audit_export_tasks
		SET status = 'running',
		    started_at = COALESCE(started_at, now()),
		    error_code = NULL,
		    error_message = NULL
		WHERE id = $1 AND status = 'pending'`,
		taskID,
	)
	if err != nil {
		return fmt.Errorf("start audit export task: %w", err)
	}
	return requireAffected(result, db.ErrNotFound)
}

func (r *PostgresRepository) UpdateProgress(ctx context.Context, taskID string, totalRows, exportedRows int) error {
	_, err := r.db.SQL.ExecContext(ctx, `
		UPDATE audit_export_tasks
		SET total_rows = $2,
		    exported_rows = $3
		WHERE id = $1`,
		taskID,
		totalRows,
		exportedRows,
	)
	if err != nil {
		return fmt.Errorf("update audit export progress: %w", err)
	}
	return nil
}

func (r *PostgresRepository) Finish(ctx context.Context, taskID, status, resultCSV, errorCode, errorMessage string, totalRows, exportedRows int) error {
	var codeValue any
	var messageValue any
	if errorCode != "" {
		codeValue = errorCode
	}
	if errorMessage != "" {
		messageValue = errorMessage
	}
	result, err := r.db.SQL.ExecContext(ctx, `
		UPDATE audit_export_tasks
		SET status = $2,
		    total_rows = $3,
		    exported_rows = $4,
		    result_csv = $5,
		    error_code = $6,
		    error_message = $7,
		    finished_at = now()
		WHERE id = $1`,
		taskID,
		status,
		totalRows,
		exportedRows,
		resultCSV,
		codeValue,
		messageValue,
	)
	if err != nil {
		return fmt.Errorf("finish audit export task: %w", err)
	}
	return requireAffected(result, db.ErrNotFound)
}

func (r *PostgresRepository) Cancel(ctx context.Context, userID, taskID string) (model.AuditExportTask, error) {
	row := r.db.SQL.QueryRowContext(ctx, `
		UPDATE audit_export_tasks
		SET status = 'canceled',
		    finished_at = COALESCE(finished_at, now())
		WHERE user_id = $1 AND id = $2 AND status IN ('pending', 'running')
		RETURNING id, user_id, filter_event_type, filter_target_host_id, filter_result,
			filter_start_time, filter_end_time, status, total_rows, exported_rows, result_csv,
			error_code, error_message, started_at, finished_at, expires_at, created_at, updated_at`,
		userID,
		taskID,
	)
	item, err := scanTask(row)
	if errors.Is(err, db.ErrNotFound) {
		return r.GetByID(ctx, userID, taskID)
	}
	return item, err
}

func (r *PostgresRepository) Delete(ctx context.Context, userID, taskID string) error {
	result, err := r.db.SQL.ExecContext(ctx, `
		DELETE FROM audit_export_tasks
		WHERE user_id = $1
		  AND id = $2
		  AND status NOT IN ('pending', 'running')`,
		userID,
		taskID,
	)
	if err != nil {
		return fmt.Errorf("delete audit export task: %w", err)
	}
	return requireAffected(result, db.ErrNotFound)
}

func taskSelectSQL() string {
	return `
		SELECT id, user_id, filter_event_type, filter_target_host_id, filter_result,
		       filter_start_time, filter_end_time, status, total_rows, exported_rows, result_csv,
		       error_code, error_message, started_at, finished_at, expires_at, created_at, updated_at
		FROM audit_export_tasks`
}

func scanTask(row interface{ Scan(dest ...any) error }) (model.AuditExportTask, error) {
	var item model.AuditExportTask
	var targetHostID sql.NullString
	var startTime sql.NullTime
	var endTime sql.NullTime
	var errorCode sql.NullString
	var errorMessage sql.NullString
	var startedAt sql.NullTime
	var finishedAt sql.NullTime

	if err := row.Scan(
		&item.ID,
		&item.UserID,
		&item.FilterEventType,
		&targetHostID,
		&item.FilterResult,
		&startTime,
		&endTime,
		&item.Status,
		&item.TotalRows,
		&item.ExportedRows,
		&item.ResultCSV,
		&errorCode,
		&errorMessage,
		&startedAt,
		&finishedAt,
		&item.ExpiresAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.AuditExportTask{}, db.ErrNotFound
		}
		return model.AuditExportTask{}, fmt.Errorf("scan audit export task: %w", err)
	}

	item.FilterTargetHostID = nullStringPtr(targetHostID)
	item.FilterStartTime = nullTimePtr(startTime)
	item.FilterEndTime = nullTimePtr(endTime)
	item.ErrorCode = nullStringPtr(errorCode)
	item.ErrorMessage = nullStringPtr(errorMessage)
	item.StartedAt = nullTimePtr(startedAt)
	item.FinishedAt = nullTimePtr(finishedAt)
	return item, nil
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func nullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func requireAffected(result sql.Result, fallback error) error {
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fallback
	}
	return nil
}
