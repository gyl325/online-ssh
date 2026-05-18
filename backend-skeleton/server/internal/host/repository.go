package host

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
	Keyword      string
	FavoriteOnly bool
	GroupID      string
}

type Repository interface {
	ListByUserID(ctx context.Context, userID string, filter ListFilter) ([]model.Host, int, error)
	Create(ctx context.Context, host model.Host) (model.Host, error)
	Update(ctx context.Context, host model.Host) (model.Host, error)
	Delete(ctx context.Context, userID, hostID string) error
	GetByID(ctx context.Context, userID, hostID string) (model.Host, error)
	ListFingerprintsByHostID(ctx context.Context, hostID string) ([]model.HostFingerprint, error)
	GetPrimaryFingerprintByHostID(ctx context.Context, hostID string) (model.HostFingerprint, error)
	UpsertFingerprint(ctx context.Context, hostID, algorithm, fingerprint, status string) (model.HostFingerprint, error)
	UpdateLastConnectedAt(ctx context.Context, userID, hostID string, connectedAt time.Time) error
}

type PostgresRepository struct {
	db *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{db: database}
}

func (r *PostgresRepository) ListByUserID(ctx context.Context, userID string, filter ListFilter) ([]model.Host, int, error) {
	whereParts := []string{"user_id = $1", "archived_at IS NULL", "status = 'active'"}
	args := []any{userID}

	if filter.Keyword != "" {
		args = append(args, "%"+filter.Keyword+"%")
		whereParts = append(whereParts, fmt.Sprintf("(name ILIKE $%d OR host ILIKE $%d OR username ILIKE $%d)", len(args), len(args), len(args)))
	}
	if filter.FavoriteOnly {
		whereParts = append(whereParts, "is_favorite = TRUE")
	}
	if filter.GroupID != "" {
		args = append(args, filter.GroupID)
		whereParts = append(whereParts, fmt.Sprintf("group_id = $%d", len(args)))
	}

	whereClause := strings.Join(whereParts, " AND ")
	countQuery := "SELECT COUNT(*) FROM hosts WHERE " + whereClause

	var total int
	if err := r.db.SQL.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count hosts: %w", err)
	}

	args = append(args, filter.Limit, filter.Offset)
	query := `
		SELECT id, user_id, group_id, credential_id, name, host, port, username, auth_type, status, is_favorite, last_connected_at, archived_at, created_at, updated_at
		FROM hosts
		WHERE ` + whereClause + `
		ORDER BY created_at DESC
		LIMIT $` + fmt.Sprint(len(args)-1) + ` OFFSET $` + fmt.Sprint(len(args))

	rows, err := r.db.SQL.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list hosts: %w", err)
	}
	defer rows.Close()

	var items []model.Host
	for rows.Next() {
		item, scanErr := scanHost(rows)
		if scanErr != nil {
			return nil, 0, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate hosts: %w", err)
	}
	return items, total, nil
}

func (r *PostgresRepository) Create(ctx context.Context, host model.Host) (model.Host, error) {
	const query = `
		INSERT INTO hosts (
			user_id, group_id, credential_id, name, host, port, username, auth_type, status, is_favorite
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, user_id, group_id, credential_id, name, host, port, username, auth_type, status, is_favorite, last_connected_at, archived_at, created_at, updated_at
	`

	row := r.db.SQL.QueryRowContext(
		ctx,
		query,
		host.UserID,
		host.GroupID,
		host.CredentialID,
		host.Name,
		host.Host,
		host.Port,
		host.Username,
		host.AuthType,
		host.Status,
		host.IsFavorite,
	)
	item, err := scanHost(row)
	if err != nil {
		return model.Host{}, err
	}
	return item, nil
}

func (r *PostgresRepository) Update(ctx context.Context, host model.Host) (model.Host, error) {
	const query = `
		UPDATE hosts
		SET group_id = $3,
		    credential_id = $4,
		    name = $5,
		    host = $6,
		    port = $7,
		    username = $8,
		    auth_type = $9,
		    is_favorite = $10
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
		RETURNING id, user_id, group_id, credential_id, name, host, port, username, auth_type, status, is_favorite, last_connected_at, archived_at, created_at, updated_at
	`

	row := r.db.SQL.QueryRowContext(
		ctx,
		query,
		host.ID,
		host.UserID,
		host.GroupID,
		host.CredentialID,
		host.Name,
		host.Host,
		host.Port,
		host.Username,
		host.AuthType,
		host.IsFavorite,
	)
	item, err := scanHost(row)
	if err != nil {
		return model.Host{}, err
	}
	return item, nil
}

func (r *PostgresRepository) Delete(ctx context.Context, userID, hostID string) error {
	const query = `
		UPDATE hosts
		SET status = 'archived', archived_at = $3
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
	`

	result, err := r.db.SQL.ExecContext(ctx, query, hostID, userID, time.Now())
	if err != nil {
		return fmt.Errorf("archive host: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) GetByID(ctx context.Context, userID, hostID string) (model.Host, error) {
	const query = `
		SELECT id, user_id, group_id, credential_id, name, host, port, username, auth_type, status, is_favorite, last_connected_at, archived_at, created_at, updated_at
		FROM hosts
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
	`

	row := r.db.SQL.QueryRowContext(ctx, query, hostID, userID)
	item, err := scanHost(row)
	if err != nil {
		return model.Host{}, err
	}
	return item, nil
}

func (r *PostgresRepository) ListFingerprintsByHostID(ctx context.Context, hostID string) ([]model.HostFingerprint, error) {
	const query = `
		SELECT id, host_id, algorithm, fingerprint, status, first_seen_at, last_verified_at, created_at, updated_at
		FROM host_fingerprints
		WHERE host_id = $1
		ORDER BY
			CASE status
				WHEN 'trusted' THEN 1
				WHEN 'changed' THEN 2
				WHEN 'revoked' THEN 3
				ELSE 4
			END,
			updated_at DESC
	`

	rows, err := r.db.SQL.QueryContext(ctx, query, hostID)
	if err != nil {
		return nil, fmt.Errorf("list host fingerprints: %w", err)
	}
	defer rows.Close()

	var items []model.HostFingerprint
	for rows.Next() {
		item, scanErr := scanHostFingerprint(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate host fingerprints: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) GetPrimaryFingerprintByHostID(ctx context.Context, hostID string) (model.HostFingerprint, error) {
	const query = `
		SELECT id, host_id, algorithm, fingerprint, status, first_seen_at, last_verified_at, created_at, updated_at
		FROM host_fingerprints
		WHERE host_id = $1
		ORDER BY
			CASE status
				WHEN 'trusted' THEN 1
				WHEN 'changed' THEN 2
				WHEN 'revoked' THEN 3
				ELSE 4
			END,
			updated_at DESC
		LIMIT 1
	`

	row := r.db.SQL.QueryRowContext(ctx, query, hostID)
	return scanHostFingerprint(row)
}

func (r *PostgresRepository) UpsertFingerprint(ctx context.Context, hostID, algorithm, fingerprint, status string) (model.HostFingerprint, error) {
	const query = `
		INSERT INTO host_fingerprints (host_id, algorithm, fingerprint, status, last_verified_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (host_id, algorithm)
		DO UPDATE SET
			fingerprint = EXCLUDED.fingerprint,
			status = EXCLUDED.status,
			last_verified_at = now()
		RETURNING id, host_id, algorithm, fingerprint, status, first_seen_at, last_verified_at, created_at, updated_at
	`

	row := r.db.SQL.QueryRowContext(ctx, query, hostID, algorithm, fingerprint, status)
	return scanHostFingerprint(row)
}

func (r *PostgresRepository) UpdateLastConnectedAt(ctx context.Context, userID, hostID string, connectedAt time.Time) error {
	const query = `
		UPDATE hosts
		SET last_connected_at = $3
		WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
	`

	result, err := r.db.SQL.ExecContext(ctx, query, hostID, userID, connectedAt)
	if err != nil {
		return fmt.Errorf("update host last_connected_at: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func scanHost(scanner interface {
	Scan(dest ...any) error
}) (model.Host, error) {
	var item model.Host
	var groupID sql.NullString
	var credentialID sql.NullString
	var lastConnectedAt sql.NullTime
	var archivedAt sql.NullTime
	if err := scanner.Scan(
		&item.ID,
		&item.UserID,
		&groupID,
		&credentialID,
		&item.Name,
		&item.Host,
		&item.Port,
		&item.Username,
		&item.AuthType,
		&item.Status,
		&item.IsFavorite,
		&lastConnectedAt,
		&archivedAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.Host{}, db.ErrNotFound
		}
		return model.Host{}, fmt.Errorf("scan host: %w", err)
	}
	item.GroupID = nullStringPtr(groupID)
	item.CredentialID = nullStringPtr(credentialID)
	item.LastConnectedAt = nullTimePtr(lastConnectedAt)
	item.ArchivedAt = nullTimePtr(archivedAt)
	return item, nil
}

func scanHostFingerprint(scanner interface {
	Scan(dest ...any) error
}) (model.HostFingerprint, error) {
	var item model.HostFingerprint
	var lastVerifiedAt sql.NullTime
	if err := scanner.Scan(
		&item.ID,
		&item.HostID,
		&item.Algorithm,
		&item.Fingerprint,
		&item.Status,
		&item.FirstSeenAt,
		&lastVerifiedAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.HostFingerprint{}, db.ErrNotFound
		}
		return model.HostFingerprint{}, fmt.Errorf("scan host fingerprint: %w", err)
	}
	item.LastVerifiedAt = nullTimePtr(lastVerifiedAt)
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
