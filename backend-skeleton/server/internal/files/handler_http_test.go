package files

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/auth"
	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
)

func TestFilesHandlerValidationAndAuth(t *testing.T) {
	handler := NewHandler(&Service{})

	t.Run("list directory requires session", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/files?host_id=host-1&path=/tmp", nil)
		recorder := httptest.NewRecorder()

		handler.ListDirectory(recorder, req)

		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("list directory rejects invalid limit", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/files?host_id=host-1&path=/tmp&limit=oops", nil)
		req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
		recorder := httptest.NewRecorder()

		handler.ListDirectory(recorder, req)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("search files rejects invalid recursive flag", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/files/search?host_id=host-1&base_path=/tmp&keyword=log&recursive=maybe", nil)
		req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
		recorder := httptest.NewRecorder()

		handler.SearchFiles(recorder, req)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("create search task rejects invalid request body", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/files/search-tasks", bytes.NewBufferString(`{invalid`))
		req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
		recorder := httptest.NewRecorder()

		handler.CreateSearchTask(recorder, req)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("get search task requires session", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/files/search-tasks/task-1", nil)
		recorder := httptest.NewRecorder()

		handler.GetSearchTask(recorder, req)

		if recorder.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("create directory rejects invalid json", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/files/mkdir", bytes.NewBufferString(`{invalid`))
		req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
		recorder := httptest.NewRecorder()

		handler.CreateDirectory(recorder, req)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("chmod maps service invalid input to 400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/files/chmod", bytes.NewBufferString(`{"host_id":"","path":"","mode":""}`))
		req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
		recorder := httptest.NewRecorder()

		handler.Chmod(recorder, req)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("compress archive rejects invalid json", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/files/archive/compress", bytes.NewBufferString(`{invalid`))
		req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
		recorder := httptest.NewRecorder()

		handler.CompressArchive(recorder, req)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("extract archive maps unsupported format to 400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/files/archive/extract", bytes.NewBufferString(`{"host_id":"host-1","path":"/tmp/app.rar"}`))
		req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
		recorder := httptest.NewRecorder()

		handler.ExtractArchive(recorder, req)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
		var payload map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode error payload: %v", err)
		}
		if payload["code"] != "UNSUPPORTED_ARCHIVE_FORMAT" {
			t.Fatalf("unexpected payload: %#v", payload)
		}
	})

	t.Run("copy maps service invalid input to 400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/files/copy", bytes.NewBufferString(`{"host_id":"host-1","source_path":"/tmp/a","target_path":"/tmp/a"}`))
		req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
		recorder := httptest.NewRecorder()

		handler.CopyFile(recorder, req)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("checksum rejects invalid json", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/files/checksum", bytes.NewBufferString(`{invalid`))
		req = req.WithContext(auth.WithSession(req.Context(), auth.AuthenticatedSession{UserID: "user-1"}))
		recorder := httptest.NewRecorder()

		handler.CalculateChecksum(recorder, req)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})
}

func TestWriteFilesError(t *testing.T) {
	handler := NewHandler(nil)

	t.Run("fingerprint conflict maps to 409 payload", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		err := &host.FingerprintConflictError{
			Code:    "HOST_FINGERPRINT_CONFLICT",
			Message: "fingerprint changed",
			CurrentFingerprint: model.HostFingerprint{
				Algorithm:      "ssh-ed25519",
				Fingerprint:    "current-fp",
				Status:         string(model.FingerprintStatusChanged),
				FirstSeenAt:    time.Date(2026, 4, 24, 12, 0, 0, 0, time.UTC),
				LastVerifiedAt: nil,
			},
			PreviousFingerprint: &model.HostFingerprint{
				Algorithm:   "ssh-rsa",
				Fingerprint: "previous-fp",
				Status:      string(model.FingerprintStatusTrusted),
			},
		}

		handler.writeFilesError(recorder, err)

		if recorder.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d body=%s", recorder.Code, recorder.Body.String())
		}

		var payload map[string]any
		if decodeErr := json.Unmarshal(recorder.Body.Bytes(), &payload); decodeErr != nil {
			t.Fatalf("decode fingerprint error payload: %v", decodeErr)
		}
		if payload["code"] != "HOST_FINGERPRINT_CONFLICT" {
			t.Fatalf("unexpected payload: %#v", payload)
		}
	})

	t.Run("ssh connect failure maps to 502", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		handler.writeFilesError(recorder, &host.SSHConnectionFailedError{Message: "ssh down"})
		if recorder.Code != http.StatusBadGateway {
			t.Fatalf("expected 502, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("not found maps to 404", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		handler.writeFilesError(recorder, db.ErrNotFound)
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("archive output conflict maps to 409", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		handler.writeFilesError(recorder, ErrArchiveOutputAlreadyExist)
		if recorder.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("archive tool missing maps to 400", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		handler.writeFilesError(recorder, &ArchiveToolMissingError{Command: "unzip"})
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("remote path exists maps to 409", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		handler.writeFilesError(recorder, ErrRemotePathAlreadyExists)
		if recorder.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("checksum unavailable maps to 400", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		handler.writeFilesError(recorder, ErrChecksumUnavailable)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d body=%s", recorder.Code, recorder.Body.String())
		}
	})
}
