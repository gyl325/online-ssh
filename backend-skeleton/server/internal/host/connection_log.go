package host

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
)

type ConnectionLogEntry struct {
	Level      string    `json:"level"`
	Message    string    `json:"message"`
	OccurredAt time.Time `json:"occurred_at"`
}

type sshConnectionLogBuilder struct {
	host      model.Host
	input     TestConnectionInput
	entries   []ConnectionLogEntry
	clockTime time.Time
}

func buildSSHConnectionLog(hostItem model.Host, input TestConnectionInput, occurredAt time.Time) *sshConnectionLogBuilder {
	if occurredAt.IsZero() {
		occurredAt = time.Now()
	}

	log := &sshConnectionLogBuilder{
		host:      hostItem,
		input:     input,
		clockTime: occurredAt,
	}
	log.add("info", "Starting address resolution of "+strings.TrimSpace(hostItem.Host))
	return log
}

func (l *sshConnectionLogBuilder) addressResolved() {
	l.add("info", "Address resolution finished")
	l.add("info", "Connecting to "+strings.TrimSpace(l.host.Host)+" port "+strconv.Itoa(normalizePort(l.host.Port)))
}

func (l *sshConnectionLogBuilder) authResolved() {
	l.add("info", "Credentials resolved from "+l.credentialSource())
	switch l.host.AuthType {
	case string(model.AuthTypePrivateKey):
		l.add("info", "Using SSH key authentication")
	default:
		l.add("info", "Using password authentication")
	}
}

func (l *sshConnectionLogBuilder) sshSessionStarted() {
	l.add("info", "Starting SSH session")
}

func (l *sshConnectionLogBuilder) authenticationStarted() {
	l.add("info", "Authenticating as "+strings.TrimSpace(l.host.Username))
}

func (l *sshConnectionLogBuilder) connectionEstablished() {
	l.add("success", "Connection to "+strings.TrimSpace(l.host.Host)+" established")
}

func (l *sshConnectionLogBuilder) fingerprintCaptured(fingerprint model.HostFingerprint) {
	if fingerprint.Fingerprint == "" {
		return
	}
	l.add("info", "Checking host key: "+fingerprint.Fingerprint)
}

func (l *sshConnectionLogBuilder) fingerprintTrusted(fingerprint model.HostFingerprint) {
	if fingerprint.Fingerprint == "" {
		return
	}
	l.add("success", "Host key is trusted and matches")
}

func (l *sshConnectionLogBuilder) fingerprintNeedsConfirmation(fingerprint model.HostFingerprint) {
	if fingerprint.Fingerprint == "" {
		return
	}
	l.add("warning", "Host key requires confirmation: "+fingerprint.Fingerprint)
}

func (l *sshConnectionLogBuilder) fingerprintConflict(fingerprint model.HostFingerprint) {
	if fingerprint.Fingerprint == "" {
		return
	}
	l.add("warning", "Host key changed and requires confirmation: "+fingerprint.Fingerprint)
}

func (l *sshConnectionLogBuilder) connectionFailed(message string, cause error) {
	if cause != nil {
		l.add("error", "Connection error: "+cause.Error())
	}
	if strings.TrimSpace(message) != "" {
		l.add("error", "Connection failed: "+message)
	}
}

func (l *sshConnectionLogBuilder) entriesCopy() []ConnectionLogEntry {
	if l == nil || len(l.entries) == 0 {
		return nil
	}
	return append([]ConnectionLogEntry(nil), l.entries...)
}

func (l *sshConnectionLogBuilder) credentialSource() string {
	switch {
	case l.input.Password != nil || l.input.PrivateKey != nil || l.input.Passphrase != nil:
		return "request payload"
	case l.host.CredentialID != nil && strings.TrimSpace(*l.host.CredentialID) != "":
		return "saved credential"
	default:
		return "server-side host data"
	}
}

func (l *sshConnectionLogBuilder) add(level, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	level = strings.TrimSpace(level)
	if level == "" {
		level = "info"
	}
	l.entries = append(l.entries, ConnectionLogEntry{
		Level:      level,
		Message:    message,
		OccurredAt: l.clockTime,
	})
}

func connectionLogFromError(err error) []ConnectionLogEntry {
	var connectionErr *SSHConnectionFailedError
	if errors.As(err, &connectionErr) {
		return connectionErr.ConnectionLog
	}
	return nil
}
