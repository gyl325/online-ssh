package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

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
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func TestRouterBusinessRoutesRequireModulePermissions(t *testing.T) {
	cases := []struct {
		name       string
		method     string
		target     string
		permission string
	}{
		{name: "hosts", method: http.MethodGet, target: "/api/hosts", permission: model.PermissionHostsManage},
		{name: "credentials", method: http.MethodGet, target: "/api/credentials", permission: model.PermissionCredentialsManage},
		{name: "terminal", method: http.MethodPost, target: "/api/terminal/sessions", permission: model.PermissionTerminalConnect},
		{name: "files", method: http.MethodGet, target: "/api/files/list", permission: model.PermissionFilesManage},
		{name: "transfers", method: http.MethodGet, target: "/api/transfers", permission: model.PermissionTransfersManage},
		{name: "audit", method: http.MethodGet, target: "/api/audit/logs", permission: model.PermissionAuditRead},
		{name: "saved commands", method: http.MethodGet, target: "/api/saved-commands", permission: model.PermissionTerminalConnect},
	}

	for _, tc := range cases {
		t.Run(tc.name+" rejects missing permission", func(t *testing.T) {
			recorder, requiredPermissions := serveRouterPermissionRequest(t, tc.method, tc.target, nil)

			assertRouterPermissionError(t, recorder, http.StatusForbidden, "FORBIDDEN")
			if !slices.Contains(requiredPermissions, tc.permission) {
				t.Fatalf("expected route to require %q, got %#v", tc.permission, requiredPermissions)
			}
		})

		t.Run(tc.name+" allows matching permission", func(t *testing.T) {
			recorder, requiredPermissions := serveRouterPermissionRequest(t, tc.method, tc.target, []string{tc.permission})

			if recorder.Code != http.StatusNoContent {
				t.Fatalf("expected permission guard to allow route with 204, got %d body=%s", recorder.Code, recorder.Body.String())
			}
			if !slices.Contains(requiredPermissions, tc.permission) {
				t.Fatalf("expected route to require %q, got %#v", tc.permission, requiredPermissions)
			}
		})
	}
}

func TestRouterPublicShareOpenDoesNotRequirePermission(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/terminal/shares/open", nil)
	recorder := httptest.NewRecorder()
	requiredPermissions := []string{}

	router := NewRouter(routerPermissionTestDependencies([]string{}, &requiredPermissions))
	router.ServeHTTP(recorder, req)

	if len(requiredPermissions) != 0 {
		t.Fatalf("public share open must not use permission guard, got %#v", requiredPermissions)
	}
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected public handler to process request and reject invalid body, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestRouterBootstrapRoutesDoNotRequirePermission(t *testing.T) {
	cases := []struct {
		name   string
		method string
		target string
		body   string
		want   int
	}{
		{name: "status", method: http.MethodGet, target: "/api/bootstrap/status", want: http.StatusOK},
		{name: "setup", method: http.MethodPost, target: "/api/bootstrap/setup", body: `{}`, want: http.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.target, bytes.NewBufferString(tc.body))
			recorder := httptest.NewRecorder()
			requiredPermissions := []string{}
			authGuardCalls := 0

			dep := routerPermissionTestDependencies([]string{}, &requiredPermissions)
			dep.RequireAuth = func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					authGuardCalls++
					webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
				})
			}
			router := NewRouter(dep)
			router.ServeHTTP(recorder, req)

			if authGuardCalls != 0 {
				t.Fatalf("bootstrap route must not use auth guard, got %d calls", authGuardCalls)
			}
			if len(requiredPermissions) != 0 {
				t.Fatalf("bootstrap route must not use permission guard, got %#v", requiredPermissions)
			}
			if recorder.Code != tc.want {
				t.Fatalf("expected route to be public and return %d, got %d body=%s", tc.want, recorder.Code, recorder.Body.String())
			}
		})
	}
}

func serveRouterPermissionRequest(t *testing.T, method, target string, permissions []string) (*httptest.ResponseRecorder, []string) {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	recorder := httptest.NewRecorder()
	requiredPermissions := []string{}
	router := NewRouter(routerPermissionTestDependencies(permissions, &requiredPermissions))

	router.ServeHTTP(recorder, req)

	return recorder, requiredPermissions
}

func routerPermissionTestDependencies(permissions []string, requiredPermissions *[]string) Dependencies {
	requireAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session := auth.AuthenticatedSession{
				SessionID: "session-1",
				UserID:    "user-1",
				User:      model.User{ID: "user-1", Permissions: permissions},
			}
			next.ServeHTTP(w, r.WithContext(auth.WithSession(r.Context(), session)))
		})
	}
	requirePermission := func(permission string) func(http.Handler) http.Handler {
		return func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				*requiredPermissions = append(*requiredPermissions, permission)
				session, ok := auth.SessionFromContext(r.Context())
				if !ok {
					webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
					return
				}
				if !model.UserHasPermission(session.User, permission) {
					webutil.WriteError(w, http.StatusForbidden, "FORBIDDEN", "permission required")
					return
				}
				w.WriteHeader(http.StatusNoContent)
			})
		}
	}
	return Dependencies{
		Auth:              auth.NewHandler(nil, "online_ssh_session", false, 0, true),
		Bootstrap:         bootstrap.NewHandler(&routerBootstrapServiceStub{}, "online_ssh_session", false, 0, bootstrap.HandlerOptions{}),
		Admin:             admin.NewHandler(nil),
		Connection:        connection.NewHandler(nil),
		Host:              host.NewHandler(nil),
		HostGroup:         hostgroup.NewHandler(nil),
		Credential:        credential.NewHandler(nil),
		Terminal:          terminal.NewHandler(nil),
		Files:             files.NewHandler(nil),
		Transfer:          transfer.NewHandler(nil),
		Audit:             audit.NewHandler(nil),
		AuditExport:       auditexport.NewHandler(nil),
		SavedCommand:      savedcommand.NewHandler(nil),
		RequireAuth:       requireAuth,
		RequireAdmin:      requireAuth,
		RequirePermission: requirePermission,
	}
}

type routerBootstrapServiceStub struct{}

func (s *routerBootstrapServiceStub) Status(ctx context.Context) (bootstrap.Status, error) {
	return bootstrap.Status{SetupRequired: true}, nil
}

func (s *routerBootstrapServiceStub) Setup(ctx context.Context, input bootstrap.SetupInput) (bootstrap.SetupResult, error) {
	return bootstrap.SetupResult{}, bootstrap.ErrInvalidInput
}

func (s *routerBootstrapServiceStub) Login(ctx context.Context, input auth.LoginInput) (auth.LoginResult, error) {
	return auth.LoginResult{}, nil
}

func assertRouterPermissionError(t *testing.T, recorder *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if recorder.Code != status {
		t.Fatalf("expected %d, got %d body=%s", status, recorder.Code, recorder.Body.String())
	}
	var payload webutil.ErrorResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Code != code {
		t.Fatalf("expected error code %q, got %#v", code, payload)
	}
}
