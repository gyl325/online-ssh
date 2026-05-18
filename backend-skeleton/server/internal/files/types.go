package files

import (
	"errors"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
)

var (
	ErrInvalidInput              = errors.New("invalid input")
	ErrSearchQueueFull           = errors.New("file search queue is full")
	ErrUnsupportedArchiveFormat  = errors.New("unsupported archive format")
	ErrArchiveOutputAlreadyExist = errors.New("archive output already exists")
	ErrRemotePathAlreadyExists   = errors.New("remote path already exists")
	ErrChecksumUnavailable       = errors.New("remote checksum unavailable")
)

type ListDirectoryInput struct {
	UserID string `json:"-"`
	HostID string `json:"host_id"`
	Path   string `json:"path"`
	Limit  int    `json:"limit"`
	Cursor string `json:"cursor"`
}

type SearchFilesInput struct {
	UserID    string `json:"-"`
	HostID    string `json:"host_id"`
	BasePath  string `json:"base_path"`
	Keyword   string `json:"keyword"`
	Recursive bool   `json:"recursive"`
}

type CreateSearchTaskInput struct {
	UserID            string `json:"-"`
	HostID            string `json:"host_id"`
	BasePath          string `json:"base_path"`
	Keyword           string `json:"keyword"`
	MatchMode         string `json:"match_mode"`
	Recursive         *bool  `json:"recursive"`
	IncludeHidden     bool   `json:"include_hidden"`
	MaxDepth          int    `json:"max_depth"`
	MaxResults        int    `json:"max_results"`
	MaxScannedEntries int    `json:"max_scanned_entries"`
	TimeoutSeconds    int    `json:"timeout_seconds"`
}

type CreateDirectoryInput struct {
	UserID string `json:"-"`
	HostID string `json:"host_id"`
	Path   string `json:"path"`
}

type CreateFileInput struct {
	UserID string `json:"-"`
	HostID string `json:"host_id"`
	Path   string `json:"path"`
}

type RenameFileInput struct {
	UserID  string `json:"-"`
	HostID  string `json:"host_id"`
	OldPath string `json:"old_path"`
	NewPath string `json:"new_path"`
}

type DeleteFileInput struct {
	UserID    string `json:"-"`
	HostID    string `json:"host_id"`
	Path      string `json:"path"`
	Recursive bool   `json:"recursive"`
}

type ChmodInput struct {
	UserID string `json:"-"`
	HostID string `json:"host_id"`
	Path   string `json:"path"`
	Mode   string `json:"mode"`
}

type CopyFileInput struct {
	UserID     string `json:"-"`
	HostID     string `json:"host_id"`
	SourcePath string `json:"source_path"`
	TargetPath string `json:"target_path"`
}

type FileChecksumInput struct {
	UserID    string `json:"-"`
	HostID    string `json:"host_id"`
	Path      string `json:"path"`
	Algorithm string `json:"algorithm"`
}

type ReadFileContentInput struct {
	UserID string `json:"-"`
	HostID string `json:"host_id"`
	Path   string `json:"path"`
}

type WriteFileContentInput struct {
	UserID  string `json:"-"`
	HostID  string `json:"host_id"`
	Path    string `json:"path"`
	Content string `json:"content"`
}

type CompressArchiveInput struct {
	UserID     string `json:"-"`
	HostID     string `json:"host_id"`
	Path       string `json:"path"`
	OutputPath string `json:"output_path"`
}

type ExtractArchiveInput struct {
	UserID     string `json:"-"`
	HostID     string `json:"host_id"`
	Path       string `json:"path"`
	TargetPath string `json:"target_path"`
}

type FileEntry struct {
	Name        string    `json:"name"`
	Path        string    `json:"path"`
	EntryType   string    `json:"entry_type"`
	SizeBytes   int64     `json:"size_bytes"`
	Permissions string    `json:"permissions"`
	Owner       *string   `json:"owner"`
	Group       *string   `json:"group"`
	ModifiedAt  time.Time `json:"modified_at"`
	IsHidden    bool      `json:"is_hidden"`
}

type ListDirectoryResult struct {
	HostID                string      `json:"host_id"`
	Path                  string      `json:"path"`
	Items                 []FileEntry `json:"items"`
	NextCursor            *string     `json:"next_cursor"`
	SFTPConnectionReused  bool        `json:"-"`
	SFTPConnectionRetried bool        `json:"-"`
}

type SearchFilesResult struct {
	HostID   string      `json:"host_id"`
	BasePath string      `json:"base_path"`
	Keyword  string      `json:"keyword"`
	Items    []FileEntry `json:"items"`
}

type SearchTaskProgress struct {
	ScannedDirs        int
	ScannedEntries     int
	MatchedEntries     int
	SkippedErrorsCount int
	LimitReached       bool
	Warnings           []SearchTaskWarning
}

type SearchTaskWarning struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

type SearchResultsResult struct {
	Items    []model.FileSearchResult `json:"items"`
	Page     int                      `json:"page"`
	PageSize int                      `json:"page_size"`
	Total    int                      `json:"total"`
}

type FileOperationResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type FileChecksumResult struct {
	HostID    string `json:"host_id"`
	Path      string `json:"path"`
	Algorithm string `json:"algorithm"`
	Checksum  string `json:"checksum"`
}

type FileContentResult struct {
	HostID         string    `json:"host_id"`
	Path           string    `json:"path"`
	Content        string    `json:"content"`
	Encoding       string    `json:"encoding"`
	SizeBytes      int64     `json:"size_bytes"`
	LastModifiedAt time.Time `json:"last_modified_at"`
}
