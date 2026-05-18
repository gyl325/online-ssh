package terminal

import (
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func terminalWebSocketOriginAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	originURL, err := url.Parse(origin)
	if err != nil || originURL.Scheme == "" || originURL.Host == "" {
		return false
	}
	wsScheme := terminalWebSocketScheme(r)
	expectedScheme := "http"
	if wsScheme == "wss" {
		expectedScheme = "https"
	}
	if !strings.EqualFold(originURL.Scheme, expectedScheme) {
		return false
	}
	expectedHost := terminalRequestHostWithForwardedPort(r, wsScheme)
	return normalizeOriginHost(originURL.Scheme, originURL.Host) == normalizeOriginHost(expectedScheme, expectedHost)
}

func terminalValidatedTokenOriginAllowed(r *http.Request) bool {
	if terminalWebSocketOriginAllowed(r) {
		return true
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	originURL, err := url.Parse(origin)
	if err != nil || originURL.Scheme == "" || originURL.Host == "" {
		return false
	}
	return strings.EqualFold(originURL.Scheme, "http") || strings.EqualFold(originURL.Scheme, "https")
}

func terminalWebSocketBaseURL(r *http.Request) string {
	scheme := terminalWebSocketScheme(r)
	hostValue := terminalRequestHostWithForwardedPort(r, scheme)
	if hostValue == "" {
		return ""
	}
	return scheme + "://" + hostValue
}

func terminalPublicBaseURL(r *http.Request) string {
	scheme := "http"
	wsScheme := terminalWebSocketScheme(r)
	if wsScheme == "wss" {
		scheme = "https"
	}
	hostValue := terminalRequestHostWithForwardedPort(r, wsScheme)
	if hostValue == "" {
		return ""
	}
	return scheme + "://" + hostValue
}

func terminalRequestHostWithForwardedPort(r *http.Request, scheme string) string {
	hostValue := terminalRequestHost(r)
	if hostValue == "" {
		return ""
	}
	if forwardedPort := firstHeaderValue(r.Header.Get("X-Forwarded-Port")); forwardedPort != "" {
		hostValue = addForwardedPort(hostValue, forwardedPort, scheme)
	}
	return hostValue
}

func terminalRequestHost(r *http.Request) string {
	hostValue := firstHeaderValue(r.Header.Get("X-Forwarded-Host"))
	if hostValue == "" {
		hostValue = forwardedHeaderParam(r.Header.Get("Forwarded"), "host")
	}
	if hostValue == "" {
		hostValue = strings.TrimSpace(r.Host)
	}
	return hostValue
}

func terminalWebSocketScheme(r *http.Request) string {
	proto := firstHeaderValue(r.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		proto = forwardedHeaderParam(r.Header.Get("Forwarded"), "proto")
	}
	switch {
	case strings.EqualFold(proto, "https"):
		return "wss"
	case strings.EqualFold(proto, "http"):
		return "ws"
	case strings.EqualFold(firstHeaderValue(r.Header.Get("X-Forwarded-Ssl")), "on"):
		return "wss"
	case firstHeaderValue(r.Header.Get("X-Forwarded-Port")) == "443":
		return "wss"
	case r.TLS != nil:
		return "wss"
	default:
		return "ws"
	}
}

func terminalClientIPFromRequest(r *http.Request) string {
	for _, header := range []string{"CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP"} {
		value := firstHeaderValue(r.Header.Get(header))
		if value != "" {
			return value
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && strings.TrimSpace(host) != "" {
		return strings.TrimSpace(host)
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func firstHeaderValue(value string) string {
	if value == "" {
		return ""
	}
	return strings.TrimSpace(strings.Split(value, ",")[0])
}

func forwardedHeaderParam(headerValue, key string) string {
	if headerValue == "" {
		return ""
	}
	first := strings.Split(headerValue, ",")[0]
	for _, item := range strings.Split(first, ";") {
		parts := strings.SplitN(strings.TrimSpace(item), "=", 2)
		if len(parts) != 2 || !strings.EqualFold(strings.TrimSpace(parts[0]), key) {
			continue
		}
		return strings.Trim(strings.TrimSpace(parts[1]), `"`)
	}
	return ""
}

func addForwardedPort(hostValue, port, scheme string) string {
	if port == "" || strings.Contains(hostValue, ":") {
		return hostValue
	}
	if (scheme == "wss" && port == "443") || (scheme == "ws" && port == "80") {
		return hostValue
	}
	return hostValue + ":" + port
}

func normalizeOriginHost(scheme, hostValue string) string {
	hostValue = strings.TrimSpace(strings.ToLower(hostValue))
	host, port, err := net.SplitHostPort(hostValue)
	if err != nil {
		return hostValue
	}
	host = strings.Trim(strings.ToLower(host), "[]")
	if (strings.EqualFold(scheme, "https") && port == "443") || (strings.EqualFold(scheme, "http") && port == "80") {
		return host
	}
	return net.JoinHostPort(host, port)
}

func terminalSizeFromQuery(r *http.Request) (int, int, error) {
	rows := 0
	cols := 0
	if value := strings.TrimSpace(r.URL.Query().Get("rows")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return 0, 0, err
		}
		rows = parsed
	}
	if value := strings.TrimSpace(r.URL.Query().Get("cols")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return 0, 0, err
		}
		cols = parsed
	}
	return normalizeTerminalSize(rows, cols)
}
