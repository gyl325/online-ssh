package webutil

import (
	"net/http/httptest"
	"testing"
)

func TestParsePagination(t *testing.T) {
	tests := []struct {
		name     string
		query    string
		expected Pagination
	}{
		{
			name:     "defaults when query is empty",
			query:    "",
			expected: Pagination{Page: DefaultPage, PageSize: DefaultPageSize, Offset: 0},
		},
		{
			name:     "uses positive page and page size",
			query:    "?page=3&page_size=25",
			expected: Pagination{Page: 3, PageSize: 25, Offset: 50},
		},
		{
			name:     "falls back for invalid values",
			query:    "?page=-1&page_size=abc",
			expected: Pagination{Page: DefaultPage, PageSize: DefaultPageSize, Offset: 0},
		},
		{
			name:     "caps page size",
			query:    "?page=2&page_size=999",
			expected: Pagination{Page: 2, PageSize: MaxPageSize, Offset: MaxPageSize},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/items"+tt.query, nil)
			got := ParsePagination(req)

			if got != tt.expected {
				t.Fatalf("expected %#v, got %#v", tt.expected, got)
			}
		})
	}
}
