package admin

import (
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
)

type Role struct {
	Key         string    `json:"key"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	IsSystem    bool      `json:"is_system"`
	IsActive    bool      `json:"is_active"`
	UserCount   int       `json:"user_count"`
	Permissions []string  `json:"permissions"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type PermissionDefinition struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

func PermissionDefinitions() []PermissionDefinition {
	return []PermissionDefinition{
		{Key: model.PermissionAdminAccess, Label: "Admin access", Description: "Open and use administrator settings."},
		{Key: model.PermissionAdminUsers, Label: "Manage users", Description: "Enable, disable, delete, and update user roles."},
		{Key: model.PermissionAdminSessions, Label: "Manage sessions", Description: "List and revoke active user sessions."},
		{Key: model.PermissionAdminRoles, Label: "Manage roles", Description: "Create roles and update role permissions."},
		{Key: model.PermissionAdminDatabase, Label: "Manage database", Description: "Export or import administrative database data."},
		{Key: model.PermissionHostsManage, Label: "Manage hosts", Description: "Create and manage saved hosts."},
		{Key: model.PermissionCredentialsManage, Label: "Manage credentials", Description: "Create and manage saved credentials."},
		{Key: model.PermissionTerminalConnect, Label: "Open terminal", Description: "Open SSH terminal sessions."},
		{Key: model.PermissionFilesManage, Label: "Manage files", Description: "Browse and operate on remote files."},
		{Key: model.PermissionTransfersManage, Label: "Manage transfers", Description: "Create and manage file transfer tasks."},
		{Key: model.PermissionAuditRead, Label: "Read audit logs", Description: "View audit logs and related records."},
	}
}

func (r Role) HasPermission(permission string) bool {
	for _, item := range r.Permissions {
		if item == permission {
			return true
		}
	}
	return false
}

func (r Role) PermissionSet() map[string]struct{} {
	result := make(map[string]struct{}, len(r.Permissions))
	for _, permission := range r.Permissions {
		result[permission] = struct{}{}
	}
	return result
}

func normalizeRoleKey(key string) string {
	return strings.ToLower(strings.TrimSpace(key))
}

func hasAdminAccess(role Role) bool {
	return role.HasPermission(model.PermissionAdminAccess)
}
