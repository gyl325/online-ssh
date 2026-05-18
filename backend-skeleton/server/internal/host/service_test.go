package host

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/model"
)

func TestNormalizePort(t *testing.T) {
	t.Run("defaults zero port to 22", func(t *testing.T) {
		if got := normalizePort(0); got != 22 {
			t.Fatalf("expected 22, got %d", got)
		}
	})

	t.Run("keeps explicit port", func(t *testing.T) {
		if got := normalizePort(2202); got != 2202 {
			t.Fatalf("expected 2202, got %d", got)
		}
	})
}

func TestEvaluateFingerprintTrust(t *testing.T) {
	current := &model.HostFingerprint{
		Algorithm:   "ssh-ed25519",
		Fingerprint: "SHA256:new",
	}

	t.Run("needs confirmation when no trusted fingerprint exists", func(t *testing.T) {
		_, previous, state := evaluateFingerprintTrust(current, nil)
		if previous != nil {
			t.Fatalf("expected no previous fingerprint, got %#v", previous)
		}
		if state != trustStateNeedsConfirmation {
			t.Fatalf("expected needs confirmation, got %s", state)
		}
	})

	t.Run("matches when the same fingerprint is already trusted", func(t *testing.T) {
		trusted := []model.HostFingerprint{
			{Algorithm: "ssh-ed25519", Fingerprint: "SHA256:new", Status: string(model.FingerprintStatusTrusted)},
		}
		matched, previous, state := evaluateFingerprintTrust(current, trusted)
		if matched.Fingerprint != "SHA256:new" {
			t.Fatalf("expected matched fingerprint, got %#v", matched)
		}
		if previous == nil || previous.Fingerprint != "SHA256:new" {
			t.Fatalf("expected previous matched fingerprint, got %#v", previous)
		}
		if state != trustStateMatched {
			t.Fatalf("expected matched state, got %s", state)
		}
	})

	t.Run("conflicts when same algorithm has a different fingerprint", func(t *testing.T) {
		trusted := []model.HostFingerprint{
			{Algorithm: "ssh-ed25519", Fingerprint: "SHA256:old", Status: string(model.FingerprintStatusTrusted)},
		}
		_, previous, state := evaluateFingerprintTrust(current, trusted)
		if previous == nil || previous.Fingerprint != "SHA256:old" {
			t.Fatalf("expected previous conflicting fingerprint, got %#v", previous)
		}
		if state != trustStateConflict {
			t.Fatalf("expected conflict state, got %s", state)
		}
	})

	t.Run("conflicts against the first trusted fingerprint when algorithms differ", func(t *testing.T) {
		trusted := []model.HostFingerprint{
			{Algorithm: "rsa-sha2-512", Fingerprint: "SHA256:first", Status: string(model.FingerprintStatusTrusted)},
			{Algorithm: "ecdsa-sha2-nistp256", Fingerprint: "SHA256:second", Status: string(model.FingerprintStatusTrusted)},
		}
		_, previous, state := evaluateFingerprintTrust(current, trusted)
		if previous == nil || previous.Fingerprint != "SHA256:first" {
			t.Fatalf("expected first trusted fingerprint as fallback, got %#v", previous)
		}
		if state != trustStateConflict {
			t.Fatalf("expected conflict state, got %s", state)
		}
	})
}

func TestClassifySSHProbeError(t *testing.T) {
	t.Run("returns empty string for nil error", func(t *testing.T) {
		if got := classifySSHProbeError(nil); got != "" {
			t.Fatalf("expected empty string, got %q", got)
		}
	})

	t.Run("maps context deadline exceeded", func(t *testing.T) {
		if got := classifySSHProbeError(context.DeadlineExceeded); got != "SSH connection timed out" {
			t.Fatalf("unexpected classification: %q", got)
		}
	})

	t.Run("maps permission denied to authentication failure", func(t *testing.T) {
		if got := classifySSHProbeError(errors.New("Permission denied")); got != "SSH authentication failed" {
			t.Fatalf("unexpected classification: %q", got)
		}
	})

	t.Run("maps connection refused", func(t *testing.T) {
		if got := classifySSHProbeError(errors.New("dial tcp: connection refused")); got != "TCP connection refused" {
			t.Fatalf("unexpected classification: %q", got)
		}
	})

	t.Run("falls back to generic message", func(t *testing.T) {
		if got := classifySSHProbeError(errors.New("random failure")); got != "SSH connectivity test failed" {
			t.Fatalf("unexpected classification: %q", got)
		}
	})
}

func TestConnectionLogBuilderRecordsSafeSSHStages(t *testing.T) {
	startedAt := time.Date(2026, 5, 3, 22, 30, 0, 0, time.UTC)
	privateKey := "-----BEGIN TEST OPENSSH PRIVATE KEY-----\nsecret-private-key\n-----END TEST OPENSSH PRIVATE KEY-----"
	passphrase := "secret-passphrase"
	hostItem := model.Host{
		Host:     "203.0.113.227",
		Port:     221,
		Username: "gyl",
		AuthType: string(model.AuthTypePrivateKey),
	}

	log := buildSSHConnectionLog(hostItem, TestConnectionInput{
		PrivateKey: &privateKey,
		Passphrase: &passphrase,
	}, startedAt)
	log.addressResolved()
	log.authResolved()
	log.sshSessionStarted()
	log.authenticationStarted()
	log.connectionFailed(
		"SSH authentication failed",
		errors.New("ssh: unable to authenticate, attempted methods [none publickey], no supported methods remain"),
	)

	if len(log.entries) < 6 {
		t.Fatalf("expected connection log entries, got %#v", log.entries)
	}

	messages := connectionLogMessages(log.entries)
	for _, want := range []string{
		"Starting address resolution of 203.0.113.227",
		"Address resolution finished",
		"Connecting to 203.0.113.227 port 221",
		"Credentials resolved from request payload",
		"Using SSH key authentication",
		"Starting SSH session",
		"Authenticating as gyl",
		"Connection error: ssh: unable to authenticate, attempted methods [none publickey], no supported methods remain",
		"Connection failed: SSH authentication failed",
	} {
		if !strings.Contains(messages, want) {
			t.Fatalf("expected log to contain %q, got:\n%s", want, messages)
		}
	}
	for _, secret := range []string{privateKey, "secret-private-key", passphrase} {
		if strings.Contains(messages, secret) {
			t.Fatalf("connection log leaked secret %q in:\n%s", secret, messages)
		}
	}
	for _, entry := range log.entries {
		if !entry.OccurredAt.Equal(startedAt) {
			t.Fatalf("expected stable occurrence time, got %#v", entry)
		}
	}
}

func connectionLogMessages(entries []ConnectionLogEntry) string {
	var messages []string
	for _, entry := range entries {
		messages = append(messages, entry.Message)
	}
	return strings.Join(messages, "\n")
}

func TestParseHostMetricsCommandOutput(t *testing.T) {
	now := time.Date(2026, 5, 3, 12, 0, 0, 0, time.UTC)

	metrics, err := parseHostMetricsCommandOutput("host-1", strings.Join([]string{
		"CPU_USAGE_PERCENT=12.5",
		"MEMORY_USAGE_PERCENT=41.8",
		"MEMORY_USED_BYTES=1717986918",
		"MEMORY_TOTAL_BYTES=4294967296",
		"DISK_USAGE_PERCENT=67",
		"DISK_USED_BYTES=10737418240",
		"DISK_TOTAL_BYTES=21474836480",
		"UPTIME_SECONDS=512088",
		"GPU_USAGE_PERCENT=64",
		"HOSTNAME=prod-node",
		"OS_NAME=Ubuntu 22.04.2 LTS",
		"KERNEL=6.8.0-101-generic",
		"SSH_USER=root",
		"SSH_CLIENT=203.0.113.8 55000 22",
		"ACTIVE_LOGIN_COUNT=3",
		"LAST_LOGIN=Sun May  3 11:43:02 2026 from 203.0.113.8",
		"RECENT_LOGIN_1=operator pts/1 198.51.100.43 Sun May 3 19:07 still logged in",
		"RECENT_LOGIN_2=deploy pts/2 198.51.100.20 Sun May 3 18:42 - 18:58  (00:16)",
		"RECENT_LOGIN_3=operator pts/3 198.51.100.43 Sun May 3 17:11 - 17:30  (00:19)",
	}, "\n"), now)
	if err != nil {
		t.Fatalf("parse metrics: %v", err)
	}

	if metrics.HostID != "host-1" || !metrics.CollectedAt.Equal(now) {
		t.Fatalf("unexpected metrics identity: %#v", metrics)
	}
	if metrics.CPUUsagePercent == nil || *metrics.CPUUsagePercent != 12.5 {
		t.Fatalf("expected CPU usage 12.5, got %#v", metrics.CPUUsagePercent)
	}
	if metrics.MemoryUsagePercent == nil || *metrics.MemoryUsagePercent != 41.8 || metrics.MemoryUsedBytes == nil || *metrics.MemoryUsedBytes != 1717986918 {
		t.Fatalf("unexpected memory metrics: %#v", metrics)
	}
	if metrics.DiskUsagePercent == nil || *metrics.DiskUsagePercent != 67 || metrics.UptimeSeconds == nil || *metrics.UptimeSeconds != 512088 {
		t.Fatalf("unexpected disk/uptime metrics: %#v", metrics)
	}
	if metrics.GPUUsagePercent == nil || *metrics.GPUUsagePercent != 64 {
		t.Fatalf("expected GPU usage 64, got %#v", metrics.GPUUsagePercent)
	}
	if metrics.System.Hostname != "prod-node" || metrics.System.Kernel != "6.8.0-101-generic" || metrics.System.OSName != "Ubuntu 22.04.2 LTS" {
		t.Fatalf("unexpected system info: %#v", metrics.System)
	}
	if metrics.SSH.User != "root" || metrics.SSH.Client != "203.0.113.8 55000 22" || metrics.Login.ActiveLoginCount == nil || *metrics.Login.ActiveLoginCount != 3 {
		t.Fatalf("unexpected SSH/login info: %#v %#v", metrics.SSH, metrics.Login)
	}
	if len(metrics.Login.RecentLogins) != 3 {
		t.Fatalf("expected 3 recent login records, got %#v", metrics.Login.RecentLogins)
	}
	if metrics.Login.RecentLogins[1] != "deploy pts/2 198.51.100.20 Sun May 3 18:42 - 18:58  (00:16)" {
		t.Fatalf("unexpected recent login records: %#v", metrics.Login.RecentLogins)
	}
}

func TestResolvePasswordUsesCredentialKeyVersion(t *testing.T) {
	oldActive, err := credential.NewKeyRingEncryptor(map[int]string{
		1: "old-master",
		2: "new-master",
	}, 1)
	if err != nil {
		t.Fatalf("build old active encryptor: %v", err)
	}
	cipherText, err := oldActive.Encrypt("secret")
	if err != nil {
		t.Fatalf("encrypt old credential: %v", err)
	}

	newActive, err := credential.NewKeyRingEncryptor(map[int]string{
		1: "old-master",
		2: "new-master",
	}, 2)
	if err != nil {
		t.Fatalf("build new active encryptor: %v", err)
	}
	service := NewService(nil, nil, nil, newActive, nil)

	password, err := service.resolvePassword(TestConnectionInput{}, &model.Credential{
		AuthType:        string(model.AuthTypePassword),
		EncryptedSecret: &cipherText,
		KeyVersion:      1,
	})
	if err != nil {
		t.Fatalf("resolve password: %v", err)
	}
	if password != "secret" {
		t.Fatalf("expected decrypted password, got %q", password)
	}
}

func TestApplyTestConnectionOverrides(t *testing.T) {
	t.Run("uses auth method and credential from test input without mutating the stored host", func(t *testing.T) {
		storedCredentialID := "cred-password"
		testCredentialID := "cred-key"
		item := model.Host{
			CredentialID: &storedCredentialID,
			Host:         "stored.example.com",
			Port:         22,
			Username:     "stored",
			AuthType:     string(model.AuthTypePassword),
		}
		testPort := 2202

		got, err := applyTestConnectionOverrides(item, TestConnectionInput{
			Host:         stringRef(" edited.example.com "),
			Port:         &testPort,
			Username:     stringRef(" deploy "),
			AuthType:     stringRef(string(model.AuthTypePrivateKey)),
			CredentialID: &testCredentialID,
		})
		if err != nil {
			t.Fatalf("apply overrides: %v", err)
		}

		if got.AuthType != string(model.AuthTypePrivateKey) {
			t.Fatalf("expected private key auth type, got %q", got.AuthType)
		}
		if got.Host != "edited.example.com" || got.Port != 2202 || got.Username != "deploy" {
			t.Fatalf("expected edited connection target, got %#v", got)
		}
		if got.CredentialID == nil || *got.CredentialID != testCredentialID {
			t.Fatalf("expected test credential id, got %#v", got.CredentialID)
		}
		if item.CredentialID == nil || *item.CredentialID != storedCredentialID || item.AuthType != string(model.AuthTypePassword) || item.Host != "stored.example.com" {
			t.Fatalf("stored host was mutated: %#v", item)
		}
	})

	t.Run("clears credential when credential_id is explicitly empty", func(t *testing.T) {
		storedCredentialID := "cred-password"
		got, err := applyTestConnectionOverrides(model.Host{
			CredentialID: &storedCredentialID,
			AuthType:     string(model.AuthTypePassword),
		}, TestConnectionInput{
			CredentialID: stringRef(""),
		})
		if err != nil {
			t.Fatalf("apply overrides: %v", err)
		}
		if got.CredentialID != nil {
			t.Fatalf("expected cleared credential id, got %#v", got.CredentialID)
		}
	})

	t.Run("rejects invalid auth type override", func(t *testing.T) {
		_, err := applyTestConnectionOverrides(model.Host{
			AuthType: string(model.AuthTypePassword),
		}, TestConnectionInput{
			AuthType: stringRef("keyboard_interactive"),
		})
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
	})

	t.Run("rejects invalid edited connection target", func(t *testing.T) {
		invalidPort := 70000
		_, err := applyTestConnectionOverrides(model.Host{
			Host:     "stored.example.com",
			Port:     22,
			Username: "stored",
			AuthType: string(model.AuthTypePassword),
		}, TestConnectionInput{
			Host:     stringRef(""),
			Port:     &invalidPort,
			Username: stringRef("deploy"),
		})
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput, got %v", err)
		}
	})
}

func TestCreateTemporaryConnectionStoresPasswordWithoutRepository(t *testing.T) {
	service := NewService(nil, nil, nil, nil, nil)

	item, err := service.CreateTemporaryConnection(context.Background(), TemporaryConnectionInput{
		UserID:   "user-1",
		Host:     " 203.0.113.40 ",
		Port:     0,
		Username: " root ",
		AuthType: string(model.AuthTypePassword),
		Password: " secret-password ",
	})
	if err != nil {
		t.Fatalf("create temporary connection: %v", err)
	}

	if !strings.HasPrefix(item.ID, "tmp-host-") {
		t.Fatalf("expected temporary host id, got %q", item.ID)
	}
	if item.CredentialID != nil || item.Host != "203.0.113.40" || item.Port != 22 || item.Username != "root" {
		t.Fatalf("unexpected temporary host response: %#v", item)
	}
	stored, ok := service.temporaryConnections.Get("user-1", item.ID)
	if !ok {
		t.Fatalf("expected connection to be stored")
	}
	if stored.Password != "secret-password" || stored.PrivateKey != "" {
		t.Fatalf("unexpected stored secret material: %#v", stored)
	}
}

func stringRef(value string) *string {
	return &value
}
