package auth

import (
	"net/http/httptest"
	"testing"
)

func TestClientIPFromRequest(t *testing.T) {
	t.Run("prefers cloudflare connecting ip", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/auth/login", nil)
		req.RemoteAddr = "127.0.0.1:4321"
		req.Header.Set("CF-Connecting-IP", "203.0.113.44")

		got := clientIPFromRequest(req)
		if got != "203.0.113.44" {
			t.Fatalf("expected 203.0.113.44, got %q", got)
		}
	})

	t.Run("uses first forwarded ip before proxy hops", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/auth/login", nil)
		req.RemoteAddr = "127.0.0.1:4321"
		req.Header.Set("X-Forwarded-For", "198.51.100.23, 127.0.0.1")

		got := clientIPFromRequest(req)
		if got != "198.51.100.23" {
			t.Fatalf("expected 198.51.100.23, got %q", got)
		}
	})

	t.Run("uses real ip header when forwarded chain is absent", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/auth/login", nil)
		req.RemoteAddr = "127.0.0.1:4321"
		req.Header.Set("X-Real-IP", "192.0.2.8")

		got := clientIPFromRequest(req)
		if got != "192.0.2.8" {
			t.Fatalf("expected 192.0.2.8, got %q", got)
		}
	})

	t.Run("extracts host from host:port remote addr", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/auth/login", nil)
		req.RemoteAddr = "203.0.113.10:4321"

		got := clientIPFromRequest(req)
		if got != "203.0.113.10" {
			t.Fatalf("expected 203.0.113.10, got %q", got)
		}
	})

	t.Run("falls back to raw remote addr when split fails", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/auth/login", nil)
		req.RemoteAddr = "203.0.113.10"

		got := clientIPFromRequest(req)
		if got != "203.0.113.10" {
			t.Fatalf("expected raw remote addr, got %q", got)
		}
	})
}
