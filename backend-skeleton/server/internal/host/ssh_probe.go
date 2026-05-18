package host

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
	"golang.org/x/crypto/ssh"
)

const defaultSSHTestTimeout = 10 * time.Second

type sshProbeResult struct {
	client      *ssh.Client
	fingerprint *model.HostFingerprint
}

func dialSSH(ctx context.Context, host model.Host, authMethod ssh.AuthMethod) (sshProbeResult, error) {
	return dialSSHWithLog(ctx, host, authMethod, nil)
}

func dialSSHWithLog(ctx context.Context, host model.Host, authMethod ssh.AuthMethod, log *sshConnectionLogBuilder) (sshProbeResult, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultSSHTestTimeout)
	defer cancel()

	result := sshProbeResult{}
	if log != nil {
		log.addressResolved()
	}
	clientConfig := &ssh.ClientConfig{
		User:            host.Username,
		Auth:            []ssh.AuthMethod{authMethod},
		HostKeyCallback: captureHostFingerprint(&result),
		Timeout:         defaultSSHTestTimeout,
	}

	address := net.JoinHostPort(host.Host, strconv.Itoa(normalizePort(host.Port)))
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", address)
	if err != nil {
		if log != nil {
			log.connectionFailed(classifySSHProbeError(err), err)
		}
		return result, err
	}
	if log != nil {
		log.sshSessionStarted()
		log.authenticationStarted()
	}

	sshConn, chans, reqs, err := ssh.NewClientConn(conn, address, clientConfig)
	if err != nil {
		_ = conn.Close()
		if log != nil {
			log.connectionFailed(classifySSHProbeError(err), err)
		}
		return result, err
	}

	result.client = ssh.NewClient(sshConn, chans, reqs)
	if log != nil {
		log.connectionEstablished()
	}
	return result, nil
}

func probeSSH(ctx context.Context, host model.Host, authMethod ssh.AuthMethod) (sshProbeResult, error) {
	result, err := dialSSH(ctx, host, authMethod)
	if result.client != nil {
		defer result.client.Close()
	}
	return sshProbeResult{fingerprint: result.fingerprint}, err
}

func captureHostFingerprint(result *sshProbeResult) ssh.HostKeyCallback {
	return func(_ string, _ net.Addr, key ssh.PublicKey) error {
		fingerprint := model.HostFingerprint{
			Algorithm:      key.Type(),
			Fingerprint:    ssh.FingerprintSHA256(key),
			Status:         string(model.FingerprintStatusChanged),
			FirstSeenAt:    time.Now(),
			LastVerifiedAt: nil,
		}
		result.fingerprint = &fingerprint
		return nil
	}
}

func parsePrivateKeyAuth(privateKey, passphrase string) (ssh.AuthMethod, error) {
	var (
		signer ssh.Signer
		err    error
	)

	if strings.TrimSpace(passphrase) != "" {
		signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(privateKey), []byte(passphrase))
	} else {
		signer, err = ssh.ParsePrivateKey([]byte(privateKey))
	}
	if err != nil {
		return nil, fmt.Errorf("parse private key: %w", err)
	}

	return ssh.PublicKeys(signer), nil
}

func classifySSHProbeError(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, context.DeadlineExceeded):
		return "SSH connection timed out"
	case errors.Is(err, context.Canceled):
		return "SSH connection canceled"
	}

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "SSH connection timed out"
	}

	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "unable to authenticate"):
		return "SSH authentication failed"
	case strings.Contains(message, "no supported methods remain"):
		return "SSH authentication failed"
	case strings.Contains(message, "permission denied"):
		return "SSH authentication failed"
	case strings.Contains(message, "connection refused"):
		return "TCP connection refused"
	case strings.Contains(message, "no route to host"):
		return "host is unreachable"
	case strings.Contains(message, "network is unreachable"):
		return "host is unreachable"
	case strings.Contains(message, "connection reset by peer"):
		return "connection reset by peer"
	case strings.Contains(message, "handshake failed"):
		return "SSH handshake failed"
	default:
		return "SSH connectivity test failed"
	}
}
