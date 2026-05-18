package files

import (
	"context"
	"fmt"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/model"
)

func (s *Service) ListDirectory(ctx context.Context, input ListDirectoryInput) (ListDirectoryResult, error) {
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.HostID) == "" || strings.TrimSpace(input.Path) == "" {
		return ListDirectoryResult{}, ErrInvalidInput
	}
	if s.hostService == nil {
		return ListDirectoryResult{}, ErrInvalidInput
	}
	limit := input.Limit
	if limit == 0 {
		limit = 200
	}
	if limit < 1 || limit > 5000 {
		return ListDirectoryResult{}, ErrInvalidInput
	}

	offset, err := parseCursor(input.Cursor)
	if err != nil {
		return ListDirectoryResult{}, ErrInvalidInput
	}

	lease, err := s.openSFTPLease(ctx, input.UserID, input.HostID)
	if err != nil {
		return ListDirectoryResult{}, err
	}
	defer lease.Release()
	sftpClient := lease.Client()

	cleanPath, err := cleanRemotePath(input.Path, remotePathOptions{AllowRoot: true})
	if err != nil {
		return ListDirectoryResult{}, err
	}
	items, err := sftpClient.ReadDir(cleanPath)
	retriedConnection := false
	if err != nil && isSFTPConnectionError(err) {
		lease.Discard()
		lease, err = s.openSFTPLease(ctx, input.UserID, input.HostID)
		if err != nil {
			return ListDirectoryResult{}, err
		}
		defer lease.Release()
		sftpClient = lease.Client()
		items, err = sftpClient.ReadDir(cleanPath)
		retriedConnection = true
	}
	if err != nil {
		lease.DiscardIfConnectionError(err)
		s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_list", model.AuditResultFailure, "list remote directory failed", map[string]any{"error": err.Error()})
		return ListDirectoryResult{}, fmt.Errorf("list remote directory: %w", err)
	}

	sort.Slice(items, func(i, j int) bool {
		leftDir := items[i].IsDir()
		rightDir := items[j].IsDir()
		if leftDir != rightDir {
			return leftDir
		}
		return strings.ToLower(items[i].Name()) < strings.ToLower(items[j].Name())
	})

	start := offset
	if start > len(items) {
		start = len(items)
	}
	end := start + limit
	if end > len(items) {
		end = len(items)
	}

	respItems := make([]FileEntry, 0, end-start)
	for _, item := range items[start:end] {
		respItems = append(respItems, fileEntryFromInfo(cleanPath, item))
	}

	var nextCursor *string
	if end < len(items) {
		next := strconv.Itoa(end)
		nextCursor = &next
	}

	s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_list", model.AuditResultSuccess, "remote directory listed", map[string]any{
		"count":       len(respItems),
		"next_cursor": nextCursor,
	})

	return ListDirectoryResult{
		HostID:                input.HostID,
		Path:                  cleanPath,
		Items:                 respItems,
		NextCursor:            nextCursor,
		SFTPConnectionReused:  lease.Reused(),
		SFTPConnectionRetried: retriedConnection,
	}, nil
}

func fileEntryFromInfo(parentPath string, item os.FileInfo) FileEntry {
	fullPath := path.Join(parentPath, item.Name())
	return FileEntry{
		Name:        item.Name(),
		Path:        fullPath,
		EntryType:   entryTypeFromMode(item.Mode()),
		SizeBytes:   item.Size(),
		Permissions: fmt.Sprintf("%04o", item.Mode().Perm()),
		Owner:       nil,
		Group:       nil,
		ModifiedAt:  item.ModTime(),
		IsHidden:    strings.HasPrefix(item.Name(), "."),
	}
}

func entryTypeFromMode(mode os.FileMode) string {
	switch {
	case mode.IsDir():
		return "directory"
	case mode&os.ModeSymlink != 0:
		return "symlink"
	case mode.IsRegular():
		return "file"
	default:
		return "other"
	}
}

func parseCursor(cursor string) (int, error) {
	cursor = strings.TrimSpace(cursor)
	if cursor == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(cursor)
	if err != nil || value < 0 {
		return 0, ErrInvalidInput
	}
	return value, nil
}
