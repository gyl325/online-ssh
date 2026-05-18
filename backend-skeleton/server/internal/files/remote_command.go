package files

import (
	"context"
	"errors"
	"fmt"
	"path"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/host"
	"golang.org/x/crypto/ssh"
)

type RemoteFileToolMissingError struct {
	Command string
}

func (e *RemoteFileToolMissingError) Error() string {
	return fmt.Sprintf("remote host does not have required command: %s", e.Command)
}

type RemoteFileCommandError struct {
	Operation string
	Output    string
	Cause     error
}

func (e *RemoteFileCommandError) Error() string {
	output := strings.TrimSpace(e.Output)
	if output == "" {
		return fmt.Sprintf("remote %s command failed", e.Operation)
	}
	return fmt.Sprintf("remote %s command failed: %s", e.Operation, output)
}

func (e *RemoteFileCommandError) Unwrap() error {
	return e.Cause
}

func (s *Service) runRemoteFileCommand(ctx context.Context, userID, hostID, command string) ([]byte, error) {
	sshClient, _, err := s.hostService.OpenSSHClient(ctx, userID, hostID, host.TestConnectionInput{})
	if err != nil {
		return nil, err
	}
	defer sshClient.Close()

	session, err := sshClient.NewSession()
	if err != nil {
		return nil, fmt.Errorf("create file ssh session: %w", err)
	}
	defer session.Close()

	return session.CombinedOutput(command)
}

func isAbsoluteRemotePath(value string) bool {
	return strings.HasPrefix(value, "/")
}

type remotePathOptions struct {
	AllowRoot bool
}

func cleanRemotePath(raw string, options remotePathOptions) (string, error) {
	cleanPath := path.Clean(strings.TrimSpace(raw))
	if cleanPath == "." || !isAbsoluteRemotePath(cleanPath) {
		return "", ErrInvalidInput
	}
	if cleanPath == "/" && !options.AllowRoot {
		return "", ErrInvalidInput
	}
	return cleanPath, nil
}

func sshExitStatus(err error) (int, bool) {
	var exitErr *ssh.ExitError
	if !errors.As(err, &exitErr) {
		return 0, false
	}
	return exitErr.ExitStatus(), true
}

func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}
