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

func newRuntime(client *ssh.Client, rows, cols int, initialDirectory string) (*Runtime, error) {
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
	if command := initialDirectoryCommand(initialDirectory); command != "" {
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

func normalizeInitialDirectory(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if len(value) > maxInitialDirectoryLength || strings.ContainsAny(value, "\x00\r\n") {
		return "", ErrInvalidInput
	}
	return value, nil
}

func initialDirectoryCommand(value string) string {
	value, err := normalizeInitialDirectory(value)
	if err != nil || value == "" {
		return ""
	}
	return "cd -- " + shellSingleQuote(value) + "\n"
}

func shellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
