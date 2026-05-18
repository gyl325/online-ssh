package webutil

import (
	"bufio"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/example/online-ssh-platform/server/internal/observability"
)

type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func WriteNoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

func WriteError(w http.ResponseWriter, status int, code, message string) {
	WriteJSON(w, status, ErrorResponse{
		Code:    code,
		Message: message,
	})
}

func RequestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecordingResponseWriter{
			ResponseWriter: w,
			status:         http.StatusOK,
		}
		defer func() {
			observability.Info(r.Context(), "http request completed",
				slog.String("component", "http"),
				slog.String("event", "http_request_completed"),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", recorder.status),
				slog.Int64("duration_ms", time.Since(started).Milliseconds()),
			)
		}()
		next.ServeHTTP(wrapStatusRecordingResponseWriter(recorder), r)
	})
}

type statusRecordingResponseWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (w *statusRecordingResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusRecordingResponseWriter) Write(payload []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(payload)
}

func (w *statusRecordingResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

type statusRecordingFlusher struct {
	*statusRecordingResponseWriter
}

func (w statusRecordingFlusher) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

type statusRecordingHijacker struct {
	*statusRecordingResponseWriter
}

func (w statusRecordingHijacker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("response writer does not support hijacking")
	}
	return hijacker.Hijack()
}

type statusRecordingFlusherHijacker struct {
	*statusRecordingResponseWriter
}

func (w statusRecordingFlusherHijacker) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w statusRecordingFlusherHijacker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("response writer does not support hijacking")
	}
	return hijacker.Hijack()
}

func wrapStatusRecordingResponseWriter(w *statusRecordingResponseWriter) http.ResponseWriter {
	_, hasFlusher := w.ResponseWriter.(http.Flusher)
	_, hasHijacker := w.ResponseWriter.(http.Hijacker)
	switch {
	case hasFlusher && hasHijacker:
		return statusRecordingFlusherHijacker{statusRecordingResponseWriter: w}
	case hasFlusher:
		return statusRecordingFlusher{statusRecordingResponseWriter: w}
	case hasHijacker:
		return statusRecordingHijacker{statusRecordingResponseWriter: w}
	default:
		return w
	}
}
