package credential

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"fmt"
	"strings"

	"golang.org/x/crypto/ssh"
)

type KeyPairAlgorithm string

const (
	KeyPairAlgorithmED25519 KeyPairAlgorithm = "ed25519"
	KeyPairAlgorithmECDSA   KeyPairAlgorithm = "ecdsa"
	KeyPairAlgorithmRSA     KeyPairAlgorithm = "rsa"

	defaultRSAKeyBits = 4096
)

type GenerateKeyPairInput struct {
	Algorithm string `json:"algorithm"`
	Comment   string `json:"comment"`
}

type GeneratedKeyPair struct {
	Algorithm         string `json:"algorithm"`
	PrivateKey        string `json:"private_key"`
	PublicKey         string `json:"public_key"`
	AuthorizedKeyLine string `json:"authorized_key_line"`
	DeployCommand     string `json:"deploy_command"`
}

func GenerateKeyPair(input GenerateKeyPairInput) (GeneratedKeyPair, error) {
	algorithm := normalizeKeyPairAlgorithm(input.Algorithm)
	if algorithm == "" {
		return GeneratedKeyPair{}, ErrInvalidInput
	}

	privateKey, publicKey, err := generateSignerKeys(algorithm)
	if err != nil {
		return GeneratedKeyPair{}, err
	}
	privateKeyBlock, err := ssh.MarshalPrivateKey(privateKey, "")
	if err != nil {
		return GeneratedKeyPair{}, err
	}
	privateKeyPEM := pem.EncodeToMemory(privateKeyBlock)
	if len(privateKeyPEM) == 0 {
		return GeneratedKeyPair{}, fmt.Errorf("marshal private key pem failed")
	}

	authorizedKeyLine := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(publicKey)))
	comment := strings.TrimSpace(input.Comment)
	if comment != "" {
		authorizedKeyLine += " " + sanitizeAuthorizedKeyComment(comment)
	}

	return GeneratedKeyPair{
		Algorithm:         string(algorithm),
		PrivateKey:        string(privateKeyPEM),
		PublicKey:         authorizedKeyLine,
		AuthorizedKeyLine: authorizedKeyLine,
		DeployCommand:     buildAuthorizedKeysDeployCommand(authorizedKeyLine),
	}, nil
}

func normalizeKeyPairAlgorithm(value string) KeyPairAlgorithm {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", string(KeyPairAlgorithmED25519):
		return KeyPairAlgorithmED25519
	case string(KeyPairAlgorithmECDSA):
		return KeyPairAlgorithmECDSA
	case string(KeyPairAlgorithmRSA):
		return KeyPairAlgorithmRSA
	default:
		return ""
	}
}

func generateSignerKeys(algorithm KeyPairAlgorithm) (any, ssh.PublicKey, error) {
	switch algorithm {
	case KeyPairAlgorithmED25519:
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, nil, err
		}
		sshPublicKey, err := ssh.NewPublicKey(publicKey)
		return privateKey, sshPublicKey, err
	case KeyPairAlgorithmECDSA:
		privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return nil, nil, err
		}
		sshPublicKey, err := ssh.NewPublicKey(&privateKey.PublicKey)
		return privateKey, sshPublicKey, err
	case KeyPairAlgorithmRSA:
		privateKey, err := rsa.GenerateKey(rand.Reader, defaultRSAKeyBits)
		if err != nil {
			return nil, nil, err
		}
		sshPublicKey, err := ssh.NewPublicKey(&privateKey.PublicKey)
		return privateKey, sshPublicKey, err
	default:
		return nil, nil, ErrInvalidInput
	}
}

func sanitizeAuthorizedKeyComment(value string) string {
	fields := strings.Fields(value)
	return strings.Join(fields, "_")
}

func buildAuthorizedKeysDeployCommand(authorizedKeyLine string) string {
	quotedKey := shellSingleQuote(authorizedKeyLine)
	return fmt.Sprintf("mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo %s >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys", quotedKey)
}

func shellSingleQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
