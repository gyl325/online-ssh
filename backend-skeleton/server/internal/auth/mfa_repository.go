package auth

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
)

func (r *PostgresRepository) GetMFASettings(ctx context.Context, userID string) (MFASettingsRecord, error) {
	const query = `
		SELECT
			user_id,
			totp_enabled,
			COALESCE(totp_secret_encrypted, ''),
			COALESCE(totp_secret_key_version, 0),
			totp_confirmed_at,
			COALESCE(pending_totp_secret_encrypted, ''),
			COALESCE(pending_totp_secret_key_version, 0),
			pending_totp_expires_at,
			last_used_at
		FROM user_mfa_settings
		WHERE user_id = $1
	`
	var record MFASettingsRecord
	var confirmedAt sql.NullTime
	var pendingExpiresAt sql.NullTime
	var lastUsedAt sql.NullTime
	err := r.db.SQL.QueryRowContext(ctx, query, userID).Scan(
		&record.UserID,
		&record.TOTPEnabled,
		&record.TOTPSecretCipher,
		&record.TOTPSecretKeyVersion,
		&confirmedAt,
		&record.PendingTOTPSecretCipher,
		&record.PendingTOTPSecretVersion,
		&pendingExpiresAt,
		&lastUsedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return MFASettingsRecord{}, db.ErrNotFound
		}
		return MFASettingsRecord{}, fmt.Errorf("get mfa settings: %w", err)
	}
	record.TOTPConfirmedAt = nullTimePtr(confirmedAt)
	record.PendingTOTPExpiresAt = nullTimePtr(pendingExpiresAt)
	record.LastUsedAt = nullTimePtr(lastUsedAt)
	return record, nil
}

func (r *PostgresRepository) SavePendingTOTPSecret(ctx context.Context, input SavePendingTOTPSecretInput) error {
	const query = `
		INSERT INTO user_mfa_settings (
			user_id,
			pending_totp_secret_encrypted,
			pending_totp_secret_key_version,
			pending_totp_expires_at
		)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE
		SET
			pending_totp_secret_encrypted = EXCLUDED.pending_totp_secret_encrypted,
			pending_totp_secret_key_version = EXCLUDED.pending_totp_secret_key_version,
			pending_totp_expires_at = EXCLUDED.pending_totp_expires_at
	`
	if _, err := r.db.SQL.ExecContext(ctx, query, input.UserID, input.SecretCipher, input.SecretKeyVersion, input.ExpiresAt); err != nil {
		return fmt.Errorf("save pending totp secret: %w", err)
	}
	return nil
}

func (r *PostgresRepository) EnableMFA(ctx context.Context, input EnableMFAInput, codes []CreateMFARecoveryCodeInput) error {
	tx, err := r.db.SQL.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin enable mfa tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	const updateSettings = `
		UPDATE user_mfa_settings
		SET
			totp_enabled = TRUE,
			totp_secret_encrypted = $2,
			totp_secret_key_version = $3,
			totp_confirmed_at = $4,
			pending_totp_secret_encrypted = NULL,
			pending_totp_secret_key_version = NULL,
			pending_totp_expires_at = NULL
		WHERE user_id = $1
	`
	result, err := tx.ExecContext(ctx, updateSettings, input.UserID, input.TOTPSecretCipher, input.TOTPSecretKeyVersion, input.ConfirmedAt)
	if err != nil {
		return fmt.Errorf("enable mfa settings: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_mfa_recovery_codes WHERE user_id = $1`, input.UserID); err != nil {
		return fmt.Errorf("delete old recovery codes: %w", err)
	}
	if err := insertRecoveryCodesTx(ctx, tx, codes); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepository) DisableMFA(ctx context.Context, userID string) error {
	tx, err := r.db.SQL.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin disable mfa tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	const updateSettings = `
		UPDATE user_mfa_settings
		SET
			totp_enabled = FALSE,
			totp_secret_encrypted = NULL,
			totp_secret_key_version = NULL,
			totp_confirmed_at = NULL,
			pending_totp_secret_encrypted = NULL,
			pending_totp_secret_key_version = NULL,
			pending_totp_expires_at = NULL,
			last_used_at = NULL
		WHERE user_id = $1
	`
	if _, err := tx.ExecContext(ctx, updateSettings, userID); err != nil {
		return fmt.Errorf("disable mfa settings: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_mfa_recovery_codes WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("delete mfa recovery codes: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_mfa_tokens WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("delete mfa tokens: %w", err)
	}
	return tx.Commit()
}

func (r *PostgresRepository) ReplaceMFARecoveryCodes(ctx context.Context, userID string, codes []CreateMFARecoveryCodeInput) error {
	tx, err := r.db.SQL.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin replace recovery codes tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_mfa_recovery_codes WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("delete recovery codes: %w", err)
	}
	if err := insertRecoveryCodesTx(ctx, tx, codes); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *PostgresRepository) CountUnusedMFARecoveryCodes(ctx context.Context, userID string) (int, error) {
	var count int
	err := r.db.SQL.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, userID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count unused recovery codes: %w", err)
	}
	return count, nil
}

func (r *PostgresRepository) ListUnusedMFARecoveryCodes(ctx context.Context, userID string) ([]MFARecoveryCodeRecord, error) {
	rows, err := r.db.SQL.QueryContext(ctx, `
		SELECT id, user_id, code_hash, used_at
		FROM user_mfa_recovery_codes
		WHERE user_id = $1 AND used_at IS NULL
		ORDER BY created_at ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list unused recovery codes: %w", err)
	}
	defer rows.Close()

	var items []MFARecoveryCodeRecord
	for rows.Next() {
		var item MFARecoveryCodeRecord
		var usedAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.UserID, &item.CodeHash, &usedAt); err != nil {
			return nil, fmt.Errorf("scan recovery code: %w", err)
		}
		item.UsedAt = nullTimePtr(usedAt)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate recovery codes: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) ConsumeMFARecoveryCode(ctx context.Context, id string, usedAt time.Time) error {
	result, err := r.db.SQL.ExecContext(ctx, `
		UPDATE user_mfa_recovery_codes
		SET used_at = $2
		WHERE id = $1 AND used_at IS NULL
	`, id, usedAt)
	if err != nil {
		return fmt.Errorf("consume recovery code: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) MarkMFAUsed(ctx context.Context, userID string, usedAt time.Time) error {
	if _, err := r.db.SQL.ExecContext(ctx, `UPDATE user_mfa_settings SET last_used_at = $2 WHERE user_id = $1`, userID, usedAt); err != nil {
		return fmt.Errorf("mark mfa used: %w", err)
	}
	return nil
}

func (r *PostgresRepository) CreateMFAToken(ctx context.Context, input CreateMFATokenInput) (MFATokenRecord, error) {
	const query = `
		INSERT INTO user_mfa_tokens (user_id, token_hash, login_method, client_ip, user_agent, expires_at, max_attempts)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, user_id, token_hash, login_method, host(client_ip), user_agent, attempts, max_attempts, expires_at, consumed_at, created_at
	`
	return scanMFAToken(r.db.SQL.QueryRowContext(ctx, query, input.UserID, input.TokenHash, input.LoginMethod, input.ClientIP, input.UserAgent, input.ExpiresAt, input.MaxAttempts))
}

func (r *PostgresRepository) GetMFATokenByHash(ctx context.Context, tokenHash string, now time.Time) (MFATokenRecord, error) {
	const query = `
		SELECT
			t.id,
			t.user_id,
			t.token_hash,
			t.login_method,
			host(t.client_ip),
			t.user_agent,
			t.attempts,
			t.max_attempts,
			t.expires_at,
			t.consumed_at,
			t.created_at,
			u.id,
			u.email,
			u.password_hash,
			u.display_name,
			u.preferred_locale,
			u.theme,
			u.status,
			u.role,
			u.last_login_at,
			u.created_at,
			u.updated_at
		FROM user_mfa_tokens t
		JOIN users u ON u.id = t.user_id
		WHERE t.token_hash = $1 AND t.expires_at > $2 AND t.consumed_at IS NULL
	`
	record, err := scanMFATokenWithUser(ctx, r, r.db.SQL.QueryRowContext(ctx, query, tokenHash, now))
	if err != nil {
		return MFATokenRecord{}, err
	}
	return record, nil
}

func (r *PostgresRepository) IncrementMFATokenAttempts(ctx context.Context, id string) error {
	result, err := r.db.SQL.ExecContext(ctx, `UPDATE user_mfa_tokens SET attempts = attempts + 1 WHERE id = $1 AND consumed_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("increment mfa token attempts: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) ConsumeMFAToken(ctx context.Context, id string, consumedAt time.Time) error {
	result, err := r.db.SQL.ExecContext(ctx, `UPDATE user_mfa_tokens SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL`, id, consumedAt)
	if err != nil {
		return fmt.Errorf("consume mfa token: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) CountRecentMFAFailures(ctx context.Context, input CountRecentMFAFailuresInput) (int, error) {
	where := `user_id = $1 AND created_at >= $2`
	args := []any{input.UserID, input.Since}
	if input.ClientIP != nil && *input.ClientIP != "" {
		where += ` AND client_ip = $3`
		args = append(args, *input.ClientIP)
	}
	var count int
	if err := r.db.SQL.QueryRowContext(ctx, `SELECT COALESCE(SUM(attempts), 0)::int FROM user_mfa_tokens WHERE `+where, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("count recent mfa failures: %w", err)
	}
	return count, nil
}

func insertRecoveryCodesTx(ctx context.Context, tx interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, codes []CreateMFARecoveryCodeInput) error {
	for _, code := range codes {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_mfa_recovery_codes (user_id, code_hash)
			VALUES ($1, $2)
		`, code.UserID, code.CodeHash); err != nil {
			return fmt.Errorf("insert recovery code: %w", err)
		}
	}
	return nil
}

func scanMFAToken(scanner interface{ Scan(...any) error }) (MFATokenRecord, error) {
	var record MFATokenRecord
	var clientIP sql.NullString
	var userAgent sql.NullString
	var consumedAt sql.NullTime
	err := scanner.Scan(
		&record.ID,
		&record.UserID,
		&record.TokenHash,
		&record.LoginMethod,
		&clientIP,
		&userAgent,
		&record.Attempts,
		&record.MaxAttempts,
		&record.ExpiresAt,
		&consumedAt,
		&record.CreatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return MFATokenRecord{}, db.ErrNotFound
		}
		return MFATokenRecord{}, fmt.Errorf("scan mfa token: %w", err)
	}
	record.ClientIP = nullStringPtr(clientIP)
	record.UserAgent = nullStringPtr(userAgent)
	record.ConsumedAt = nullTimePtr(consumedAt)
	return record, nil
}

func scanMFATokenWithUser(ctx context.Context, r *PostgresRepository, scanner interface{ Scan(...any) error }) (MFATokenRecord, error) {
	var record MFATokenRecord
	var clientIP sql.NullString
	var userAgent sql.NullString
	var consumedAt sql.NullTime
	var lastLogin sql.NullTime
	err := scanner.Scan(
		&record.ID,
		&record.UserID,
		&record.TokenHash,
		&record.LoginMethod,
		&clientIP,
		&userAgent,
		&record.Attempts,
		&record.MaxAttempts,
		&record.ExpiresAt,
		&consumedAt,
		&record.CreatedAt,
		&record.User.ID,
		&record.User.Email,
		&record.User.PasswordHash,
		&record.User.DisplayName,
		&record.User.PreferredLocale,
		&record.User.Theme,
		&record.User.Status,
		&record.User.Role,
		&lastLogin,
		&record.User.CreatedAt,
		&record.User.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return MFATokenRecord{}, db.ErrNotFound
		}
		return MFATokenRecord{}, fmt.Errorf("scan mfa token with user: %w", err)
	}
	record.ClientIP = nullStringPtr(clientIP)
	record.UserAgent = nullStringPtr(userAgent)
	record.ConsumedAt = nullTimePtr(consumedAt)
	record.User.LastLoginAt = nullTimePtr(lastLogin)
	record.User.AuthType = "password"
	if err := r.populatePermissions(ctx, &record.User); err != nil {
		return MFATokenRecord{}, err
	}
	return record, nil
}
