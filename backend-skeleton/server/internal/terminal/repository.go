package terminal

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type Repository interface {
	CreateSession(ctx context.Context, userID, hostID, status string, remoteAddr *string) (model.TerminalSession, error)
	GetSessionByID(ctx context.Context, userID, sessionID string) (model.TerminalSession, error)
	UpdateSessionStatus(ctx context.Context, userID, sessionID, status string, endedAt *time.Time) (model.TerminalSession, error)
	CreateTerminalShare(ctx context.Context, input CreateTerminalShareRecordInput) (model.TerminalShare, error)
	GetActiveTerminalShare(ctx context.Context, userID, sessionID string, now time.Time) (model.TerminalShare, error)
	GetTerminalShareByID(ctx context.Context, userID, shareID string) (model.TerminalShare, error)
	GetTerminalShareByTokenHash(ctx context.Context, tokenHash string, now time.Time) (model.TerminalShare, error)
	IncrementTerminalShareAccess(ctx context.Context, shareID string, now time.Time) (model.TerminalShare, error)
	RevokeTerminalShare(ctx context.Context, userID, shareID string, revokedAt time.Time) (model.TerminalShare, error)
	ExtendTerminalShare(ctx context.Context, userID, shareID string, expiresAt time.Time) (model.TerminalShare, error)
	CreateTerminalShareAccessLog(ctx context.Context, log model.TerminalShareAccessLog) error
	ListTerminalShareAccessLogs(ctx context.Context, userID, shareID string, limit, offset int) ([]model.TerminalShareAccessLog, int, error)
	CreateTerminalShareViewerToken(ctx context.Context, input CreateTerminalShareViewerTokenInput) (model.TerminalShareViewerToken, error)
	GetTerminalShareViewerTokenByHash(ctx context.Context, tokenHash string, now time.Time) (model.TerminalShareViewerToken, error)
}

type RecordingRepository interface {
	GetRecordingSettings(ctx context.Context, userID string) (model.TerminalRecordingSettings, error)
	UpsertRecordingSettings(ctx context.Context, settings model.TerminalRecordingSettings) (model.TerminalRecordingSettings, error)
	CreateRecording(ctx context.Context, recording model.TerminalRecording) (model.TerminalRecording, error)
	AppendRecordingChunk(ctx context.Context, recordingID, direction, dataEnc string, byteCount int64, keyVersion int, occurredAt time.Time) error
	FinishRecordingBySession(ctx context.Context, userID, sessionID, status string, endedAt time.Time, droppedBytes int64) error
	ListRecordingsByUserID(ctx context.Context, userID string, limit, offset int) ([]model.TerminalRecording, int, error)
	GetRecordingByID(ctx context.Context, userID, recordingID string) (model.TerminalRecording, error)
	ListRecordingChunks(ctx context.Context, recordingID string, afterSequence, limit int) ([]model.TerminalRecordingChunk, error)
	UpdateRecordingBookmark(ctx context.Context, userID, recordingID string, isBookmarked bool) (model.TerminalRecording, error)
	DeleteRecording(ctx context.Context, userID, recordingID string) error
}

type PostgresRepository struct {
	db *db.DB
}

func NewPostgresRepository(database *db.DB) *PostgresRepository {
	return &PostgresRepository{db: database}
}

func (r *PostgresRepository) CreateSession(ctx context.Context, userID, hostID, status string, remoteAddr *string) (model.TerminalSession, error) {
	const query = `
		INSERT INTO terminal_sessions (user_id, host_id, status, remote_addr, started_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, host_id, status, remote_addr, started_at, ended_at, created_at, updated_at
	`

	row := r.db.SQL.QueryRowContext(ctx, query, userID, hostID, status, remoteAddr, time.Now())
	return scanTerminalSession(row)
}

func (r *PostgresRepository) GetSessionByID(ctx context.Context, userID, sessionID string) (model.TerminalSession, error) {
	const query = `
		SELECT id, user_id, host_id, status, remote_addr, started_at, ended_at, created_at, updated_at
		FROM terminal_sessions
		WHERE id = $1 AND user_id = $2
	`

	row := r.db.SQL.QueryRowContext(ctx, query, sessionID, userID)
	return scanTerminalSession(row)
}

func (r *PostgresRepository) UpdateSessionStatus(ctx context.Context, userID, sessionID, status string, endedAt *time.Time) (model.TerminalSession, error) {
	const query = `
		UPDATE terminal_sessions
		SET status = $3,
		    ended_at = $4
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, host_id, status, remote_addr, started_at, ended_at, created_at, updated_at
	`

	row := r.db.SQL.QueryRowContext(ctx, query, sessionID, userID, status, endedAt)
	return scanTerminalSession(row)
}

func (r *PostgresRepository) GetRecordingSettings(ctx context.Context, userID string) (model.TerminalRecordingSettings, error) {
	const query = `
		SELECT user_id, enabled, retention_days, created_at, updated_at
		FROM terminal_recording_settings
		WHERE user_id = $1
	`
	return scanRecordingSettings(r.db.SQL.QueryRowContext(ctx, query, userID))
}

func (r *PostgresRepository) UpsertRecordingSettings(ctx context.Context, settings model.TerminalRecordingSettings) (model.TerminalRecordingSettings, error) {
	const query = `
		INSERT INTO terminal_recording_settings (user_id, enabled, retention_days)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id)
		DO UPDATE SET enabled = EXCLUDED.enabled,
		              retention_days = EXCLUDED.retention_days
		RETURNING user_id, enabled, retention_days, created_at, updated_at
	`
	return scanRecordingSettings(r.db.SQL.QueryRowContext(ctx, query, settings.UserID, settings.Enabled, settings.RetentionDays))
}

func (r *PostgresRepository) CreateRecording(ctx context.Context, recording model.TerminalRecording) (model.TerminalRecording, error) {
	const query = `
		INSERT INTO terminal_recordings (
			user_id, terminal_session_id, host_id, status, started_at, expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, user_id, terminal_session_id, host_id, status, started_at, ended_at, expires_at, is_bookmarked,
			input_bytes, output_bytes, dropped_bytes, key_version, created_at, updated_at
	`
	return scanRecording(r.db.SQL.QueryRowContext(
		ctx,
		query,
		recording.UserID,
		recording.TerminalSessionID,
		recording.HostID,
		recording.Status,
		recording.StartedAt,
		recording.ExpiresAt,
	))
}

func (r *PostgresRepository) AppendRecordingChunk(ctx context.Context, recordingID, direction, dataEnc string, byteCount int64, keyVersion int, occurredAt time.Time) error {
	tx, err := r.db.SQL.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin terminal recording chunk transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	const insertQuery = `
		INSERT INTO terminal_recording_chunks (
			recording_id, sequence, direction, occurred_at, data_enc, byte_count, key_version
		)
		VALUES (
			$1,
			COALESCE((SELECT MAX(sequence) + 1 FROM terminal_recording_chunks WHERE recording_id = $1), 1),
			$2, $3, $4, $5, $6
		)
	`
	if _, err := tx.ExecContext(ctx, insertQuery, recordingID, direction, occurredAt, dataEnc, byteCount, keyVersion); err != nil {
		return fmt.Errorf("insert terminal recording chunk: %w", err)
	}

	const updateQuery = `
		UPDATE terminal_recordings
		SET input_bytes = input_bytes + CASE WHEN $2 = 'input' THEN $3 ELSE 0 END,
		    output_bytes = output_bytes + CASE WHEN $2 = 'output' THEN $3 ELSE 0 END,
		    key_version = CASE WHEN key_version = 0 THEN $4 ELSE key_version END
		WHERE id = $1
	`
	if _, err := tx.ExecContext(ctx, updateQuery, recordingID, direction, byteCount, keyVersion); err != nil {
		return fmt.Errorf("update terminal recording byte counters: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit terminal recording chunk transaction: %w", err)
	}
	committed = true
	return nil
}

func (r *PostgresRepository) FinishRecordingBySession(ctx context.Context, userID, sessionID, status string, endedAt time.Time, droppedBytes int64) error {
	const query = `
		UPDATE terminal_recordings
		SET status = $3,
		    ended_at = COALESCE(ended_at, $4),
		    dropped_bytes = dropped_bytes + $5
		WHERE user_id = $1
		  AND terminal_session_id = $2
		  AND status = 'active'
	`
	if _, err := r.db.SQL.ExecContext(ctx, query, userID, sessionID, status, endedAt, droppedBytes); err != nil {
		return fmt.Errorf("finish terminal recording: %w", err)
	}
	return nil
}

func (r *PostgresRepository) ListRecordingsByUserID(ctx context.Context, userID string, limit, offset int) ([]model.TerminalRecording, int, error) {
	const where = `WHERE user_id = $1 AND (is_bookmarked OR expires_at > now())`

	var total int
	if err := r.db.SQL.QueryRowContext(ctx, `SELECT COUNT(*) FROM terminal_recordings `+where, userID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count terminal recordings: %w", err)
	}

	rows, err := r.db.SQL.QueryContext(ctx, recordingSelectSQL()+`
		`+where+`
		ORDER BY started_at DESC
		LIMIT $2 OFFSET $3`,
		userID,
		limit,
		offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list terminal recordings: %w", err)
	}
	defer rows.Close()

	items := make([]model.TerminalRecording, 0)
	for rows.Next() {
		item, scanErr := scanRecording(rows)
		if scanErr != nil {
			return nil, 0, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate terminal recordings: %w", err)
	}
	return items, total, nil
}

func (r *PostgresRepository) GetRecordingByID(ctx context.Context, userID, recordingID string) (model.TerminalRecording, error) {
	return scanRecording(r.db.SQL.QueryRowContext(ctx, recordingSelectSQL()+`
		WHERE user_id = $1 AND id = $2 AND (is_bookmarked OR expires_at > now())`,
		userID,
		recordingID,
	))
}

func (r *PostgresRepository) ListRecordingChunks(ctx context.Context, recordingID string, afterSequence, limit int) ([]model.TerminalRecordingChunk, error) {
	const query = `
		SELECT id, recording_id, sequence, direction, occurred_at, data_enc, byte_count, key_version, created_at
		FROM terminal_recording_chunks
		WHERE recording_id = $1 AND sequence > $2
		ORDER BY sequence ASC
		LIMIT $3
	`
	rows, err := r.db.SQL.QueryContext(ctx, query, recordingID, afterSequence, limit)
	if err != nil {
		return nil, fmt.Errorf("list terminal recording chunks: %w", err)
	}
	defer rows.Close()

	items := make([]model.TerminalRecordingChunk, 0)
	for rows.Next() {
		item, scanErr := scanRecordingChunk(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate terminal recording chunks: %w", err)
	}
	return items, nil
}

func (r *PostgresRepository) UpdateRecordingBookmark(ctx context.Context, userID, recordingID string, isBookmarked bool) (model.TerminalRecording, error) {
	const query = `
		UPDATE terminal_recordings
		SET is_bookmarked = $3
		WHERE user_id = $1
		  AND id = $2
		  AND (is_bookmarked OR expires_at > now())
		RETURNING id, user_id, terminal_session_id, host_id, status, started_at, ended_at, expires_at, is_bookmarked,
		          input_bytes, output_bytes, dropped_bytes, key_version, created_at, updated_at
	`
	return scanRecording(r.db.SQL.QueryRowContext(ctx, query,
		userID,
		recordingID,
		isBookmarked,
	))
}

func (r *PostgresRepository) DeleteRecording(ctx context.Context, userID, recordingID string) error {
	result, err := r.db.SQL.ExecContext(ctx, `DELETE FROM terminal_recordings WHERE user_id = $1 AND id = $2`, userID, recordingID)
	if err != nil {
		return fmt.Errorf("delete terminal recording: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete terminal recording affected rows: %w", err)
	}
	if rows == 0 {
		return db.ErrNotFound
	}
	return nil
}

func (r *PostgresRepository) CreateTerminalShare(ctx context.Context, input CreateTerminalShareRecordInput) (model.TerminalShare, error) {
	const query = `
		INSERT INTO terminal_shares (
			user_id, terminal_session_id, host_id, token_hash, public_token, password_hash, expires_at, max_accesses, sensitive_prompt
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, user_id, terminal_session_id, host_id, token_hash, public_token, password_hash, expires_at, revoked_at,
		          max_accesses, access_count, sensitive_prompt, created_at, updated_at
	`
	return scanTerminalShare(r.db.SQL.QueryRowContext(
		ctx,
		query,
		input.UserID,
		input.TerminalSessionID,
		input.HostID,
		input.TokenHash,
		input.PublicToken,
		input.PasswordHash,
		input.ExpiresAt,
		input.MaxAccesses,
		input.SensitivePrompt,
	))
}

func (r *PostgresRepository) GetActiveTerminalShare(ctx context.Context, userID, sessionID string, now time.Time) (model.TerminalShare, error) {
	const query = `
		SELECT id, user_id, terminal_session_id, host_id, token_hash, public_token, password_hash, expires_at, revoked_at,
		       max_accesses, access_count, sensitive_prompt, created_at, updated_at
		FROM terminal_shares
		WHERE user_id = $1
		  AND terminal_session_id = $2
		  AND revoked_at IS NULL
		  AND expires_at > $3
		ORDER BY created_at DESC
		LIMIT 1
	`
	return scanTerminalShare(r.db.SQL.QueryRowContext(ctx, query, userID, sessionID, now))
}

func (r *PostgresRepository) GetTerminalShareByID(ctx context.Context, userID, shareID string) (model.TerminalShare, error) {
	const query = `
		SELECT id, user_id, terminal_session_id, host_id, token_hash, public_token, password_hash, expires_at, revoked_at,
		       max_accesses, access_count, sensitive_prompt, created_at, updated_at
		FROM terminal_shares
		WHERE id = $1 AND user_id = $2
	`
	return scanTerminalShare(r.db.SQL.QueryRowContext(ctx, query, shareID, userID))
}

func (r *PostgresRepository) GetTerminalShareByTokenHash(ctx context.Context, tokenHash string, _ time.Time) (model.TerminalShare, error) {
	const query = `
		SELECT id, user_id, terminal_session_id, host_id, token_hash, public_token, password_hash, expires_at, revoked_at,
		       max_accesses, access_count, sensitive_prompt, created_at, updated_at
		FROM terminal_shares
		WHERE token_hash = $1
	`
	return scanTerminalShare(r.db.SQL.QueryRowContext(ctx, query, tokenHash))
}

func (r *PostgresRepository) IncrementTerminalShareAccess(ctx context.Context, shareID string, now time.Time) (model.TerminalShare, error) {
	const query = `
		UPDATE terminal_shares
		SET access_count = access_count + 1,
		    updated_at = now()
		WHERE id = $1
		  AND revoked_at IS NULL
		  AND expires_at > $2
		  AND (max_accesses IS NULL OR access_count < max_accesses)
		RETURNING id, user_id, terminal_session_id, host_id, token_hash, public_token, password_hash, expires_at, revoked_at,
		          max_accesses, access_count, sensitive_prompt, created_at, updated_at
	`
	item, err := scanTerminalShare(r.db.SQL.QueryRowContext(ctx, query, shareID, now))
	if errors.Is(err, db.ErrNotFound) {
		return model.TerminalShare{}, ErrShareAccessLimit
	}
	return item, err
}

func (r *PostgresRepository) RevokeTerminalShare(ctx context.Context, userID, shareID string, revokedAt time.Time) (model.TerminalShare, error) {
	const query = `
		UPDATE terminal_shares
		SET revoked_at = COALESCE(revoked_at, $3),
		    updated_at = now()
		WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, terminal_session_id, host_id, token_hash, public_token, password_hash, expires_at, revoked_at,
		          max_accesses, access_count, sensitive_prompt, created_at, updated_at
	`
	return scanTerminalShare(r.db.SQL.QueryRowContext(ctx, query, shareID, userID, revokedAt))
}

func (r *PostgresRepository) ExtendTerminalShare(ctx context.Context, userID, shareID string, expiresAt time.Time) (model.TerminalShare, error) {
	const query = `
		UPDATE terminal_shares
		SET expires_at = $3,
		    updated_at = now()
		WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
		RETURNING id, user_id, terminal_session_id, host_id, token_hash, public_token, password_hash, expires_at, revoked_at,
		          max_accesses, access_count, sensitive_prompt, created_at, updated_at
	`
	return scanTerminalShare(r.db.SQL.QueryRowContext(ctx, query, shareID, userID, expiresAt))
}

func (r *PostgresRepository) CreateTerminalShareAccessLog(ctx context.Context, log model.TerminalShareAccessLog) error {
	const query = `
		INSERT INTO terminal_share_access_logs (
			share_id, terminal_session_id, client_ip, user_agent, result, failure_reason, accessed_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))
	`
	var accessedAt any
	if !log.AccessedAt.IsZero() {
		accessedAt = log.AccessedAt
	}
	if _, err := r.db.SQL.ExecContext(ctx, query, log.ShareID, log.TerminalSessionID, log.ClientIP, log.UserAgent, log.Result, log.FailureReason, accessedAt); err != nil {
		return fmt.Errorf("create terminal share access log: %w", err)
	}
	return nil
}

func (r *PostgresRepository) ListTerminalShareAccessLogs(ctx context.Context, userID, shareID string, limit, offset int) ([]model.TerminalShareAccessLog, int, error) {
	const where = `
		FROM terminal_share_access_logs l
		JOIN terminal_shares s ON s.id = l.share_id
		WHERE s.user_id = $1 AND l.share_id = $2
	`
	var total int
	if err := r.db.SQL.QueryRowContext(ctx, `SELECT COUNT(*) `+where, userID, shareID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count terminal share access logs: %w", err)
	}
	rows, err := r.db.SQL.QueryContext(ctx, `
		SELECT l.id, l.share_id, l.terminal_session_id, host(l.client_ip), l.user_agent, l.result, l.failure_reason, l.accessed_at
		`+where+`
		ORDER BY l.accessed_at DESC
		LIMIT $3 OFFSET $4
	`, userID, shareID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("list terminal share access logs: %w", err)
	}
	defer rows.Close()
	items := make([]model.TerminalShareAccessLog, 0)
	for rows.Next() {
		item, scanErr := scanTerminalShareAccessLog(rows)
		if scanErr != nil {
			return nil, 0, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate terminal share access logs: %w", err)
	}
	return items, total, nil
}

func (r *PostgresRepository) CreateTerminalShareViewerToken(ctx context.Context, input CreateTerminalShareViewerTokenInput) (model.TerminalShareViewerToken, error) {
	const query = `
		INSERT INTO terminal_share_viewer_tokens (share_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
		RETURNING id, share_id, token_hash, expires_at, created_at
	`
	return scanTerminalShareViewerToken(r.db.SQL.QueryRowContext(ctx, query, input.ShareID, input.TokenHash, input.ExpiresAt))
}

func (r *PostgresRepository) GetTerminalShareViewerTokenByHash(ctx context.Context, tokenHash string, now time.Time) (model.TerminalShareViewerToken, error) {
	const query = `
		SELECT vt.id, vt.share_id, vt.token_hash, vt.expires_at, vt.created_at,
		       s.id, s.user_id, s.terminal_session_id, s.host_id, s.token_hash, s.public_token, s.password_hash, s.expires_at, s.revoked_at,
		       s.max_accesses, s.access_count, s.sensitive_prompt, s.created_at, s.updated_at
		FROM terminal_share_viewer_tokens vt
		JOIN terminal_shares s ON s.id = vt.share_id
		WHERE vt.token_hash = $1
		  AND vt.expires_at > $2
		  AND s.expires_at > $2
		  AND s.revoked_at IS NULL
	`
	return scanTerminalShareViewerTokenWithShare(r.db.SQL.QueryRowContext(ctx, query, tokenHash, now))
}

func scanTerminalSession(scanner interface {
	Scan(dest ...any) error
}) (model.TerminalSession, error) {
	var item model.TerminalSession
	var remoteAddr sql.NullString
	var endedAt sql.NullTime
	if err := scanner.Scan(
		&item.ID,
		&item.UserID,
		&item.HostID,
		&item.Status,
		&remoteAddr,
		&item.StartedAt,
		&endedAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.TerminalSession{}, db.ErrNotFound
		}
		return model.TerminalSession{}, fmt.Errorf("scan terminal session: %w", err)
	}
	item.RemoteAddr = nullStringPtr(remoteAddr)
	item.EndedAt = nullTimePtr(endedAt)
	return item, nil
}

func scanTerminalShare(scanner interface {
	Scan(dest ...any) error
}) (model.TerminalShare, error) {
	var item model.TerminalShare
	var passwordHash sql.NullString
	var revokedAt sql.NullTime
	var maxAccesses sql.NullInt64
	if err := scanner.Scan(
		&item.ID,
		&item.UserID,
		&item.TerminalSessionID,
		&item.HostID,
		&item.TokenHash,
		&item.PublicToken,
		&passwordHash,
		&item.ExpiresAt,
		&revokedAt,
		&maxAccesses,
		&item.AccessCount,
		&item.SensitivePrompt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.TerminalShare{}, db.ErrNotFound
		}
		return model.TerminalShare{}, fmt.Errorf("scan terminal share: %w", err)
	}
	item.PasswordHash = nullStringPtr(passwordHash)
	item.RevokedAt = nullTimePtr(revokedAt)
	item.MaxAccesses = nullIntPtr(maxAccesses)
	return item, nil
}

func scanTerminalShareAccessLog(scanner interface {
	Scan(dest ...any) error
}) (model.TerminalShareAccessLog, error) {
	var item model.TerminalShareAccessLog
	var clientIP sql.NullString
	var userAgent sql.NullString
	var failureReason sql.NullString
	if err := scanner.Scan(
		&item.ID,
		&item.ShareID,
		&item.TerminalSessionID,
		&clientIP,
		&userAgent,
		&item.Result,
		&failureReason,
		&item.AccessedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.TerminalShareAccessLog{}, db.ErrNotFound
		}
		return model.TerminalShareAccessLog{}, fmt.Errorf("scan terminal share access log: %w", err)
	}
	item.ClientIP = nullStringPtr(clientIP)
	item.UserAgent = nullStringPtr(userAgent)
	item.FailureReason = nullStringPtr(failureReason)
	return item, nil
}

func scanTerminalShareViewerToken(scanner interface {
	Scan(dest ...any) error
}) (model.TerminalShareViewerToken, error) {
	var item model.TerminalShareViewerToken
	if err := scanner.Scan(&item.ID, &item.ShareID, &item.TokenHash, &item.ExpiresAt, &item.CreatedAt); err != nil {
		if err == sql.ErrNoRows {
			return model.TerminalShareViewerToken{}, db.ErrNotFound
		}
		return model.TerminalShareViewerToken{}, fmt.Errorf("scan terminal share viewer token: %w", err)
	}
	return item, nil
}

func scanTerminalShareViewerTokenWithShare(scanner interface {
	Scan(dest ...any) error
}) (model.TerminalShareViewerToken, error) {
	var item model.TerminalShareViewerToken
	var share model.TerminalShare
	var passwordHash sql.NullString
	var revokedAt sql.NullTime
	var maxAccesses sql.NullInt64
	if err := scanner.Scan(
		&item.ID,
		&item.ShareID,
		&item.TokenHash,
		&item.ExpiresAt,
		&item.CreatedAt,
		&share.ID,
		&share.UserID,
		&share.TerminalSessionID,
		&share.HostID,
		&share.TokenHash,
		&share.PublicToken,
		&passwordHash,
		&share.ExpiresAt,
		&revokedAt,
		&maxAccesses,
		&share.AccessCount,
		&share.SensitivePrompt,
		&share.CreatedAt,
		&share.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.TerminalShareViewerToken{}, db.ErrNotFound
		}
		return model.TerminalShareViewerToken{}, fmt.Errorf("scan terminal share viewer token with share: %w", err)
	}
	share.PasswordHash = nullStringPtr(passwordHash)
	share.RevokedAt = nullTimePtr(revokedAt)
	share.MaxAccesses = nullIntPtr(maxAccesses)
	item.Share = share
	return item, nil
}

func scanRecordingSettings(scanner interface {
	Scan(dest ...any) error
}) (model.TerminalRecordingSettings, error) {
	var item model.TerminalRecordingSettings
	if err := scanner.Scan(
		&item.UserID,
		&item.Enabled,
		&item.RetentionDays,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.TerminalRecordingSettings{}, db.ErrNotFound
		}
		return model.TerminalRecordingSettings{}, fmt.Errorf("scan terminal recording settings: %w", err)
	}
	return item, nil
}

func recordingSelectSQL() string {
	return `
		SELECT id, user_id, terminal_session_id, host_id, status, started_at, ended_at, expires_at, is_bookmarked,
		       input_bytes, output_bytes, dropped_bytes, key_version, created_at, updated_at
		FROM terminal_recordings`
}

func scanRecording(scanner interface {
	Scan(dest ...any) error
}) (model.TerminalRecording, error) {
	var item model.TerminalRecording
	var sessionID sql.NullString
	var hostID sql.NullString
	var endedAt sql.NullTime
	if err := scanner.Scan(
		&item.ID,
		&item.UserID,
		&sessionID,
		&hostID,
		&item.Status,
		&item.StartedAt,
		&endedAt,
		&item.ExpiresAt,
		&item.IsBookmarked,
		&item.InputBytes,
		&item.OutputBytes,
		&item.DroppedBytes,
		&item.KeyVersion,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.TerminalRecording{}, db.ErrNotFound
		}
		return model.TerminalRecording{}, fmt.Errorf("scan terminal recording: %w", err)
	}
	item.TerminalSessionID = nullStringPtr(sessionID)
	item.HostID = nullStringPtr(hostID)
	item.EndedAt = nullTimePtr(endedAt)
	return item, nil
}

func scanRecordingChunk(scanner interface {
	Scan(dest ...any) error
}) (model.TerminalRecordingChunk, error) {
	var item model.TerminalRecordingChunk
	if err := scanner.Scan(
		&item.ID,
		&item.RecordingID,
		&item.Sequence,
		&item.Direction,
		&item.OccurredAt,
		&item.DataEnc,
		&item.ByteCount,
		&item.KeyVersion,
		&item.CreatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return model.TerminalRecordingChunk{}, db.ErrNotFound
		}
		return model.TerminalRecordingChunk{}, fmt.Errorf("scan terminal recording chunk: %w", err)
	}
	return item, nil
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func nullIntPtr(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	result := int(value.Int64)
	return &result
}

func nullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}
