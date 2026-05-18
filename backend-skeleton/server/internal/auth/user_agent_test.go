package auth

import "testing"

func TestParseUserAgent(t *testing.T) {
	tests := []struct {
		name      string
		userAgent string
		label     string
	}{
		{
			name:      "edge on macos",
			userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0",
			label:     "Edge on macOS",
		},
		{
			name:      "chrome on windows",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
			label:     "Chrome on Windows",
		},
		{
			name:      "safari on ios",
			userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
			label:     "Safari on iOS",
		},
		{
			name:      "firefox on linux",
			userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
			label:     "Firefox on Linux",
		},
		{
			name:      "unknown",
			userAgent: "CustomClient/1.0",
			label:     "Unknown browser on Unknown OS",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if label := parseUserAgent(tt.userAgent).Label; label != tt.label {
				t.Fatalf("expected %q, got %q", tt.label, label)
			}
		})
	}
}
