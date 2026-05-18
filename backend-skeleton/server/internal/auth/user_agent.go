package auth

import "strings"

type parsedUserAgent struct {
	Browser string
	OS      string
	Label   string
}

func parseUserAgent(userAgent string) parsedUserAgent {
	browser := parseUserAgentBrowser(userAgent)
	os := parseUserAgentOS(userAgent)
	return parsedUserAgent{
		Browser: browser,
		OS:      os,
		Label:   browser + " on " + os,
	}
}

func deviceLabelFromUserAgent(userAgent string) *string {
	trimmed := strings.TrimSpace(userAgent)
	if trimmed == "" {
		return nil
	}
	label := parseUserAgent(trimmed).Label
	return &label
}

func parseUserAgentBrowser(userAgent string) string {
	if strings.Contains(userAgent, "Edg/") {
		return "Edge"
	}
	if strings.Contains(userAgent, "Firefox/") {
		return "Firefox"
	}
	if strings.Contains(userAgent, "Chrome/") && !strings.Contains(userAgent, "Edg/") {
		return "Chrome"
	}
	if strings.Contains(userAgent, "Safari/") &&
		!strings.Contains(userAgent, "Chrome/") &&
		!strings.Contains(userAgent, "Chromium/") &&
		!strings.Contains(userAgent, "Edg/") {
		return "Safari"
	}
	return "Unknown browser"
}

func parseUserAgentOS(userAgent string) string {
	if strings.Contains(userAgent, "iPad") {
		return "iPadOS"
	}
	if strings.Contains(userAgent, "iPhone") {
		return "iOS"
	}
	if strings.Contains(userAgent, "Windows NT") {
		return "Windows"
	}
	if strings.Contains(userAgent, "Macintosh") || strings.Contains(userAgent, "Mac OS X") {
		return "macOS"
	}
	if strings.Contains(userAgent, "Android") {
		return "Android"
	}
	if strings.Contains(userAgent, "Linux") {
		return "Linux"
	}
	return "Unknown OS"
}
