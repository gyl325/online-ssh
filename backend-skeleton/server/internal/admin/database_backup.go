package admin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/model"
)

const databaseBackupSchemaVersion = 1

type DatabaseBackup struct {
	SchemaVersion int                        `json:"schema_version"`
	ExportedAt    time.Time                  `json:"exported_at"`
	HostGroups    []DatabaseHostGroupBackup  `json:"host_groups"`
	Credentials   []DatabaseCredentialBackup `json:"credentials"`
	Hosts         []DatabaseHostBackup       `json:"hosts"`
}

type DatabaseHostGroupBackup struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type DatabaseCredentialBackup struct {
	ID                  string    `json:"id"`
	UserID              string    `json:"user_id"`
	Name                string    `json:"name"`
	AuthType            string    `json:"auth_type"`
	EncryptedSecret     *string   `json:"encrypted_secret,omitempty"`
	EncryptedPrivateKey *string   `json:"encrypted_private_key,omitempty"`
	EncryptedPassphrase *string   `json:"encrypted_passphrase,omitempty"`
	KeyVersion          int       `json:"key_version"`
	ContentHash         string    `json:"content_hash"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type DatabaseHostBackup struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	GroupID         *string    `json:"group_id"`
	CredentialID    *string    `json:"credential_id"`
	Name            string     `json:"name"`
	Host            string     `json:"host"`
	Port            int        `json:"port"`
	Username        string     `json:"username"`
	AuthType        string     `json:"auth_type"`
	Status          string     `json:"status"`
	IsFavorite      bool       `json:"is_favorite"`
	LastConnectedAt *time.Time `json:"last_connected_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type DatabaseImportResult struct {
	HostGroupsImported  int `json:"host_groups_imported"`
	HostGroupsSkipped   int `json:"host_groups_skipped"`
	CredentialsImported int `json:"credentials_imported"`
	CredentialsSkipped  int `json:"credentials_skipped"`
	HostsImported       int `json:"hosts_imported"`
	HostsSkipped        int `json:"hosts_skipped"`
}

func (s *Service) ExportDatabase(ctx context.Context, actor Actor) (DatabaseBackup, error) {
	if !hasActorPermission(actor, model.PermissionAdminDatabase) {
		return DatabaseBackup{}, ErrForbidden
	}
	if s.credentialEncryptor == nil {
		return DatabaseBackup{}, ErrInvalidInput
	}

	groups, err := s.repo.ListDatabaseHostGroups(ctx)
	if err != nil {
		return DatabaseBackup{}, err
	}
	credentials, err := s.repo.ListDatabaseCredentials(ctx)
	if err != nil {
		return DatabaseBackup{}, err
	}
	hosts, err := s.repo.ListDatabaseHosts(ctx)
	if err != nil {
		return DatabaseBackup{}, err
	}

	backup := DatabaseBackup{
		SchemaVersion: databaseBackupSchemaVersion,
		ExportedAt:    s.now(),
		HostGroups:    make([]DatabaseHostGroupBackup, 0, len(groups)),
		Credentials:   make([]DatabaseCredentialBackup, 0, len(credentials)),
		Hosts:         make([]DatabaseHostBackup, 0, len(hosts)),
	}
	for _, group := range groups {
		backup.HostGroups = append(backup.HostGroups, databaseHostGroupBackup(group))
	}
	for _, item := range credentials {
		converted, convertErr := s.databaseCredentialBackup(item)
		if convertErr != nil {
			return DatabaseBackup{}, convertErr
		}
		backup.Credentials = append(backup.Credentials, converted)
	}
	for _, item := range hosts {
		backup.Hosts = append(backup.Hosts, databaseHostBackup(item))
	}
	return backup, nil
}

func (s *Service) ImportDatabase(ctx context.Context, actor Actor, backup DatabaseBackup) (DatabaseImportResult, error) {
	if !hasActorPermission(actor, model.PermissionAdminDatabase) {
		return DatabaseImportResult{}, ErrForbidden
	}
	if backup.SchemaVersion != databaseBackupSchemaVersion || s.credentialEncryptor == nil {
		return DatabaseImportResult{}, ErrInvalidInput
	}

	existingGroups, err := s.repo.ListDatabaseHostGroups(ctx)
	if err != nil {
		return DatabaseImportResult{}, err
	}
	existingCredentials, err := s.repo.ListDatabaseCredentials(ctx)
	if err != nil {
		return DatabaseImportResult{}, err
	}
	existingHosts, err := s.repo.ListDatabaseHosts(ctx)
	if err != nil {
		return DatabaseImportResult{}, err
	}

	result := DatabaseImportResult{}
	groupIDMap := map[string]string{}
	groupKeySet := map[string]string{}
	for _, group := range existingGroups {
		groupKeySet[databaseGroupKey(group.UserID, group.Name)] = group.ID
	}
	for _, source := range backup.HostGroups {
		if strings.TrimSpace(source.UserID) == "" || strings.TrimSpace(source.Name) == "" {
			result.HostGroupsSkipped++
			continue
		}
		key := databaseGroupKey(source.UserID, source.Name)
		if existingID, ok := groupKeySet[key]; ok {
			groupIDMap[source.ID] = existingID
			result.HostGroupsSkipped++
			continue
		}
		created, createErr := s.repo.CreateDatabaseHostGroup(ctx, model.HostGroup{
			UserID:    strings.TrimSpace(source.UserID),
			Name:      strings.TrimSpace(source.Name),
			SortOrder: source.SortOrder,
		})
		if createErr != nil {
			return DatabaseImportResult{}, createErr
		}
		groupIDMap[source.ID] = created.ID
		groupKeySet[key] = created.ID
		result.HostGroupsImported++
	}

	credentialIDMap := map[string]string{}
	credentialHashSet, err := s.databaseCredentialHashSet(existingCredentials)
	if err != nil {
		return DatabaseImportResult{}, err
	}
	for _, source := range backup.Credentials {
		if strings.TrimSpace(source.UserID) == "" || strings.TrimSpace(source.Name) == "" || !validCredentialBackup(source) {
			result.CredentialsSkipped++
			continue
		}
		hash, hashErr := s.databaseCredentialContentHash(source)
		if hashErr != nil {
			return DatabaseImportResult{}, hashErr
		}
		if existingID, ok := credentialHashSet[databaseCredentialKey(source.UserID, hash)]; ok {
			credentialIDMap[source.ID] = existingID
			result.CredentialsSkipped++
			continue
		}
		item, convertErr := s.databaseCredentialModel(source)
		if convertErr != nil {
			return DatabaseImportResult{}, convertErr
		}
		created, createErr := s.repo.CreateDatabaseCredential(ctx, item)
		if createErr != nil {
			return DatabaseImportResult{}, createErr
		}
		credentialIDMap[source.ID] = created.ID
		credentialHashSet[databaseCredentialKey(source.UserID, hash)] = created.ID
		result.CredentialsImported++
	}

	hostKeySet := map[string]string{}
	for _, host := range existingHosts {
		hostKeySet[databaseHostKey(host.UserID, host.Host, host.Port, host.Username)] = host.ID
	}
	for _, source := range backup.Hosts {
		if strings.TrimSpace(source.UserID) == "" || strings.TrimSpace(source.Host) == "" || strings.TrimSpace(source.Username) == "" {
			result.HostsSkipped++
			continue
		}
		key := databaseHostKey(source.UserID, source.Host, source.Port, source.Username)
		if _, ok := hostKeySet[key]; ok {
			result.HostsSkipped++
			continue
		}
		item := databaseHostModel(source, groupIDMap, credentialIDMap)
		created, createErr := s.repo.CreateDatabaseHost(ctx, item)
		if createErr != nil {
			return DatabaseImportResult{}, createErr
		}
		hostKeySet[key] = created.ID
		result.HostsImported++
	}

	return result, nil
}

func databaseHostGroupBackup(item model.HostGroup) DatabaseHostGroupBackup {
	return DatabaseHostGroupBackup{
		ID:        item.ID,
		UserID:    item.UserID,
		Name:      item.Name,
		SortOrder: item.SortOrder,
		CreatedAt: item.CreatedAt,
		UpdatedAt: item.UpdatedAt,
	}
}

func (s *Service) databaseCredentialBackup(item model.Credential) (DatabaseCredentialBackup, error) {
	result := DatabaseCredentialBackup{
		ID:                  item.ID,
		UserID:              item.UserID,
		Name:                item.Name,
		AuthType:            item.AuthType,
		EncryptedSecret:     item.EncryptedSecret,
		EncryptedPrivateKey: item.EncryptedPrivateKey,
		EncryptedPassphrase: item.EncryptedPassphrase,
		KeyVersion:          item.KeyVersion,
		CreatedAt:           item.CreatedAt,
		UpdatedAt:           item.UpdatedAt,
	}
	switch item.AuthType {
	case string(model.AuthTypePassword):
		if item.EncryptedSecret == nil {
			return DatabaseCredentialBackup{}, ErrInvalidInput
		}
		plain, err := credential.DecryptWithVersion(s.credentialEncryptor, *item.EncryptedSecret, item.KeyVersion)
		if err != nil {
			return DatabaseCredentialBackup{}, err
		}
		result.ContentHash = credentialContentHash(item.AuthType, plain, "", "")
	case string(model.AuthTypePrivateKey):
		if item.EncryptedPrivateKey == nil {
			return DatabaseCredentialBackup{}, ErrInvalidInput
		}
		privateKey, err := credential.DecryptWithVersion(s.credentialEncryptor, *item.EncryptedPrivateKey, item.KeyVersion)
		if err != nil {
			return DatabaseCredentialBackup{}, err
		}
		passphrase := ""
		if item.EncryptedPassphrase != nil {
			decryptedPassphrase, passphraseErr := credential.DecryptWithVersion(s.credentialEncryptor, *item.EncryptedPassphrase, item.KeyVersion)
			if passphraseErr != nil {
				return DatabaseCredentialBackup{}, passphraseErr
			}
			passphrase = decryptedPassphrase
		}
		result.ContentHash = credentialContentHash(item.AuthType, "", privateKey, passphrase)
	default:
		return DatabaseCredentialBackup{}, ErrInvalidInput
	}
	return result, nil
}

func databaseHostBackup(item model.Host) DatabaseHostBackup {
	return DatabaseHostBackup{
		ID:              item.ID,
		UserID:          item.UserID,
		GroupID:         item.GroupID,
		CredentialID:    item.CredentialID,
		Name:            item.Name,
		Host:            item.Host,
		Port:            item.Port,
		Username:        item.Username,
		AuthType:        item.AuthType,
		Status:          item.Status,
		IsFavorite:      item.IsFavorite,
		LastConnectedAt: item.LastConnectedAt,
		CreatedAt:       item.CreatedAt,
		UpdatedAt:       item.UpdatedAt,
	}
}

func (s *Service) databaseCredentialModel(source DatabaseCredentialBackup) (model.Credential, error) {
	item := model.Credential{
		UserID:   strings.TrimSpace(source.UserID),
		Name:     strings.TrimSpace(source.Name),
		AuthType: strings.TrimSpace(source.AuthType),
	}
	switch item.AuthType {
	case string(model.AuthTypePassword):
		if source.EncryptedSecret == nil {
			return model.Credential{}, ErrInvalidInput
		}
		plain, err := credential.DecryptWithVersion(s.credentialEncryptor, *source.EncryptedSecret, source.KeyVersion)
		if err != nil {
			return model.Credential{}, err
		}
		encrypted, err := credential.EncryptWithActiveVersion(s.credentialEncryptor, plain)
		if err != nil {
			return model.Credential{}, err
		}
		item.EncryptedSecret = stringPtr(encrypted.CipherText)
		item.KeyVersion = encrypted.KeyVersion
	case string(model.AuthTypePrivateKey):
		if source.EncryptedPrivateKey == nil {
			return model.Credential{}, ErrInvalidInput
		}
		privateKey, err := credential.DecryptWithVersion(s.credentialEncryptor, *source.EncryptedPrivateKey, source.KeyVersion)
		if err != nil {
			return model.Credential{}, err
		}
		encryptedKey, err := credential.EncryptWithActiveVersion(s.credentialEncryptor, privateKey)
		if err != nil {
			return model.Credential{}, err
		}
		item.EncryptedPrivateKey = stringPtr(encryptedKey.CipherText)
		item.KeyVersion = encryptedKey.KeyVersion
		if source.EncryptedPassphrase != nil {
			passphrase, passphraseErr := credential.DecryptWithVersion(s.credentialEncryptor, *source.EncryptedPassphrase, source.KeyVersion)
			if passphraseErr != nil {
				return model.Credential{}, passphraseErr
			}
			if strings.TrimSpace(passphrase) != "" {
				encryptedPassphrase, encryptErr := credential.EncryptWithActiveVersion(s.credentialEncryptor, passphrase)
				if encryptErr != nil {
					return model.Credential{}, encryptErr
				}
				item.EncryptedPassphrase = stringPtr(encryptedPassphrase.CipherText)
				item.KeyVersion = encryptedPassphrase.KeyVersion
			}
		}
	default:
		return model.Credential{}, ErrInvalidInput
	}
	return item, nil
}

func databaseHostModel(source DatabaseHostBackup, groupIDMap map[string]string, credentialIDMap map[string]string) model.Host {
	item := model.Host{
		UserID:     strings.TrimSpace(source.UserID),
		Name:       strings.TrimSpace(source.Name),
		Host:       strings.TrimSpace(source.Host),
		Port:       source.Port,
		Username:   strings.TrimSpace(source.Username),
		AuthType:   strings.TrimSpace(source.AuthType),
		Status:     string(model.HostStatusActive),
		IsFavorite: source.IsFavorite,
	}
	item.LastConnectedAt = source.LastConnectedAt
	if item.Name == "" {
		item.Name = item.Host
	}
	if item.Port == 0 {
		item.Port = 22
	}
	if source.GroupID != nil {
		if mapped, ok := groupIDMap[*source.GroupID]; ok {
			item.GroupID = stringPtr(mapped)
		}
	}
	if source.CredentialID != nil {
		if mapped, ok := credentialIDMap[*source.CredentialID]; ok {
			item.CredentialID = stringPtr(mapped)
		}
	}
	return item
}

func (s *Service) databaseCredentialHashSet(items []model.Credential) (map[string]string, error) {
	result := make(map[string]string, len(items))
	for _, item := range items {
		backup, err := s.databaseCredentialBackup(item)
		if err != nil {
			return nil, err
		}
		result[databaseCredentialKey(item.UserID, backup.ContentHash)] = item.ID
	}
	return result, nil
}

func validCredentialBackup(item DatabaseCredentialBackup) bool {
	if item.KeyVersion <= 0 {
		return false
	}
	switch strings.TrimSpace(item.AuthType) {
	case string(model.AuthTypePassword):
		return item.EncryptedSecret != nil && strings.TrimSpace(*item.EncryptedSecret) != ""
	case string(model.AuthTypePrivateKey):
		return item.EncryptedPrivateKey != nil && strings.TrimSpace(*item.EncryptedPrivateKey) != ""
	default:
		return false
	}
}

func (s *Service) databaseCredentialContentHash(item DatabaseCredentialBackup) (string, error) {
	if strings.TrimSpace(item.ContentHash) != "" {
		return strings.TrimSpace(item.ContentHash), nil
	}
	switch strings.TrimSpace(item.AuthType) {
	case string(model.AuthTypePassword):
		if item.EncryptedSecret == nil {
			return "", ErrInvalidInput
		}
		plain, err := credential.DecryptWithVersion(s.credentialEncryptor, *item.EncryptedSecret, item.KeyVersion)
		if err != nil {
			return "", err
		}
		return credentialContentHash(item.AuthType, plain, "", ""), nil
	case string(model.AuthTypePrivateKey):
		if item.EncryptedPrivateKey == nil {
			return "", ErrInvalidInput
		}
		privateKey, err := credential.DecryptWithVersion(s.credentialEncryptor, *item.EncryptedPrivateKey, item.KeyVersion)
		if err != nil {
			return "", err
		}
		passphrase := ""
		if item.EncryptedPassphrase != nil {
			decryptedPassphrase, passphraseErr := credential.DecryptWithVersion(s.credentialEncryptor, *item.EncryptedPassphrase, item.KeyVersion)
			if passphraseErr != nil {
				return "", passphraseErr
			}
			passphrase = decryptedPassphrase
		}
		return credentialContentHash(item.AuthType, "", privateKey, passphrase), nil
	default:
		return "", ErrInvalidInput
	}
}

func credentialContentHash(authType, password, privateKey, passphrase string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(authType) + "\x00" + password + "\x00" + privateKey + "\x00" + passphrase))
	return hex.EncodeToString(sum[:])
}

func databaseGroupKey(userID string, name string) string {
	return strings.TrimSpace(userID) + "\x00" + strings.ToLower(strings.TrimSpace(name))
}

func databaseCredentialKey(userID string, contentHash string) string {
	return strings.TrimSpace(userID) + "\x00" + strings.TrimSpace(contentHash)
}

func databaseHostKey(userID string, host string, port int, username string) string {
	if port == 0 {
		port = 22
	}
	return strings.TrimSpace(userID) + "\x00" + strings.ToLower(strings.TrimSpace(host)) + "\x00" + strings.TrimSpace(username) + "\x00" + strconv.Itoa(port)
}

func stringPtr(value string) *string {
	return &value
}
