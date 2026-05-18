package transfer

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
	Limit       int
	Offset      int
	Status      string
	TaskType    string
	CreatedFrom *time.Time
	CreatedTo   *time.Time
}

type Repository interface {
	CreateTask(ctx context.Context, task model.TransferTask) (model.TransferTask, error)
	UpdateTaskStatus(ctx context.Context, taskID string, status string, transferredBytes int64, errorCode, errorMessage string) error
	GetTaskByID(ctx context.Context, userID, taskID string) (model.TransferTask, error)
	GetTaskByIDAny(ctx context.Context, taskID string) (model.TransferTask, error)
	FindLatestUploadTask(ctx context.Context, userID, targetHostID, targetPath, fileName string, fileSize int64, statuses []string) (model.TransferTask, error)
	ListTasksByUserID(ctx context.Context, userID string, filter ListFilter) ([]model.TransferTask, int, error)
	ListTasksByStatuses(ctx context.Context, statuses []string, limit int) ([]model.TransferTask, error)
	IncrementRetryCount(ctx context.Context, taskID string) error
}

type PostgresRepository struct {
	db *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{db: database}
}

func (r *PostgresRepository) CreateTask(ctx context.Context, task model.TransferTask) (model.TransferTask, error) {
	const query = `
		INSERT INTO transfer_tasks (
			user_id, task_type, source_type, target_type, source_host_id, target_host_id, source_path, target_path, tmp_path, file_name, total_bytes, transferred_bytes, chunk_size, resumable, retry_count, status, error_code, error_message, started_at, finished_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
		RETURNING id, user_id, task_type, source_type, target_type, source_host_id, target_host_id, source_path, target_path, tmp_path, file_name, total_bytes, transferred_bytes, chunk_size, resumable, retry_count, status, error_code, error_message, created_at, updated_at, started_at, finished_at
	`

	row := r.db.SQL.QueryRowContext(
		ctx,
		query,
		task.UserID,
		task.TaskType,
		task.SourceType,
		task.TargetType,
		task.SourceHostID,
		task.TargetHostID,
		task.SourcePath,
		task.TargetPath,
		task.TmpPath,
		task.FileName,
		task.TotalBytes,
		task.TransferredBytes,
		task.ChunkSize,
		task.Resumable,
		task.RetryCount,
		task.Status,
		task.ErrorCode,
		task.ErrorMessage,
		task.StartedAt,
		task.FinishedAt,
	)
	item, err := scanTransferTask(row)
	if err != nil {
		return model.TransferTask{}, err
	}
	return item, nil
}

func (r *PostgresRepository) UpdateTaskStatus(ctx context.Context, taskID string, status string, transferredBytes int64, errorCode, errorMessage string) error {
	const query = `
		UPDATE transfer_tasks
		SET status = $2::varchar,
		    transferred_bytes = $3,
		    error_code = NULLIF($4, ''),
		    error_message = NULLIF($5, ''),
		    finished_at = CASE WHEN $2::text IN ('completed', 'failed', 'canceled') THEN now() ELSE NULL END
		WHERE id = $1
	`

	result, err := r.db.SQL.ExecContext(ctx, query, taskID, status, transferredBytes, errorCode, errorMessage)
	if err != nil {
		return fmt.Errorf("update transfer status: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) GetTaskByID(ctx context.Context, userID, taskID string) (model.TransferTask, error) {
	const query = `
		SELECT id, user_id, task_type, source_type, target_type, source_host_id, target_host_id, source_path, target_path, tmp_path, file_name, total_bytes, transferred_bytes, chunk_size, resumable, retry_count, status, error_code, error_message, created_at, updated_at, started_at, finished_at
		FROM transfer_tasks
		WHERE id = $1 AND user_id = $2
	`

	row := r.db.SQL.QueryRowContext(ctx, query, taskID, userID)
	item, err := scanTransferTask(row)
	if err != nil {
		return model.TransferTask{}, err
	}
	return item, nil
}

func (r *PostgresRepository) GetTaskByIDAny(ctx context.Context, taskID string) (model.TransferTask, error) {
	const query = `
		SELECT id, user_id, task_type, source_type, target_type, source_host_id, target_host_id, source_path, target_path, tmp_path, file_name, total_bytes, transferred_bytes, chunk_size, resumable, retry_count, status, error_code, error_message, created_at, updated_at, started_at, finished_at
		FROM transfer_tasks
		WHERE id = $1
	`

	row := r.db.SQL.QueryRowContext(ctx, query, taskID)
	item, err := scanTransferTask(row)
	if err != nil {
		return model.TransferTask{}, err
	}
	return item, nil
}

func (r *PostgresRepository) FindLatestUploadTask(ctx context.Context, userID, targetHostID, targetPath, fileName string, fileSize int64, statuses []string) (model.TransferTask, error) {
	if len(statuses) == 0 {
		return model.TransferTask{}, db.ErrNotFound
	}

	args := []any{userID, targetHostID, targetPath, fileName, fileSize}
	placeholders := make([]string, 0, len(statuses))
	for _, status := range statuses {
		args = append(args, status)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
	}

	query := `
		SELECT id, user_id, task_type, source_type, target_type, source_host_id, target_host_id, source_path, target_path, tmp_path, file_name, total_bytes, transferred_bytes, chunk_size, resumable, retry_count, status, error_code, error_message, created_at, updated_at, started_at, finished_at
		FROM transfer_tasks
		WHERE user_id = $1
		  AND task_type = 'upload'
		  AND target_host_id = $2
		  AND target_path = $3
		  AND file_name = $4
		  AND total_bytes = $5
		  AND status IN (` + strings.Join(placeholders, ", ") + `)
		ORDER BY created_at DESC
		LIMIT 1`

	row := r.db.SQL.QueryRowContext(ctx, query, args...)
	item, err := scanTransferTask(row)
	if err != nil {
		return model.TransferTask{}, err
	}
	return item, nil
}

func (r *PostgresRepository) ListTasksByUserID(ctx context.Context, userID string, filter ListFilter) ([]model.TransferTask, int, error) {
	whereParts := []string{"user_id = $1"}
	args := []any{userID}

	if filter.Status != "" {
		args = append(args, filter.Status)
		whereParts = append(whereParts, fmt.Sprintf("status = $%d", len(args)))
	}
	if filter.TaskType != "" {
		args = append(args, filter.TaskType)
		whereParts = append(whereParts, fmt.Sprintf("task_type = $%d", len(args)))
	}
	if filter.CreatedFrom != nil {
		args = append(args, *filter.CreatedFrom)
		whereParts = append(whereParts, fmt.Sprintf("created_at >= $%d", len(args)))
	}
	if filter.CreatedTo != nil {
		args = append(args, *filter.CreatedTo)
		whereParts = append(whereParts, fmt.Sprintf("created_at <= $%d", len(args)))
	}

	whereClause := strings.Join(whereParts, " AND ")
	countQuery := "SELECT COUNT(*) FROM transfer_tasks WHERE " + whereClause

	var total int
	if err := r.db.SQL.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count transfer tasks: %w", err)
	}

	args = append(args, filter.Limit, filter.Offset)
	query := `
		SELECT id, user_id, task_type, source_type, target_type, source_host_id, target_host_id, source_path, target_path, tmp_path, file_name, total_bytes, transferred_bytes, chunk_size, resumable, retry_count, status, error_code, error_message, created_at, updated_at, started_at, finished_at
		FROM transfer_tasks
		WHERE ` + whereClause + `
		ORDER BY created_at DESC
		LIMIT $` + fmt.Sprint(len(args)-1) + ` OFFSET $` + fmt.Sprint(len(args))

	rows, err := r.db.SQL.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list transfer tasks: %w", err)
	}
	defer rows.Close()

	var items []model.TransferTask
	for rows.Next() {
		item, scanErr := scanTransferTask(rows)
		if scanErr != nil {
			return nil, 0, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate transfer tasks: %w", err)
	}
	return items, total, nil
}

func (r *PostgresRepository) ListTasksByStatuses(ctx context.Context, statuses []string, limit int) ([]model.TransferTask, error) {
	if len(statuses) == 0 {
		return nil, nil
	}
	args := make([]any, 0, len(statuses)+1)
	placeholders := make([]string, 0, len(statuses))
	for i, status := range statuses {
		args = append(args, status)
		placeholders = append(placeholders, fmt.Sprintf("$%d", i+1))
	}

	query := `
		SELECT id, user_id, task_type, source_type, target_type, source_host_id, target_host_id, source_path, target_path, tmp_path, file_name, total_bytes, transferred_bytes, chunk_size, resumable, retry_count, status, error_code, error_message, created_at, updated_at, started_at, finished_at
		FROM transfer_tasks
		WHERE status IN (` + strings.Join(placeholders, ", ") + `)
		ORDER BY created_at ASC`
	if limit > 0 {
		args = append(args, limit)
		query += fmt.Sprintf(" LIMIT $%d", len(args))
	}

	rows, err := r.db.SQL.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list recoverable transfer tasks: %w", err)
	}
	defer rows.Close()

	items := make([]model.TransferTask, 0)
	for rows.Next() {
		item, scanErr := scanTransferTask(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recoverable transfer tasks: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) IncrementRetryCount(ctx context.Context, taskID string) error {
	const query = `
		UPDATE transfer_tasks
		SET retry_count = retry_count + 1
		WHERE id = $1
	`

	result, err := r.db.SQL.ExecContext(ctx, query, taskID)
	if err != nil {
		return fmt.Errorf("increment transfer retry count: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func scanTransferTask(scanner interface {
	Scan(dest ...any) error
}) (model.TransferTask, error) {
	var item model.TransferTask
	var sourceHostID sql.NullString
	var targetHostID sql.NullString
	var sourcePath sql.NullString
	var targetPath sql.NullString
	var tmpPath sql.NullString
	var errorCode sql.NullString
	var errorMessage sql.NullString
	var startedAt sql.NullTime
	var finishedAt sql.NullTime
	if err := scanner.Scan(
		&item.ID,
		&item.UserID,
		&item.TaskType,
		&item.SourceType,
		&item.TargetType,
		&sourceHostID,
		&targetHostID,
		&sourcePath,
		&targetPath,
		&tmpPath,
		&item.FileName,
		&item.TotalBytes,
		&item.TransferredBytes,
		&item.ChunkSize,
		&item.Resumable,
		&item.RetryCount,
		&item.Status,
		&errorCode,
		&errorMessage,
		&item.CreatedAt,
		&item.UpdatedAt,
		&startedAt,
		&finishedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.TransferTask{}, db.ErrNotFound
		}
		return model.TransferTask{}, fmt.Errorf("scan transfer task: %w", err)
	}
	item.SourceHostID = nullStringPtr(sourceHostID)
	item.TargetHostID = nullStringPtr(targetHostID)
	item.SourcePath = nullStringPtr(sourcePath)
	item.TargetPath = nullStringPtr(targetPath)
	item.TmpPath = nullStringPtr(tmpPath)
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
