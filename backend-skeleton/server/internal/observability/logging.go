package observability

import (
	"context"
	"log/slog"
	"strings"
)

const (
	KindCanceled   = "canceled"
	KindConnection = "connection"
	KindNoSpace    = "no_space"
	KindNotFound   = "not_found"
	KindPermission = "permission_denied"
	KindTimeout    = "timeout"
	KindUnknown    = "unknown"
	KindValidation = "validation"
)

func Info(ctx context.Context, message string, attrs ...slog.Attr) {
	slog.LogAttrs(ctx, slog.LevelInfo, message, attrs...)
}

func Warn(ctx context.Context, message string, attrs ...slog.Attr) {
	slog.LogAttrs(ctx, slog.LevelWarn, message, attrs...)
}

func ErrorKindFromCode(code string) string {
	value := strings.ToLower(strings.TrimSpace(code))
	switch {
	case value == "":
		return KindUnknown
	case strings.Contains(value, "permission"):
		return KindPermission
	case strings.Contains(value, "no_space"):
		return KindNoSpace
	case strings.Contains(value, "not_found") || strings.Contains(value, "missing"):
		return KindNotFound
	case strings.Contains(value, "timeout"):
		return KindTimeout
	case strings.Contains(value, "cancel"):
		return KindCanceled
	case strings.Contains(value, "invalid"):
		return KindValidation
	case strings.Contains(value, "retryable") || strings.Contains(value, "connection"):
		return KindConnection
	default:
		return KindUnknown
	}
}
