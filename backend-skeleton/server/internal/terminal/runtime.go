package terminal

import (
	"io"
	"strings"

	"github.com/example/online-ssh-platform/server/internal/model"
	"golang.org/x/crypto/ssh"
)

type Runtime struct {
	Session       model.TerminalSession
	AuthSessionID string
	Fingerprint   model.HostFingerprint
	Client        *ssh.Client
	SSHSession    *ssh.Session
	Stdin         io.WriteCloser
	Stdout        io.Reader
	Stderr        io.Reader
	Recorder      *RecordingHandle
}

func (r *Runtime) Resize(rows, cols int) error {
	if r == nil || r.SSHSession == nil {
		return ErrInvalidState
	}
	return r.SSHSession.WindowChange(rows, cols)
}

func (r *Runtime) Close() error {
	if r == nil {
		return nil
	}

	var firstErr error
	if r.Stdin != nil {
		if err := r.Stdin.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if r.SSHSession != nil {
		if err := r.SSHSession.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if r.Client != nil {
		if err := r.Client.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func newRuntime(client *ssh.Client, rows, cols int, initialDirectories []string) (*Runtime, error) {
	sshSession, err := client.NewSession()
	if err != nil {
		return nil, err
	}

	stdin, err := sshSession.StdinPipe()
	if err != nil {
		_ = sshSession.Close()
		return nil, err
	}
	stdout, err := sshSession.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		_ = sshSession.Close()
		return nil, err
	}
	stderr, err := sshSession.StderrPipe()
	if err != nil {
		_ = stdin.Close()
		_ = sshSession.Close()
		return nil, err
	}

	if err := sshSession.RequestPty("xterm-256color", rows, cols, ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}); err != nil {
		_ = stdin.Close()
		_ = sshSession.Close()
		return nil, err
	}
	if err := sshSession.Shell(); err != nil {
		_ = stdin.Close()
		_ = sshSession.Close()
		return nil, err
	}
	if command := initialDirectoryCommand(initialDirectories); command != "" {
		if _, err := stdin.Write([]byte(command)); err != nil {
			_ = stdin.Close()
			_ = sshSession.Close()
			return nil, err
		}
	}

	return &Runtime{
		Client:     client,
		SSHSession: sshSession,
		Stdin:      stdin,
		Stdout:     stdout,
		Stderr:     stderr,
	}, nil
}

func normalizeInitialDirectories(values []string) ([]string, error) {
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if len(value) > maxInitialDirectoryLength || strings.ContainsAny(value, "\x00\r\n") {
			return nil, ErrInvalidInput
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized, nil
}

func initialDirectoryCommand(values []string) string {
	values, err := normalizeInitialDirectories(values)
	if err != nil || len(values) == 0 {
		return ""
	}
	var builder strings.Builder
	for index, value := range values {
		quoted := shellSingleQuote(value)
		if index == 0 {
			builder.WriteString("if [ -d ")
		} else {
			builder.WriteString("; elif [ -d ")
		}
		builder.WriteString(quoted)
		builder.WriteString(" ]; then cd -- ")
		builder.WriteString(quoted)
	}
	builder.WriteString("; fi\n")
	return builder.String()
}

func shellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
