package files

import (
	"context"
	"fmt"
	"path"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type ArchiveToolMissingError struct {
	Command string
}

func (e *ArchiveToolMissingError) Error() string {
	return fmt.Sprintf("remote host does not have required command: %s", e.Command)
}

type ArchiveCommandError struct {
	Output string
	Cause  error
}

func (e *ArchiveCommandError) Error() string {
	output := strings.TrimSpace(e.Output)
	if output == "" {
		return "remote archive command failed"
	}
	return fmt.Sprintf("remote archive command failed: %s", output)
}

func (e *ArchiveCommandError) Unwrap() error {
	return e.Cause
}

type remoteArchiveCommand struct {
	Tool       string
	Command    string
	OutputPath string
	TargetPath string
	Format     string
}

type archiveFormat struct {
	ID         string
	Tool       string
	Extensions []string
	TarFlags   string
}

var supportedCompressArchiveFormats = []archiveFormat{
	{ID: "tar.gz", Tool: "tar", Extensions: []string{".tar.gz", ".tgz"}, TarFlags: "-czf"},
	{ID: "tar", Tool: "tar", Extensions: []string{".tar"}, TarFlags: "-cf"},
	{ID: "zip", Tool: "zip", Extensions: []string{".zip"}},
}

var supportedExtractArchiveFormats = []archiveFormat{
	{ID: "tar.gz", Tool: "tar", Extensions: []string{".tar.gz", ".tgz"}, TarFlags: "-xkzf"},
	{ID: "tar.bz2", Tool: "tar", Extensions: []string{".tar.bz2", ".tbz2"}, TarFlags: "-xkjf"},
	{ID: "tar.xz", Tool: "tar", Extensions: []string{".tar.xz", ".txz"}, TarFlags: "-xkJf"},
	{ID: "tar", Tool: "tar", Extensions: []string{".tar"}, TarFlags: "-xkf"},
	{ID: "zip", Tool: "unzip", Extensions: []string{".zip"}},
}

func (s *Service) CompressArchive(ctx context.Context, input CompressArchiveInput) (FileOperationResult, error) {
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.HostID) == "" || strings.TrimSpace(input.Path) == "" {
		return FileOperationResult{}, ErrInvalidInput
	}
	if s.hostService == nil {
		return FileOperationResult{}, ErrInvalidInput
	}

	cleanPath, err := cleanRemotePath(input.Path, remotePathOptions{})
	if err != nil {
		return FileOperationResult{}, err
	}
	outputPath := normalizeArchiveOutputPath(cleanPath, input.OutputPath)
	outputPath, err = cleanRemotePath(outputPath, remotePathOptions{})
	if err != nil {
		return FileOperationResult{}, err
	}
	if outputPath == cleanPath || strings.HasPrefix(outputPath, cleanPath+"/") {
		return FileOperationResult{}, ErrInvalidInput
	}

	command, err := buildCompressArchiveCommand(cleanPath, outputPath)
	if err != nil {
		return FileOperationResult{}, err
	}
	if err := s.runRemoteArchiveCommand(ctx, input.UserID, input.HostID, command); err != nil {
		s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_archive_compress", model.AuditResultFailure, "compress remote directory failed", map[string]any{
			"output_path": outputPath,
			"format":      command.Format,
			"error":       err.Error(),
		})
		return FileOperationResult{}, err
	}

	s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_archive_compress", model.AuditResultSuccess, "remote directory compressed", map[string]any{
		"output_path": outputPath,
		"format":      command.Format,
	})
	return FileOperationResult{Success: true, Message: "remote directory compressed"}, nil
}

func (s *Service) ExtractArchive(ctx context.Context, input ExtractArchiveInput) (FileOperationResult, error) {
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.HostID) == "" || strings.TrimSpace(input.Path) == "" {
		return FileOperationResult{}, ErrInvalidInput
	}

	cleanPath, err := cleanRemotePath(input.Path, remotePathOptions{})
	if err != nil {
		return FileOperationResult{}, err
	}

	command, err := buildExtractArchiveCommand(cleanPath, input.TargetPath)
	if err != nil {
		return FileOperationResult{}, err
	}
	if s.hostService == nil {
		return FileOperationResult{}, ErrInvalidInput
	}
	if err := s.runRemoteArchiveCommand(ctx, input.UserID, input.HostID, command); err != nil {
		s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_archive_extract", model.AuditResultFailure, "extract remote archive failed", map[string]any{
			"target_path": command.TargetPath,
			"format":      command.Format,
			"error":       err.Error(),
		})
		return FileOperationResult{}, err
	}

	s.recordFileOperation(ctx, input.UserID, input.HostID, cleanPath, "file_archive_extract", model.AuditResultSuccess, "remote archive extracted", map[string]any{
		"target_path": command.TargetPath,
		"format":      command.Format,
	})
	return FileOperationResult{Success: true, Message: "remote archive extracted"}, nil
}

func (s *Service) runRemoteArchiveCommand(ctx context.Context, userID, hostID string, archiveCommand remoteArchiveCommand) error {
	sshClient, _, err := s.hostService.OpenSSHClient(ctx, userID, hostID, host.TestConnectionInput{})
	if err != nil {
		return err
	}
	defer sshClient.Close()

	session, err := sshClient.NewSession()
	if err != nil {
		return fmt.Errorf("create archive ssh session: %w", err)
	}
	defer session.Close()

	output, err := session.CombinedOutput(archiveCommand.Command)
	if err != nil {
		if exitStatus, ok := sshExitStatus(err); ok {
			switch exitStatus {
			case 73:
				return ErrArchiveOutputAlreadyExist
			case 74:
				return ErrInvalidInput
			case 127:
				return &ArchiveToolMissingError{Command: archiveCommand.Tool}
			}
		}
		return &ArchiveCommandError{Output: string(output), Cause: err}
	}
	return nil
}

func normalizeArchiveOutputPath(sourcePath string, rawOutputPath string) string {
	value := strings.TrimSpace(rawOutputPath)
	if value != "" {
		return path.Clean(value)
	}
	return fmt.Sprintf("%s.tar.gz", sourcePath)
}

func normalizeArchiveTargetPath(archivePath string, rawTargetPath string) string {
	value := strings.TrimSpace(rawTargetPath)
	if value != "" {
		return path.Clean(value)
	}
	return path.Dir(archivePath)
}

func buildCompressArchiveCommand(sourcePath, outputPath string) (remoteArchiveCommand, error) {
	format, ok := archiveFormatForPath(outputPath, supportedCompressArchiveFormats)
	if !ok {
		return remoteArchiveCommand{}, ErrUnsupportedArchiveFormat
	}

	command := remoteArchiveCommand{
		Tool:       format.Tool,
		OutputPath: outputPath,
		Format:     format.ID,
	}
	if format.Tool == "zip" {
		command.Command = fmt.Sprintf("command -v zip >/dev/null 2>&1 || exit 127\n[ -d %s ] || exit 74\n[ ! -e %s ] || exit 73\ncd %s && zip -qr %s -- %s", shellQuote(sourcePath), shellQuote(outputPath), shellQuote(path.Dir(sourcePath)), shellQuote(outputPath), shellQuote(path.Base(sourcePath)))
		return command, nil
	}

	command.Command = fmt.Sprintf("command -v tar >/dev/null 2>&1 || exit 127\n[ -d %s ] || exit 74\n[ ! -e %s ] || exit 73\ncd %s && tar %s %s -- %s", shellQuote(sourcePath), shellQuote(outputPath), shellQuote(path.Dir(sourcePath)), format.TarFlags, shellQuote(outputPath), shellQuote(path.Base(sourcePath)))
	return command, nil
}

func buildExtractArchiveCommand(archivePath string, rawTargetPath string) (remoteArchiveCommand, error) {
	format, ok := archiveFormatForPath(archivePath, supportedExtractArchiveFormats)
	if !ok {
		return remoteArchiveCommand{}, ErrUnsupportedArchiveFormat
	}

	targetPath := normalizeArchiveTargetPath(archivePath, rawTargetPath)
	if _, err := cleanRemotePath(targetPath, remotePathOptions{}); err != nil {
		return remoteArchiveCommand{}, ErrInvalidInput
	}

	command := remoteArchiveCommand{
		Tool:       format.Tool,
		TargetPath: targetPath,
		Format:     format.ID,
	}
	if format.Tool == "unzip" {
		command.Command = fmt.Sprintf("command -v unzip >/dev/null 2>&1 || exit 127\nmkdir -p %s && unzip -n %s -d %s", shellQuote(targetPath), shellQuote(archivePath), shellQuote(targetPath))
		return command, nil
	}

	command.Command = fmt.Sprintf("command -v tar >/dev/null 2>&1 || exit 127\nmkdir -p %s && tar %s %s -C %s", shellQuote(targetPath), format.TarFlags, shellQuote(archivePath), shellQuote(targetPath))
	return command, nil
}

func archiveFormatForPath(archivePath string, formats []archiveFormat) (archiveFormat, bool) {
	lower := strings.ToLower(archivePath)
	for _, format := range formats {
		for _, extension := range format.Extensions {
			if strings.HasSuffix(lower, extension) {
				return format, true
			}
		}
	}
	return archiveFormat{}, false
}
