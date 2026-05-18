package audit

import (
	"testing"
	"time"
)

func TestParseMetadata(t *testing.T) {
	t.Run("empty metadata returns empty object", func(t *testing.T) {
		got := parseMetadata(nil)
		if len(got) != 0 {
			t.Fatalf("expected empty metadata, got %#v", got)
		}
	})

	t.Run("invalid metadata returns empty object", func(t *testing.T) {
		got := parseMetadata([]byte("{invalid"))
		if len(got) != 0 {
			t.Fatalf("expected empty metadata for invalid json, got %#v", got)
		}
	})

	t.Run("valid metadata is parsed", func(t *testing.T) {
		got := parseMetadata([]byte(`{"event":"login","ok":true}`))
		if got["event"] != "login" {
			t.Fatalf("expected event=login, got %#v", got["event"])
		}
		if got["ok"] != true {
			t.Fatalf("expected ok=true, got %#v", got["ok"])
		}
	})
}

func TestParseTime(t *testing.T) {
	t.Run("empty time returns nil", func(t *testing.T) {
		if got := parseTime(""); got != nil {
			t.Fatalf("expected nil, got %#v", got)
		}
	})

	t.Run("invalid time returns nil", func(t *testing.T) {
		if got := parseTime("not-a-time"); got != nil {
			t.Fatalf("expected nil, got %#v", got)
		}
	})

	t.Run("valid rfc3339 time is parsed", func(t *testing.T) {
		raw := "2026-04-24T01:02:03Z"
		got := parseTime(raw)
		if got == nil {
			t.Fatal("expected parsed time, got nil")
		}
		expected, _ := time.Parse(time.RFC3339, raw)
		if !got.Equal(expected) {
			t.Fatalf("expected %s, got %s", expected.Format(time.RFC3339), got.Format(time.RFC3339))
		}
	})
}
