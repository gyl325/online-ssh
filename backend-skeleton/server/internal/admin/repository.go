package admin

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type PostgresRepository struct {
	db *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{db: database}
}

func (r *PostgresRepository) ListUsers(ctx context.Context) ([]UserListItem, error) {
	const query = `
		SELECT
			u.id,
			u.email,
			u.display_name,
			u.preferred_locale,
			u.theme,
			u.status,
			u.role,
			u.last_login_at,
			u.created_at,
			u.updated_at,
			(
				SELECT s2.login_method
				FROM user_sessions s2
				WHERE s2.user_id = u.id
				ORDER BY s2.last_seen_at DESC, s2.created_at DESC
				LIMIT 1
			) AS last_login_method,
			COALESCE(mfa.totp_enabled, FALSE) AS mfa_enabled,
			COALESCE(active_sessions.active_session_count, 0) AS active_session_count
		FROM users u
		LEFT JOIN (
			SELECT user_id, COUNT(*)::int AS active_session_count
			FROM user_sessions
			WHERE revoked_at IS NULL AND expires_at > now()
			GROUP BY user_id
		) active_sessions ON active_sessions.user_id = u.id
		LEFT JOIN user_mfa_settings mfa ON mfa.user_id = u.id
		ORDER BY u.created_at DESC
	`

	rows, err := r.db.SQL.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list admin users: %w", err)
	}
	defer rows.Close()

	items := make([]UserListItem, 0)
	for rows.Next() {
		item, err := r.scanUserListItem(ctx, rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admin users: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) GetUserMFAStatus(ctx context.Context, userID string) (UserMFAStatus, error) {
	const query = `
		SELECT
			u.id,
			COALESCE(m.totp_enabled, FALSE),
			m.totp_confirmed_at,
			m.last_used_at,
			COUNT(c.id) FILTER (WHERE c.used_at IS NULL)::int
		FROM users u
		LEFT JOIN user_mfa_settings m ON m.user_id = u.id
		LEFT JOIN user_mfa_recovery_codes c ON c.user_id = u.id
		WHERE u.id = $1
		GROUP BY u.id, m.totp_enabled, m.totp_confirmed_at, m.last_used_at
	`
	var status UserMFAStatus
	var confirmedAt sql.NullTime
	var lastUsedAt sql.NullTime
	err := r.db.SQL.QueryRowContext(ctx, query, userID).Scan(
		&status.UserID,
		&status.TOTPEnabled,
		&confirmedAt,
		&lastUsedAt,
		&status.RecoveryCodeCount,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return UserMFAStatus{}, db.ErrNotFound
		}
		return UserMFAStatus{}, fmt.Errorf("get user mfa status: %w", err)
	}
	status.ConfirmedAt = nullTimePtr(confirmedAt)
	status.LastUsedAt = nullTimePtr(lastUsedAt)
	return status, nil
}

func (r *PostgresRepository) ResetUserMFA(ctx context.Context, userID string) error {
	tx, err := r.db.SQL.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin reset user mfa tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx, `
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
	`, userID)
	if err != nil {
		return fmt.Errorf("reset user mfa settings: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		if _, err := r.GetUser(ctx, userID); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_mfa_recovery_codes WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("delete user mfa recovery codes: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_mfa_tokens WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("delete user mfa tokens: %w", err)
	}
	return tx.Commit()
}

func (r *PostgresRepository) GetUser(ctx context.Context, userID string) (model.User, error) {
	const query = `
		SELECT id, email, display_name, preferred_locale, theme, status, role, last_login_at, created_at, updated_at
		FROM users
		WHERE id = $1
	`
	user, err := r.scanUser(ctx, r.db.SQL.QueryRowContext(ctx, query, userID), "get admin user")
	if err != nil {
		return model.User{}, err
	}
	return user, nil
}

func (r *PostgresRepository) UpdateUserStatus(ctx context.Context, userID string, status model.UserStatus) (model.User, error) {
	const query = `
		UPDATE users
		SET status = $2
		WHERE id = $1
		RETURNING id, email, display_name, preferred_locale, theme, status, role, last_login_at, created_at, updated_at
	`
	return r.scanUser(ctx, r.db.SQL.QueryRowContext(ctx, query, userID, status), "update user status")
}

func (r *PostgresRepository) DeleteUser(ctx context.Context, userID string) error {
	result, err := r.db.SQL.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		return fmt.Errorf("delete admin user: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) UpdateUserRole(ctx context.Context, userID string, role string) (model.User, error) {
	const query = `
		UPDATE users
		SET role = $2
		WHERE id = $1
		RETURNING id, email, display_name, preferred_locale, theme, status, role, last_login_at, created_at, updated_at
	`
	return r.scanUser(ctx, r.db.SQL.QueryRowContext(ctx, query, userID, role), "update user role")
}

func (r *PostgresRepository) ListSessions(ctx context.Context, now time.Time) ([]SessionListItem, error) {
	const query = `
		SELECT
			s.id,
			s.user_id,
			u.email,
			u.display_name,
			u.role,
			host(s.client_ip),
			s.user_agent,
			s.device_label,
			s.login_method,
			s.last_seen_at,
			s.expires_at,
			s.created_at
		FROM user_sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.revoked_at IS NULL AND s.expires_at > $1
		ORDER BY s.last_seen_at DESC
	`

	rows, err := r.db.SQL.QueryContext(ctx, query, now)
	if err != nil {
		return nil, fmt.Errorf("list admin sessions: %w", err)
	}
	defer rows.Close()

	items := make([]SessionListItem, 0)
	for rows.Next() {
		item, err := scanSessionListItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admin sessions: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) ListRoles(ctx context.Context) ([]Role, error) {
	const query = `
		SELECT
			r.key,
			r.name,
			r.description,
			r.is_system,
			r.is_active,
			COALESCE(u.user_count, 0) AS user_count,
			COALESCE(p.permissions, '') AS permissions,
			r.created_at,
			r.updated_at
		FROM roles r
		LEFT JOIN (
			SELECT role, COUNT(*)::int AS user_count
			FROM users
			WHERE status = 'active'
			GROUP BY role
		) u ON u.role = r.key
		LEFT JOIN (
			SELECT role_key, string_agg(permission, ',' ORDER BY permission) AS permissions
			FROM role_permissions
			GROUP BY role_key
		) p ON p.role_key = r.key
		ORDER BY r.is_system DESC, r.key ASC
	`

	rows, err := r.db.SQL.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list admin roles: %w", err)
	}
	defer rows.Close()

	items := make([]Role, 0)
	for rows.Next() {
		item, err := scanRole(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admin roles: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) GetRole(ctx context.Context, key string) (Role, error) {
	const query = `
		SELECT
			r.key,
			r.name,
			r.description,
			r.is_system,
			r.is_active,
			COALESCE(u.user_count, 0) AS user_count,
			COALESCE(p.permissions, '') AS permissions,
			r.created_at,
			r.updated_at
		FROM roles r
		LEFT JOIN (
			SELECT role, COUNT(*)::int AS user_count
			FROM users
			WHERE status = 'active'
			GROUP BY role
		) u ON u.role = r.key
		LEFT JOIN (
			SELECT role_key, string_agg(permission, ',' ORDER BY permission) AS permissions
			FROM role_permissions
			GROUP BY role_key
		) p ON p.role_key = r.key
		WHERE r.key = $1
	`
	role, err := scanRole(r.db.SQL.QueryRowContext(ctx, query, key))
	if err != nil {
		return Role{}, err
	}
	return role, nil
}

func (r *PostgresRepository) CreateRole(ctx context.Context, role Role) (Role, error) {
	tx, err := r.db.SQL.BeginTx(ctx, nil)
	if err != nil {
		return Role{}, fmt.Errorf("begin create role tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	const insertRole = `
		INSERT INTO roles (key, name, description, is_system, is_active)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING key
	`
	var key string
	if err := tx.QueryRowContext(ctx, insertRole, role.Key, role.Name, role.Description, role.IsSystem, role.IsActive).Scan(&key); err != nil {
		return Role{}, fmt.Errorf("create admin role: %w", err)
	}
	if err := replaceRolePermissionsTx(ctx, tx, role.Key, role.Permissions); err != nil {
		return Role{}, err
	}
	created, err := scanRole(tx.QueryRowContext(ctx, roleByKeyQuery(), role.Key))
	if err != nil {
		return Role{}, err
	}
	if err := tx.Commit(); err != nil {
		return Role{}, fmt.Errorf("commit create role: %w", err)
	}
	return created, nil
}

func (r *PostgresRepository) UpdateRole(ctx context.Context, key string, role Role) (Role, error) {
	tx, err := r.db.SQL.BeginTx(ctx, nil)
	if err != nil {
		return Role{}, fmt.Errorf("begin update role tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	const updateRole = `
		UPDATE roles
		SET name = $2,
		    description = $3,
		    is_system = $4,
		    is_active = $5
		WHERE key = $1
	`
	result, err := tx.ExecContext(ctx, updateRole, key, role.Name, role.Description, role.IsSystem, role.IsActive)
	if err != nil {
		return Role{}, fmt.Errorf("update admin role: %w", err)
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		return Role{}, db.ErrNotFound
	}
	if err := replaceRolePermissionsTx(ctx, tx, key, role.Permissions); err != nil {
		return Role{}, err
	}
	updated, err := scanRole(tx.QueryRowContext(ctx, roleByKeyQuery(), key))
	if err != nil {
		return Role{}, err
	}
	if err := tx.Commit(); err != nil {
		return Role{}, fmt.Errorf("commit update role: %w", err)
	}
	return updated, nil
}

func (r *PostgresRepository) DeleteRole(ctx context.Context, key string) error {
	result, err := r.db.SQL.ExecContext(ctx, `DELETE FROM roles WHERE key = $1`, key)
	if err != nil {
		return fmt.Errorf("delete admin role: %w", err)
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

func (r *PostgresRepository) RevokeSession(ctx context.Context, sessionID string, revokedAt time.Time) (string, error) {
	const query = `
		UPDATE user_sessions
		SET revoked_at = $2, last_seen_at = $2
		WHERE id = $1 AND revoked_at IS NULL
		RETURNING user_id::text
	`
	var userID string
	if err := r.db.SQL.QueryRowContext(ctx, query, sessionID, revokedAt).Scan(&userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", db.ErrNotFound
		}
		return "", fmt.Errorf("revoke admin session: %w", err)
	}
	return userID, nil
}

func (r *PostgresRepository) RevokeSessionsByUserID(ctx context.Context, userID string, exceptSessionID string, revokedAt time.Time) (int, error) {
	sessionIDs, err := r.RevokeSessionIDsByUserID(ctx, userID, exceptSessionID, revokedAt)
	if err != nil {
		return 0, err
	}
	return len(sessionIDs), nil
}

func (r *PostgresRepository) RevokeSessionIDsByUserID(ctx context.Context, userID string, exceptSessionID string, revokedAt time.Time) ([]string, error) {
	const query = `
		UPDATE user_sessions
		SET revoked_at = $3, last_seen_at = $3
		WHERE user_id = $1
		  AND revoked_at IS NULL
		  AND ($2 = '' OR id::text <> $2)
		RETURNING id::text
	`
	rows, err := r.db.SQL.QueryContext(ctx, query, userID, exceptSessionID, revokedAt)
	if err != nil {
		return nil, fmt.Errorf("revoke admin user sessions: %w", err)
	}
	defer rows.Close()

	sessionIDs := make([]string, 0)
	for rows.Next() {
		var sessionID string
		if err := rows.Scan(&sessionID); err != nil {
			return nil, fmt.Errorf("scan revoked admin user session: %w", err)
		}
		sessionIDs = append(sessionIDs, sessionID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate revoked admin user sessions: %w", err)
	}
	return sessionIDs, nil
}

func (r *PostgresRepository) ListDatabaseHostGroups(ctx context.Context) ([]model.HostGroup, error) {
	const query = `
		SELECT id, user_id, name, sort_order, created_at, updated_at
		FROM host_groups
		ORDER BY user_id ASC, sort_order ASC, name ASC, created_at ASC
	`
	rows, err := r.db.SQL.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list database host groups: %w", err)
	}
	defer rows.Close()

	items := make([]model.HostGroup, 0)
	for rows.Next() {
		item, scanErr := scanDatabaseHostGroup(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate database host groups: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) ListDatabaseCredentials(ctx context.Context) ([]model.Credential, error) {
	const query = `
		SELECT id, user_id, name, auth_type, encrypted_secret, encrypted_private_key, encrypted_passphrase, key_version, created_at, updated_at
		FROM credentials
		ORDER BY user_id ASC, created_at ASC, name ASC
	`
	rows, err := r.db.SQL.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list database credentials: %w", err)
	}
	defer rows.Close()

	items := make([]model.Credential, 0)
	for rows.Next() {
		item, scanErr := scanDatabaseCredential(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate database credentials: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) ListDatabaseHosts(ctx context.Context) ([]model.Host, error) {
	const query = `
		SELECT id, user_id, group_id, credential_id, name, host, port, username, auth_type, status, is_favorite, last_connected_at, archived_at, created_at, updated_at
		FROM hosts
		WHERE archived_at IS NULL
		ORDER BY user_id ASC, created_at ASC, name ASC
	`
	rows, err := r.db.SQL.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list database hosts: %w", err)
	}
	defer rows.Close()

	items := make([]model.Host, 0)
	for rows.Next() {
		item, scanErr := scanDatabaseHost(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate database hosts: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) CreateDatabaseHostGroup(ctx context.Context, item model.HostGroup) (model.HostGroup, error) {
	const query = `
		INSERT INTO host_groups (user_id, name, sort_order)
		VALUES ($1, $2, $3)
		RETURNING id, user_id, name, sort_order, created_at, updated_at
	`
	return scanDatabaseHostGroup(r.db.SQL.QueryRowContext(ctx, query, item.UserID, item.Name, item.SortOrder))
}

func (r *PostgresRepository) CreateDatabaseCredential(ctx context.Context, item model.Credential) (model.Credential, error) {
	const query = `
		INSERT INTO credentials (user_id, name, auth_type, encrypted_secret, encrypted_private_key, encrypted_passphrase, key_version)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, user_id, name, auth_type, encrypted_secret, encrypted_private_key, encrypted_passphrase, key_version, created_at, updated_at
	`
	return scanDatabaseCredential(r.db.SQL.QueryRowContext(
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

func (r *PostgresRepository) CreateDatabaseHost(ctx context.Context, item model.Host) (model.Host, error) {
	const query = `
		INSERT INTO hosts (user_id, group_id, credential_id, name, host, port, username, auth_type, status, is_favorite, last_connected_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, user_id, group_id, credential_id, name, host, port, username, auth_type, status, is_favorite, last_connected_at, archived_at, created_at, updated_at
	`
	status := strings.TrimSpace(item.Status)
	if status == "" {
		status = string(model.HostStatusActive)
	}
	return scanDatabaseHost(r.db.SQL.QueryRowContext(
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
		status,
		item.IsFavorite,
		item.LastConnectedAt,
	))
}

func (r *PostgresRepository) ListSystemSettings(ctx context.Context) (map[string]string, error) {
	rows, err := r.db.SQL.QueryContext(ctx, `SELECT key, value FROM system_settings`)
	if err != nil {
		return nil, fmt.Errorf("list system settings: %w", err)
	}
	defer rows.Close()

	values := make(map[string]string)
	for rows.Next() {
		var key string
		var value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("scan system setting: %w", err)
		}
		values[key] = value
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate system settings: %w", err)
	}
	return values, nil
}

func (r *PostgresRepository) UpsertSystemSettings(ctx context.Context, values map[string]string, updatedBy string, updatedAt time.Time) error {
	tx, err := r.db.SQL.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin upsert system settings tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	const query = `
		INSERT INTO system_settings (key, value, updated_by, updated_at)
		VALUES ($1, $2, NULLIF($3, '')::uuid, $4)
		ON CONFLICT (key) DO UPDATE
		SET value = EXCLUDED.value,
		    updated_by = EXCLUDED.updated_by,
		    updated_at = EXCLUDED.updated_at
	`
	for key, value := range values {
		if _, err := tx.ExecContext(ctx, query, key, value, updatedBy, updatedAt); err != nil {
			return fmt.Errorf("upsert system setting %s: %w", key, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit upsert system settings: %w", err)
	}
	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func (r *PostgresRepository) scanUser(ctx context.Context, row scanner, operation string) (model.User, error) {
	var user model.User
	var lastLogin sql.NullTime
	err := row.Scan(
		&user.ID,
		&user.Email,
		&user.DisplayName,
		&user.PreferredLocale,
		&user.Theme,
		&user.Status,
		&user.Role,
		&lastLogin,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return model.User{}, db.ErrNotFound
		}
		return model.User{}, fmt.Errorf("%s: %w", operation, err)
	}
	user.LastLoginAt = nullTimePtr(lastLogin)
	user.AuthType = string(model.AuthTypePassword)
	if err := r.populatePermissions(ctx, &user); err != nil {
		return model.User{}, err
	}
	return user, nil
}

func (r *PostgresRepository) scanUserListItem(ctx context.Context, row scanner) (UserListItem, error) {
	var item UserListItem
	var lastLogin sql.NullTime
	var lastLoginMethod sql.NullString
	err := row.Scan(
		&item.ID,
		&item.Email,
		&item.DisplayName,
		&item.PreferredLocale,
		&item.Theme,
		&item.Status,
		&item.Role,
		&lastLogin,
		&item.CreatedAt,
		&item.UpdatedAt,
		&lastLoginMethod,
		&item.MFAEnabled,
		&item.ActiveSessionCount,
	)
	if err != nil {
		return UserListItem{}, fmt.Errorf("scan admin user: %w", err)
	}
	item.LastLoginAt = nullTimePtr(lastLogin)
	item.AuthType = string(model.AuthTypePassword)
	item.LastLoginMethod = nullStringPtr(lastLoginMethod)
	if err := r.populatePermissions(ctx, &item.User); err != nil {
		return UserListItem{}, err
	}
	return item, nil
}

func scanSessionListItem(row scanner) (SessionListItem, error) {
	var item SessionListItem
	var clientIP sql.NullString
	var userAgent sql.NullString
	var deviceLabel sql.NullString
	err := row.Scan(
		&item.ID,
		&item.UserID,
		&item.UserEmail,
		&item.UserDisplayName,
		&item.UserRole,
		&clientIP,
		&userAgent,
		&deviceLabel,
		&item.LoginMethod,
		&item.LastSeenAt,
		&item.ExpiresAt,
		&item.CreatedAt,
	)
	if err != nil {
		return SessionListItem{}, fmt.Errorf("scan admin session: %w", err)
	}
	item.ClientIP = nullStringPtr(clientIP)
	item.UserAgent = nullStringPtr(userAgent)
	item.DeviceLabel = nullStringPtr(deviceLabel)
	item.LoginMethod = normalizeLoginMethod(item.LoginMethod)
	return item, nil
}

func scanDatabaseHostGroup(row scanner) (model.HostGroup, error) {
	var item model.HostGroup
	err := row.Scan(
		&item.ID,
		&item.UserID,
		&item.Name,
		&item.SortOrder,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return model.HostGroup{}, db.ErrNotFound
		}
		return model.HostGroup{}, fmt.Errorf("scan database host group: %w", err)
	}
	return item, nil
}

func scanDatabaseCredential(row scanner) (model.Credential, error) {
	var item model.Credential
	var secret sql.NullString
	var privateKey sql.NullString
	var passphrase sql.NullString
	err := row.Scan(
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
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return model.Credential{}, db.ErrNotFound
		}
		return model.Credential{}, fmt.Errorf("scan database credential: %w", err)
	}
	item.EncryptedSecret = nullStringPtr(secret)
	item.EncryptedPrivateKey = nullStringPtr(privateKey)
	item.EncryptedPassphrase = nullStringPtr(passphrase)
	return item, nil
}

func scanDatabaseHost(row scanner) (model.Host, error) {
	var item model.Host
	var groupID sql.NullString
	var credentialID sql.NullString
	var lastConnectedAt sql.NullTime
	var archivedAt sql.NullTime
	err := row.Scan(
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
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return model.Host{}, db.ErrNotFound
		}
		return model.Host{}, fmt.Errorf("scan database host: %w", err)
	}
	item.GroupID = nullStringPtr(groupID)
	item.CredentialID = nullStringPtr(credentialID)
	item.LastConnectedAt = nullTimePtr(lastConnectedAt)
	item.ArchivedAt = nullTimePtr(archivedAt)
	return item, nil
}

func scanRole(row scanner) (Role, error) {
	var item Role
	var permissions sql.NullString
	err := row.Scan(
		&item.Key,
		&item.Name,
		&item.Description,
		&item.IsSystem,
		&item.IsActive,
		&item.UserCount,
		&permissions,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return Role{}, db.ErrNotFound
		}
		return Role{}, fmt.Errorf("scan admin role: %w", err)
	}
	item.Permissions = splitPermissions(permissions.String)
	return item, nil
}

func roleByKeyQuery() string {
	return `
		SELECT
			r.key,
			r.name,
			r.description,
			r.is_system,
			r.is_active,
			COALESCE(u.user_count, 0) AS user_count,
			COALESCE(p.permissions, '') AS permissions,
			r.created_at,
			r.updated_at
		FROM roles r
		LEFT JOIN (
			SELECT role, COUNT(*)::int AS user_count
			FROM users
			WHERE status = 'active'
			GROUP BY role
		) u ON u.role = r.key
		LEFT JOIN (
			SELECT role_key, string_agg(permission, ',' ORDER BY permission) AS permissions
			FROM role_permissions
			GROUP BY role_key
		) p ON p.role_key = r.key
		WHERE r.key = $1
	`
}

func replaceRolePermissionsTx(ctx context.Context, tx *sql.Tx, roleKey string, permissions []string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM role_permissions WHERE role_key = $1`, roleKey); err != nil {
		return fmt.Errorf("replace admin role permissions: %w", err)
	}
	if len(permissions) == 0 {
		return nil
	}
	const insertPermission = `INSERT INTO role_permissions (role_key, permission) VALUES ($1, $2)`
	for _, permission := range permissions {
		if _, err := tx.ExecContext(ctx, insertPermission, roleKey, permission); err != nil {
			return fmt.Errorf("insert admin role permission: %w", err)
		}
	}
	return nil
}

func (r *PostgresRepository) populatePermissions(ctx context.Context, record *model.User) error {
	if record == nil || strings.TrimSpace(record.Role) == "" {
		return nil
	}
	const query = `
		SELECT COALESCE(string_agg(rp.permission, ',' ORDER BY rp.permission), '')
		FROM roles r
		LEFT JOIN role_permissions rp ON rp.role_key = r.key
		WHERE r.key = $1 AND r.is_active = TRUE
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

func normalizeLoginMethod(value string) string {
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
