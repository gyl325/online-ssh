package auth

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type Repository interface {
	CreateUser(ctx context.Context, user CreateUserInput) (UserRecord, error)
	GetUserByID(ctx context.Context, userID string) (UserRecord, error)
	GetUserByEmail(ctx context.Context, email string) (UserRecord, error)
	GetUserByLoginIdentifier(ctx context.Context, identifier string) (UserRecord, error)
	UpdateUserPassword(ctx context.Context, userID string, passwordHash string) error
	UpdateUserEmail(ctx context.Context, userID string, email string) (UserRecord, error)
	DeleteUser(ctx context.Context, userID string) error
	CountUsersWithPermission(ctx context.Context, permission string) (int, error)
	UpdateLastLogin(ctx context.Context, userID string, at time.Time) error
	CreateSession(ctx context.Context, session CreateSessionInput) (SessionRecord, error)
	GetActiveSessionByTokenHash(ctx context.Context, tokenHash string, now time.Time) (SessionRecord, error)
	GetSessionByTokenHash(ctx context.Context, tokenHash string) (SessionRecord, error)
	RotateSessionByRefreshTokenHash(ctx context.Context, input RotateSessionInput) (SessionRecord, error)
	RevokeSession(ctx context.Context, sessionID string, revokedAt time.Time) error
	RevokeOtherSessions(ctx context.Context, userID string, keepSessionID string, revokedAt time.Time) (int, error)
	RevokeSessionByRefreshTokenHash(ctx context.Context, refreshTokenHash string, revokedAt time.Time) (SessionRecord, error)
	CreateEmailVerificationCode(ctx context.Context, input CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error)
	CountEmailVerificationCodeSends(ctx context.Context, input CountEmailVerificationCodeSendsInput) (int, error)
	GetLatestEmailVerificationCode(ctx context.Context, input GetLatestEmailVerificationCodeInput) (EmailVerificationCodeRecord, error)
	IncrementEmailVerificationCodeAttempts(ctx context.Context, id string) error
	ConsumeEmailVerificationCode(ctx context.Context, id string, consumedAt time.Time) error
	GetMFASettings(ctx context.Context, userID string) (MFASettingsRecord, error)
	SavePendingTOTPSecret(ctx context.Context, input SavePendingTOTPSecretInput) error
	EnableMFA(ctx context.Context, input EnableMFAInput, codes []CreateMFARecoveryCodeInput) error
	DisableMFA(ctx context.Context, userID string) error
	ReplaceMFARecoveryCodes(ctx context.Context, userID string, codes []CreateMFARecoveryCodeInput) error
	CountUnusedMFARecoveryCodes(ctx context.Context, userID string) (int, error)
	ListUnusedMFARecoveryCodes(ctx context.Context, userID string) ([]MFARecoveryCodeRecord, error)
	ConsumeMFARecoveryCode(ctx context.Context, id string, usedAt time.Time) error
	MarkMFAUsed(ctx context.Context, userID string, usedAt time.Time) error
	CreateMFAToken(ctx context.Context, input CreateMFATokenInput) (MFATokenRecord, error)
	GetMFATokenByHash(ctx context.Context, tokenHash string, now time.Time) (MFATokenRecord, error)
	IncrementMFATokenAttempts(ctx context.Context, id string) error
	ConsumeMFAToken(ctx context.Context, id string, consumedAt time.Time) error
	CountRecentMFAFailures(ctx context.Context, input CountRecentMFAFailuresInput) (int, error)
}

type UserRecord struct {
	ID              string
	Email           string
	PasswordHash    string
	DisplayName     string
	PreferredLocale string
	Theme           string
	Status          string
	Role            string
	AuthType        string
	Permissions     []string
	LastLoginAt     *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type SessionRecord struct {
	ID               string
	UserID           string
	SessionTokenHash string
	RefreshTokenHash *string
	ClientIP         *string
	UserAgent        *string
	DeviceLabel      *string
	LoginMethod      string
	LastSeenAt       time.Time
	ExpiresAt        time.Time
	RefreshExpiresAt *time.Time
	RefreshRotatedAt *time.Time
	RevokedAt        *time.Time
	CreatedAt        time.Time
	User             UserRecord
}

type CreateUserInput struct {
	Email        string
	PasswordHash string
	DisplayName  string
	Role         string
}

type CreateSessionInput struct {
	UserID           string
	SessionTokenHash string
	RefreshTokenHash *string
	ClientIP         *string
	UserAgent        *string
	DeviceLabel      *string
	LoginMethod      string
	ExpiresAt        time.Time
	RefreshExpiresAt *time.Time
}

type RotateSessionInput struct {
	RefreshTokenHash    string
	NewSessionTokenHash string
	NewRefreshTokenHash string
	ClientIP            *string
	UserAgent           *string
	DeviceLabel         *string
	ExpiresAt           time.Time
	IdleSince           time.Time
	Now                 time.Time
}

type EmailVerificationPurpose string

const (
	EmailVerificationPurposeRegister     EmailVerificationPurpose = "register"
	EmailVerificationPurposeLogin        EmailVerificationPurpose = "login"
	EmailVerificationPurposeEmailCurrent EmailVerificationPurpose = "email_change_current"
	EmailVerificationPurposeEmailNew     EmailVerificationPurpose = "email_change_new"
)

type EmailVerificationCodeRecord struct {
	ID          string
	Email       string
	Purpose     EmailVerificationPurpose
	CodeHash    string
	ClientIP    *string
	Attempts    int
	MaxAttempts int
	ExpiresAt   time.Time
	ConsumedAt  *time.Time
	CreatedAt   time.Time
}

type CreateEmailVerificationCodeInput struct {
	Email       string
	Purpose     EmailVerificationPurpose
	CodeHash    string
	ClientIP    *string
	ExpiresAt   time.Time
	MaxAttempts int
}

type CountEmailVerificationCodeSendsInput struct {
	Email    string
	ClientIP *string
	Since    time.Time
}

type GetLatestEmailVerificationCodeInput struct {
	Email   string
	Purpose EmailVerificationPurpose
	Now     time.Time
}

type PostgresRepository struct {
	db *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{db: database}
}

func (r *PostgresRepository) CreateUser(ctx context.Context, input CreateUserInput) (UserRecord, error) {
	role := strings.TrimSpace(input.Role)
	if role == "" {
		role = string(model.UserRoleUser)
	}

	const query = `
		INSERT INTO users (email, password_hash, display_name, role)
		VALUES ($1, $2, $3, $4)
		RETURNING id, email, password_hash, display_name, preferred_locale, theme, status, role, last_login_at, created_at, updated_at
	`

	var record UserRecord
	var lastLogin sql.NullTime
	err := r.db.SQL.QueryRowContext(ctx, query, input.Email, input.PasswordHash, input.DisplayName, role).Scan(
		&record.ID,
		&record.Email,
		&record.PasswordHash,
		&record.DisplayName,
		&record.PreferredLocale,
		&record.Theme,
		&record.Status,
		&record.Role,
		&lastLogin,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		return UserRecord{}, fmt.Errorf("create user: %w", err)
	}
	record.LastLoginAt = nullTimePtr(lastLogin)
	record.AuthType = "password"
	if err := r.populatePermissions(ctx, &record); err != nil {
		return UserRecord{}, err
	}
	return record, nil
}

func (r *PostgresRepository) GetUserByID(ctx context.Context, userID string) (UserRecord, error) {
	const query = `
		SELECT id, email, password_hash, display_name, preferred_locale, theme, status, role, last_login_at, created_at, updated_at
		FROM users
		WHERE id = $1
	`
	return r.scanUser(ctx, r.db.SQL.QueryRowContext(ctx, query, userID), "get user by id")
}

func (r *PostgresRepository) GetUserByEmail(ctx context.Context, email string) (UserRecord, error) {
	const query = `
		SELECT id, email, password_hash, display_name, preferred_locale, theme, status, role, last_login_at, created_at, updated_at
		FROM users
		WHERE email = $1
	`
	return r.scanUser(ctx, r.db.SQL.QueryRowContext(ctx, query, email), "get user by email")
}

func (r *PostgresRepository) GetUserByLoginIdentifier(ctx context.Context, identifier string) (UserRecord, error) {
	const query = `
		SELECT id, email, password_hash, display_name, preferred_locale, theme, status, role, last_login_at, created_at, updated_at
		FROM users
		WHERE email = $1 OR lower(display_name) = lower($1)
		ORDER BY CASE WHEN email = $1 THEN 0 ELSE 1 END
		LIMIT 1
	`
	return r.scanUser(ctx, r.db.SQL.QueryRowContext(ctx, query, identifier), "get user by login identifier")
}

func (r *PostgresRepository) UpdateUserPassword(ctx context.Context, userID string, passwordHash string) error {
	const query = `
		UPDATE users
		SET password_hash = $2
		WHERE id = $1
	`
	result, err := r.db.SQL.ExecContext(ctx, query, userID, passwordHash)
	if err != nil {
		return fmt.Errorf("update user password: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) UpdateUserEmail(ctx context.Context, userID string, email string) (UserRecord, error) {
	const query = `
		UPDATE users
		SET email = $2
		WHERE id = $1
		RETURNING id, email, password_hash, display_name, preferred_locale, theme, status, role, last_login_at, created_at, updated_at
	`
	return r.scanUser(ctx, r.db.SQL.QueryRowContext(ctx, query, userID, email), "update user email")
}

func (r *PostgresRepository) DeleteUser(ctx context.Context, userID string) error {
	result, err := r.db.SQL.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) CountUsersWithPermission(ctx context.Context, permission string) (int, error) {
	const query = `
		SELECT COUNT(DISTINCT u.id)
		FROM users u
		JOIN roles r ON r.key = u.role AND r.is_active = TRUE
		JOIN role_permissions rp ON rp.role_key = r.key AND rp.permission = $1
		WHERE u.status = 'active'
	`
	var count int
	if err := r.db.SQL.QueryRowContext(ctx, query, permission).Scan(&count); err != nil {
		return 0, fmt.Errorf("count users with permission: %w", err)
	}
	return count, nil
}

func (r *PostgresRepository) scanUser(ctx context.Context, row rowScanner, operation string) (UserRecord, error) {
	var record UserRecord
	var lastLogin sql.NullTime
	err := row.Scan(
		&record.ID,
		&record.Email,
		&record.PasswordHash,
		&record.DisplayName,
		&record.PreferredLocale,
		&record.Theme,
		&record.Status,
		&record.Role,
		&lastLogin,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return UserRecord{}, db.ErrNotFound
		}
		return UserRecord{}, fmt.Errorf("%s: %w", operation, err)
	}
	record.LastLoginAt = nullTimePtr(lastLogin)
	record.AuthType = "password"
	if err := r.populatePermissions(ctx, &record); err != nil {
		return UserRecord{}, err
	}
	return record, nil
}

func (r *PostgresRepository) UpdateLastLogin(ctx context.Context, userID string, at time.Time) error {
	const query = `UPDATE users SET last_login_at = $2 WHERE id = $1`

	result, err := r.db.SQL.ExecContext(ctx, query, userID, at)
	if err != nil {
		return fmt.Errorf("update last login: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) CreateSession(ctx context.Context, input CreateSessionInput) (SessionRecord, error) {
	const query = `
		INSERT INTO user_sessions (
			user_id,
			session_token_hash,
			refresh_token_hash,
			client_ip,
			user_agent,
			device_label,
			login_method,
			expires_at,
			refresh_expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, user_id, session_token_hash, refresh_token_hash, client_ip, user_agent, device_label, login_method, last_seen_at, expires_at, refresh_expires_at, refresh_rotated_at, revoked_at, created_at
	`

	var record SessionRecord
	var refreshToken sql.NullString
	var clientIP sql.NullString
	var userAgent sql.NullString
	var deviceLabel sql.NullString
	var refreshExpiresAt sql.NullTime
	var refreshRotatedAt sql.NullTime
	var revokedAt sql.NullTime
	err := r.db.SQL.QueryRowContext(
		ctx,
		query,
		input.UserID,
		input.SessionTokenHash,
		input.RefreshTokenHash,
		input.ClientIP,
		input.UserAgent,
		input.DeviceLabel,
		normalizedLoginMethod(input.LoginMethod),
		input.ExpiresAt,
		input.RefreshExpiresAt,
	).Scan(
		&record.ID,
		&record.UserID,
		&record.SessionTokenHash,
		&refreshToken,
		&clientIP,
		&userAgent,
		&deviceLabel,
		&record.LoginMethod,
		&record.LastSeenAt,
		&record.ExpiresAt,
		&refreshExpiresAt,
		&refreshRotatedAt,
		&revokedAt,
		&record.CreatedAt,
	)
	if err != nil {
		return SessionRecord{}, fmt.Errorf("create session: %w", err)
	}

	record.RefreshTokenHash = nullStringPtr(refreshToken)
	record.ClientIP = nullStringPtr(clientIP)
	record.UserAgent = nullStringPtr(userAgent)
	record.DeviceLabel = nullStringPtr(deviceLabel)
	record.LoginMethod = normalizedLoginMethod(record.LoginMethod)
	record.RefreshExpiresAt = nullTimePtr(refreshExpiresAt)
	record.RefreshRotatedAt = nullTimePtr(refreshRotatedAt)
	record.RevokedAt = nullTimePtr(revokedAt)
	return record, nil
}

func (r *PostgresRepository) GetActiveSessionByTokenHash(ctx context.Context, tokenHash string, now time.Time) (SessionRecord, error) {
	const query = `
		UPDATE user_sessions s
		SET last_seen_at = $2
		FROM users u
		WHERE s.user_id = u.id
		  AND s.session_token_hash = $1
		  AND s.revoked_at IS NULL
		  AND s.expires_at > $2
		RETURNING
			s.id,
			s.user_id,
			s.session_token_hash,
			s.refresh_token_hash,
			s.client_ip,
			s.user_agent,
			s.device_label,
			s.login_method,
			s.last_seen_at,
			s.expires_at,
			s.refresh_expires_at,
			s.refresh_rotated_at,
			s.revoked_at,
			s.created_at,
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
	`

	var record SessionRecord
	var refreshToken sql.NullString
	var clientIP sql.NullString
	var userAgent sql.NullString
	var deviceLabel sql.NullString
	var refreshExpiresAt sql.NullTime
	var refreshRotatedAt sql.NullTime
	var revokedAt sql.NullTime
	var lastLogin sql.NullTime
	err := r.db.SQL.QueryRowContext(ctx, query, tokenHash, now).Scan(
		&record.ID,
		&record.UserID,
		&record.SessionTokenHash,
		&refreshToken,
		&clientIP,
		&userAgent,
		&deviceLabel,
		&record.LoginMethod,
		&record.LastSeenAt,
		&record.ExpiresAt,
		&refreshExpiresAt,
		&refreshRotatedAt,
		&revokedAt,
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
			return SessionRecord{}, db.ErrNotFound
		}
		return SessionRecord{}, fmt.Errorf("get session by token hash: %w", err)
	}

	record.RefreshTokenHash = nullStringPtr(refreshToken)
	record.ClientIP = nullStringPtr(clientIP)
	record.UserAgent = nullStringPtr(userAgent)
	record.DeviceLabel = nullStringPtr(deviceLabel)
	record.LoginMethod = normalizedLoginMethod(record.LoginMethod)
	record.RefreshExpiresAt = nullTimePtr(refreshExpiresAt)
	record.RefreshRotatedAt = nullTimePtr(refreshRotatedAt)
	record.RevokedAt = nullTimePtr(revokedAt)
	record.User.LastLoginAt = nullTimePtr(lastLogin)
	record.User.AuthType = "password"
	if err := r.populatePermissions(ctx, &record.User); err != nil {
		return SessionRecord{}, err
	}
	return record, nil
}

func (r *PostgresRepository) GetSessionByTokenHash(ctx context.Context, tokenHash string) (SessionRecord, error) {
	const query = `
		SELECT
			s.id,
			s.user_id,
			s.session_token_hash,
			s.refresh_token_hash,
			s.client_ip,
			s.user_agent,
			s.device_label,
			s.login_method,
			s.last_seen_at,
			s.expires_at,
			s.refresh_expires_at,
			s.refresh_rotated_at,
			s.revoked_at,
			s.created_at,
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
		FROM user_sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.session_token_hash = $1
	`

	return r.scanSessionWithUser(ctx, r.db.SQL.QueryRowContext(ctx, query, tokenHash), "get session by token hash")
}

func (r *PostgresRepository) RotateSessionByRefreshTokenHash(ctx context.Context, input RotateSessionInput) (SessionRecord, error) {
	const query = `
		UPDATE user_sessions s
		SET session_token_hash = $2,
		    refresh_token_hash = $3,
		    expires_at = $4,
		    client_ip = COALESCE($5, client_ip),
		    user_agent = COALESCE($6, user_agent),
		    device_label = COALESCE($7, device_label),
		    last_seen_at = $8,
		    refresh_rotated_at = $8
		FROM users u
		WHERE s.user_id = u.id
		  AND s.refresh_token_hash = $1
		  AND s.revoked_at IS NULL
		  AND s.refresh_expires_at > $8
		  AND s.last_seen_at >= $9
		  AND u.status = 'active'
		RETURNING
			s.id,
			s.user_id,
			s.session_token_hash,
			s.refresh_token_hash,
			s.client_ip,
			s.user_agent,
			s.device_label,
			s.login_method,
			s.last_seen_at,
			s.expires_at,
			s.refresh_expires_at,
			s.refresh_rotated_at,
			s.revoked_at,
			s.created_at,
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
	`

	return r.scanSessionWithUser(
		ctx,
		r.db.SQL.QueryRowContext(
			ctx,
			query,
			input.RefreshTokenHash,
			input.NewSessionTokenHash,
			input.NewRefreshTokenHash,
			input.ExpiresAt,
			input.ClientIP,
			input.UserAgent,
			input.DeviceLabel,
			input.Now,
			input.IdleSince,
		),
		"rotate session by refresh token hash",
	)
}

func (r *PostgresRepository) RevokeSession(ctx context.Context, sessionID string, revokedAt time.Time) error {
	const query = `
		UPDATE user_sessions
		SET revoked_at = $2, last_seen_at = $2
		WHERE id = $1 AND revoked_at IS NULL
	`

	result, err := r.db.SQL.ExecContext(ctx, query, sessionID, revokedAt)
	if err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) RevokeOtherSessions(ctx context.Context, userID string, keepSessionID string, revokedAt time.Time) (int, error) {
	const query = `
		UPDATE user_sessions
		SET revoked_at = $3, last_seen_at = $3
		WHERE user_id = $1
		  AND id::text <> $2
		  AND created_at <= (
		      SELECT created_at
		      FROM user_sessions
		      WHERE user_id = $1 AND id::text = $2
		  )
		  AND revoked_at IS NULL
	`

	result, err := r.db.SQL.ExecContext(ctx, query, userID, keepSessionID, revokedAt)
	if err != nil {
		return 0, fmt.Errorf("revoke other sessions: %w", err)
	}
	rows, _ := result.RowsAffected()
	return int(rows), nil
}

func (r *PostgresRepository) RevokeSessionByRefreshTokenHash(ctx context.Context, refreshTokenHash string, revokedAt time.Time) (SessionRecord, error) {
	const query = `
		UPDATE user_sessions s
		SET revoked_at = $2, last_seen_at = $2
		FROM users u
		WHERE s.user_id = u.id
		  AND s.refresh_token_hash = $1
		  AND s.revoked_at IS NULL
		RETURNING
			s.id,
			s.user_id,
			s.session_token_hash,
			s.refresh_token_hash,
			s.client_ip,
			s.user_agent,
			s.device_label,
			s.login_method,
			s.last_seen_at,
			s.expires_at,
			s.refresh_expires_at,
			s.refresh_rotated_at,
			s.revoked_at,
			s.created_at,
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
	`

	return r.scanSessionWithUser(
		ctx,
		r.db.SQL.QueryRowContext(ctx, query, refreshTokenHash, revokedAt),
		"revoke session by refresh token hash",
	)
}

func (r *PostgresRepository) CreateEmailVerificationCode(ctx context.Context, input CreateEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
	const query = `
		INSERT INTO email_verification_codes (
			email,
			purpose,
			code_hash,
			client_ip,
			expires_at,
			max_attempts
		)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, email, purpose, code_hash, client_ip, attempts, max_attempts, expires_at, consumed_at, created_at
	`

	return scanEmailVerificationCode(
		r.db.SQL.QueryRowContext(ctx, query, input.Email, string(input.Purpose), input.CodeHash, input.ClientIP, input.ExpiresAt, input.MaxAttempts),
		"create email verification code",
	)
}

func (r *PostgresRepository) CountEmailVerificationCodeSends(ctx context.Context, input CountEmailVerificationCodeSendsInput) (int, error) {
	const query = `
		SELECT COUNT(*)
		FROM email_verification_codes
		WHERE created_at >= $1
		  AND ($2::citext IS NULL OR email = $2)
		  AND ($3::inet IS NULL OR client_ip = $3)
	`
	var email *string
	if strings.TrimSpace(input.Email) != "" {
		value := strings.TrimSpace(input.Email)
		email = &value
	}
	var count int
	if err := r.db.SQL.QueryRowContext(ctx, query, input.Since, email, input.ClientIP).Scan(&count); err != nil {
		return 0, fmt.Errorf("count email verification code sends: %w", err)
	}
	return count, nil
}

func (r *PostgresRepository) GetLatestEmailVerificationCode(ctx context.Context, input GetLatestEmailVerificationCodeInput) (EmailVerificationCodeRecord, error) {
	const query = `
		SELECT id, email, purpose, code_hash, client_ip, attempts, max_attempts, expires_at, consumed_at, created_at
		FROM email_verification_codes
		WHERE email = $1
		  AND purpose = $2
		  AND consumed_at IS NULL
		  AND expires_at > $3
		  AND attempts < max_attempts
		ORDER BY created_at DESC
		LIMIT 1
	`

	return scanEmailVerificationCode(
		r.db.SQL.QueryRowContext(ctx, query, input.Email, string(input.Purpose), input.Now),
		"get latest email verification code",
	)
}

func (r *PostgresRepository) IncrementEmailVerificationCodeAttempts(ctx context.Context, id string) error {
	const query = `UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = $1`
	result, err := r.db.SQL.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("increment email verification code attempts: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) ConsumeEmailVerificationCode(ctx context.Context, id string, consumedAt time.Time) error {
	const query = `UPDATE email_verification_codes SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL`
	result, err := r.db.SQL.ExecContext(ctx, query, id, consumedAt)
	if err != nil {
		return fmt.Errorf("consume email verification code: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanEmailVerificationCode(row rowScanner, operation string) (EmailVerificationCodeRecord, error) {
	var record EmailVerificationCodeRecord
	var purpose string
	var clientIP sql.NullString
	var consumedAt sql.NullTime
	err := row.Scan(
		&record.ID,
		&record.Email,
		&purpose,
		&record.CodeHash,
		&clientIP,
		&record.Attempts,
		&record.MaxAttempts,
		&record.ExpiresAt,
		&consumedAt,
		&record.CreatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return EmailVerificationCodeRecord{}, db.ErrNotFound
		}
		return EmailVerificationCodeRecord{}, fmt.Errorf("%s: %w", operation, err)
	}
	record.Purpose = EmailVerificationPurpose(purpose)
	record.ClientIP = nullStringPtr(clientIP)
	record.ConsumedAt = nullTimePtr(consumedAt)
	return record, nil
}

func (r *PostgresRepository) scanSessionWithUser(ctx context.Context, row rowScanner, operation string) (SessionRecord, error) {
	var record SessionRecord
	var refreshToken sql.NullString
	var clientIP sql.NullString
	var userAgent sql.NullString
	var deviceLabel sql.NullString
	var refreshExpiresAt sql.NullTime
	var refreshRotatedAt sql.NullTime
	var revokedAt sql.NullTime
	var lastLogin sql.NullTime
	err := row.Scan(
		&record.ID,
		&record.UserID,
		&record.SessionTokenHash,
		&refreshToken,
		&clientIP,
		&userAgent,
		&deviceLabel,
		&record.LoginMethod,
		&record.LastSeenAt,
		&record.ExpiresAt,
		&refreshExpiresAt,
		&refreshRotatedAt,
		&revokedAt,
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
			return SessionRecord{}, db.ErrNotFound
		}
		return SessionRecord{}, fmt.Errorf("%s: %w", operation, err)
	}

	record.RefreshTokenHash = nullStringPtr(refreshToken)
	record.ClientIP = nullStringPtr(clientIP)
	record.UserAgent = nullStringPtr(userAgent)
	record.DeviceLabel = nullStringPtr(deviceLabel)
	record.LoginMethod = normalizedLoginMethod(record.LoginMethod)
	record.RefreshExpiresAt = nullTimePtr(refreshExpiresAt)
	record.RefreshRotatedAt = nullTimePtr(refreshRotatedAt)
	record.RevokedAt = nullTimePtr(revokedAt)
	record.User.LastLoginAt = nullTimePtr(lastLogin)
	record.User.AuthType = "password"
	if err := r.populatePermissions(ctx, &record.User); err != nil {
		return SessionRecord{}, err
	}
	return record, nil
}

func (r *PostgresRepository) populatePermissions(ctx context.Context, record *UserRecord) error {
	if record == nil || strings.TrimSpace(record.Role) == "" {
		return nil
	}
	const query = `
		SELECT COALESCE(string_agg(rp.permission, ',' ORDER BY rp.permission), '')
		FROM roles ro
		LEFT JOIN role_permissions rp ON rp.role_key = ro.key
		WHERE ro.key = $1 AND ro.is_active = TRUE
	`
	var raw string
	if err := r.db.SQL.QueryRowContext(ctx, query, record.Role).Scan(&raw); err != nil {
		if err == sql.ErrNoRows {
			record.Permissions = []string{}
			return nil
		}
		return fmt.Errorf("load user role permissions: %w", err)
	}
	record.Permissions = splitPermissions(raw)
	return nil
}

func splitPermissions(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	parts := strings.Split(raw, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			items = append(items, trimmed)
		}
	}
	return items
}

func normalizedLoginMethod(value string) string {
	switch strings.TrimSpace(value) {
	case "email_code":
		return "email_code"
	default:
		return "password"
	}
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
