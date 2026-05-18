package files

import (
	"context"
	"fmt"
	"os"
	"path"
	"strconv"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/pkg/sftp"
)

func (s *Service) CreateDirectory(ctx context.Context, input CreateDirectoryInput) (FileOperationResult, error) {
	cleanPath, lease, err := s.validateWriteInput(ctx, input.UserID, input.HostID, input.Path)
	if err != nil {
		return FileOperationResult{}, err
	}
	defer lease.Release()
	client := lease.Client()

	if err := client.Mkdir(cleanPath); err != nil {
		lease.DiscardIfConnectionError(err)
		s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_mkdir", model.AuditResultFailure, "create remote directory failed", map[string]any{"error": err.Error()})
		return FileOperationResult{}, fmt.Errorf("create remote directory: %w", err)
	}

	s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_mkdir", model.AuditResultSuccess, "remote directory created", nil)
	return FileOperationResult{Success: true, Message: "remote directory created"}, nil
}

func (s *Service) CreateFile(ctx context.Context, input CreateFileInput) (FileOperationResult, error) {
	cleanPath, lease, err := s.validateWriteInput(ctx, input.UserID, input.HostID, input.Path)
	if err != nil {
		return FileOperationResult{}, err
	}
	defer lease.Release()
	client := lease.Client()

	file, err := client.OpenFile(cleanPath, os.O_RDWR|os.O_CREATE)
	if err != nil {
		lease.DiscardIfConnectionError(err)
		s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_touch", model.AuditResultFailure, "create remote file failed", map[string]any{"error": err.Error()})
		return FileOperationResult{}, fmt.Errorf("create remote file: %w", err)
	}
	_ = file.Close()

	s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_touch", model.AuditResultSuccess, "remote file created", nil)
	return FileOperationResult{Success: true, Message: "remote file created"}, nil
}

func (s *Service) RenameFile(ctx context.Context, input RenameFileInput) (FileOperationResult, error) {
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.HostID) == "" || strings.TrimSpace(input.OldPath) == "" || strings.TrimSpace(input.NewPath) == "" {
		return FileOperationResult{}, ErrInvalidInput
	}
	if s.hostService == nil {
		return FileOperationResult{}, ErrInvalidInput
	}
	oldPath, err := cleanRemotePath(input.OldPath, remotePathOptions{})
	if err != nil {
		return FileOperationResult{}, err
	}
	newPath, err := cleanRemotePath(input.NewPath, remotePathOptions{})
	if err != nil {
		return FileOperationResult{}, ErrInvalidInput
	}

	lease, err := s.openSFTPLease(ctx, input.UserID, input.HostID)
	if err != nil {
		return FileOperationResult{}, err
	}
	defer lease.Release()
	client := lease.Client()

	if err := client.Rename(oldPath, newPath); err != nil {
		lease.DiscardIfConnectionError(err)
		s.recordFileOperation(ctx, input.UserID, input.HostID, oldPath, "file_rename", model.AuditResultFailure, "rename remote path failed", map[string]any{"new_path": newPath, "error": err.Error()})
		return FileOperationResult{}, fmt.Errorf("rename remote path: %w", err)
	}

	s.recordFileOperation(ctx, input.UserID, input.HostID, newPath, "file_rename", model.AuditResultSuccess, "remote path renamed", map[string]any{"old_path": oldPath})
	return FileOperationResult{Success: true, Message: "remote path renamed"}, nil
}

func (s *Service) DeleteFile(ctx context.Context, input DeleteFileInput) (FileOperationResult, error) {
	cleanPath, lease, err := s.validateWriteInput(ctx, input.UserID, input.HostID, input.Path)
	if err != nil {
		return FileOperationResult{}, err
	}
	defer lease.Release()
	client := lease.Client()

	if err := s.deletePath(ctx, client, cleanPath, input.Recursive); err != nil {
		lease.DiscardIfConnectionError(err)
		s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_delete", model.AuditResultFailure, "delete remote path failed", map[string]any{"recursive": input.Recursive, "error": err.Error()})
		return FileOperationResult{}, err
	}

	s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_delete", model.AuditResultSuccess, "remote path deleted", map[string]any{"recursive": input.Recursive})
	return FileOperationResult{Success: true, Message: "remote path deleted"}, nil
}

func (s *Service) Chmod(ctx context.Context, input ChmodInput) (FileOperationResult, error) {
	cleanPath, lease, err := s.validateWriteInput(ctx, input.UserID, input.HostID, input.Path)
	if err != nil {
		return FileOperationResult{}, err
	}
	defer lease.Release()
	client := lease.Client()

	modeValue, err := parseMode(input.Mode)
	if err != nil {
		return FileOperationResult{}, ErrInvalidInput
	}
	if err := client.Chmod(cleanPath, modeValue); err != nil {
		lease.DiscardIfConnectionError(err)
		s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_chmod", model.AuditResultFailure, "chmod remote path failed", map[string]any{"mode": input.Mode, "error": err.Error()})
		return FileOperationResult{}, fmt.Errorf("chmod remote path: %w", err)
	}

	s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_chmod", model.AuditResultSuccess, "remote path chmod updated", map[string]any{"mode": input.Mode})
	return FileOperationResult{Success: true, Message: "remote path chmod updated"}, nil
}

func (s *Service) CopyFile(ctx context.Context, input CopyFileInput) (FileOperationResult, error) {
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.HostID) == "" || strings.TrimSpace(input.SourcePath) == "" || strings.TrimSpace(input.TargetPath) == "" {
		return FileOperationResult{}, ErrInvalidInput
	}
	if s.hostService == nil {
		return FileOperationResult{}, ErrInvalidInput
	}

	sourcePath, err := cleanRemotePath(input.SourcePath, remotePathOptions{})
	if err != nil {
		return FileOperationResult{}, err
	}
	targetPath, err := cleanRemotePath(input.TargetPath, remotePathOptions{})
	if err != nil {
		return FileOperationResult{}, err
	}
	if sourcePath == targetPath {
		return FileOperationResult{}, ErrInvalidInput
	}
	if strings.HasPrefix(targetPath, sourcePath+"/") {
		return FileOperationResult{}, ErrInvalidInput
	}

	command := buildCopyFileCommand(sourcePath, targetPath)
	output, err := s.runRemoteFileCommand(ctx, input.UserID, input.HostID, command)
	if err != nil {
		if exitStatus, ok := sshExitStatus(err); ok {
			switch exitStatus {
			case 73:
				err = ErrRemotePathAlreadyExists
			case 74:
				err = ErrInvalidInput
			case 127:
				err = &RemoteFileToolMissingError{Command: "cp"}
			default:
				err = &RemoteFileCommandError{Operation: "copy", Output: string(output), Cause: err}
			}
		} else {
			err = &RemoteFileCommandError{Operation: "copy", Output: string(output), Cause: err}
		}
		s.recordFileOperation(ctx, input.UserID, input.HostID, sourcePath, "file_copy", model.AuditResultFailure, "copy remote path failed", map[string]any{"target_path": targetPath, "error": err.Error()})
		return FileOperationResult{}, err
	}

	s.recordFileOperation(ctx, input.UserID, input.HostID, sourcePath, "file_copy", model.AuditResultSuccess, "remote path copied", map[string]any{"target_path": targetPath})
	return FileOperationResult{Success: true, Message: "remote path copied"}, nil
}

func (s *Service) CalculateChecksum(ctx context.Context, input FileChecksumInput) (FileChecksumResult, error) {
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.HostID) == "" || strings.TrimSpace(input.Path) == "" {
		return FileChecksumResult{}, ErrInvalidInput
	}
	if s.hostService == nil {
		return FileChecksumResult{}, ErrInvalidInput
	}

	cleanPath, err := cleanRemotePath(input.Path, remotePathOptions{})
	if err != nil {
		return FileChecksumResult{}, ErrInvalidInput
	}
	algorithm := normalizeChecksumAlgorithm(input.Algorithm)
	if algorithm == "" {
		return FileChecksumResult{}, ErrInvalidInput
	}

	command := buildChecksumCommand(cleanPath, algorithm)
	output, err := s.runRemoteFileCommand(ctx, input.UserID, input.HostID, command)
	if err != nil {
		if exitStatus, ok := sshExitStatus(err); ok {
			switch exitStatus {
			case 74:
				err = ErrInvalidInput
			case 127:
				err = ErrChecksumUnavailable
			default:
				err = &RemoteFileCommandError{Operation: "checksum", Output: string(output), Cause: err}
			}
		} else {
			err = &RemoteFileCommandError{Operation: "checksum", Output: string(output), Cause: err}
		}
		s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_checksum", model.AuditResultFailure, "calculate remote checksum failed", map[string]any{"algorithm": algorithm, "error": err.Error()})
		return FileChecksumResult{}, err
	}

	fields := strings.Fields(strings.TrimSpace(string(output)))
	if len(fields) == 0 {
		err := ErrChecksumUnavailable
		s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_checksum", model.AuditResultFailure, "calculate remote checksum failed", map[string]any{"algorithm": algorithm, "error": err.Error()})
		return FileChecksumResult{}, err
	}
	checksum := fields[0]

	s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_checksum", model.AuditResultSuccess, "remote checksum calculated", map[string]any{"algorithm": algorithm})
	return FileChecksumResult{
		HostID:    input.HostID,
		Path:      cleanPath,
		Algorithm: algorithm,
		Checksum:  checksum,
	}, nil
}

func (s *Service) validateWriteInput(ctx context.Context, userID, hostID, rawPath string) (string, *sftpLease, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(hostID) == "" || strings.TrimSpace(rawPath) == "" {
		return "", nil, ErrInvalidInput
	}
	if s.hostService == nil {
		return "", nil, ErrInvalidInput
	}

	cleanPath, err := cleanRemotePath(rawPath, remotePathOptions{})
	if err != nil {
		return "", nil, ErrInvalidInput
	}

	lease, err := s.openSFTPLease(ctx, userID, hostID)
	if err != nil {
		return "", nil, err
	}
	return cleanPath, lease, nil
}

func buildCopyFileCommand(sourcePath, targetPath string) string {
	return fmt.Sprintf("command -v cp >/dev/null 2>&1 || exit 127\n[ -e %s ] || exit 74\n[ ! -e %s ] || exit 73\ncp -a -- %s %s", shellQuote(sourcePath), shellQuote(targetPath), shellQuote(sourcePath), shellQuote(targetPath))
}

func normalizeChecksumAlgorithm(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "md5":
		return "md5"
	case "sha256", "sha-256":
		return "sha256"
	default:
		return ""
	}
}

func buildChecksumCommand(filePath, algorithm string) string {
	quotedPath := shellQuote(filePath)
	if algorithm == "md5" {
		return fmt.Sprintf("[ -f %s ] || exit 74\nif command -v md5sum >/dev/null 2>&1; then md5sum -- %s | awk '{print $1}'; elif command -v md5 >/dev/null 2>&1; then md5 -q %s; else exit 127; fi", quotedPath, quotedPath, quotedPath)
	}
	return fmt.Sprintf("[ -f %s ] || exit 74\nif command -v sha256sum >/dev/null 2>&1; then sha256sum -- %s | awk '{print $1}'; elif command -v shasum >/dev/null 2>&1; then shasum -a 256 -- %s | awk '{print $1}'; else exit 127; fi", quotedPath, quotedPath, quotedPath)
}

func (s *Service) deletePath(ctx context.Context, client *sftp.Client, targetPath string, recursive bool) error {
	info, err := client.Stat(targetPath)
	if err != nil {
		return fmt.Errorf("stat remote path: %w", err)
	}
	if !info.IsDir() {
		if err := client.Remove(targetPath); err != nil {
			return fmt.Errorf("delete remote file: %w", err)
		}
		return nil
	}
	if !recursive {
		if err := client.RemoveDirectory(targetPath); err != nil {
			return fmt.Errorf("delete remote directory: %w", err)
		}
		return nil
	}

	items, err := client.ReadDir(targetPath)
	if err != nil {
		return fmt.Errorf("list remote directory for delete: %w", err)
	}
	for _, item := range items {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		childPath := path.Join(targetPath, item.Name())
		if err := s.deletePath(ctx, client, childPath, true); err != nil {
			return err
		}
	}
	if err := client.RemoveDirectory(targetPath); err != nil {
		return fmt.Errorf("delete remote directory: %w", err)
	}
	return nil
}

func parseMode(raw string) (os.FileMode, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, ErrInvalidInput
	}
	parsed, err := strconv.ParseUint(value, 8, 32)
	if err != nil {
		return 0, err
	}
	return os.FileMode(parsed), nil
}
