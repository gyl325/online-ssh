package credential

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

var (
	ErrInvalidKeyRing        = errors.New("invalid credential key ring")
	ErrCredentialKeyNotFound = errors.New("credential key version is not configured")
)

type AESEncryptor struct {
	key []byte
}

func NewAESEncryptor(masterKey string) *AESEncryptor {
	sum := sha256.Sum256([]byte(masterKey))
	return &AESEncryptor{key: sum[:]}
}

func (e *AESEncryptor) Encrypt(plain string) (string, error) {
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

func (e *AESEncryptor) Decrypt(cipherText string) (string, error) {
	block, err := aes.NewCipher(e.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	raw, err := base64.StdEncoding.DecodeString(cipherText)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid ciphertext")
	}

	nonce := raw[:gcm.NonceSize()]
	cipherBytes := raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, cipherBytes, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

type EncryptedValue struct {
	CipherText string
	KeyVersion int
}

type VersionedEncryptor interface {
	Encrypt(plain string) (string, error)
	Decrypt(cipherText string) (string, error)
	EncryptWithActiveVersion(plain string) (EncryptedValue, error)
	DecryptWithVersion(cipherText string, keyVersion int) (string, error)
	ActiveKeyVersion() int
	ConfiguredKeyVersions() []int
	IsKeyVersionConfigured(keyVersion int) bool
}

type KeyRingEncryptor struct {
	activeVersion int
	keys          map[int]*AESEncryptor
}

func NewKeyRingEncryptor(keys map[int]string, activeVersion int) (*KeyRingEncryptor, error) {
	if activeVersion <= 0 {
		return nil, fmt.Errorf("%w: active key version must be positive", ErrInvalidKeyRing)
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("%w: at least one key is required", ErrInvalidKeyRing)
	}

	encryptors := make(map[int]*AESEncryptor, len(keys))
	for version, key := range keys {
		if version <= 0 {
			return nil, fmt.Errorf("%w: key version must be positive", ErrInvalidKeyRing)
		}
		if strings.TrimSpace(key) == "" {
			return nil, fmt.Errorf("%w: key version %d is empty", ErrInvalidKeyRing, version)
		}
		encryptors[version] = NewAESEncryptor(key)
	}
	if _, ok := encryptors[activeVersion]; !ok {
		return nil, fmt.Errorf("%w: active key version %d is missing", ErrInvalidKeyRing, activeVersion)
	}

	return &KeyRingEncryptor{
		activeVersion: activeVersion,
		keys:          encryptors,
	}, nil
}

func NewKeyRingEncryptorFromConfig(masterKey, keyRing string, activeVersion int) (*KeyRingEncryptor, error) {
	if strings.TrimSpace(keyRing) == "" {
		if strings.TrimSpace(masterKey) == "" {
			return nil, fmt.Errorf("%w: CREDENTIAL_MASTER_KEY or CREDENTIAL_KEY_RING is required", ErrInvalidKeyRing)
		}
		if activeVersion == 0 {
			activeVersion = 1
		}
		if activeVersion != 1 {
			return nil, fmt.Errorf("%w: CREDENTIAL_ACTIVE_KEY_VERSION requires CREDENTIAL_KEY_RING when not 1", ErrInvalidKeyRing)
		}
		return NewKeyRingEncryptor(map[int]string{1: masterKey}, 1)
	}

	if activeVersion <= 0 {
		return nil, fmt.Errorf("%w: CREDENTIAL_ACTIVE_KEY_VERSION is required when CREDENTIAL_KEY_RING is set", ErrInvalidKeyRing)
	}
	keys, err := ParseKeyRing(keyRing)
	if err != nil {
		return nil, err
	}
	return NewKeyRingEncryptor(keys, activeVersion)
}

func ParseKeyRing(value string) (map[int]string, error) {
	keys := make(map[int]string)
	for _, entry := range strings.Split(value, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		versionText, keyText, ok := strings.Cut(entry, ":")
		if !ok {
			return nil, fmt.Errorf("%w: entry %q must use version:key", ErrInvalidKeyRing, entry)
		}
		version, err := strconv.Atoi(strings.TrimSpace(versionText))
		if err != nil || version <= 0 {
			return nil, fmt.Errorf("%w: entry %q has invalid version", ErrInvalidKeyRing, entry)
		}
		if _, exists := keys[version]; exists {
			return nil, fmt.Errorf("%w: duplicate key version %d", ErrInvalidKeyRing, version)
		}
		key := strings.TrimSpace(keyText)
		if key == "" {
			return nil, fmt.Errorf("%w: key version %d is empty", ErrInvalidKeyRing, version)
		}
		keys[version] = key
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("%w: no valid key ring entries", ErrInvalidKeyRing)
	}
	return keys, nil
}

func (e *KeyRingEncryptor) Encrypt(plain string) (string, error) {
	value, err := e.EncryptWithActiveVersion(plain)
	if err != nil {
		return "", err
	}
	return value.CipherText, nil
}

func (e *KeyRingEncryptor) Decrypt(cipherText string) (string, error) {
	return e.DecryptWithVersion(cipherText, e.activeVersion)
}

func (e *KeyRingEncryptor) EncryptWithActiveVersion(plain string) (EncryptedValue, error) {
	encryptor := e.keys[e.activeVersion]
	if encryptor == nil {
		return EncryptedValue{}, fmt.Errorf("%w: %d", ErrCredentialKeyNotFound, e.activeVersion)
	}
	cipherText, err := encryptor.Encrypt(plain)
	if err != nil {
		return EncryptedValue{}, err
	}
	return EncryptedValue{
		CipherText: cipherText,
		KeyVersion: e.activeVersion,
	}, nil
}

func (e *KeyRingEncryptor) DecryptWithVersion(cipherText string, keyVersion int) (string, error) {
	encryptor := e.keys[keyVersion]
	if encryptor == nil {
		return "", fmt.Errorf("%w: %d", ErrCredentialKeyNotFound, keyVersion)
	}
	return encryptor.Decrypt(cipherText)
}

func (e *KeyRingEncryptor) ActiveKeyVersion() int {
	return e.activeVersion
}

func (e *KeyRingEncryptor) ConfiguredKeyVersions() []int {
	versions := make([]int, 0, len(e.keys))
	for version := range e.keys {
		versions = append(versions, version)
	}
	sort.Ints(versions)
	return versions
}

func (e *KeyRingEncryptor) IsKeyVersionConfigured(keyVersion int) bool {
	_, ok := e.keys[keyVersion]
	return ok
}

func EncryptWithActiveVersion(encryptor Encryptor, plain string) (EncryptedValue, error) {
	if encryptor == nil {
		return EncryptedValue{}, ErrInvalidInput
	}
	if versioned, ok := encryptor.(VersionedEncryptor); ok {
		return versioned.EncryptWithActiveVersion(plain)
	}
	cipherText, err := encryptor.Encrypt(plain)
	if err != nil {
		return EncryptedValue{}, err
	}
	return EncryptedValue{
		CipherText: cipherText,
		KeyVersion: 1,
	}, nil
}

func DecryptWithVersion(encryptor Encryptor, cipherText string, keyVersion int) (string, error) {
	if encryptor == nil {
		return "", ErrInvalidInput
	}
	if versioned, ok := encryptor.(VersionedEncryptor); ok {
		return versioned.DecryptWithVersion(cipherText, keyVersion)
	}
	if keyVersion > 1 {
		return "", fmt.Errorf("%w: %d", ErrCredentialKeyNotFound, keyVersion)
	}
	return encryptor.Decrypt(cipherText)
}
