package auth

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/example/online-ssh-platform/server/internal/settings"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

type Handler struct {
	service                      *Service
	cookieName                   string
	refreshCookieName            string
	cookieSecure                 bool
	cookieTTL                    time.Duration
	refreshCookieTTL             time.Duration
	allowRegistration            bool
	hostConnectivityPollInterval time.Duration
	emailCodeLength              int
	settingsProvider             func() settings.General
}

func NewHandler(service *Service, cookieName string, cookieSecure bool, cookieTTL time.Duration, allowRegistration bool) *Handler {
	return NewHandlerWithOptions(service, cookieName, cookieSecure, cookieTTL, allowRegistration, HandlerOptions{})
}

type HandlerOptions struct {
	RefreshCookieName            string
	RefreshCookieTTL             time.Duration
	HostConnectivityPollInterval time.Duration
	EmailCodeLength              int
	SettingsProvider             func() settings.General
}

func NewHandlerWithOptions(service *Service, cookieName string, cookieSecure bool, cookieTTL time.Duration, allowRegistration bool, options HandlerOptions) *Handler {
	refreshCookieName := options.RefreshCookieName
	if refreshCookieName == "" {
		refreshCookieName = "online_ssh_refresh"
	}
	refreshCookieTTL := options.RefreshCookieTTL
	if refreshCookieTTL <= 0 {
		refreshCookieTTL = defaultRefreshTTL
	}
	hostConnectivityPollInterval := options.HostConnectivityPollInterval
	if hostConnectivityPollInterval <= 0 {
		hostConnectivityPollInterval = 30 * time.Second
	}
	emailCodeLength := options.EmailCodeLength
	if emailCodeLength <= 0 {
		emailCodeLength = defaultEmailCodeLength
	}

	return &Handler{
		service:                      service,
		cookieName:                   cookieName,
		refreshCookieName:            refreshCookieName,
		cookieSecure:                 cookieSecure,
		cookieTTL:                    cookieTTL,
		refreshCookieTTL:             refreshCookieTTL,
		allowRegistration:            allowRegistration,
		hostConnectivityPollInterval: hostConnectivityPollInterval,
		emailCodeLength:              emailCodeLength,
		settingsProvider:             options.SettingsProvider,
	}
}

func (h *Handler) Config(w http.ResponseWriter, r *http.Request) {
	allowRegistration := h.allowRegistration
	hostConnectivityPollInterval := h.hostConnectivityPollInterval
	emailCodeLength := h.emailCodeLength
	if h.settingsProvider != nil {
		if cfg, err := settings.Normalize(h.settingsProvider()); err == nil {
			allowRegistration = cfg.AllowUserRegistration
			hostConnectivityPollInterval = cfg.HostConnectivityPollInterval()
			emailCodeLength = cfg.AuthEmailCodeLength
		}
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"allow_registration":                      allowRegistration,
		"host_connectivity_poll_interval_seconds": int(hostConnectivityPollInterval / time.Second),
		"email_code_length":                       emailCodeLength,
	})
}

func (h *Handler) registrationAllowed() bool {
	if h.settingsProvider == nil {
		return h.allowRegistration
	}
	if cfg, err := settings.Normalize(h.settingsProvider()); err == nil {
		return cfg.AllowUserRegistration
	}
	return h.allowRegistration
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	if !h.registrationAllowed() {
		webutil.WriteError(w, http.StatusForbidden, "REGISTRATION_DISABLED", "registration is disabled")
		return
	}

	var req RegisterInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	_, err := h.service.Register(r.Context(), req)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid register request")
		case errors.Is(err, ErrEmailNotAllowed):
			webutil.WriteError(w, http.StatusForbidden, "EMAIL_NOT_ALLOWED", "email is not allowed")
		case errors.Is(err, ErrVerificationCodeInvalid):
			webutil.WriteError(w, http.StatusBadRequest, "VERIFICATION_CODE_INVALID", "invalid verification code")
		case errors.Is(err, ErrEmailAlreadyExists):
			webutil.WriteError(w, http.StatusConflict, "EMAIL_ALREADY_EXISTS", "email already exists")
		case errors.Is(err, ErrUsernameAlreadyExists):
			webutil.WriteError(w, http.StatusConflict, "USERNAME_ALREADY_EXISTS", "username already exists")
		case errors.Is(err, ErrRegistrationDisabled):
			webutil.WriteError(w, http.StatusForbidden, "REGISTRATION_DISABLED", "registration is disabled")
		default:
			webutil.WriteError(w, http.StatusInternalServerError, "REGISTER_FAILED", "register failed")
		}
		return
	}

	result, err := h.service.Login(r.Context(), LoginInput{
		Email:     req.Email,
		Password:  req.Password,
		ClientIP:  clientIPFromRequest(r),
		UserAgent: r.UserAgent(),
	})
	if err != nil {
		webutil.WriteError(w, http.StatusInternalServerError, "REGISTER_LOGIN_FAILED", "register succeeded but login failed")
		return
	}
	if result.Status == LoginStatusMFARequired {
		webutil.WriteJSON(w, http.StatusOK, mfaLoginResponse(result))
		return
	}

	h.setSessionCookie(w, result.SessionToken, result.ExpiresAt)
	h.setRefreshCookie(w, result.RefreshToken, result.RefreshExpiresAt)

	webutil.WriteJSON(w, http.StatusCreated, map[string]any{
		"user":    result.User,
		"session": result.Session,
	})
}

func (h *Handler) SendEmailVerificationCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email      string `json:"email"`
		Identifier string `json:"identifier"`
		Purpose    string `json:"purpose"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	err := h.service.SendEmailVerificationCode(r.Context(), SendEmailVerificationCodeInput{
		Email:      req.Email,
		Identifier: req.Identifier,
		Purpose:    EmailVerificationPurpose(req.Purpose),
		ClientIP:   clientIPFromRequest(r),
	})
	if err != nil {
		if !errors.Is(err, ErrInvalidInput) &&
			!errors.Is(err, ErrRegistrationDisabled) &&
			!errors.Is(err, ErrEmailNotAllowed) &&
			!errors.Is(err, ErrInvalidCredentials) &&
			!errors.Is(err, ErrVerificationCodeRateLimited) &&
			!errors.Is(err, ErrEmailSenderUnavailable) {
			slog.Warn("send email verification code failed", "error", err, "purpose", req.Purpose)
		}
		h.writeEmailVerificationError(w, err)
		return
	}

	webutil.WriteJSON(w, http.StatusAccepted, map[string]any{
		"sent": true,
	})
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Identifier string `json:"identifier"`
		Email      string `json:"email"`
		Password   string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	result, err := h.service.Login(r.Context(), LoginInput{
		Identifier: req.Identifier,
		Email:      req.Email,
		Password:   req.Password,
		ClientIP:   clientIPFromRequest(r),
		UserAgent:  r.UserAgent(),
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid login request")
		case errors.Is(err, ErrEmailNotAllowed):
			webutil.WriteError(w, http.StatusForbidden, "EMAIL_NOT_ALLOWED", "email is not allowed")
		case errors.Is(err, ErrAccountDisabled):
			webutil.WriteError(w, http.StatusForbidden, "ACCOUNT_DISABLED", "account is disabled")
		case errors.Is(err, ErrInvalidCredentials):
			webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid email or password")
		default:
			webutil.WriteError(w, http.StatusInternalServerError, "LOGIN_FAILED", "login failed")
		}
		return
	}
	if result.Status == LoginStatusMFARequired {
		webutil.WriteJSON(w, http.StatusOK, mfaLoginResponse(result))
		return
	}

	h.setSessionCookie(w, result.SessionToken, result.ExpiresAt)
	h.setRefreshCookie(w, result.RefreshToken, result.RefreshExpiresAt)

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"user":    result.User,
		"session": result.Session,
	})
}

func (h *Handler) LoginWithEmailVerificationCode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Identifier       string `json:"identifier"`
		Email            string `json:"email"`
		VerificationCode string `json:"verification_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	result, err := h.service.LoginWithEmailVerificationCode(r.Context(), EmailCodeLoginInput{
		Identifier:       req.Identifier,
		Email:            req.Email,
		VerificationCode: req.VerificationCode,
		ClientIP:         clientIPFromRequest(r),
		UserAgent:        r.UserAgent(),
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid login request")
		case errors.Is(err, ErrEmailNotAllowed):
			webutil.WriteError(w, http.StatusForbidden, "EMAIL_NOT_ALLOWED", "email is not allowed")
		case errors.Is(err, ErrAccountDisabled):
			webutil.WriteError(w, http.StatusForbidden, "ACCOUNT_DISABLED", "account is disabled")
		case errors.Is(err, ErrVerificationCodeInvalid):
			webutil.WriteError(w, http.StatusUnauthorized, "VERIFICATION_CODE_INVALID", "invalid verification code")
		case errors.Is(err, ErrInvalidCredentials):
			webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid email or verification code")
		default:
			webutil.WriteError(w, http.StatusInternalServerError, "LOGIN_FAILED", "login failed")
		}
		return
	}
	if result.Status == LoginStatusMFARequired {
		webutil.WriteJSON(w, http.StatusOK, mfaLoginResponse(result))
		return
	}

	h.setSessionCookie(w, result.SessionToken, result.ExpiresAt)
	h.setRefreshCookie(w, result.RefreshToken, result.RefreshExpiresAt)

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"user":    result.User,
		"session": result.Session,
	})
}

func (h *Handler) writeEmailVerificationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid email verification request")
	case errors.Is(err, ErrRegistrationDisabled):
		webutil.WriteError(w, http.StatusForbidden, "REGISTRATION_DISABLED", "registration is disabled")
	case errors.Is(err, ErrEmailNotAllowed):
		webutil.WriteError(w, http.StatusForbidden, "EMAIL_NOT_ALLOWED", "email is not allowed")
	case errors.Is(err, ErrAccountDisabled):
		webutil.WriteError(w, http.StatusForbidden, "ACCOUNT_DISABLED", "account is disabled")
	case errors.Is(err, ErrVerificationCodeRateLimited):
		webutil.WriteError(w, http.StatusTooManyRequests, "VERIFICATION_CODE_RATE_LIMITED", "too many verification code requests")
	case errors.Is(err, ErrEmailSenderUnavailable):
		webutil.WriteError(w, http.StatusServiceUnavailable, "EMAIL_SENDER_UNAVAILABLE", "email sender is unavailable")
	case errors.Is(err, ErrInvalidCredentials):
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid email, username, or verification code")
	default:
		webutil.WriteError(w, http.StatusInternalServerError, "EMAIL_CODE_SEND_FAILED", "send verification code failed")
	}
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(h.refreshCookieName)
	if err != nil || cookie.Value == "" {
		h.clearAuthCookies(w)
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	result, err := h.service.RefreshWithMetadata(r.Context(), RefreshInput{
		RefreshToken: cookie.Value,
		ClientIP:     clientIPFromRequest(r),
		UserAgent:    r.UserAgent(),
	})
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			h.clearAuthCookies(w)
			webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
			return
		}
		webutil.WriteError(w, http.StatusInternalServerError, "REFRESH_FAILED", "refresh session failed")
		return
	}

	h.setSessionCookie(w, result.SessionToken, result.ExpiresAt)
	h.setRefreshCookie(w, result.RefreshToken, result.RefreshExpiresAt)

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"user":    result.User,
		"session": result.Session,
	})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	session, ok := SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"user":    session.User,
		"session": session.Session,
	})
}

func (h *Handler) SendAccountEmailVerificationCode(w http.ResponseWriter, r *http.Request) {
	session, ok := SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var req struct {
		Stage string `json:"stage"`
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}

	err := h.service.SendAccountEmailVerificationCode(r.Context(), session, SendAccountEmailVerificationCodeInput{
		Stage:    req.Stage,
		Email:    req.Email,
		ClientIP: clientIPFromRequest(r),
	})
	if err != nil {
		if errors.Is(err, ErrEmailAlreadyExists) {
			webutil.WriteError(w, http.StatusConflict, "EMAIL_ALREADY_EXISTS", "email already exists")
			return
		}
		h.writeEmailVerificationError(w, err)
		return
	}

	webutil.WriteJSON(w, http.StatusAccepted, map[string]any{"sent": true})
}

func (h *Handler) GetMFAStatus(w http.ResponseWriter, r *http.Request) {
	session, ok := SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	result, err := h.service.GetMFAStatus(r.Context(), session)
	if err != nil {
		h.writeMFAError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) SetupMFA(w http.ResponseWriter, r *http.Request) {
	session, ok := SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var req SetupMFAInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	result, err := h.service.SetupMFA(r.Context(), session, req)
	if err != nil {
		h.writeMFAError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) ConfirmMFASetup(w http.ResponseWriter, r *http.Request) {
	session, ok := SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var req ConfirmMFASetupInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	result, err := h.service.ConfirmMFASetup(r.Context(), session, req)
	if err != nil {
		h.writeMFAError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) VerifyMFA(w http.ResponseWriter, r *http.Request) {
	var req VerifyMFAInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	result, err := h.service.VerifyMFA(r.Context(), req)
	if err != nil {
		h.writeMFAError(w, err)
		return
	}
	h.setSessionCookie(w, result.SessionToken, result.ExpiresAt)
	h.setRefreshCookie(w, result.RefreshToken, result.RefreshExpiresAt)
	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"user":    result.User,
		"session": result.Session,
	})
}

func (h *Handler) DisableMFA(w http.ResponseWriter, r *http.Request) {
	session, ok := SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var req DisableMFAInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if err := h.service.DisableMFA(r.Context(), session, req); err != nil {
		h.writeMFAError(w, err)
		return
	}
	webutil.WriteNoContent(w)
}

func (h *Handler) RegenerateMFARecoveryCodes(w http.ResponseWriter, r *http.Request) {
	session, ok := SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var req RegenerateMFARecoveryCodesInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	result, err := h.service.RegenerateMFARecoveryCodes(r.Context(), session, req)
	if err != nil {
		h.writeMFAError(w, err)
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	session, ok := SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var req ChangePasswordInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	result, err := h.service.ChangePassword(r.Context(), session, req)
	if err != nil {
		h.writeAccountError(w, err, "CHANGE_PASSWORD_FAILED", "change password failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) ChangeEmail(w http.ResponseWriter, r *http.Request) {
	session, ok := SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var req ChangeEmailInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	user, err := h.service.ChangeEmail(r.Context(), session, req)
	if err != nil {
		h.writeAccountError(w, err, "CHANGE_EMAIL_FAILED", "change email failed")
		return
	}
	webutil.WriteJSON(w, http.StatusOK, map[string]any{
		"user":    user,
		"session": session.Session,
	})
}

func (h *Handler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	session, ok := SessionFromContext(r.Context())
	if !ok {
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}
	var req DeleteAccountInput
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	if err := h.service.DeleteAccount(r.Context(), session, req); err != nil {
		h.writeAccountError(w, err, "DELETE_ACCOUNT_FAILED", "delete account failed")
		return
	}
	h.clearAuthCookies(w)
	webutil.WriteNoContent(w)
}

func (h *Handler) writeMFAError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid mfa request")
	case errors.Is(err, ErrUnauthorized):
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
	case errors.Is(err, ErrInvalidCredentials):
		webutil.WriteError(w, http.StatusUnauthorized, "INVALID_CURRENT_PASSWORD", "current password is incorrect")
	case errors.Is(err, ErrMFAInvalidCode):
		webutil.WriteError(w, http.StatusUnauthorized, "MFA_CODE_INVALID", "verification code is invalid or expired")
	case errors.Is(err, ErrMFARateLimited):
		webutil.WriteError(w, http.StatusTooManyRequests, "MFA_RATE_LIMITED", "too many verification attempts")
	case errors.Is(err, ErrMFAAlreadyEnabled):
		webutil.WriteError(w, http.StatusConflict, "MFA_ALREADY_ENABLED", "mfa is already enabled")
	case errors.Is(err, ErrMFANotEnabled):
		webutil.WriteError(w, http.StatusBadRequest, "MFA_NOT_ENABLED", "mfa is not enabled")
	case errors.Is(err, ErrMFAUnavailable):
		webutil.WriteError(w, http.StatusInternalServerError, "MFA_UNAVAILABLE", "mfa is unavailable")
	default:
		webutil.WriteError(w, http.StatusInternalServerError, "MFA_FAILED", "mfa request failed")
	}
}

func (h *Handler) writeAccountError(w http.ResponseWriter, err error, fallbackCode string, fallbackMessage string) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid account request")
	case errors.Is(err, ErrInvalidCredentials):
		webutil.WriteError(w, http.StatusUnauthorized, "INVALID_CURRENT_PASSWORD", "current password is incorrect")
	case errors.Is(err, ErrVerificationCodeInvalid):
		webutil.WriteError(w, http.StatusBadRequest, "VERIFICATION_CODE_INVALID", "invalid verification code")
	case errors.Is(err, ErrEmailNotAllowed):
		webutil.WriteError(w, http.StatusForbidden, "EMAIL_NOT_ALLOWED", "email is not allowed")
	case errors.Is(err, ErrEmailAlreadyExists):
		webutil.WriteError(w, http.StatusConflict, "EMAIL_ALREADY_EXISTS", "email already exists")
	case errors.Is(err, ErrLastAdminAccess):
		webutil.WriteError(w, http.StatusConflict, "LAST_ADMIN_ACCESS", "cannot delete the last admin account")
	case errors.Is(err, ErrPasswordUnchanged):
		webutil.WriteError(w, http.StatusBadRequest, "PASSWORD_UNCHANGED", "new password must be different from current password")
	case errors.Is(err, ErrUnauthorized):
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
	default:
		webutil.WriteError(w, http.StatusInternalServerError, fallbackCode, fallbackMessage)
	}
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	session, ok := SessionFromContext(r.Context())
	var err error
	if ok {
		err = h.service.Logout(r.Context(), session)
	} else if refreshCookie, cookieErr := r.Cookie(h.refreshCookieName); cookieErr == nil && refreshCookie.Value != "" {
		err = h.service.LogoutByRefreshToken(r.Context(), refreshCookie.Value)
	} else {
		err = ErrUnauthorized
	}
	if err != nil && !errors.Is(err, ErrUnauthorized) {
		h.clearAuthCookies(w)
		webutil.WriteError(w, http.StatusInternalServerError, "LOGOUT_FAILED", "logout failed")
		return
	}
	if err != nil && errors.Is(err, ErrUnauthorized) && ok {
		h.clearAuthCookies(w)
		webutil.WriteError(w, http.StatusUnauthorized, "UNAUTHORIZED", "login required")
		return
	}

	h.clearAuthCookies(w)
	webutil.WriteNoContent(w)
}

func (h *Handler) setSessionCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge < 0 {
		maxAge = 0
	}
	http.SetCookie(w, &http.Cookie{
		Name:     h.cookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   maxAge,
	})
}

func (h *Handler) setRefreshCookie(w http.ResponseWriter, token string, expiresAt time.Time) {
	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge < 0 {
		maxAge = 0
	}
	http.SetCookie(w, &http.Cookie{
		Name:     h.refreshCookieName,
		Value:    token,
		Path:     "/api/auth",
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expiresAt,
		MaxAge:   maxAge,
	})
}

func (h *Handler) clearAuthCookies(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     h.cookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
	http.SetCookie(w, &http.Cookie{
		Name:     h.refreshCookieName,
		Value:    "",
		Path:     "/api/auth",
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
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
