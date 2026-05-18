package credential

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type ListFilter struct {
	Limit    int
	Offset   int
	AuthType string
}

type KeyVersionCount struct {
	KeyVersion int
	Count      int
}

type Repository interface {
	ListByUserID(ctx context.Context, userID string, filter ListFilter) ([]model.Credential, int, error)
	Create(ctx context.Context, credential model.Credential) (model.Credential, error)
	Update(ctx context.Context, credential model.Credential) (model.Credential, error)
	Delete(ctx context.Context, userID, credentialID string) error
	GetByID(ctx context.Context, userID, credentialID string) (model.Credential, error)
}

type PostgresRepository struct {
	db *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{db: database}
}

func (r *PostgresRepository) ListByUserID(ctx context.Context, userID string, filter ListFilter) ([]model.Credential, int, error) {
	whereParts := []string{"user_id = $1"}
	args := []any{userID}

	if filter.AuthType != "" {
		args = append(args, filter.AuthType)
		whereParts = append(whereParts, fmt.Sprintf("auth_type = $%d", len(args)))
	}

	whereClause := strings.Join(whereParts, " AND ")
	countQuery := "SELECT COUNT(*) FROM credentials WHERE " + whereClause

	var total int
	if err := r.db.SQL.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count credentials: %w", err)
	}

	args = append(args, filter.Limit, filter.Offset)
	query := `
		SELECT id, user_id, name, auth_type, encrypted_secret, encrypted_private_key, encrypted_passphrase, key_version, created_at, updated_at
		FROM credentials
		WHERE ` + whereClause + `
		ORDER BY created_at DESC
		LIMIT $` + fmt.Sprint(len(args)-1) + ` OFFSET $` + fmt.Sprint(len(args))

	rows, err := r.db.SQL.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list credentials: %w", err)
	}
	defer rows.Close()

	var items []model.Credential
	for rows.Next() {
		item, scanErr := scanCredential(rows)
		if scanErr != nil {
			return nil, 0, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate credentials: %w", err)
	}

	return items, total, nil
}

func (r *PostgresRepository) Create(ctx context.Context, credential model.Credential) (model.Credential, error) {
	const query = `
		INSERT INTO credentials (
			user_id, name, auth_type, encrypted_secret, encrypted_private_key, encrypted_passphrase, key_version
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, user_id, name, auth_type, encrypted_secret, encrypted_private_key, encrypted_passphrase, key_version, created_at, updated_at
	`

	row := r.db.SQL.QueryRowContext(
		ctx,
		query,
		credential.UserID,
		credential.Name,
		credential.AuthType,
		credential.EncryptedSecret,
		credential.EncryptedPrivateKey,
		credential.EncryptedPassphrase,
		credential.KeyVersion,
	)
	item, err := scanCredential(row)
	if err != nil {
		return model.Credential{}, err
	}
	return item, nil
}

func (r *PostgresRepository) Update(ctx context.Context, credential model.Credential) (model.Credential, error) {
	const query = `
		UPDATE credentials
		SET name = $3,
		    auth_type = $4,
		    encrypted_secret = $5,
		    encrypted_private_key = $6,
		    encrypted_passphrase = $7,
		    key_version = $8
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, name, auth_type, encrypted_secret, encrypted_private_key, encrypted_passphrase, key_version, created_at, updated_at
	`

	row := r.db.SQL.QueryRowContext(
		ctx,
		query,
		credential.ID,
		credential.UserID,
		credential.Name,
		credential.AuthType,
		credential.EncryptedSecret,
		credential.EncryptedPrivateKey,
		credential.EncryptedPassphrase,
		credential.KeyVersion,
	)
	item, err := scanCredential(row)
	if err != nil {
		return model.Credential{}, err
	}
	return item, nil
}

func (r *PostgresRepository) Delete(ctx context.Context, userID, credentialID string) error {
	const query = `DELETE FROM credentials WHERE id = $1 AND user_id = $2`

	result, err := r.db.SQL.ExecContext(ctx, query, credentialID, userID)
	if err != nil {
		return fmt.Errorf("delete credential: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) GetByID(ctx context.Context, userID, credentialID string) (model.Credential, error) {
	const query = `
		SELECT id, user_id, name, auth_type, encrypted_secret, encrypted_private_key, encrypted_passphrase, key_version, created_at, updated_at
		FROM credentials
		WHERE id = $1 AND user_id = $2
	`

	row := r.db.SQL.QueryRowContext(ctx, query, credentialID, userID)
	item, err := scanCredential(row)
	if err != nil {
		if err == sql.ErrNoRows || db.IsNotFound(err) {
			return model.Credential{}, db.ErrNotFound
		}
		return model.Credential{}, err
	}
	return item, nil
}

func (r *PostgresRepository) CountByKeyVersion(ctx context.Context) ([]KeyVersionCount, error) {
	const query = `
		SELECT key_version, COUNT(*)
		FROM credentials
		GROUP BY key_version
		ORDER BY key_version
	`

	rows, err := r.db.SQL.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("count credentials by key version: %w", err)
	}
	defer rows.Close()

	var counts []KeyVersionCount
	for rows.Next() {
		var count KeyVersionCount
		if err := rows.Scan(&count.KeyVersion, &count.Count); err != nil {
			return nil, fmt.Errorf("scan credential key version count: %w", err)
		}
		counts = append(counts, count)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate credential key version counts: %w", err)
	}

	return counts, nil
}

func scanCredential(scanner interface {
	Scan(dest ...any) error
}) (model.Credential, error) {
	var item model.Credential
	var secret sql.NullString
	var privateKey sql.NullString
	var passphrase sql.NullString
	if err := scanner.Scan(
		&item.ID,
		&item.UserID,
		&item.Name,
		&item.AuthType,
		&secret,
		&privateKey,
		&passphrase,
		&item.KeyVersion,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.Credential{}, db.ErrNotFound
		}
		return model.Credential{}, fmt.Errorf("scan credential: %w", err)
	}
	item.EncryptedSecret = nullStringPtr(secret)
	item.EncryptedPrivateKey = nullStringPtr(privateKey)
	item.EncryptedPassphrase = nullStringPtr(passphrase)
	return item, nil
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
