package credential

import (
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestGenerateKeyPairAlgorithms(t *testing.T) {
	tests := []struct {
		algorithm string
		publicKey string
	}{
		{algorithm: "ed25519", publicKey: "ssh-ed25519 "},
		{algorithm: "ecdsa", publicKey: "ecdsa-sha2-nistp256 "},
		{algorithm: "rsa", publicKey: "ssh-rsa "},
	}

	for _, test := range tests {
		t.Run(test.algorithm, func(t *testing.T) {
			keyPair, err := GenerateKeyPair(GenerateKeyPairInput{
				Algorithm: test.algorithm,
				Comment:   "  deploy user@Termix  ",
			})
			if err != nil {
				t.Fatalf("generate key pair: %v", err)
			}

			if keyPair.Algorithm != test.algorithm {
				t.Fatalf("expected algorithm %q, got %q", test.algorithm, keyPair.Algorithm)
			}
			if !strings.Contains(keyPair.PrivateKey, "BEGIN TEST OPENSSH PRIVATE KEY") {
				t.Fatalf("expected OpenSSH private key, got %q", keyPair.PrivateKey[:min(len(keyPair.PrivateKey), 40)])
			}
			if _, err := ssh.ParseRawPrivateKey([]byte(keyPair.PrivateKey)); err != nil {
				t.Fatalf("private key should parse: %v", err)
			}
			if !strings.HasPrefix(keyPair.AuthorizedKeyLine, test.publicKey) {
				t.Fatalf("unexpected public key prefix: %q", keyPair.AuthorizedKeyLine)
			}
			if !strings.HasSuffix(keyPair.AuthorizedKeyLine, "deploy_user@Termix") {
				t.Fatalf("expected sanitized comment, got %q", keyPair.AuthorizedKeyLine)
			}
			if !strings.Contains(keyPair.DeployCommand, "authorized_keys") || !strings.Contains(keyPair.DeployCommand, shellSingleQuote(keyPair.AuthorizedKeyLine)) {
				t.Fatalf("deploy command does not include quoted public key: %q", keyPair.DeployCommand)
			}
		})
	}
}

func TestGenerateKeyPairRejectsInvalidAlgorithm(t *testing.T) {
	if _, err := GenerateKeyPair(GenerateKeyPairInput{Algorithm: "dsa"}); err != ErrInvalidInput {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}
