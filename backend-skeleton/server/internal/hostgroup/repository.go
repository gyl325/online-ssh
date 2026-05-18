package hostgroup

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type Repository interface {
	ListByUserID(ctx context.Context, userID string) ([]model.HostGroup, error)
	GetByID(ctx context.Context, userID, groupID string) (model.HostGroup, error)
	Create(ctx context.Context, item model.HostGroup) (model.HostGroup, error)
	Update(ctx context.Context, userID string, item model.HostGroup) (model.HostGroup, error)
	Delete(ctx context.Context, userID, groupID string) error
}

type PostgresRepository struct {
	db *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{db: database}
}

func (r *PostgresRepository) ListByUserID(ctx context.Context, userID string) ([]model.HostGroup, error) {
	const query = `
		SELECT id, user_id, name, sort_order, created_at, updated_at
		FROM host_groups
		WHERE user_id = $1
		ORDER BY sort_order ASC, name ASC, created_at ASC
	`

	rows, err := r.db.SQL.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("list host groups: %w", err)
	}
	defer rows.Close()

	items := make([]model.HostGroup, 0)
	for rows.Next() {
		item, scanErr := scanHostGroup(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate host groups: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) GetByID(ctx context.Context, userID, groupID string) (model.HostGroup, error) {
	const query = `
		SELECT id, user_id, name, sort_order, created_at, updated_at
		FROM host_groups
		WHERE id = $1 AND user_id = $2
	`

	return scanHostGroup(r.db.SQL.QueryRowContext(ctx, query, groupID, userID))
}

func (r *PostgresRepository) Create(ctx context.Context, item model.HostGroup) (model.HostGroup, error) {
	const query = `
		INSERT INTO host_groups (user_id, name, sort_order)
		VALUES ($1, $2, $3)
		RETURNING id, user_id, name, sort_order, created_at, updated_at
	`

	return scanHostGroup(r.db.SQL.QueryRowContext(ctx, query, item.UserID, item.Name, item.SortOrder))
}

func (r *PostgresRepository) Update(ctx context.Context, userID string, item model.HostGroup) (model.HostGroup, error) {
	const query = `
		UPDATE host_groups
		SET name = $3,
		    sort_order = $4
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, name, sort_order, created_at, updated_at
	`

	return scanHostGroup(r.db.SQL.QueryRowContext(ctx, query, item.ID, userID, item.Name, item.SortOrder))
}

func (r *PostgresRepository) Delete(ctx context.Context, userID, groupID string) error {
	result, err := r.db.SQL.ExecContext(ctx, `DELETE FROM host_groups WHERE id = $1 AND user_id = $2`, groupID, userID)
	if err != nil {
		return fmt.Errorf("delete host group: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

type hostGroupRow interface {
	Scan(dest ...any) error
}

func scanHostGroup(row hostGroupRow) (model.HostGroup, error) {
	var item model.HostGroup
	if err := row.Scan(
		&item.ID,
		&item.UserID,
		&item.Name,
		&item.SortOrder,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.HostGroup{}, db.ErrNotFound
		}
		return model.HostGroup{}, err
	}
	return item, nil
}
