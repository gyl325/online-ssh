package credential

import (
	"errors"
	"testing"
)

func TestAESEncryptorRoundTrip(t *testing.T) {
	encryptor := NewAESEncryptor("master-key")

	cipherText, err := encryptor.Encrypt("secret")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if cipherText == "" || cipherText == "secret" {
		t.Fatalf("expected non-empty encrypted value different from plaintext, got %q", cipherText)
	}

	plain, err := encryptor.Decrypt(cipherText)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if plain != "secret" {
		t.Fatalf("expected plaintext %q, got %q", "secret", plain)
	}
}

func TestAESEncryptorRejectsInvalidCiphertext(t *testing.T) {
	encryptor := NewAESEncryptor("master-key")

	tests := []struct {
		name       string
		cipherText string
	}{
		{name: "not base64", cipherText: "not-base64"},
		{name: "too short", cipherText: "c2hvcnQ="},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := encryptor.Decrypt(tt.cipherText); err == nil {
				t.Fatal("expected decrypt error")
			}
		})
	}
}

func TestAESEncryptorRejectsWrongKey(t *testing.T) {
	cipherText, err := NewAESEncryptor("master-key").Encrypt("secret")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	if _, err := NewAESEncryptor("other-key").Decrypt(cipherText); err == nil {
		t.Fatal("expected decrypt error with wrong key")
	}
}

func TestKeyRingEncryptorConfigCompatibility(t *testing.T) {
	encryptor, err := NewKeyRingEncryptorFromConfig("legacy-master", "", 0)
	if err != nil {
		t.Fatalf("build legacy key ring: %v", err)
	}
	if encryptor.ActiveKeyVersion() != 1 {
		t.Fatalf("expected active version 1, got %d", encryptor.ActiveKeyVersion())
	}

	value, err := encryptor.EncryptWithActiveVersion("secret")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if value.KeyVersion != 1 {
		t.Fatalf("expected encrypted key version 1, got %d", value.KeyVersion)
	}

	plain, err := encryptor.DecryptWithVersion(value.CipherText, value.KeyVersion)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if plain != "secret" {
		t.Fatalf("expected plaintext secret, got %q", plain)
	}
}

func TestKeyRingEncryptorDecryptsOldVersionWithNewActiveVersion(t *testing.T) {
	oldActive, err := NewKeyRingEncryptorFromConfig("", "1:old-master,2:new-master", 1)
	if err != nil {
		t.Fatalf("build old active key ring: %v", err)
	}
	oldValue, err := oldActive.EncryptWithActiveVersion("secret")
	if err != nil {
		t.Fatalf("encrypt old value: %v", err)
	}

	newActive, err := NewKeyRingEncryptorFromConfig("", "1:old-master,2:new-master", 2)
	if err != nil {
		t.Fatalf("build new active key ring: %v", err)
	}
	newValue, err := newActive.EncryptWithActiveVersion("fresh")
	if err != nil {
		t.Fatalf("encrypt new value: %v", err)
	}
	if newValue.KeyVersion != 2 {
		t.Fatalf("expected new value key version 2, got %d", newValue.KeyVersion)
	}

	plain, err := newActive.DecryptWithVersion(oldValue.CipherText, oldValue.KeyVersion)
	if err != nil {
		t.Fatalf("decrypt old value: %v", err)
	}
	if plain != "secret" {
		t.Fatalf("expected old plaintext secret, got %q", plain)
	}
}

func TestKeyRingEncryptorRejectsInvalidConfig(t *testing.T) {
	tests := []struct {
		name          string
		masterKey     string
		keyRing       string
		activeVersion int
	}{
		{name: "missing all keys"},
		{name: "ring missing active", keyRing: "1:old,2:new"},
		{name: "active not configured", keyRing: "1:old", activeVersion: 2},
		{name: "invalid entry", keyRing: "bad-entry", activeVersion: 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := NewKeyRingEncryptorFromConfig(tt.masterKey, tt.keyRing, tt.activeVersion); !errors.Is(err, ErrInvalidKeyRing) {
				t.Fatalf("expected ErrInvalidKeyRing, got %v", err)
			}
		})
	}
}

func TestDecryptWithVersionRejectsMissingVersion(t *testing.T) {
	encryptor, err := NewKeyRingEncryptorFromConfig("", "1:old,2:new", 2)
	if err != nil {
		t.Fatalf("build key ring: %v", err)
	}

	if _, err := encryptor.DecryptWithVersion("cipher", 9); !errors.Is(err, ErrCredentialKeyNotFound) {
		t.Fatalf("expected ErrCredentialKeyNotFound, got %v", err)
	}

	if _, err := DecryptWithVersion(NewAESEncryptor("legacy"), "cipher", 2); !errors.Is(err, ErrCredentialKeyNotFound) {
		t.Fatalf("expected legacy decrypt to reject non-v1 key version, got %v", err)
	}
}
