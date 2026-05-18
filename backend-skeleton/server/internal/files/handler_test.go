package files

import "testing"

func TestParseLimit(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    int
		wantErr bool
	}{
		{name: "empty means unlimited", raw: "", want: 0},
		{name: "trims whitespace", raw: "  25  ", want: 25},
		{name: "zero is allowed", raw: "0", want: 0},
		{name: "invalid number returns error", raw: "abc", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseLimit(tt.raw)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("expected %d, got %d", tt.want, got)
			}
		})
	}
}

func TestParseRecursive(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    bool
		wantErr bool
	}{
		{name: "empty defaults false", raw: "", want: false},
		{name: "true keyword", raw: "true", want: true},
		{name: "one keyword", raw: "1", want: true},
		{name: "false keyword", raw: "false", want: false},
		{name: "zero keyword", raw: "0", want: false},
		{name: "invalid keyword", raw: "maybe", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseRecursive(tt.raw)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("expected %t, got %t", tt.want, got)
			}
		})
	}
}
