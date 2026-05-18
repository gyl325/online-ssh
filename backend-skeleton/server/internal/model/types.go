package model

import (
	"encoding/json"
	"time"
)

type UserStatus string
type UserRole string
type AuthType string
type HostStatus string
type FingerprintStatus string
type TerminalSessionStatus string
type TerminalRecordingStatus string
type TerminalRecordingDirection string
type TransferTaskType string
type TransferTaskStatus string
type FileSearchTaskStatus string
type AuditExportTaskStatus string
type AuditResult string
type AuditLevel string

const (
	UserStatusActive   UserStatus = "active"
	UserStatusDisabled UserStatus = "disabled"

	UserRoleAdmin UserRole = "admin"
	UserRoleUser  UserRole = "user"

	PermissionAdminAccess       = "admin.access"
	PermissionAdminUsers        = "admin.users.manage"
	PermissionAdminSessions     = "admin.sessions.manage"
	PermissionAdminRoles        = "admin.roles.manage"
	PermissionAdminDatabase     = "admin.database.manage"
	PermissionHostsManage       = "hosts.manage"
	PermissionCredentialsManage = "credentials.manage"
	PermissionTerminalConnect   = "terminal.connect"
	PermissionFilesManage       = "files.manage"
	PermissionTransfersManage   = "transfers.manage"
	PermissionAuditRead         = "audit.read"

	AuthTypePassword   AuthType = "password"
	AuthTypePrivateKey AuthType = "private_key"

	HostStatusActive   HostStatus = "active"
	HostStatusArchived HostStatus = "archived"

	FingerprintStatusTrusted FingerprintStatus = "trusted"
	FingerprintStatusChanged FingerprintStatus = "changed"
	FingerprintStatusRevoked FingerprintStatus = "revoked"

	TerminalSessionStatusConnecting   TerminalSessionStatus = "connecting"
	TerminalSessionStatusConnected    TerminalSessionStatus = "connected"
	TerminalSessionStatusDisconnected TerminalSessionStatus = "disconnected"
	TerminalSessionStatusFailed       TerminalSessionStatus = "failed"

	TerminalRecordingStatusActive    TerminalRecordingStatus = "active"
	TerminalRecordingStatusCompleted TerminalRecordingStatus = "completed"
	TerminalRecordingStatusFailed    TerminalRecordingStatus = "failed"

	TerminalRecordingDirectionInput  TerminalRecordingDirection = "input"
	TerminalRecordingDirectionOutput TerminalRecordingDirection = "output"

	TransferTaskTypeUpload   TransferTaskType = "upload"
	TransferTaskTypeDownload TransferTaskType = "download"

	TransferTaskStatusPending                 TransferTaskStatus = "pending"
	TransferTaskStatusUploadingToPlatform     TransferTaskStatus = "uploading_to_platform"
	TransferTaskStatusQueuedForRemoteTransfer TransferTaskStatus = "queued_for_remote_transfer"
	TransferTaskStatusTransferring            TransferTaskStatus = "transferring"
	TransferTaskStatusPaused                  TransferTaskStatus = "paused"
	TransferTaskStatusFailed                  TransferTaskStatus = "failed"
	TransferTaskStatusCompleted               TransferTaskStatus = "completed"
	TransferTaskStatusCanceled                TransferTaskStatus = "canceled"

	FileSearchTaskStatusPending   FileSearchTaskStatus = "pending"
	FileSearchTaskStatusRunning   FileSearchTaskStatus = "running"
	FileSearchTaskStatusCompleted FileSearchTaskStatus = "completed"
	FileSearchTaskStatusFailed    FileSearchTaskStatus = "failed"
	FileSearchTaskStatusCanceled  FileSearchTaskStatus = "canceled"

	AuditExportTaskStatusPending   AuditExportTaskStatus = "pending"
	AuditExportTaskStatusRunning   AuditExportTaskStatus = "running"
	AuditExportTaskStatusCompleted AuditExportTaskStatus = "completed"
	AuditExportTaskStatusFailed    AuditExportTaskStatus = "failed"
	AuditExportTaskStatusCanceled  AuditExportTaskStatus = "canceled"

	AuditResultSuccess AuditResult = "success"
	AuditResultFailure AuditResult = "failure"

	AuditLevelBasic   AuditLevel = "basic"
	AuditLevelCommand AuditLevel = "command"
	AuditLevelFullIO  AuditLevel = "full_io"
)

type User struct {
	ID              string     `json:"id"`
	Email           string     `json:"email"`
	DisplayName     string     `json:"display_name"`
	PreferredLocale string     `json:"preferred_locale"`
	Theme           string     `json:"theme"`
	Status          string     `json:"status"`
	Role            string     `json:"role"`
	AuthType        string     `json:"auth_type"`
	Permissions     []string   `json:"permissions"`
	LastLoginAt     *time.Time `json:"last_login_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func UserHasPermission(user User, permission string) bool {
	for _, item := range user.Permissions {
		if item == permission {
			return true
		}
	}
	return false
}

type Credential struct {
	ID                  string    `json:"id"`
	UserID              string    `json:"user_id"`
	Name                string    `json:"name"`
	AuthType            string    `json:"auth_type"`
	EncryptedSecret     *string   `json:"-"`
	EncryptedPrivateKey *string   `json:"-"`
	EncryptedPassphrase *string   `json:"-"`
	KeyVersion          int       `json:"key_version"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type Host struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	GroupID         *string    `json:"group_id"`
	CredentialID    *string    `json:"credential_id"`
	Name            string     `json:"name"`
	Host            string     `json:"host"`
	Port            int        `json:"port"`
	Username        string     `json:"username"`
	AuthType        string     `json:"auth_type"`
	Status          string     `json:"status"`
	IsFavorite      bool       `json:"is_favorite"`
	LastConnectedAt *time.Time `json:"last_connected_at"`
	ArchivedAt      *time.Time `json:"archived_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type HostGroup struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type HostFingerprint struct {
	ID             string     `json:"id"`
	HostID         string     `json:"host_id"`
	Algorithm      string     `json:"algorithm"`
	Fingerprint    string     `json:"fingerprint"`
	Status         string     `json:"status"`
	FirstSeenAt    time.Time  `json:"first_seen_at"`
	LastVerifiedAt *time.Time `json:"last_verified_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type TerminalSession struct {
	ID         string     `json:"id"`
	UserID     string     `json:"user_id"`
	HostID     string     `json:"host_id"`
	Status     string     `json:"status"`
	RemoteAddr *string    `json:"remote_addr"`
	StartedAt  time.Time  `json:"started_at"`
	EndedAt    *time.Time `json:"ended_at"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type TerminalRecordingSettings struct {
	UserID        string    `json:"user_id"`
	Enabled       bool      `json:"enabled"`
	RetentionDays int       `json:"retention_days"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type TerminalRecording struct {
	ID                string     `json:"id"`
	UserID            string     `json:"user_id"`
	TerminalSessionID *string    `json:"terminal_session_id"`
	HostID            *string    `json:"host_id"`
	Status            string     `json:"status"`
	StartedAt         time.Time  `json:"started_at"`
	EndedAt           *time.Time `json:"ended_at"`
	ExpiresAt         time.Time  `json:"expires_at"`
	IsBookmarked      bool       `json:"is_bookmarked"`
	InputBytes        int64      `json:"input_bytes"`
	OutputBytes       int64      `json:"output_bytes"`
	DroppedBytes      int64      `json:"dropped_bytes"`
	KeyVersion        int        `json:"key_version"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type TerminalRecordingChunk struct {
	ID          string    `json:"id"`
	RecordingID string    `json:"recording_id"`
	Sequence    int       `json:"sequence"`
	Direction   string    `json:"direction"`
	OccurredAt  time.Time `json:"occurred_at"`
	DataEnc     string    `json:"-"`
	Data        string    `json:"data,omitempty"`
	ByteCount   int64     `json:"byte_count"`
	KeyVersion  int       `json:"key_version"`
	CreatedAt   time.Time `json:"created_at"`
}

type TerminalShare struct {
	ID                string     `json:"id"`
	UserID            string     `json:"user_id"`
	TerminalSessionID string     `json:"terminal_session_id"`
	HostID            string     `json:"host_id"`
	TokenHash         string     `json:"-"`
	PublicToken       string     `json:"-"`
	PasswordHash      *string    `json:"-"`
	ExpiresAt         time.Time  `json:"expires_at"`
	RevokedAt         *time.Time `json:"revoked_at"`
	MaxAccesses       *int       `json:"max_accesses"`
	AccessCount       int        `json:"access_count"`
	SensitivePrompt   string     `json:"sensitive_prompt"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type TerminalShareAccessLog struct {
	ID                string    `json:"id"`
	ShareID           string    `json:"share_id"`
	TerminalSessionID string    `json:"terminal_session_id"`
	ClientIP          *string   `json:"client_ip"`
	UserAgent         *string   `json:"user_agent"`
	Result            string    `json:"result"`
	FailureReason     *string   `json:"failure_reason"`
	AccessedAt        time.Time `json:"accessed_at"`
}

type TerminalShareViewerToken struct {
	ID        string    `json:"id"`
	ShareID   string    `json:"share_id"`
	TokenHash string    `json:"-"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
	Share     TerminalShare
}

type TransferTask struct {
	ID               string     `json:"id"`
	UserID           string     `json:"user_id"`
	TaskType         string     `json:"task_type"`
	SourceType       string     `json:"source_type"`
	TargetType       string     `json:"target_type"`
	SourceHostID     *string    `json:"source_host_id"`
	TargetHostID     *string    `json:"target_host_id"`
	SourcePath       *string    `json:"source_path"`
	TargetPath       *string    `json:"target_path"`
	TmpPath          *string    `json:"tmp_path"`
	FileName         string     `json:"file_name"`
	TotalBytes       int64      `json:"total_bytes"`
	TransferredBytes int64      `json:"transferred_bytes"`
	ChunkSize        int64      `json:"chunk_size"`
	Resumable        bool       `json:"resumable"`
	Status           string     `json:"status"`
	RetryCount       int        `json:"retry_count"`
	ErrorCode        *string    `json:"error_code"`
	ErrorMessage     *string    `json:"error_message"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	StartedAt        *time.Time `json:"started_at"`
	FinishedAt       *time.Time `json:"finished_at"`
}

type FileSearchTask struct {
	ID                 string          `json:"id"`
	UserID             string          `json:"user_id"`
	HostID             string          `json:"host_id"`
	BasePath           string          `json:"base_path"`
	Keyword            string          `json:"keyword"`
	MatchMode          string          `json:"match_mode"`
	Recursive          bool            `json:"recursive"`
	IncludeHidden      bool            `json:"include_hidden"`
	MaxDepth           int             `json:"max_depth"`
	MaxResults         int             `json:"max_results"`
	MaxScannedEntries  int             `json:"max_scanned_entries"`
	TimeoutSeconds     int             `json:"timeout_seconds"`
	Status             string          `json:"status"`
	ScannedDirs        int             `json:"scanned_dirs"`
	ScannedEntries     int             `json:"scanned_entries"`
	MatchedEntries     int             `json:"matched_entries"`
	SkippedErrorsCount int             `json:"skipped_errors_count"`
	LimitReached       bool            `json:"limit_reached"`
	ErrorCode          *string         `json:"error_code"`
	ErrorMessage       *string         `json:"error_message"`
	WarningsJSON       json.RawMessage `json:"warnings_json"`
	StartedAt          *time.Time      `json:"started_at"`
	FinishedAt         *time.Time      `json:"finished_at"`
	ExpiresAt          time.Time       `json:"expires_at"`
	CreatedAt          time.Time       `json:"created_at"`
	UpdatedAt          time.Time       `json:"updated_at"`
}

type FileSearchResult struct {
	ID          string    `json:"id"`
	TaskID      string    `json:"task_id"`
	Rank        int       `json:"rank"`
	Name        string    `json:"name"`
	Path        string    `json:"path"`
	EntryType   string    `json:"entry_type"`
	SizeBytes   int64     `json:"size_bytes"`
	Permissions string    `json:"permissions"`
	Owner       *string   `json:"owner"`
	Group       *string   `json:"group"`
	ModifiedAt  time.Time `json:"modified_at"`
	IsHidden    bool      `json:"is_hidden"`
	CreatedAt   time.Time `json:"created_at"`
}

type AuditLog struct {
	ID                string          `json:"id"`
	UserID            string          `json:"user_id"`
	TerminalSessionID *string         `json:"terminal_session_id"`
	EventType         string          `json:"event_type"`
	ResourceType      *string         `json:"resource_type"`
	ResourceID        *string         `json:"resource_id"`
	TargetHostID      *string         `json:"target_host_id"`
	TargetPath        *string         `json:"target_path"`
	Result            string          `json:"result"`
	Message           *string         `json:"message"`
	ClientIP          *string         `json:"client_ip"`
	UserAgent         *string         `json:"user_agent"`
	AuditLevel        string          `json:"audit_level"`
	MetadataJSON      json.RawMessage `json:"metadata_json"`
	OccurredAt        time.Time       `json:"occurred_at"`
}

type AuditExportTask struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	FilterEventType    string     `json:"filter_event_type"`
	FilterTargetHostID *string    `json:"filter_target_host_id"`
	FilterResult       string     `json:"filter_result"`
	FilterStartTime    *time.Time `json:"filter_start_time"`
	FilterEndTime      *time.Time `json:"filter_end_time"`
	Status             string     `json:"status"`
	TotalRows          int        `json:"total_rows"`
	ExportedRows       int        `json:"exported_rows"`
	ResultCSV          string     `json:"-"`
	ErrorCode          *string    `json:"error_code"`
	ErrorMessage       *string    `json:"error_message"`
	StartedAt          *time.Time `json:"started_at"`
	FinishedAt         *time.Time `json:"finished_at"`
	ExpiresAt          time.Time  `json:"expires_at"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type SavedCommand struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	Name        string    `json:"name"`
	CommandText string    `json:"command_text"`
	Category    *string   `json:"category"`
	Description *string   `json:"description"`
	SortOrder   int       `json:"sort_order"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
