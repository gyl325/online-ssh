package files

import (
	"errors"
	"net/http"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/webutil"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) writeFilesError(w http.ResponseWriter, err error) {
	var fingerprintErr *host.FingerprintConflictError
	var hostConnErr *host.SSHConnectionFailedError
	var archiveToolMissingErr *ArchiveToolMissingError
	var remoteToolMissingErr *RemoteFileToolMissingError
	switch {
	case errors.Is(err, ErrInvalidInput):
		webutil.WriteError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid file request")
	case errors.Is(err, ErrUnsupportedArchiveFormat):
		webutil.WriteError(w, http.StatusBadRequest, "UNSUPPORTED_ARCHIVE_FORMAT", "unsupported archive format")
	case errors.Is(err, ErrArchiveOutputAlreadyExist):
		webutil.WriteError(w, http.StatusConflict, "ARCHIVE_OUTPUT_EXISTS", "archive output already exists")
	case errors.Is(err, ErrRemotePathAlreadyExists):
		webutil.WriteError(w, http.StatusConflict, "REMOTE_PATH_EXISTS", "remote path already exists")
	case errors.Is(err, ErrChecksumUnavailable):
		webutil.WriteError(w, http.StatusBadRequest, "CHECKSUM_UNAVAILABLE", "unable to calculate checksum")
	case errors.As(err, &archiveToolMissingErr):
		webutil.WriteError(w, http.StatusBadRequest, "ARCHIVE_TOOL_MISSING", archiveToolMissingErr.Error())
	case errors.As(err, &remoteToolMissingErr):
		webutil.WriteError(w, http.StatusBadRequest, "REMOTE_TOOL_MISSING", remoteToolMissingErr.Error())
	case errors.As(err, &fingerprintErr):
		webutil.WriteJSON(w, http.StatusConflict, map[string]any{
			"code":                 fingerprintErr.Code,
			"message":              fingerprintErr.Message,
			"current_fingerprint":  hostFingerprintResponse(fingerprintErr.CurrentFingerprint),
			"previous_fingerprint": optionalHostFingerprintResponse(fingerprintErr.PreviousFingerprint),
		})
	case errors.As(err, &hostConnErr):
		webutil.WriteError(w, http.StatusBadGateway, "FILES_SSH_CONNECT_FAILED", hostConnErr.Message)
	case db.IsNotFound(err):
		webutil.WriteError(w, http.StatusNotFound, "NOT_FOUND", "file resource not found")
	default:
		webutil.WriteError(w, http.StatusInternalServerError, "REMOTE_FILE_OPERATION_FAILED", "remote file operation failed")
	}
}

func hostFingerprintResponse(item model.HostFingerprint) map[string]any {
	return map[string]any{
		"algorithm":        item.Algorithm,
		"fingerprint":      item.Fingerprint,
		"status":           item.Status,
		"first_seen_at":    zeroTimeToNil(item.FirstSeenAt),
		"last_verified_at": item.LastVerifiedAt,
	}
}

func optionalHostFingerprintResponse(item *model.HostFingerprint) any {
	if item == nil {
		return nil
	}
	return hostFingerprintResponse(*item)
}

func zeroTimeToNil(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}
