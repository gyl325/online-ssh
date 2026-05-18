package files

import (
	"context"
	"fmt"
	"io"
	"os"
	"time"
	"unicode/utf8"

	"github.com/example/online-ssh-platform/server/internal/model"
)

const maxEditableFileBytes int64 = 1 * 1024 * 1024

func (s *Service) ReadFileContent(ctx context.Context, input ReadFileContentInput) (FileContentResult, error) {
	cleanPath, lease, err := s.validateWriteInput(ctx, input.UserID, input.HostID, input.Path)
	if err != nil {
		return FileContentResult{}, err
	}
	defer lease.Release()
	client := lease.Client()

	info, err := client.Stat(cleanPath)
	if err != nil {
		lease.DiscardIfConnectionError(err)
		return FileContentResult{}, fmt.Errorf("stat remote file: %w", err)
	}
	if info.IsDir() || !info.Mode().IsRegular() {
		return FileContentResult{}, ErrInvalidInput
	}
	if info.Size() > maxEditableFileBytes {
		return FileContentResult{}, ErrInvalidInput
	}

	file, err := client.Open(cleanPath)
	if err != nil {
		lease.DiscardIfConnectionError(err)
		return FileContentResult{}, fmt.Errorf("open remote file: %w", err)
	}
	defer file.Close()

	payload, err := io.ReadAll(io.LimitReader(file, maxEditableFileBytes+1))
	if err != nil {
		lease.DiscardIfConnectionError(err)
		return FileContentResult{}, fmt.Errorf("read remote file: %w", err)
	}
	if int64(len(payload)) > maxEditableFileBytes || !utf8.Valid(payload) {
		return FileContentResult{}, ErrInvalidInput
	}

	s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_read", model.AuditResultSuccess, "remote text file read", map[string]any{"size_bytes": len(payload)})
	return FileContentResult{
		HostID:         input.HostID,
		Path:           cleanPath,
		Content:        string(payload),
		Encoding:       "utf-8",
		SizeBytes:      int64(len(payload)),
		LastModifiedAt: info.ModTime(),
	}, nil
}

func (s *Service) WriteFileContent(ctx context.Context, input WriteFileContentInput) (FileContentResult, error) {
	cleanPath, lease, err := s.validateWriteInput(ctx, input.UserID, input.HostID, input.Path)
	if err != nil {
		return FileContentResult{}, err
	}
	defer lease.Release()
	client := lease.Client()

	if !utf8.ValidString(input.Content) || int64(len(input.Content)) > maxEditableFileBytes {
		return FileContentResult{}, ErrInvalidInput
	}

	info, err := client.Stat(cleanPath)
	if err != nil {
		lease.DiscardIfConnectionError(err)
		return FileContentResult{}, fmt.Errorf("stat remote file: %w", err)
	}
	if info.IsDir() || !info.Mode().IsRegular() {
		return FileContentResult{}, ErrInvalidInput
	}

	tmpPath := fmt.Sprintf("%s.codex-write-tmp-%d", cleanPath, time.Now().UnixNano())
	tmpFile, err := client.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC)
	if err != nil {
		lease.DiscardIfConnectionError(err)
		return FileContentResult{}, fmt.Errorf("open remote temp file: %w", err)
	}
	tmpKept := false
	defer func() {
		if !tmpKept {
			_ = client.Remove(tmpPath)
		}
	}()
	if _, err := tmpFile.Write([]byte(input.Content)); err != nil {
		lease.DiscardIfConnectionError(err)
		_ = tmpFile.Close()
		return FileContentResult{}, fmt.Errorf("write remote temp file: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		lease.DiscardIfConnectionError(err)
		return FileContentResult{}, fmt.Errorf("close remote temp file: %w", err)
	}
	_ = client.Chmod(tmpPath, info.Mode().Perm())
	if err := client.PosixRename(tmpPath, cleanPath); err != nil {
		lease.DiscardIfConnectionError(err)
		return FileContentResult{}, fmt.Errorf("rename remote temp file: %w", err)
	}
	tmpKept = true

	updatedInfo, err := client.Stat(cleanPath)
	if err != nil {
		lease.DiscardIfConnectionError(err)
		return FileContentResult{}, fmt.Errorf("stat saved remote file: %w", err)
	}
	s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_write", model.AuditResultSuccess, "remote text file updated", map[string]any{"size_bytes": len(input.Content)})
	return FileContentResult{
		HostID:         input.HostID,
		Path:           cleanPath,
		Content:        input.Content,
		Encoding:       "utf-8",
		SizeBytes:      int64(len(input.Content)),
		LastModifiedAt: updatedInfo.ModTime(),
	}, nil
}
