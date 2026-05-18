package app

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/admin"
	"github.com/example/online-ssh-platform/server/internal/audit"
	"github.com/example/online-ssh-platform/server/internal/auditexport"
	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/bootstrap"
	"github.com/example/online-ssh-platform/server/internal/config"
	"github.com/example/online-ssh-platform/server/internal/connection"
	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/files"
	"github.com/example/online-ssh-platform/server/internal/frontend"
	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/hostgroup"
	"github.com/example/online-ssh-platform/server/internal/httpapi"
	"github.com/example/online-ssh-platform/server/internal/llm"
	"github.com/example/online-ssh-platform/server/internal/savedcommand"
	"github.com/example/online-ssh-platform/server/internal/settings"
	"github.com/example/online-ssh-platform/server/internal/terminal"
	"github.com/example/online-ssh-platform/server/internal/transfer"
)

type Application struct {
	cfg                config.Config
	db                 *db.DB
	router             http.Handler
	filesService       *files.Service
	auditExportService *auditexport.Service
	terminalService    *terminal.Service
	transferService    *transfer.Service
}

type bootstrapAuthService struct {
	bootstrap *bootstrap.Service
	auth      *auth.Service
}

func (s bootstrapAuthService) Status(ctx context.Context) (bootstrap.Status, error) {
	return s.bootstrap.Status(ctx)
}

func (s bootstrapAuthService) Setup(ctx context.Context, input bootstrap.SetupInput) (bootstrap.SetupResult, error) {
	return s.bootstrap.Setup(ctx, input)
}

func (s bootstrapAuthService) Login(ctx context.Context, input auth.LoginInput) (auth.LoginResult, error) {
	return s.auth.Login(ctx, input)
}

func New(cfg config.Config) (*Application, error) {
	database, err := db.Open(context.Background(), cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}

	auditRepo := audit.NewPostgresRepository(database)
	auditService := audit.NewService(auditRepo)

	authRepo := auth.NewPostgresRepository(database)
	sessionTTL := time.Duration(cfg.SessionTTLMinutes) * time.Minute
	sessionIdleTimeout := time.Duration(cfg.SessionIdleTimeoutMinutes) * time.Minute
	refreshTTL := time.Duration(cfg.RefreshTokenTTLHours) * time.Hour
	generalDefaults := settings.General{
		AllowUserRegistration:               cfg.AllowUserRegistration,
		SessionIdleTimeoutMinutes:           cfg.SessionIdleTimeoutMinutes,
		RefreshTokenTTLHours:                cfg.RefreshTokenTTLHours,
		TerminalMaxSessionsPerUser:          cfg.TerminalMaxSessionsPerUser,
		TerminalMaxSessionsTotal:            cfg.TerminalMaxSessionsTotal,
		TerminalKeepAliveHours:              cfg.TerminalKeepAliveHours,
		FileSFTPIdleTTLMinutes:              cfg.FileSFTPIdleTTLMinutes,
		HostConnectivityPollIntervalSeconds: cfg.HostConnectivityPollIntervalSeconds,
		SMTPHost:                            cfg.SMTPHost,
		SMTPPort:                            cfg.SMTPPort,
		SMTPFrom:                            cfg.SMTPFrom,
		SMTPFromName:                        cfg.SMTPFromName,
		SMTPUsername:                        cfg.SMTPUsername,
		SMTPPassword:                        cfg.SMTPPassword,
		SMTPUseSSL:                          cfg.SMTPUseSSL,
		AuthAllowedEmails:                   cfg.AuthAllowedEmails,
		AuthAllowedEmailDomains:             cfg.AuthAllowedEmailDomains,
		AuthEmailCodeLength:                 cfg.AuthEmailCodeLength,
		AuthEmailCodeTTLMinutes:             cfg.AuthEmailCodeTTLMinutes,
		AuthEmailCodeMaxAttempts:            cfg.AuthEmailCodeMaxAttempts,
		AuthEmailCodeResendCooldownSeconds:  cfg.AuthEmailCodeResendCooldownSeconds,
		AuthEmailCodeEmailWindowMinutes:     cfg.AuthEmailCodeEmailWindowMinutes,
		AuthEmailCodeEmailWindowMaxSends:    cfg.AuthEmailCodeEmailWindowMaxSends,
		AuthEmailCodeIPWindowMinutes:        cfg.AuthEmailCodeIPWindowMinutes,
		AuthEmailCodeIPWindowMaxSends:       cfg.AuthEmailCodeIPWindowMaxSends,
		LLMEnabled:                          cfg.LLMEnabled,
		LLMProtocol:                         cfg.LLMProtocol,
		LLMBaseURL:                          cfg.LLMBaseURL,
		LLMModel:                            cfg.LLMModel,
		LLMAuthHeader:                       cfg.LLMAuthHeader,
		LLMAPIKey:                           cfg.LLMAPIKey,
		LLMTimeoutSeconds:                   cfg.LLMTimeoutSeconds,
		LLMMaxTokens:                        cfg.LLMMaxTokens,
	}
	generalSettings := settings.NewStore(generalDefaults)
	adminRepo := admin.NewPostgresRepository(database)
	if persisted, err := adminRepo.ListSystemSettings(context.Background()); err == nil {
		if merged, mergeErr := settings.Merge(generalDefaults, persisted); mergeErr == nil {
			_ = generalSettings.Update(merged)
		}
	}
	generalSnapshot := generalSettings.Snapshot
	emailCodeHashSecret := strings.TrimSpace(cfg.AuthEmailCodeHashSecret)
	if emailCodeHashSecret == "" {
		emailCodeHashSecret = strings.TrimSpace(cfg.CredentialMasterKey)
	}
	if emailCodeHashSecret == "" {
		emailCodeHashSecret = strings.TrimSpace(cfg.CredentialKeyRing)
	}
	emailSenderFromSettings := func(current settings.General) auth.EmailSender {
		if strings.TrimSpace(current.SMTPHost) == "" {
			return nil
		}
		return auth.NewSMTPSender(auth.SMTPConfig{
			Host:     current.SMTPHost,
			Port:     current.SMTPPort,
			Username: current.SMTPUsername,
			Password: current.SMTPPassword,
			From:     current.SMTPFrom,
			FromName: current.SMTPFromName,
			UseSSL:   current.SMTPUseSSL,
		})
	}
	emailSender := emailSenderFromSettings(generalSnapshot())
	emailSenderProvider := func() auth.EmailSender {
		return emailSenderFromSettings(generalSnapshot())
	}
	credentialRepo := credential.NewPostgresRepository(database)
	credentialEncryptor, err := credential.NewKeyRingEncryptorFromConfig(
		cfg.CredentialMasterKey,
		cfg.CredentialKeyRing,
		cfg.CredentialActiveKeyVersion,
	)
	if err != nil {
		_ = database.Close()
		return nil, err
	}
	authService := auth.NewServiceWithOptions(authRepo, sessionTTL, auditService, auth.ServiceOptions{
		AllowRegistration:       cfg.AllowUserRegistration,
		IdleTimeout:             sessionIdleTimeout,
		RefreshTTL:              refreshTTL,
		EmailSender:             emailSender,
		EmailCodeHashSecret:     emailCodeHashSecret,
		AllowedEmails:           splitCSV(cfg.AuthAllowedEmails),
		AllowedEmailDomains:     splitCSV(cfg.AuthAllowedEmailDomains),
		EmailCodeLength:         cfg.AuthEmailCodeLength,
		EmailCodeTTL:            time.Duration(cfg.AuthEmailCodeTTLMinutes) * time.Minute,
		EmailCodeMaxAttempts:    cfg.AuthEmailCodeMaxAttempts,
		EmailCodeResendCooldown: time.Duration(cfg.AuthEmailCodeResendCooldownSeconds) * time.Second,
		EmailCodeEmailWindow:    time.Duration(cfg.AuthEmailCodeEmailWindowMinutes) * time.Minute,
		EmailCodeEmailMaxSends:  cfg.AuthEmailCodeEmailWindowMaxSends,
		EmailCodeIPWindow:       time.Duration(cfg.AuthEmailCodeIPWindowMinutes) * time.Minute,
		EmailCodeIPMaxSends:     cfg.AuthEmailCodeIPWindowMaxSends,
		SettingsProvider:        generalSnapshot,
		EmailSenderProvider:     emailSenderProvider,
		MFAEncryptor:            credentialEncryptor,
	})
	authHandler := auth.NewHandlerWithOptions(authService, cfg.SessionCookieName, cfg.SessionCookieSecure, sessionTTL, cfg.AllowUserRegistration, auth.HandlerOptions{
		RefreshCookieName:            cfg.RefreshCookieName,
		RefreshCookieTTL:             refreshTTL,
		HostConnectivityPollInterval: time.Duration(cfg.HostConnectivityPollIntervalSeconds) * time.Second,
		EmailCodeLength:              cfg.AuthEmailCodeLength,
		SettingsProvider:             generalSnapshot,
	})
	bootstrapService := bootstrap.NewService(authRepo, auditService)
	bootstrapHandler := bootstrap.NewHandler(bootstrapAuthService{bootstrap: bootstrapService, auth: authService}, cfg.SessionCookieName, cfg.SessionCookieSecure, sessionTTL, bootstrap.HandlerOptions{
		RefreshCookieName: cfg.RefreshCookieName,
		RefreshCookieTTL:  refreshTTL,
		SetupToken:        cfg.BootstrapSetupToken,
	})
	llmService := llm.NewService(llm.NewClient(nil), generalSnapshot)

	adminService := admin.NewServiceWithOptions(adminRepo, admin.ServiceOptions{
		CredentialEncryptor:     credentialEncryptor,
		AuditRecorder:           auditService,
		GeneralSettings:         generalSettings,
		GeneralSettingsDefaults: generalDefaults,
		EmailSenderForSettings:  emailSenderFromSettings,
		EmailSenderProvider:     emailSenderProvider,
		LLMTester:               llmService,
	})
	adminHandler := admin.NewHandler(adminService)
	credentialService := credential.NewService(credentialRepo, credentialEncryptor, auditService)
	credentialHandler := credential.NewHandler(credentialService)

	hostRepo := host.NewPostgresRepository(database)
	hostGroupRepo := hostgroup.NewPostgresRepository(database)
	hostGroupService := hostgroup.NewService(hostGroupRepo, auditService)
	hostGroupHandler := hostgroup.NewHandler(hostGroupService)
	hostService := host.NewService(hostRepo, hostGroupRepo, credentialRepo, credentialEncryptor, auditService)
	hostHandler := host.NewHandler(hostService)
	connectionService := connection.NewService(database, credentialEncryptor, auditService)
	connectionHandler := connection.NewHandlerWithTemporaryConnections(connectionService, hostService)

	transferRepo := transfer.NewPostgresRepository(database)
	transferService := transfer.NewService(transferRepo, hostRepo, hostService, auditService)
	transferHandler := transfer.NewHandler(transferService)

	auditHandler := audit.NewHandler(auditService)
	auditExportRepo := auditexport.NewPostgresRepository(database)
	auditExportService := auditexport.NewService(auditExportRepo, auditService, auditService)
	auditExportHandler := auditexport.NewHandler(auditExportService)
	terminalRepo := terminal.NewPostgresRepository(database)
	terminalService := terminal.NewServiceWithOptions(terminalRepo, hostService, auditService, terminal.ServiceOptions{
		KeepAliveTTL:       time.Duration(cfg.TerminalKeepAliveHours) * time.Hour,
		MaxSessionsPerUser: cfg.TerminalMaxSessionsPerUser,
		MaxSessionsTotal:   cfg.TerminalMaxSessionsTotal,
		RecordingEncryptor: credentialEncryptor,
		SettingsProvider: func() terminal.TerminalHubRuntimeSettings {
			current := generalSnapshot()
			return terminal.TerminalHubRuntimeSettings{
				KeepAliveTTL:       current.TerminalKeepAliveTTL(),
				MaxSessionsPerUser: current.TerminalMaxSessionsPerUser,
				MaxSessionsTotal:   current.TerminalMaxSessionsTotal,
			}
		},
		CommandGenerator: llmService,
	})
	adminService.SetUserSessionsRevokedHook(func(ctx context.Context, userID string, message string) {
		terminalService.CloseUserRuntimesForce(ctx, userID, message)
	})
	adminService.SetUserSessionRevokedHook(func(ctx context.Context, userID string, sessionID string, message string) {
		terminalService.CloseAuthSessionRuntimesForce(ctx, userID, sessionID, message)
	})
	authService.SetOtherSessionsRevokedHook(func(ctx context.Context, userID string) {
		terminalService.CloseUserRuntimes(ctx, userID, "account signed in elsewhere")
	})
	terminalHandler := terminal.NewHandler(terminalService)
	savedCommandRepo := savedcommand.NewPostgresRepository(database)
	savedCommandService := savedcommand.NewService(savedCommandRepo, auditService)
	savedCommandHandler := savedcommand.NewHandler(savedCommandService)
	filesRepo := files.NewPostgresRepository(database)
	filesService := files.NewServiceWithOptions(hostService, auditService, filesRepo, files.ServiceOptions{
		SFTPIdleTTL: time.Duration(cfg.FileSFTPIdleTTLMinutes) * time.Minute,
		SFTPIdleTTLProvider: func() time.Duration {
			return generalSnapshot().SFTPIdleTTL()
		},
	})
	filesHandler := files.NewHandler(filesService)

	router := httpapi.NewRouter(httpapi.Dependencies{
		Auth:              authHandler,
		Bootstrap:         bootstrapHandler,
		Admin:             adminHandler,
		Connection:        connectionHandler,
		Host:              hostHandler,
		HostGroup:         hostGroupHandler,
		Credential:        credentialHandler,
		Terminal:          terminalHandler,
		Files:             filesHandler,
		Transfer:          transferHandler,
		Audit:             auditHandler,
		AuditExport:       auditExportHandler,
		SavedCommand:      savedCommandHandler,
		RequireAuth:       auth.NewMiddleware(authService, cfg.SessionCookieName),
		RequireAdmin:      auth.NewAdminMiddleware(authService, cfg.SessionCookieName),
		RequirePermission: auth.NewPermissionMiddleware,
	})
	handler := http.Handler(router)
	if strings.TrimSpace(cfg.StaticDir) != "" {
		handler = frontend.NewHandler(os.DirFS(cfg.StaticDir), router)
	}

	if err := transferService.RecoverPending(context.Background()); err != nil {
		_ = database.Close()
		filesService.Close()
		auditExportService.Close()
		terminalService.Close()
		transferService.Close()
		return nil, err
	}

	return &Application{
		cfg:                cfg,
		db:                 database,
		router:             handler,
		filesService:       filesService,
		auditExportService: auditExportService,
		terminalService:    terminalService,
		transferService:    transferService,
	}, nil
}

func splitCSV(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			items = append(items, trimmed)
		}
	}
	return items
}

func (a *Application) Router() http.Handler {
	return a.router
}

func (a *Application) Close() error {
	if a.transferService != nil {
		a.transferService.Close()
	}
	if a.filesService != nil {
		a.filesService.Close()
	}
	if a.auditExportService != nil {
		a.auditExportService.Close()
	}
	if a.terminalService != nil {
		a.terminalService.Close()
	}
	if a.db == nil {
		return nil
	}
	return a.db.Close()
}
