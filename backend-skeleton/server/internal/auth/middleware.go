package auth

import (
	"errors"
	"net/http"

	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

func NewMiddleware(service *Service, cookieName string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(cookieName)
			if err != nil || cookie.Value == "" {
				webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
				return
			}

			session, err := service.Authenticate(r.Context(), cookie.Value)
			if err != nil {
				if errors.Is(err, ErrSessionRevoked) {
					webutil.WriteError(w, http.StatusUnauthorized, "AUTH_SESSION_REVOKED", "session revoked")
					return
				}
				if errors.Is(err, ErrUnauthorized) {
					webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
					return
				}
				webutil.WriteError(w, http.StatusInternalServerError, "AUTH_SESSION_FAILED", "session validation failed")
				return
			}

			next.ServeHTTP(w, r.WithContext(WithSession(r.Context(), session)))
		})
	}
}

func NewAdminMiddleware(service *Service, cookieName string) func(http.Handler) http.Handler {
	requireAuth := NewMiddleware(service, cookieName)
	return func(next http.Handler) http.Handler {
		return requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session, ok := SessionFromContext(r.Context())
			if !ok {
				webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
				return
			}
			if !model.UserHasPermission(session.User, model.PermissionAdminAccess) {
				webutil.WriteError(w, http.StatusForbidden, "FORBIDDEN", "admin access required")
				return
			}
			next.ServeHTTP(w, r)
		}))
	}
}

func NewPermissionMiddleware(permission string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session, ok := SessionFromContext(r.Context())
			if !ok {
				webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
				return
			}
			if !model.UserHasPermission(session.User, permission) {
				webutil.WriteError(w, http.StatusForbidden, "FORBIDDEN", "permission required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
