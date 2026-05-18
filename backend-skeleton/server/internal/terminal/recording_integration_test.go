package terminal

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/db"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/testutil/pgtest"
)

type recordingEncryptorStub struct{}

func (recordingEncryptorStub) Encrypt(plain string) (string, error) {
	return "enc:" + plain, nil
}

func (recordingEncryptorStub) Decrypt(cipherText string) (string, error) {
	return strings.TrimPrefix(cipherText, "enc:"), nil
}

func TestServiceTerminalRecordingSettingsAndChunks(t *testing.T) {
	database := pgtest.OpenMigratedDB(t)
	repo := NewPostgresRepository(database)
	service := NewServiceWithOptions(repo, nil, nil, ServiceOptions{
		RecordingEncryptor: recordingEncryptorStub{},
		RecordingQueueSize: 8,
	})
	defer service.Close()

	ctx := context.Background()
	userID := pgtest.InsertUser(t, database, "terminal-recording@example.com")
	hostID := insertTerminalRecordingHost(t, database, userID)

	defaultSettings, err := service.GetRecordingSettings(ctx, userID)
	if err != nil {
		t.Fatalf("get default recording settings: %v", err)
	}
	if defaultSettings.Enabled || defaultSettings.RetentionDays != defaultRecordingRetentionDays {
		t.Fatalf("unexpected default settings: %#v", defaultSettings)
	}

	settings, err := service.UpdateRecordingSettings(ctx, RecordingSettingsInput{
		UserID:        userID,
		Enabled:       true,
		RetentionDays: 3,
	})
	if err != nil {
		t.Fatalf("update recording settings: %v", err)
	}
	if !settings.Enabled || settings.RetentionDays != 3 {
		t.Fatalf("unexpected updated settings: %#v", settings)
	}

	session, err := repo.CreateSession(ctx, userID, hostID, string(model.TerminalSessionStatusConnected), nil)
	if err != nil {
		t.Fatalf("create terminal session: %v", err)
	}
	handle := service.startRecording(ctx, session)
	if handle == nil {
		t.Fatalf("expected recording handle when settings are enabled")
	}

	handle.Record(model.TerminalRecordingDirectionInput, []byte("ls -la\n"))
	handle.Record(model.TerminalRecordingDirectionOutput, []byte("total 8\n"))

	var chunks RecordingChunkListResult
	eventually(t, func() bool {
		var chunkErr error
		chunks, chunkErr = service.ListRecordingChunks(ctx, userID, handle.RecordingID, 0, 20)
		return chunkErr == nil && len(chunks.Items) == 2
	})
	if chunks.Items[0].Direction != string(model.TerminalRecordingDirectionInput) || chunks.Items[0].Data != "ls -la\n" {
		t.Fatalf("unexpected input chunk: %#v", chunks.Items[0])
	}
	if chunks.Items[1].Direction != string(model.TerminalRecordingDirectionOutput) || chunks.Items[1].Data != "total 8\n" {
		t.Fatalf("unexpected output chunk: %#v", chunks.Items[1])
	}

	handle.Finish(model.TerminalRecordingStatusCompleted)
	recording, err := service.GetRecording(ctx, userID, handle.RecordingID)
	if err != nil {
		t.Fatalf("get finished recording: %v", err)
	}
	if recording.Status != string(model.TerminalRecordingStatusCompleted) || recording.EndedAt == nil {
		t.Fatalf("expected completed recording, got %#v", recording)
	}
	if recording.InputBytes != int64(len("ls -la\n")) || recording.OutputBytes != int64(len("total 8\n")) {
		t.Fatalf("unexpected byte counters: %#v", recording)
	}

	list, err := service.ListRecordings(ctx, userID, 1, 10)
	if err != nil {
		t.Fatalf("list recordings: %v", err)
	}
	if list.Total != 1 || len(list.Items) != 1 || list.Items[0].ID != handle.RecordingID {
		t.Fatalf("unexpected recording list: %#v", list)
	}

	bookmarked, err := service.UpdateRecordingBookmark(ctx, RecordingBookmarkInput{
		UserID:       userID,
		RecordingID:  handle.RecordingID,
		IsBookmarked: true,
	})
	if err != nil {
		t.Fatalf("bookmark recording: %v", err)
	}
	if !bookmarked.IsBookmarked {
		t.Fatalf("expected bookmarked recording, got %#v", bookmarked)
	}
	if _, err := database.SQL.ExecContext(ctx, `UPDATE terminal_recordings SET expires_at = now() - interval '1 day' WHERE id = $1`, handle.RecordingID); err != nil {
		t.Fatalf("expire bookmarked recording: %v", err)
	}
	list, err = service.ListRecordings(ctx, userID, 1, 10)
	if err != nil {
		t.Fatalf("list bookmarked expired recording: %v", err)
	}
	if list.Total != 1 || len(list.Items) != 1 || !list.Items[0].IsBookmarked {
		t.Fatalf("expected bookmarked expired recording to remain visible, got %#v", list)
	}
	unbookmarked, err := service.UpdateRecordingBookmark(ctx, RecordingBookmarkInput{
		UserID:       userID,
		RecordingID:  handle.RecordingID,
		IsBookmarked: false,
	})
	if err != nil {
		t.Fatalf("remove recording bookmark: %v", err)
	}
	if unbookmarked.IsBookmarked {
		t.Fatalf("expected unbookmarked recording, got %#v", unbookmarked)
	}
	list, err = service.ListRecordings(ctx, userID, 1, 10)
	if err != nil {
		t.Fatalf("list expired unbookmarked recording: %v", err)
	}
	if list.Total != 0 {
		t.Fatalf("expected expired unbookmarked recording to disappear, got %#v", list)
	}

	if _, err := database.SQL.ExecContext(ctx, `UPDATE terminal_recordings SET expires_at = now() + interval '1 day' WHERE id = $1`, handle.RecordingID); err != nil {
		t.Fatalf("restore recording expiry: %v", err)
	}
	if err := service.DeleteRecording(ctx, userID, handle.RecordingID); err != nil {
		t.Fatalf("delete recording: %v", err)
	}
	list, err = service.ListRecordings(ctx, userID, 1, 10)
	if err != nil {
		t.Fatalf("list recordings after delete: %v", err)
	}
	if list.Total != 0 {
		t.Fatalf("expected deleted recording to disappear, got %#v", list)
	}
}

func insertTerminalRecordingHost(t *testing.T, database *db.DB, userID string) string {
	t.Helper()

	return pgtest.MustQueryRow(t, database,
		`INSERT INTO hosts (user_id, name, host, port, username, auth_type, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		func(row *sql.Row) (string, error) {
			var id string
			err := row.Scan(&id)
			return id, err
		},
		userID,
		"Recording host",
		"203.0.113.50",
		22,
		"root",
		string(model.AuthTypePassword),
		string(model.HostStatusActive),
	)
}

func eventually(t *testing.T, condition func() bool) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !condition() {
		t.Fatalf("condition did not become true before deadline")
	}
}
