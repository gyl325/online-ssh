package savedcommand

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type Repository interface {
	ListByUserID(ctx context.Context, userID string) ([]model.SavedCommand, error)
	Create(ctx context.Context, item model.SavedCommand) (model.SavedCommand, error)
	Update(ctx context.Context, userID string, item model.SavedCommand) (model.SavedCommand, error)
	Delete(ctx context.Context, userID, commandID string) error
}

type PostgresRepository struct {
	db *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{db: database}
}

func (r *PostgresRepository) ListByUserID(ctx context.Context, userID string) ([]model.SavedCommand, error) {
	const query = `
		SELECT id, user_id, name, command_text, category, description, sort_order, created_at, updated_at
		FROM saved_commands
		WHERE user_id = $1
		ORDER BY sort_order ASC, updated_at DESC
	`

	rows, err := r.db.SQL.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("list saved commands: %w", err)
	}
	defer rows.Close()

	items := make([]model.SavedCommand, 0)
	for rows.Next() {
		item, scanErr := scanSavedCommand(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate saved commands: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) Create(ctx context.Context, item model.SavedCommand) (model.SavedCommand, error) {
	const query = `
		INSERT INTO saved_commands (user_id, name, command_text, category, description, sort_order)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, user_id, name, command_text, category, description, sort_order, created_at, updated_at
	`

	return scanSavedCommand(r.db.SQL.QueryRowContext(
		ctx,
		query,
		item.UserID,
		item.Name,
		item.CommandText,
		item.Category,
		item.Description,
		item.SortOrder,
	))
}

func (r *PostgresRepository) Update(ctx context.Context, userID string, item model.SavedCommand) (model.SavedCommand, error) {
	const query = `
		UPDATE saved_commands
		SET name = $3,
		    command_text = $4,
		    category = $5,
		    description = $6,
		    sort_order = $7
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, name, command_text, category, description, sort_order, created_at, updated_at
	`

	return scanSavedCommand(r.db.SQL.QueryRowContext(
		ctx,
		query,
		item.ID,
		userID,
		item.Name,
		item.CommandText,
		item.Category,
		item.Description,
		item.SortOrder,
	))
}

func (r *PostgresRepository) Delete(ctx context.Context, userID, commandID string) error {
	result, err := r.db.SQL.ExecContext(ctx, `DELETE FROM saved_commands WHERE id = $1 AND user_id = $2`, commandID, userID)
	if err != nil {
		return fmt.Errorf("delete saved command: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

type savedCommandRow interface {
	Scan(dest ...any) error
}

func scanSavedCommand(row savedCommandRow) (model.SavedCommand, error) {
	var item model.SavedCommand
	if err := row.Scan(
		&item.ID,
		&item.UserID,
		&item.Name,
		&item.CommandText,
		&item.Category,
		&item.Description,
		&item.SortOrder,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.SavedCommand{}, db.ErrNotFound
		}
		return model.SavedCommand{}, err
	}
	return item, nil
}
