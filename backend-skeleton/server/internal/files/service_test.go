package files

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type staticFileInfo struct {
	name    string
	size    int64
	mode    os.FileMode
	modTime time.Time
}

func (s staticFileInfo) Name() string       { return s.name }
func (s staticFileInfo) Size() int64        { return s.size }
func (s staticFileInfo) Mode() os.FileMode  { return s.mode }
func (s staticFileInfo) ModTime() time.Time { return s.modTime }
func (s staticFileInfo) IsDir() bool        { return s.mode.IsDir() }
func (s staticFileInfo) Sys() any           { return nil }

func TestFilesInputValidation(t *testing.T) {
	service := &Service{}
	ctx := context.Background()

	t.Run("list directory rejects invalid input", func(t *testing.T) {
		tests := []ListDirectoryInput{
			{},
			{UserID: "user-1", HostID: "host-1", Path: "/tmp", Limit: -1},
			{UserID: "user-1", HostID: "host-1", Path: "/tmp", Limit: 6000},
			{UserID: "user-1", HostID: "host-1", Path: "/tmp", Cursor: "-1"},
		}
		for _, input := range tests {
			if _, err := service.ListDirectory(ctx, input); err != ErrInvalidInput {
				t.Fatalf("expected ErrInvalidInput for %#v, got %v", input, err)
			}
		}
	})

	t.Run("search rejects invalid input", func(t *testing.T) {
		tests := []SearchFilesInput{
			{},
			{UserID: "user-1", HostID: "host-1", BasePath: "/tmp"},
			{UserID: "user-1", HostID: "host-1", Keyword: "log"},
			{UserID: "user-1", HostID: "host-1", BasePath: "relative", Keyword: "log"},
		}
		for _, input := range tests {
			if _, err := service.SearchFiles(ctx, input); err != ErrInvalidInput {
				t.Fatalf("expected ErrInvalidInput for %#v, got %v", input, err)
			}
		}
	})

	t.Run("write operations reject invalid input before sftp", func(t *testing.T) {
		if _, err := service.CreateDirectory(ctx, CreateDirectoryInput{}); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
		if _, err := service.CreateFile(ctx, CreateFileInput{}); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
		if _, err := service.RenameFile(ctx, RenameFileInput{}); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
		if _, err := service.DeleteFile(ctx, DeleteFileInput{}); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
		if _, err := service.Chmod(ctx, ChmodInput{}); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
		if _, err := service.ReadFileContent(ctx, ReadFileContentInput{}); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
		if _, err := service.WriteFileContent(ctx, WriteFileContentInput{}); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
	})

	t.Run("validate write input rejects dot path", func(t *testing.T) {
		service := &Service{hostService: newHostServicePlaceholder()}
		_, _, err := service.validateWriteInput(ctx, "user-1", "host-1", ".")
		if err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
	})

	t.Run("remote path helper rejects unsafe write and read paths", func(t *testing.T) {
		invalid := []string{".", "/", "relative/file.txt", "../etc/passwd", "tmp/../etc/passwd"}
		for _, raw := range invalid {
			if _, err := cleanRemotePath(raw, remotePathOptions{}); err != ErrInvalidInput {
				t.Fatalf("expected ErrInvalidInput for %q, got %v", raw, err)
			}
		}

		cleanPath, err := cleanRemotePath(" /var/../var/log/app.log ", remotePathOptions{})
		if err != nil {
			t.Fatalf("expected normalized absolute path: %v", err)
		}
		if cleanPath != "/var/log/app.log" {
			t.Fatalf("expected cleaned absolute path, got %q", cleanPath)
		}
	})

	t.Run("remote path helper only allows root when explicit", func(t *testing.T) {
		if _, err := cleanRemotePath("/", remotePathOptions{}); err != ErrInvalidInput {
			t.Fatalf("expected root to be rejected by default, got %v", err)
		}
		cleanPath, err := cleanRemotePath("/", remotePathOptions{AllowRoot: true})
		if err != nil {
			t.Fatalf("expected explicit root allowance: %v", err)
		}
		if cleanPath != "/" {
			t.Fatalf("expected root path, got %q", cleanPath)
		}
	})

	t.Run("destructive and content operations reject unsafe remote paths before opening connections", func(t *testing.T) {
		service := &Service{hostService: newHostServicePlaceholder()}
		cases := []struct {
			name string
			run  func() error
		}{
			{name: "mkdir relative", run: func() error {
				_, err := service.CreateDirectory(ctx, CreateDirectoryInput{UserID: "user-1", HostID: "host-1", Path: "relative/dir"})
				return err
			}},
			{name: "touch root", run: func() error {
				_, err := service.CreateFile(ctx, CreateFileInput{UserID: "user-1", HostID: "host-1", Path: "/"})
				return err
			}},
			{name: "delete relative", run: func() error {
				_, err := service.DeleteFile(ctx, DeleteFileInput{UserID: "user-1", HostID: "host-1", Path: "relative/file"})
				return err
			}},
			{name: "chmod root", run: func() error {
				_, err := service.Chmod(ctx, ChmodInput{UserID: "user-1", HostID: "host-1", Path: "/", Mode: "0644"})
				return err
			}},
			{name: "read relative", run: func() error {
				_, err := service.ReadFileContent(ctx, ReadFileContentInput{UserID: "user-1", HostID: "host-1", Path: "relative/file"})
				return err
			}},
			{name: "write root", run: func() error {
				_, err := service.WriteFileContent(ctx, WriteFileContentInput{UserID: "user-1", HostID: "host-1", Path: "/", Content: "x"})
				return err
			}},
			{name: "rename relative old path", run: func() error {
				_, err := service.RenameFile(ctx, RenameFileInput{UserID: "user-1", HostID: "host-1", OldPath: "relative/file", NewPath: "/tmp/file"})
				return err
			}},
			{name: "rename root new path", run: func() error {
				_, err := service.RenameFile(ctx, RenameFileInput{UserID: "user-1", HostID: "host-1", OldPath: "/tmp/file", NewPath: "/"})
				return err
			}},
			{name: "copy relative source", run: func() error {
				_, err := service.CopyFile(ctx, CopyFileInput{UserID: "user-1", HostID: "host-1", SourcePath: "relative/file", TargetPath: "/tmp/file"})
				return err
			}},
			{name: "checksum root", run: func() error {
				_, err := service.CalculateChecksum(ctx, FileChecksumInput{UserID: "user-1", HostID: "host-1", Path: "/", Algorithm: "sha256"})
				return err
			}},
			{name: "compress relative", run: func() error {
				_, err := service.CompressArchive(ctx, CompressArchiveInput{UserID: "user-1", HostID: "host-1", Path: "relative/dir"})
				return err
			}},
			{name: "extract root", run: func() error {
				_, err := service.ExtractArchive(ctx, ExtractArchiveInput{UserID: "user-1", HostID: "host-1", Path: "/"})
				return err
			}},
		}

		for _, tc := range cases {
			if err := tc.run(); err != ErrInvalidInput {
				t.Fatalf("%s: expected ErrInvalidInput, got %v", tc.name, err)
			}
		}
	})
}

func TestSFTPPoolOptions(t *testing.T) {
	t.Run("uses default idle ttl", func(t *testing.T) {
		pool := NewSFTPPoolWithOptions(nil, SFTPPoolOptions{})
		defer pool.Close()
		if pool.idleTTL != defaultSFTPIdleTTL {
			t.Fatalf("expected default idle ttl %s, got %s", defaultSFTPIdleTTL, pool.idleTTL)
		}
	})

	t.Run("uses configured idle ttl", func(t *testing.T) {
		pool := NewSFTPPoolWithOptions(nil, SFTPPoolOptions{IdleTTL: 2 * time.Minute})
		defer pool.Close()
		if pool.idleTTL != 2*time.Minute {
			t.Fatalf("expected configured idle ttl, got %s", pool.idleTTL)
		}
	})
}

func TestSearchTaskInputNormalization(t *testing.T) {
	recursive := false
	task, err := normalizeSearchTaskInput(CreateSearchTaskInput{
		UserID:    " user-1 ",
		HostID:    " host-1 ",
		BasePath:  "/var/../var/log",
		Keyword:   " log ",
		Recursive: &recursive,
	})
	if err != nil {
		t.Fatalf("normalize search input: %v", err)
	}
	if task.BasePath != "/var/log" || task.Keyword != "log" || task.MatchMode != "name" || task.Recursive {
		t.Fatalf("unexpected normalized task: %#v", task)
	}
	if task.MaxDepth != defaultSearchMaxDepth || task.MaxResults != defaultSearchMaxResults || task.TimeoutSeconds != defaultSearchTimeoutSeconds {
		t.Fatalf("expected defaults, got %#v", task)
	}

	invalid := []CreateSearchTaskInput{
		{},
		{UserID: "user-1", HostID: "host-1", BasePath: "/tmp", Keyword: "x"},
		{UserID: "user-1", HostID: "host-1", BasePath: "relative", Keyword: "log"},
		{UserID: "user-1", HostID: "host-1", BasePath: "/", Keyword: "log"},
		{UserID: "user-1", HostID: "host-1", BasePath: "/tmp", Keyword: "log", MatchMode: "regex"},
		{UserID: "user-1", HostID: "host-1", BasePath: "/tmp", Keyword: "log", MaxDepth: maxSearchMaxDepth + 1},
		{UserID: "user-1", HostID: "host-1", BasePath: "/tmp", Keyword: "log", MaxResults: maxSearchMaxResults + 1},
	}
	for _, input := range invalid {
		if _, err := normalizeSearchTaskInput(input); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput for %#v, got %v", input, err)
		}
	}
}

func TestArchiveCommandBuilders(t *testing.T) {
	t.Run("compresses directory to adjacent tar gzip archive", func(t *testing.T) {
		command, err := buildCompressArchiveCommand("/home/app/release", "/home/app/release.tar.gz")
		if err != nil {
			t.Fatalf("build compress command: %v", err)
		}
		if command.Tool != "tar" || command.Format != "tar.gz" || command.OutputPath != "/home/app/release.tar.gz" {
			t.Fatalf("unexpected command metadata: %#v", command)
		}
		if !strings.Contains(command.Command, "cd '/home/app' && tar -czf '/home/app/release.tar.gz' -- 'release'") {
			t.Fatalf("unexpected command: %s", command.Command)
		}
	})

	t.Run("compresses directory to tar and zip archives", func(t *testing.T) {
		tarCommand, err := buildCompressArchiveCommand("/home/app/release", "/home/app/release.tar")
		if err != nil {
			t.Fatalf("build tar compress command: %v", err)
		}
		if tarCommand.Tool != "tar" || tarCommand.Format != "tar" {
			t.Fatalf("unexpected tar metadata: %#v", tarCommand)
		}
		if !strings.Contains(tarCommand.Command, "tar -cf '/home/app/release.tar' -- 'release'") {
			t.Fatalf("unexpected tar command: %s", tarCommand.Command)
		}

		zipCommand, err := buildCompressArchiveCommand("/home/app/release", "/home/app/release.zip")
		if err != nil {
			t.Fatalf("build zip compress command: %v", err)
		}
		if zipCommand.Tool != "zip" || zipCommand.Format != "zip" {
			t.Fatalf("unexpected zip metadata: %#v", zipCommand)
		}
		if !strings.Contains(zipCommand.Command, "zip -qr '/home/app/release.zip' -- 'release'") {
			t.Fatalf("unexpected zip command: %s", zipCommand.Command)
		}
	})

	t.Run("quotes shell arguments with single quotes", func(t *testing.T) {
		command, err := buildCompressArchiveCommand("/tmp/app's data", "/tmp/app's data.tar.gz")
		if err != nil {
			t.Fatalf("build compress command: %v", err)
		}
		if !strings.Contains(command.Command, "'/tmp/app'\"'\"'s data.tar.gz'") {
			t.Fatalf("expected safely quoted output path, got %s", command.Command)
		}
		if !strings.Contains(command.Command, "'app'\"'\"'s data'") {
			t.Fatalf("expected safely quoted source base, got %s", command.Command)
		}
	})

	t.Run("rejects unsupported compress archive extensions", func(t *testing.T) {
		if _, err := buildCompressArchiveCommand("/tmp/app", "/tmp/app.rar"); err != ErrUnsupportedArchiveFormat {
			t.Fatalf("expected ErrUnsupportedArchiveFormat, got %v", err)
		}
	})

	t.Run("extracts supported tar and zip formats", func(t *testing.T) {
		tarCommand, err := buildExtractArchiveCommand("/tmp/logs.tar.gz", "")
		if err != nil {
			t.Fatalf("build tar extract command: %v", err)
		}
		if tarCommand.Tool != "tar" || tarCommand.Format != "tar.gz" || tarCommand.TargetPath != "/tmp" {
			t.Fatalf("unexpected tar metadata: %#v", tarCommand)
		}
		if !strings.Contains(tarCommand.Command, "tar -xkzf '/tmp/logs.tar.gz' -C '/tmp'") {
			t.Fatalf("unexpected tar command: %s", tarCommand.Command)
		}

		zipCommand, err := buildExtractArchiveCommand("/tmp/app.zip", "/opt/app")
		if err != nil {
			t.Fatalf("build zip extract command: %v", err)
		}
		if zipCommand.Tool != "unzip" || zipCommand.Format != "zip" || zipCommand.TargetPath != "/opt/app" {
			t.Fatalf("unexpected zip metadata: %#v", zipCommand)
		}
		if !strings.Contains(zipCommand.Command, "unzip -n '/tmp/app.zip' -d '/opt/app'") {
			t.Fatalf("unexpected zip command: %s", zipCommand.Command)
		}
	})

	t.Run("rejects unsupported archive extensions", func(t *testing.T) {
		if _, err := buildExtractArchiveCommand("/tmp/app.rar", ""); err != ErrUnsupportedArchiveFormat {
			t.Fatalf("expected ErrUnsupportedArchiveFormat, got %v", err)
		}
	})

	t.Run("rejects relative extraction targets", func(t *testing.T) {
		if _, err := buildExtractArchiveCommand("/tmp/app.zip", "relative"); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
	})

	t.Run("rejects root extraction target", func(t *testing.T) {
		if _, err := buildExtractArchiveCommand("/tmp/app.zip", "/"); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
	})
}

func TestRemoteFileCommandBuilders(t *testing.T) {
	t.Run("builds copy command with conflict protection", func(t *testing.T) {
		command := buildCopyFileCommand("/home/app/data", "/home/app/data-copy")
		if !strings.Contains(command, "command -v cp >/dev/null 2>&1 || exit 127") {
			t.Fatalf("expected cp availability check, got %s", command)
		}
		if !strings.Contains(command, "[ ! -e '/home/app/data-copy' ] || exit 73") {
			t.Fatalf("expected target conflict guard, got %s", command)
		}
		if !strings.Contains(command, "cp -a -- '/home/app/data' '/home/app/data-copy'") {
			t.Fatalf("unexpected copy command: %s", command)
		}
	})

	t.Run("builds checksum commands", func(t *testing.T) {
		md5Command := buildChecksumCommand("/tmp/a file.txt", "md5")
		if !strings.Contains(md5Command, "md5sum -- '/tmp/a file.txt'") || !strings.Contains(md5Command, "md5 -q '/tmp/a file.txt'") {
			t.Fatalf("unexpected md5 command: %s", md5Command)
		}

		shaCommand := buildChecksumCommand("/tmp/a file.txt", "sha256")
		if !strings.Contains(shaCommand, "sha256sum -- '/tmp/a file.txt'") || !strings.Contains(shaCommand, "shasum -a 256 -- '/tmp/a file.txt'") {
			t.Fatalf("unexpected sha256 command: %s", shaCommand)
		}
	})

	t.Run("normalizes checksum algorithm", func(t *testing.T) {
		if normalizeChecksumAlgorithm("SHA-256") != "sha256" {
			t.Fatalf("expected sha256 alias")
		}
		if normalizeChecksumAlgorithm("crc32") != "" {
			t.Fatalf("expected unsupported algorithm to be empty")
		}
	})
}

func TestSearchRemoteBFS(t *testing.T) {
	client := fakeSearchClient{
		items: map[string][]os.FileInfo{
			"/root": {
				staticFileInfo{name: "app", mode: os.ModeDir | 0o755, modTime: time.Now()},
				staticFileInfo{name: "blocked", mode: os.ModeDir | 0o755, modTime: time.Now()},
				staticFileInfo{name: ".hidden.log", mode: 0o644, modTime: time.Now()},
				staticFileInfo{name: "README.md", mode: 0o644, modTime: time.Now()},
			},
			"/root/app": {
				staticFileInfo{name: "app.log", mode: 0o644, size: 10, modTime: time.Now()},
				staticFileInfo{name: "server.txt", mode: 0o644, size: 5, modTime: time.Now()},
			},
		},
		errs: map[string]error{
			"/root/blocked": errors.New("permission denied"),
		},
	}
	repo := &searchRepoRecorder{}
	service := &Service{searchRepo: repo}

	progress, err := service.searchRemoteBFS(context.Background(), client, model.FileSearchTask{
		ID:                "task-1",
		BasePath:          "/root",
		Keyword:           "log",
		MatchMode:         "path",
		Recursive:         true,
		IncludeHidden:     false,
		MaxDepth:          2,
		MaxResults:        10,
		MaxScannedEntries: 100,
	})
	if err != nil {
		t.Fatalf("search remote bfs: %v", err)
	}
	if progress.ScannedDirs != 2 || progress.MatchedEntries != 1 || progress.SkippedErrorsCount != 1 {
		t.Fatalf("unexpected progress: %#v", progress)
	}
	if len(repo.inserted) != 1 || repo.inserted[0].Path != "/root/app/app.log" {
		t.Fatalf("unexpected inserted results: %#v", repo.inserted)
	}
	if len(progress.Warnings) != 1 || progress.Warnings[0].Path != "/root/blocked" {
		t.Fatalf("unexpected warnings: %#v", progress.Warnings)
	}
}

func TestFilesHelpers(t *testing.T) {
	t.Run("parse mode trims whitespace", func(t *testing.T) {
		mode, err := parseMode(" 0644 ")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mode != 0o644 {
			t.Fatalf("expected 0644, got %#o", mode)
		}
	})

	t.Run("parse mode rejects invalid value", func(t *testing.T) {
		if _, err := parseMode(""); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
		if _, err := parseMode("xyz"); err == nil {
			t.Fatal("expected parse error for invalid mode")
		}
	})

	t.Run("parse cursor accepts non negative values", func(t *testing.T) {
		value, err := parseCursor(" 12 ")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if value != 12 {
			t.Fatalf("expected 12, got %d", value)
		}
	})

	t.Run("parse cursor rejects negative values", func(t *testing.T) {
		if _, err := parseCursor("-1"); err != ErrInvalidInput {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
	})

	t.Run("file entry maps regular file metadata", func(t *testing.T) {
		modifiedAt := time.Date(2026, 4, 24, 8, 30, 0, 0, time.UTC)
		entry := fileEntryFromInfo("/var/log", staticFileInfo{
			name:    ".app.log",
			size:    128,
			mode:    0o644,
			modTime: modifiedAt,
		})
		if entry.Name != ".app.log" || entry.Path != "/var/log/.app.log" {
			t.Fatalf("unexpected file entry path mapping: %#v", entry)
		}
		if entry.EntryType != "file" || entry.Permissions != "0644" || !entry.IsHidden {
			t.Fatalf("unexpected file entry metadata: %#v", entry)
		}
		if !entry.ModifiedAt.Equal(modifiedAt) {
			t.Fatalf("unexpected modified time: %#v", entry.ModifiedAt)
		}
	})

	t.Run("entry type detects directory and symlink", func(t *testing.T) {
		if got := entryTypeFromMode(os.ModeDir | 0o755); got != "directory" {
			t.Fatalf("expected directory, got %q", got)
		}
		if got := entryTypeFromMode(os.ModeSymlink); got != "symlink" {
			t.Fatalf("expected symlink, got %q", got)
		}
		if got := entryTypeFromMode(os.ModeNamedPipe); got != "other" {
			t.Fatalf("expected other, got %q", got)
		}
	})
}

type fakeSearchClient struct {
	items map[string][]os.FileInfo
	errs  map[string]error
}

func (f fakeSearchClient) ReadDir(p string) ([]os.FileInfo, error) {
	if err := f.errs[p]; err != nil {
		return nil, err
	}
	return f.items[p], nil
}

type searchRepoRecorder struct {
	task         model.FileSearchTask
	cancelResult model.FileSearchTask
	finishCalls  []searchTaskFinishCall
	inserted     []model.FileSearchResult
}

type searchTaskFinishCall struct {
	taskID       string
	status       string
	errorCode    string
	errorMessage string
	progress     SearchTaskProgress
}

func (s *searchRepoRecorder) CreateSearchTask(context.Context, model.FileSearchTask) (model.FileSearchTask, error) {
	return model.FileSearchTask{}, errors.New("unexpected CreateSearchTask")
}

func (s *searchRepoRecorder) GetSearchTaskByID(context.Context, string, string) (model.FileSearchTask, error) {
	return model.FileSearchTask{}, errors.New("unexpected GetSearchTaskByID")
}

func (s *searchRepoRecorder) GetSearchTaskByIDAny(context.Context, string) (model.FileSearchTask, error) {
	if s.task.ID == "" {
		return model.FileSearchTask{}, errors.New("unexpected GetSearchTaskByIDAny")
	}
	return s.task, nil
}

func (s *searchRepoRecorder) StartSearchTask(context.Context, string) error {
	return nil
}

func (s *searchRepoRecorder) UpdateSearchTaskProgress(context.Context, string, SearchTaskProgress) error {
	return nil
}

func (s *searchRepoRecorder) FinishSearchTask(_ context.Context, taskID, status, errorCode, errorMessage string, progress SearchTaskProgress) error {
	s.finishCalls = append(s.finishCalls, searchTaskFinishCall{
		taskID:       taskID,
		status:       status,
		errorCode:    errorCode,
		errorMessage: errorMessage,
		progress:     progress,
	})
	return nil
}

func (s *searchRepoRecorder) CancelSearchTask(context.Context, string, string) (model.FileSearchTask, error) {
	if s.cancelResult.ID == "" {
		return model.FileSearchTask{}, errors.New("unexpected CancelSearchTask")
	}
	return s.cancelResult, nil
}

func (s *searchRepoRecorder) InsertSearchResults(_ context.Context, _ string, results []model.FileSearchResult) error {
	s.inserted = append(s.inserted, results...)
	return nil
}

func (s *searchRepoRecorder) ListSearchResults(context.Context, string, string, int, int) ([]model.FileSearchResult, int, error) {
	return nil, 0, errors.New("unexpected ListSearchResults")
}

func TestRunSearchTaskWritesStructuredOperationalLogs(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	repo := &searchRepoRecorder{
		task: model.FileSearchTask{
			ID:             "search-task-1",
			UserID:         "user-1",
			HostID:         "host-1",
			BasePath:       "/var/log/private",
			Keyword:        "secret",
			Recursive:      true,
			MaxDepth:       1,
			MaxResults:     10,
			TimeoutSeconds: 1,
		},
	}
	service := NewServiceWithSearchRepository(nil, nil, repo)
	defer service.Close()

	service.runSearchTask("search-task-1")

	if len(repo.finishCalls) != 1 || repo.finishCalls[0].status != string(model.FileSearchTaskStatusFailed) {
		t.Fatalf("expected failed search task finish, got %#v", repo.finishCalls)
	}
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) < 2 {
		t.Fatalf("expected started and failed logs, got %q", output.String())
	}
	var started map[string]any
	var failed map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &started); err != nil {
		t.Fatalf("decode started log: %v", err)
	}
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), &failed); err != nil {
		t.Fatalf("decode failed log: %v", err)
	}
	if started["msg"] != "file search task started" ||
		started["component"] != "files" ||
		started["event"] != "file_search_task_started" ||
		started["user_id"] != "user-1" ||
		started["task_id"] != "search-task-1" ||
		started["host_id"] != "host-1" ||
		started["status"] != string(model.FileSearchTaskStatusRunning) {
		t.Fatalf("unexpected started log: %#v", started)
	}
	if failed["msg"] != "file search task finished" ||
		failed["component"] != "files" ||
		failed["event"] != "file_search_task_finished" ||
		failed["status"] != string(model.FileSearchTaskStatusFailed) ||
		failed["error_code"] != errorCodeFileSearchFailed ||
		failed["error_kind"] != "unknown" {
		t.Fatalf("unexpected failed log: %#v", failed)
	}
	if strings.Contains(output.String(), "/var/log/private") || strings.Contains(output.String(), "secret") {
		t.Fatalf("structured operational log leaked remote path or keyword: %s", output.String())
	}
}

func TestCancelSearchTaskWritesStructuredOperationalLog(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	repo := &searchRepoRecorder{
		cancelResult: model.FileSearchTask{
			ID:       "search-task-1",
			UserID:   "user-1",
			HostID:   "host-1",
			BasePath: "/home/user/private",
			Keyword:  "secret",
			Status:   string(model.FileSearchTaskStatusCanceled),
		},
	}
	service := NewServiceWithSearchRepository(nil, nil, repo)
	defer service.Close()

	if _, err := service.CancelSearchTask(context.Background(), "user-1", "search-task-1"); err != nil {
		t.Fatalf("cancel search task: %v", err)
	}

	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatalf("decode structured log: %v; output=%s", err, output.String())
	}
	if record["msg"] != "file search task cancel requested" ||
		record["component"] != "files" ||
		record["event"] != "file_search_task_cancel_requested" ||
		record["user_id"] != "user-1" ||
		record["task_id"] != "search-task-1" ||
		record["host_id"] != "host-1" ||
		record["status"] != string(model.FileSearchTaskStatusCanceled) {
		t.Fatalf("unexpected cancel requested log: %#v", record)
	}
	if strings.Contains(output.String(), "/home/user/private") || strings.Contains(output.String(), "secret") {
		t.Fatalf("structured operational log leaked remote path or keyword: %s", output.String())
	}
}

func newHostServicePlaceholder() *host.Service {
	return &host.Service{}
}
