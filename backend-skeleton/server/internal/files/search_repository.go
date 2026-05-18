package files

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type SearchRepository interface {
	CreateSearchTask(ctx context.Context, task model.FileSearchTask) (model.FileSearchTask, error)
	GetSearchTaskByID(ctx context.Context, userID, taskID string) (model.FileSearchTask, error)
	GetSearchTaskByIDAny(ctx context.Context, taskID string) (model.FileSearchTask, error)
	StartSearchTask(ctx context.Context, taskID string) error
	UpdateSearchTaskProgress(ctx context.Context, taskID string, progress SearchTaskProgress) error
	FinishSearchTask(ctx context.Context, taskID, status, errorCode, errorMessage string, progress SearchTaskProgress) error
	CancelSearchTask(ctx context.Context, userID, taskID string) (model.FileSearchTask, error)
	InsertSearchResults(ctx context.Context, taskID string, results []model.FileSearchResult) error
	ListSearchResults(ctx context.Context, userID, taskID string, limit, offset int) ([]model.FileSearchResult, int, error)
}

type PostgresRepository struct {
	db *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{db: database}
}

func (r *PostgresRepository) CreateSearchTask(ctx context.Context, task model.FileSearchTask) (model.FileSearchTask, error) {
	row := r.db.SQL.QueryRowContext(ctx, `
		INSERT INTO file_search_tasks (
			user_id, host_id, base_path, keyword, match_mode, recursive, include_hidden,
			max_depth, max_results, max_scanned_entries, timeout_seconds, status, expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING id, user_id, host_id, base_path, keyword, match_mode, recursive, include_hidden,
			max_depth, max_results, max_scanned_entries, timeout_seconds, status,
			scanned_dirs, scanned_entries, matched_entries, skipped_errors_count, limit_reached,
			error_code, error_message, warnings_json, started_at, finished_at, expires_at, created_at, updated_at`,
		task.UserID,
		task.HostID,
		task.BasePath,
		task.Keyword,
		task.MatchMode,
		task.Recursive,
		task.IncludeHidden,
		task.MaxDepth,
		task.MaxResults,
		task.MaxScannedEntries,
		task.TimeoutSeconds,
		task.Status,
		task.ExpiresAt,
	)
	item, err := scanFileSearchTask(row)
	if err != nil {
		return model.FileSearchTask{}, err
	}
	return item, nil
}

func (r *PostgresRepository) GetSearchTaskByID(ctx context.Context, userID, taskID string) (model.FileSearchTask, error) {
	row := r.db.SQL.QueryRowContext(ctx, fileSearchTaskSelectSQL()+` WHERE user_id = $1 AND id = $2`, userID, taskID)
	return scanFileSearchTask(row)
}

func (r *PostgresRepository) GetSearchTaskByIDAny(ctx context.Context, taskID string) (model.FileSearchTask, error) {
	row := r.db.SQL.QueryRowContext(ctx, fileSearchTaskSelectSQL()+` WHERE id = $1`, taskID)
	return scanFileSearchTask(row)
}

func (r *PostgresRepository) StartSearchTask(ctx context.Context, taskID string) error {
	result, err := r.db.SQL.ExecContext(ctx, `
		UPDATE file_search_tasks
		SET status = 'running',
		    started_at = COALESCE(started_at, now()),
		    error_code = NULL,
		    error_message = NULL
		WHERE id = $1 AND status = 'pending'`,
		taskID,
	)
	if err != nil {
		return fmt.Errorf("start file search task: %w", err)
	}
	return requireAffected(result, db.ErrNotFound)
}

func (r *PostgresRepository) UpdateSearchTaskProgress(ctx context.Context, taskID string, progress SearchTaskProgress) error {
	warningsJSON := warningsRawJSON(progress.Warnings)
	_, err := r.db.SQL.ExecContext(ctx, `
		UPDATE file_search_tasks
		SET scanned_dirs = $2,
		    scanned_entries = $3,
		    matched_entries = $4,
		    skipped_errors_count = $5,
		    limit_reached = $6,
		    warnings_json = $7
		WHERE id = $1`,
		taskID,
		progress.ScannedDirs,
		progress.ScannedEntries,
		progress.MatchedEntries,
		progress.SkippedErrorsCount,
		progress.LimitReached,
		warningsJSON,
	)
	if err != nil {
		return fmt.Errorf("update file search task progress: %w", err)
	}
	return nil
}

func (r *PostgresRepository) FinishSearchTask(ctx context.Context, taskID, status, errorCode, errorMessage string, progress SearchTaskProgress) error {
	var codeValue any
	var messageValue any
	if strings.TrimSpace(errorCode) != "" {
		codeValue = errorCode
	}
	if strings.TrimSpace(errorMessage) != "" {
		messageValue = errorMessage
	}
	result, err := r.db.SQL.ExecContext(ctx, `
		UPDATE file_search_tasks
		SET status = $2,
		    scanned_dirs = $3,
		    scanned_entries = $4,
		    matched_entries = $5,
		    skipped_errors_count = $6,
		    limit_reached = $7,
		    warnings_json = $8,
		    error_code = $9,
		    error_message = $10,
		    finished_at = now()
		WHERE id = $1`,
		taskID,
		status,
		progress.ScannedDirs,
		progress.ScannedEntries,
		progress.MatchedEntries,
		progress.SkippedErrorsCount,
		progress.LimitReached,
		warningsRawJSON(progress.Warnings),
		codeValue,
		messageValue,
	)
	if err != nil {
		return fmt.Errorf("finish file search task: %w", err)
	}
	return requireAffected(result, db.ErrNotFound)
}

func (r *PostgresRepository) CancelSearchTask(ctx context.Context, userID, taskID string) (model.FileSearchTask, error) {
	row := r.db.SQL.QueryRowContext(ctx, `
		UPDATE file_search_tasks
		SET status = 'canceled',
		    finished_at = COALESCE(finished_at, now())
		WHERE user_id = $1 AND id = $2 AND status IN ('pending', 'running')
		RETURNING id, user_id, host_id, base_path, keyword, match_mode, recursive, include_hidden,
			max_depth, max_results, max_scanned_entries, timeout_seconds, status,
			scanned_dirs, scanned_entries, matched_entries, skipped_errors_count, limit_reached,
			error_code, error_message, warnings_json, started_at, finished_at, expires_at, created_at, updated_at`,
		userID,
		taskID,
	)
	item, err := scanFileSearchTask(row)
	if errors.Is(err, db.ErrNotFound) {
		return r.GetSearchTaskByID(ctx, userID, taskID)
	}
	return item, err
}

func (r *PostgresRepository) InsertSearchResults(ctx context.Context, taskID string, results []model.FileSearchResult) error {
	if len(results) == 0 {
		return nil
	}
	tx, err := r.db.SQL.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin file search result insert: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO file_search_results (
			task_id, rank, name, path, entry_type, size_bytes, permissions, owner, group_name, modified_at, is_hidden
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (task_id, path) DO NOTHING`)
	if err != nil {
		return fmt.Errorf("prepare file search result insert: %w", err)
	}
	defer stmt.Close()

	for _, result := range results {
		if _, err = stmt.ExecContext(ctx,
			taskID,
			result.Rank,
			result.Name,
			result.Path,
			result.EntryType,
			result.SizeBytes,
			result.Permissions,
			result.Owner,
			result.Group,
			result.ModifiedAt,
			result.IsHidden,
		); err != nil {
			return fmt.Errorf("insert file search result: %w", err)
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit file search result insert: %w", err)
	}
	return nil
}

func (r *PostgresRepository) ListSearchResults(ctx context.Context, userID, taskID string, limit, offset int) ([]model.FileSearchResult, int, error) {
	var total int
	if err := r.db.SQL.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM file_search_results fsr
		JOIN file_search_tasks fst ON fst.id = fsr.task_id
		WHERE fst.user_id = $1 AND fsr.task_id = $2`,
		userID,
		taskID,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count file search results: %w", err)
	}
	if total == 0 {
		if _, err := r.GetSearchTaskByID(ctx, userID, taskID); err != nil {
			return nil, 0, err
		}
	}

	rows, err := r.db.SQL.QueryContext(ctx, `
		SELECT fsr.id, fsr.task_id, fsr.rank, fsr.name, fsr.path, fsr.entry_type, fsr.size_bytes,
		       fsr.permissions, fsr.owner, fsr.group_name, fsr.modified_at, fsr.is_hidden, fsr.created_at
		FROM file_search_results fsr
		JOIN file_search_tasks fst ON fst.id = fsr.task_id
		WHERE fst.user_id = $1 AND fsr.task_id = $2
		ORDER BY fsr.rank ASC
		LIMIT $3 OFFSET $4`,
		userID,
		taskID,
		limit,
		offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list file search results: %w", err)
	}
	defer rows.Close()

	items := make([]model.FileSearchResult, 0)
	for rows.Next() {
		item, scanErr := scanFileSearchResult(rows)
		if scanErr != nil {
			return nil, 0, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate file search results: %w", err)
	}
	return items, total, nil
}

func fileSearchTaskSelectSQL() string {
	return `SELECT id, user_id, host_id, base_path, keyword, match_mode, recursive, include_hidden,
		max_depth, max_results, max_scanned_entries, timeout_seconds, status,
		scanned_dirs, scanned_entries, matched_entries, skipped_errors_count, limit_reached,
		error_code, error_message, warnings_json, started_at, finished_at, expires_at, created_at, updated_at
		FROM file_search_tasks`
}

func scanFileSearchTask(scanner interface {
	Scan(dest ...any) error
}) (model.FileSearchTask, error) {
	var item model.FileSearchTask
	if err := scanner.Scan(
		&item.ID,
		&item.UserID,
		&item.HostID,
		&item.BasePath,
		&item.Keyword,
		&item.MatchMode,
		&item.Recursive,
		&item.IncludeHidden,
		&item.MaxDepth,
		&item.MaxResults,
		&item.MaxScannedEntries,
		&item.TimeoutSeconds,
		&item.Status,
		&item.ScannedDirs,
		&item.ScannedEntries,
		&item.MatchedEntries,
		&item.SkippedErrorsCount,
		&item.LimitReached,
		&item.ErrorCode,
		&item.ErrorMessage,
		&item.WarningsJSON,
		&item.StartedAt,
		&item.FinishedAt,
		&item.ExpiresAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.FileSearchTask{}, db.ErrNotFound
		}
		return model.FileSearchTask{}, fmt.Errorf("scan file search task: %w", err)
	}
	return item, nil
}

func scanFileSearchResult(scanner interface {
	Scan(dest ...any) error
}) (model.FileSearchResult, error) {
	var item model.FileSearchResult
	if err := scanner.Scan(
		&item.ID,
		&item.TaskID,
		&item.Rank,
		&item.Name,
		&item.Path,
		&item.EntryType,
		&item.SizeBytes,
		&item.Permissions,
		&item.Owner,
		&item.Group,
		&item.ModifiedAt,
		&item.IsHidden,
		&item.CreatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.FileSearchResult{}, db.ErrNotFound
		}
		return model.FileSearchResult{}, fmt.Errorf("scan file search result: %w", err)
	}
	return item, nil
}

func requireAffected(result sql.Result, fallback error) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return fallback
	}
	return nil
}

func warningsRawJSON(warnings []SearchTaskWarning) json.RawMessage {
	raw, err := json.Marshal(warnings)
	if err != nil {
		return json.RawMessage("[]")
	}
	return raw
}
