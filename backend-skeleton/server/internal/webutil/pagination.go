package webutil

import (
	"net/http"
	"strconv"
)

const (
	DefaultPage     = 1
	DefaultPageSize = 20
	MaxPageSize     = 200
)

type Pagination struct {
	Page     int
	PageSize int
	Offset   int
}

func ParsePagination(r *http.Request) Pagination {
	page := parsePositiveInt(r.URL.Query().Get("page"), DefaultPage)
	pageSize := parsePositiveInt(r.URL.Query().Get("page_size"), DefaultPageSize)
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}

	return Pagination{
		Page:     page,
		PageSize: pageSize,
		Offset:   (page - 1) * pageSize,
	}
}

func parsePositiveInt(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
