package connection

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

func createCredential(ctx context.Context, tx *sql.Tx, item model.Credential) (model.Credential, error) {
	const query = `
		INSERT INTO credentials (
			user_id, name, auth_type, encrypted_secret, encrypted_private_key, encrypted_passphrase, key_version
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, user_id, name, auth_type, encrypted_secret, encrypted_private_key, encrypted_passphrase, key_version, created_at, updated_at
	`

	return scanCredential(tx.QueryRowContext(
		ctx,
		query,
		item.UserID,
		item.Name,
		item.AuthType,
		item.EncryptedSecret,
		item.EncryptedPrivateKey,
		item.EncryptedPassphrase,
		item.KeyVersion,
	))
}

func getCredentialForUser(ctx context.Context, tx *sql.Tx, userID, credentialID string) (model.Credential, error) {
	const query = `
		SELECT id, user_id, name, auth_type, encrypted_secret, encrypted_private_key, encrypted_passphrase, key_version, created_at, updated_at
		FROM credentials
		WHERE id = $1 AND user_id = $2
	`

	return scanCredential(tx.QueryRowContext(ctx, query, credentialID, userID))
}

func ensureHostGroup(ctx context.Context, tx *sql.Tx, userID, groupID string) error {
	const query = `SELECT id FROM host_groups WHERE id = $1 AND user_id = $2`

	var id string
	if err := tx.QueryRowContext(ctx, query, groupID, userID).Scan(&id); err != nil {
		if err == sql.ErrNoRows {
			return ErrInvalidInput
		}
		return fmt.Errorf("get host group: %w", err)
	}
	return nil
}

func createHost(ctx context.Context, tx *sql.Tx, item model.Host) (model.Host, error) {
	const query = `
		INSERT INTO hosts (
			user_id, group_id, credential_id, name, host, port, username, auth_type, status, is_favorite
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, user_id, group_id, credential_id, name, host, port, username, auth_type, status, is_favorite, last_connected_at, archived_at, created_at, updated_at
	`

	return scanHost(tx.QueryRowContext(
		ctx,
		query,
		item.UserID,
		item.GroupID,
		item.CredentialID,
		item.Name,
		item.Host,
		item.Port,
		item.Username,
		item.AuthType,
		item.Status,
		item.IsFavorite,
	))
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
