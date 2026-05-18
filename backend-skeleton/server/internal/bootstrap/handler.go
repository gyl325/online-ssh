package bootstrap

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

type ServiceAPI interface {
	Status(ctx context.Context) (Status, error)
	Setup(ctx context.Context, input SetupInput) (SetupResult, error)
	Login(ctx context.Context, input auth.LoginInput) (auth.LoginResult, error)
}

type HandlerOptions struct {
	RefreshCookieName string
	RefreshCookieTTL  time.Duration
	SetupToken        string
}

type Handler struct {
	service           ServiceAPI
	cookieName        string
	refreshCookieName string
	cookieSecure      bool
	cookieTTL         time.Duration
	refreshCookieTTL  time.Duration
	setupToken        string
}

func NewHandler(service ServiceAPI, sessionCookieName string, secureCookies bool, sessionTTL time.Duration, options HandlerOptions) *Handler {
	refreshCookieName := options.RefreshCookieName
	if refreshCookieName == "" {
		refreshCookieName = "online_ssh_refresh"
	}
	refreshCookieTTL := options.RefreshCookieTTL
	if refreshCookieTTL <= 0 {
		refreshCookieTTL = 7 * 24 * time.Hour
	}

	return &Handler{
		service:           service,
		cookieName:        sessionCookieName,
		refreshCookieName: refreshCookieName,
		cookieSecure:      secureCookies,
		cookieTTL:         sessionTTL,
		refreshCookieTTL:  refreshCookieTTL,
		setupToken:        strings.TrimSpace(options.SetupToken),
	}
}

func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	status, err := h.service.Status(r.Context())
	if err != nil {
		webutil.WriteError(w, http.StatusInternalServerError, "BOOTSTRAP_STATUS_FAILED", "bootstrap status failed")
		return
	}

	webutil.WriteJSON(w, http.StatusOK, Status{
		SetupRequired:      status.SetupRequired,
		SetupTokenRequired: status.SetupRequired && h.setupToken != "",
	})
}

func (h *Handler) Setup(w http.ResponseWriter, r *http.Request) {
	var request setupRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	input := request.SetupInput
	if h.setupToken != "" && !constantTimeEqual(request.SetupToken, h.setupToken) {
		webutil.WriteError(w, http.StatusForbidden, "BOOTSTRAP_SETUP_TOKEN_REQUIRED", "bootstrap setup token required")
		return
	}

	if _, err := h.service.Setup(r.Context(), input); err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid bootstrap setup request")
		case errors.Is(err, ErrAlreadyInitialized):
			webutil.WriteError(w, http.StatusConflict, "BOOTSTRAP_ALREADY_INITIALIZED", "bootstrap is already initialized")
		default:
			webutil.WriteError(w, http.StatusInternalServerError, "BOOTSTRAP_SETUP_FAILED", "bootstrap setup failed")
		}
		return
	}

	result, err := h.service.Login(r.Context(), auth.LoginInput{
		Email:     input.Email,
		Password:  input.Password,
		ClientIP:  clientIPFromRequest(r),
		UserAgent: r.UserAgent(),
	})
	if err != nil || result.Status == auth.LoginStatusMFARequired {
		webutil.WriteError(w, http.StatusInternalServerError, "BOOTSTRAP_LOGIN_FAILED", "bootstrap setup succeeded but login failed")
		return
	}

	h.setSessionCookie(w, result.SessionToken, result.ExpiresAt)
	h.setRefreshCookie(w, result.RefreshToken, result.RefreshExpiresAt)

	webutil.WriteJSON(w, http.StatusCreated, map[string]any{
		"user":    result.User,
		"session": result.Session,
	})
}

type setupRequest struct {
	SetupInput
	SetupToken string `json:"setup_token"`
}

func constantTimeEqual(input string, expected string) bool {
	input = strings.TrimSpace(input)
	expected = strings.TrimSpace(expected)
	if input == "" || expected == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(input), []byte(expected)) == 1
}

func (h *Handler) setSessionCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     h.cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   maxAgeUntil(expiresAt),
	})
}

func (h *Handler) setRefreshCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     h.refreshCookieName,
		Value:    token,
		Path:     "/api/auth",
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   maxAgeUntil(expiresAt),
	})
}

func maxAgeUntil(expiresAt time.Time) int {
	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge < 0 {
		return 0
	}
	return maxAge
}

func clientIPFromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	headerCandidates := []string{
		r.Header.Get("CF-Connecting-IP"),
		r.Header.Get("X-Forwarded-For"),
		r.Header.Get("X-Real-IP"),
	}
	for _, candidate := range headerCandidates {
		if ip := validClientIP(candidate); ip != "" {
			return ip
		}
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		if ip := validClientIP(host); ip != "" {
			return ip
		}
		return host
	}
	if ip := validClientIP(r.RemoteAddr); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

func validClientIP(value string) string {
	for _, part := range strings.Split(value, ",") {
		candidate := strings.TrimSpace(part)
		if candidate == "" {
			continue
		}
		if host, _, err := net.SplitHostPort(candidate); err == nil {
			candidate = host
		}
		candidate = strings.Trim(candidate, "[]")
		if prefix, err := netip.ParsePrefix(candidate); err == nil {
			return prefix.Addr().String()
		}
		if addr, err := netip.ParseAddr(candidate); err == nil {
			return addr.String()
		}
	}
	return ""
}
