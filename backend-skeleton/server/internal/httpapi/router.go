package httpapi

import (
	"net/http"

	"github.com/example/online-ssh-platform/server/internal/webutil"

	"github.com/example/online-ssh-platform/server/internal/admin"
	"github.com/example/online-ssh-platform/server/internal/audit"
	"github.com/example/online-ssh-platform/server/internal/auditexport"
	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/bootstrap"
	"github.com/example/online-ssh-platform/server/internal/connection"
	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/files"
	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/hostgroup"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/savedcommand"
	"github.com/example/online-ssh-platform/server/internal/terminal"
	"github.com/example/online-ssh-platform/server/internal/transfer"
)

type Dependencies struct {
	Auth              *auth.Handler
	Bootstrap         *bootstrap.Handler
	Admin             *admin.Handler
	Connection        *connection.Handler
	Host              *host.Handler
	HostGroup         *hostgroup.Handler
	Credential        *credential.Handler
	Terminal          *terminal.Handler
	Files             *files.Handler
	Transfer          *transfer.Handler
	Audit             *audit.Handler
	AuditExport       *auditexport.Handler
	SavedCommand      *savedcommand.Handler
	RequireAuth       func(http.Handler) http.Handler
	RequireAdmin      func(http.Handler) http.Handler
	RequirePermission func(string) func(http.Handler) http.Handler
}

func NewRouter(dep Dependencies) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		webutil.WriteJSON(w, http.StatusOK, map[string]any{
			"status": "ok",
		})
	})

	requireAuth := dep.RequireAuth
	if requireAuth == nil {
		requireAuth = func(next http.Handler) http.Handler { return next }
	}
	requireAdmin := dep.RequireAdmin
	if requireAdmin == nil {
		requireAdmin = requireAuth
	}
	permissionGuard := dep.RequirePermission
	if permissionGuard == nil {
		permissionGuard = func(string) func(http.Handler) http.Handler {
			return func(next http.Handler) http.Handler { return next }
		}
	}
	requirePermission := func(permission string) func(http.Handler) http.Handler {
		guard := permissionGuard(permission)
		return func(next http.Handler) http.Handler {
			return requireAuth(guard(next))
		}
	}
	requireHosts := requirePermission(model.PermissionHostsManage)
	requireCredentials := requirePermission(model.PermissionCredentialsManage)
	requireTerminal := requirePermission(model.PermissionTerminalConnect)
	requireFiles := requirePermission(model.PermissionFilesManage)
	requireTransfers := requirePermission(model.PermissionTransfersManage)
	requireAudit := requirePermission(model.PermissionAuditRead)

	// bootstrap
	if dep.Bootstrap != nil {
		mux.HandleFunc("GET /api/bootstrap/status", dep.Bootstrap.Status)
		mux.HandleFunc("POST /api/bootstrap/setup", dep.Bootstrap.Setup)
	}

	// auth
	mux.HandleFunc("GET /api/auth/config", dep.Auth.Config)
	mux.HandleFunc("POST /api/auth/register", dep.Auth.Register)
	mux.HandleFunc("POST /api/auth/email-code/send", dep.Auth.SendEmailVerificationCode)
	mux.HandleFunc("POST /api/auth/login", dep.Auth.Login)
	mux.HandleFunc("POST /api/auth/login/email-code", dep.Auth.LoginWithEmailVerificationCode)
	mux.HandleFunc("POST /api/auth/2fa/verify", dep.Auth.VerifyMFA)
	mux.HandleFunc("POST /api/auth/refresh", dep.Auth.Refresh)
	mux.Handle("GET /api/auth/me", requireAuth(http.HandlerFunc(dep.Auth.Me)))
	mux.HandleFunc("POST /api/auth/logout", dep.Auth.Logout)
	mux.Handle("GET /api/auth/2fa/status", requireAuth(http.HandlerFunc(dep.Auth.GetMFAStatus)))
	mux.Handle("POST /api/auth/2fa/setup", requireAuth(http.HandlerFunc(dep.Auth.SetupMFA)))
	mux.Handle("POST /api/auth/2fa/confirm", requireAuth(http.HandlerFunc(dep.Auth.ConfirmMFASetup)))
	mux.Handle("POST /api/auth/2fa/disable", requireAuth(http.HandlerFunc(dep.Auth.DisableMFA)))
	mux.Handle("POST /api/auth/2fa/recovery-codes/regenerate", requireAuth(http.HandlerFunc(dep.Auth.RegenerateMFARecoveryCodes)))
	mux.Handle("POST /api/account/email-code/send", requireAuth(http.HandlerFunc(dep.Auth.SendAccountEmailVerificationCode)))
	mux.Handle("PATCH /api/account/password", requireAuth(http.HandlerFunc(dep.Auth.ChangePassword)))
	mux.Handle("PATCH /api/account/email", requireAuth(http.HandlerFunc(dep.Auth.ChangeEmail)))
	mux.Handle("DELETE /api/account", requireAuth(http.HandlerFunc(dep.Auth.DeleteAccount)))

	// admin
	mux.Handle("GET /api/admin/users", requireAdmin(http.HandlerFunc(dep.Admin.ListUsers)))
	mux.Handle("DELETE /api/admin/users/{userId}", requireAdmin(http.HandlerFunc(dep.Admin.DeleteUser)))
	mux.Handle("PATCH /api/admin/users/{userId}/status", requireAdmin(http.HandlerFunc(dep.Admin.UpdateUserStatus)))
	mux.Handle("PATCH /api/admin/users/{userId}/role", requireAdmin(http.HandlerFunc(dep.Admin.UpdateUserRole)))
	mux.Handle("POST /api/admin/users/{userId}/sessions/revoke", requireAdmin(http.HandlerFunc(dep.Admin.RevokeUserSessions)))
	mux.Handle("GET /api/admin/users/{userId}/mfa", requireAdmin(http.HandlerFunc(dep.Admin.GetUserMFA)))
	mux.Handle("POST /api/admin/users/{userId}/mfa/reset", requireAdmin(http.HandlerFunc(dep.Admin.ResetUserMFA)))
	mux.Handle("GET /api/admin/roles", requireAdmin(http.HandlerFunc(dep.Admin.ListRoles)))
	mux.Handle("POST /api/admin/roles", requireAdmin(http.HandlerFunc(dep.Admin.CreateRole)))
	mux.Handle("PATCH /api/admin/roles/{roleKey}", requireAdmin(http.HandlerFunc(dep.Admin.UpdateRole)))
	mux.Handle("DELETE /api/admin/roles/{roleKey}", requireAdmin(http.HandlerFunc(dep.Admin.DeleteRole)))
	mux.Handle("GET /api/admin/sessions", requireAdmin(http.HandlerFunc(dep.Admin.ListSessions)))
	mux.Handle("POST /api/admin/sessions/{sessionId}/revoke", requireAdmin(http.HandlerFunc(dep.Admin.RevokeSession)))
	mux.Handle("GET /api/admin/settings/general", requireAdmin(http.HandlerFunc(dep.Admin.GetGeneralSettings)))
	mux.Handle("PATCH /api/admin/settings/general", requireAdmin(http.HandlerFunc(dep.Admin.UpdateGeneralSettings)))
	mux.Handle("POST /api/admin/settings/general/test-email", requireAdmin(http.HandlerFunc(dep.Admin.SendGeneralSettingsTestEmail)))
	mux.Handle("POST /api/admin/settings/general/test-llm", requireAdmin(http.HandlerFunc(dep.Admin.TestGeneralSettingsLLM)))
	mux.Handle("GET /api/admin/database/export", requireAdmin(http.HandlerFunc(dep.Admin.ExportDatabase)))
	mux.Handle("POST /api/admin/database/import", requireAdmin(http.HandlerFunc(dep.Admin.ImportDatabase)))

	// connections
	mux.Handle("POST /api/connections/quick-connect", requireHosts(http.HandlerFunc(dep.Connection.QuickConnect)))
	mux.Handle("POST /api/connections/temporary", requireHosts(http.HandlerFunc(dep.Connection.CreateTemporaryConnection)))

	// credentials
	mux.Handle("GET /api/credentials", requireCredentials(http.HandlerFunc(dep.Credential.List)))
	mux.Handle("POST /api/credentials", requireCredentials(http.HandlerFunc(dep.Credential.Create)))
	mux.Handle("POST /api/credentials/keypairs", requireCredentials(http.HandlerFunc(dep.Credential.GenerateKeyPair)))
	mux.Handle("GET /api/credentials/{credentialId}", requireCredentials(http.HandlerFunc(dep.Credential.Get)))
	mux.Handle("PUT /api/credentials/{credentialId}", requireCredentials(http.HandlerFunc(dep.Credential.Update)))
	mux.Handle("DELETE /api/credentials/{credentialId}", requireCredentials(http.HandlerFunc(dep.Credential.Delete)))

	// hosts
	mux.Handle("GET /api/hosts", requireHosts(http.HandlerFunc(dep.Host.List)))
	mux.Handle("POST /api/hosts", requireHosts(http.HandlerFunc(dep.Host.Create)))
	mux.Handle("GET /api/hosts/{hostId}", requireHosts(http.HandlerFunc(dep.Host.Get)))
	mux.Handle("PUT /api/hosts/{hostId}", requireHosts(http.HandlerFunc(dep.Host.Update)))
	mux.Handle("DELETE /api/hosts/{hostId}", requireHosts(http.HandlerFunc(dep.Host.Delete)))
	mux.Handle("GET /api/hosts/{hostId}/metrics", requireHosts(http.HandlerFunc(dep.Host.Metrics)))
	mux.Handle("POST /api/hosts/{hostId}/test", requireHosts(http.HandlerFunc(dep.Host.TestConnection)))
	mux.Handle("POST /api/hosts/{hostId}/fingerprint/confirm", requireHosts(http.HandlerFunc(dep.Host.ConfirmFingerprint)))
	mux.Handle("GET /api/host-groups", requireHosts(http.HandlerFunc(dep.HostGroup.List)))
	mux.Handle("POST /api/host-groups", requireHosts(http.HandlerFunc(dep.HostGroup.Create)))
	mux.Handle("PUT /api/host-groups/{groupId}", requireHosts(http.HandlerFunc(dep.HostGroup.Update)))
	mux.Handle("DELETE /api/host-groups/{groupId}", requireHosts(http.HandlerFunc(dep.HostGroup.Delete)))

	// terminal
	mux.Handle("GET /api/terminal/sessions", requireTerminal(http.HandlerFunc(dep.Terminal.ListSessions)))
	mux.Handle("POST /api/terminal/sessions", requireTerminal(http.HandlerFunc(dep.Terminal.Bootstrap)))
	mux.Handle("POST /api/terminal/sessions/quick-connect", requireTerminal(http.HandlerFunc(dep.Terminal.QuickConnect)))
	mux.Handle("GET /api/terminal/sessions/{sessionId}", requireTerminal(http.HandlerFunc(dep.Terminal.GetSession)))
	mux.Handle("POST /api/terminal/sessions/{sessionId}/keepalive", requireTerminal(http.HandlerFunc(dep.Terminal.SetKeepAlive)))
	mux.Handle("POST /api/terminal/sessions/{sessionId}/close", requireTerminal(http.HandlerFunc(dep.Terminal.CloseSession)))
	mux.Handle("GET /api/terminal/sessions/{sessionId}/share", requireTerminal(http.HandlerFunc(dep.Terminal.GetActiveShare)))
	mux.Handle("POST /api/terminal/sessions/{sessionId}/share", requireTerminal(http.HandlerFunc(dep.Terminal.CreateShare)))
	mux.Handle("POST /api/terminal/command-assistant/generate", requireTerminal(http.HandlerFunc(dep.Terminal.GenerateCommand)))
	mux.HandleFunc("POST /api/terminal/shares/open", dep.Terminal.OpenShareAccess)
	mux.Handle("PATCH /api/terminal/shares/{shareId}", requireTerminal(http.HandlerFunc(dep.Terminal.ExtendShare)))
	mux.Handle("DELETE /api/terminal/shares/{shareId}", requireTerminal(http.HandlerFunc(dep.Terminal.RevokeShare)))
	mux.Handle("GET /api/terminal/shares/{shareId}/access-logs", requireTerminal(http.HandlerFunc(dep.Terminal.ListShareAccessLogs)))
	mux.Handle("GET /api/terminal/settings", requireTerminal(http.HandlerFunc(dep.Terminal.GetRecordingSettings)))
	mux.Handle("PUT /api/terminal/settings", requireTerminal(http.HandlerFunc(dep.Terminal.UpdateRecordingSettings)))
	mux.Handle("GET /api/terminal/recordings", requireTerminal(http.HandlerFunc(dep.Terminal.ListRecordings)))
	mux.Handle("GET /api/terminal/recordings/{recordingId}", requireTerminal(http.HandlerFunc(dep.Terminal.GetRecording)))
	mux.Handle("GET /api/terminal/recordings/{recordingId}/chunks", requireTerminal(http.HandlerFunc(dep.Terminal.ListRecordingChunks)))
	mux.Handle("PUT /api/terminal/recordings/{recordingId}/bookmark", requireTerminal(http.HandlerFunc(dep.Terminal.UpdateRecordingBookmark)))
	mux.Handle("DELETE /api/terminal/recordings/{recordingId}", requireTerminal(http.HandlerFunc(dep.Terminal.DeleteRecording)))
	mux.Handle("GET /ws/terminal", requireTerminal(http.HandlerFunc(dep.Terminal.Stream)))
	mux.HandleFunc("GET /ws/terminal/share", dep.Terminal.StreamShare)

	// saved commands
	mux.Handle("GET /api/saved-commands", requireTerminal(http.HandlerFunc(dep.SavedCommand.List)))
	mux.Handle("POST /api/saved-commands", requireTerminal(http.HandlerFunc(dep.SavedCommand.Create)))
	mux.Handle("PUT /api/saved-commands/{commandId}", requireTerminal(http.HandlerFunc(dep.SavedCommand.Update)))
	mux.Handle("DELETE /api/saved-commands/{commandId}", requireTerminal(http.HandlerFunc(dep.SavedCommand.Delete)))

	// files
	mux.Handle("GET /api/files/list", requireFiles(http.HandlerFunc(dep.Files.ListDirectory)))
	mux.Handle("GET /api/files/search", requireFiles(http.HandlerFunc(dep.Files.SearchFiles)))
	mux.Handle("POST /api/files/search-tasks", requireFiles(http.HandlerFunc(dep.Files.CreateSearchTask)))
	mux.Handle("GET /api/files/search-tasks/{taskId}", requireFiles(http.HandlerFunc(dep.Files.GetSearchTask)))
	mux.Handle("GET /api/files/search-tasks/{taskId}/results", requireFiles(http.HandlerFunc(dep.Files.ListSearchTaskResults)))
	mux.Handle("POST /api/files/search-tasks/{taskId}/cancel", requireFiles(http.HandlerFunc(dep.Files.CancelSearchTask)))
	mux.Handle("POST /api/files/mkdir", requireFiles(http.HandlerFunc(dep.Files.CreateDirectory)))
	mux.Handle("POST /api/files/touch", requireFiles(http.HandlerFunc(dep.Files.CreateFile)))
	mux.Handle("POST /api/files/rename", requireFiles(http.HandlerFunc(dep.Files.RenameFile)))
	mux.Handle("POST /api/files/delete", requireFiles(http.HandlerFunc(dep.Files.DeleteFile)))
	mux.Handle("POST /api/files/chmod", requireFiles(http.HandlerFunc(dep.Files.Chmod)))
	mux.Handle("POST /api/files/copy", requireFiles(http.HandlerFunc(dep.Files.CopyFile)))
	mux.Handle("POST /api/files/checksum", requireFiles(http.HandlerFunc(dep.Files.CalculateChecksum)))
	mux.Handle("POST /api/files/archive/compress", requireFiles(http.HandlerFunc(dep.Files.CompressArchive)))
	mux.Handle("POST /api/files/archive/extract", requireFiles(http.HandlerFunc(dep.Files.ExtractArchive)))
	mux.Handle("GET /api/files/content", requireFiles(http.HandlerFunc(dep.Files.ReadFileContent)))
	mux.Handle("PUT /api/files/content", requireFiles(http.HandlerFunc(dep.Files.WriteFileContent)))
	mux.Handle("POST /api/files/download", requireFiles(http.HandlerFunc(dep.Transfer.CreateDownloadTask)))

	// transfers
	mux.Handle("POST /api/transfers/upload/init", requireTransfers(http.HandlerFunc(dep.Transfer.InitUpload)))
	mux.Handle("PATCH /api/transfers/upload/{taskId}/chunk", requireTransfers(http.HandlerFunc(dep.Transfer.UploadChunk)))
	mux.Handle("GET /api/transfers", requireTransfers(http.HandlerFunc(dep.Transfer.List)))
	mux.Handle("GET /api/transfers/{taskId}", requireTransfers(http.HandlerFunc(dep.Transfer.Get)))
	mux.Handle("POST /api/transfers/{taskId}/pause", requireTransfers(http.HandlerFunc(dep.Transfer.Pause)))
	mux.Handle("POST /api/transfers/{taskId}/resume", requireTransfers(http.HandlerFunc(dep.Transfer.Resume)))
	mux.Handle("POST /api/transfers/{taskId}/cancel", requireTransfers(http.HandlerFunc(dep.Transfer.Cancel)))
	mux.Handle("POST /api/transfers/{taskId}/retry", requireTransfers(http.HandlerFunc(dep.Transfer.Retry)))
	mux.Handle("GET /api/transfers/{taskId}/content", requireTransfers(http.HandlerFunc(dep.Transfer.DownloadContent)))

	// audit
	mux.Handle("GET /api/audit/logs", requireAudit(http.HandlerFunc(dep.Audit.List)))
	mux.Handle("GET /api/audit/logs/{logId}", requireAudit(http.HandlerFunc(dep.Audit.Get)))
	mux.Handle("POST /api/audit/exports", requireAudit(http.HandlerFunc(dep.AuditExport.Create)))
	mux.Handle("GET /api/audit/exports", requireAudit(http.HandlerFunc(dep.AuditExport.List)))
	mux.Handle("GET /api/audit/exports/{exportId}", requireAudit(http.HandlerFunc(dep.AuditExport.Get)))
	mux.Handle("DELETE /api/audit/exports/{exportId}", requireAudit(http.HandlerFunc(dep.AuditExport.Delete)))
	mux.Handle("GET /api/audit/exports/{exportId}/download", requireAudit(http.HandlerFunc(dep.AuditExport.Download)))
	mux.Handle("POST /api/audit/exports/{exportId}/cancel", requireAudit(http.HandlerFunc(dep.AuditExport.Cancel)))

	return webutil.RequestLogging(mux)
}
