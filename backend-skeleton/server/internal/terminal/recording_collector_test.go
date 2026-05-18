package terminal

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
)

func TestRecordingHandleFinishFlushesQueuedChunksBeforeFinishing(t *testing.T) {
	repo := newRecordingCollectorRepoStub()
	collector := NewRecordingCollector(repo, recordingEncryptorStub{}, 4)
	defer collector.Close()
	defer repo.releaseAppend()

	sessionID := "session-1"
	handle := collector.Handle(model.TerminalRecording{
		ID:                "recording-1",
		UserID:            "user-1",
		TerminalSessionID: &sessionID,
	})
	handle.Record(model.TerminalRecordingDirectionOutput, []byte("tail output"))

	select {
	case <-repo.appendStarted:
	case <-time.After(time.Second):
		t.Fatal("expected queued recording chunk append to start")
	}

	finishDone := make(chan struct{})
	go func() {
		handle.Finish(model.TerminalRecordingStatusCompleted)
		close(finishDone)
	}()

	select {
	case <-repo.finishCalled:
		t.Fatal("recording was finished before queued chunks were flushed")
	case <-time.After(50 * time.Millisecond):
	}

	repo.releaseAppend()

	select {
	case <-repo.finishCalled:
	case <-time.After(time.Second):
		t.Fatal("expected recording finish after queued chunk append completed")
	}
	select {
	case <-finishDone:
	case <-time.After(time.Second):
		t.Fatal("expected Finish to return after flushing queued chunks")
	}

	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.chunks) != 1 {
		t.Fatalf("expected one appended chunk, got %d", len(repo.chunks))
	}
	if repo.chunks[0].dataEnc != "enc:tail output" {
		t.Fatalf("unexpected encrypted chunk payload %q", repo.chunks[0].dataEnc)
	}
}

func TestRecordingHandleFinishLogsFlushAndFinishWithoutRawPayload(t *testing.T) {
	var output bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(previous)

	repo := newRecordingCollectorRepoStub()
	collector := NewRecordingCollector(repo, recordingEncryptorStub{}, 4)
	defer collector.Close()
	repo.releaseAppend()

	sessionID := "session-1"
	handle := collector.Handle(model.TerminalRecording{
		ID:                "recording-1",
		UserID:            "user-1",
		TerminalSessionID: &sessionID,
	})
	handle.Record(model.TerminalRecordingDirectionOutput, []byte("tail output from /tmp/private.log"))
	handle.Finish(model.TerminalRecordingStatusCompleted)

	records := make(map[string]map[string]any)
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("decode structured recording log %q: %v", line, err)
		}
		if event, ok := record["event"].(string); ok {
			records[event] = record
		}
	}
	flushLog := records["terminal_recording_flush_completed"]
	if flushLog == nil {
		t.Fatalf("expected recording flush log, got %s", output.String())
	}
	if flushLog["component"] != "terminal" ||
		flushLog["recording_id"] != "recording-1" ||
		flushLog["session_id"] != "session-1" ||
		flushLog["user_id"] != "user-1" {
		t.Fatalf("unexpected recording flush log: %#v", flushLog)
	}
	finishLog := records["terminal_recording_finished"]
	if finishLog == nil {
		t.Fatalf("expected recording finish log, got %s", output.String())
	}
	if finishLog["component"] != "terminal" ||
		finishLog["recording_id"] != "recording-1" ||
		finishLog["session_id"] != "session-1" ||
		finishLog["user_id"] != "user-1" ||
		finishLog["status"] != string(model.TerminalRecordingStatusCompleted) ||
		finishLog["dropped_bytes"] != float64(0) {
		t.Fatalf("unexpected recording finish log: %#v", finishLog)
	}
	if strings.Contains(output.String(), "tail output") || strings.Contains(output.String(), "/tmp/private.log") {
		t.Fatalf("structured recording logs leaked raw payload: %s", output.String())
	}
}

type recordingCollectorRepoStub struct {
	appendStarted chan struct{}
	allowAppend   chan struct{}
	finishCalled  chan struct{}
	appendOnce    sync.Once
	allowOnce     sync.Once
	finishOnce    sync.Once
	mu            sync.Mutex
	chunks        []recordingCollectorChunk
}

func (r *recordingCollectorRepoStub) releaseAppend() {
	r.allowOnce.Do(func() {
		close(r.allowAppend)
	})
}

type recordingCollectorChunk struct {
	recordingID string
	direction   string
	dataEnc     string
	byteCount   int64
}

func newRecordingCollectorRepoStub() *recordingCollectorRepoStub {
	return &recordingCollectorRepoStub{
		appendStarted: make(chan struct{}),
		allowAppend:   make(chan struct{}),
		finishCalled:  make(chan struct{}),
	}
}

func (r *recordingCollectorRepoStub) GetRecordingSettings(context.Context, string) (model.TerminalRecordingSettings, error) {
	return model.TerminalRecordingSettings{}, nil
}

func (r *recordingCollectorRepoStub) UpsertRecordingSettings(_ context.Context, settings model.TerminalRecordingSettings) (model.TerminalRecordingSettings, error) {
	return settings, nil
}

func (r *recordingCollectorRepoStub) CreateRecording(_ context.Context, recording model.TerminalRecording) (model.TerminalRecording, error) {
	return recording, nil
}

func (r *recordingCollectorRepoStub) AppendRecordingChunk(_ context.Context, recordingID, direction, dataEnc string, byteCount int64, _ int, _ time.Time) error {
	r.appendOnce.Do(func() {
		close(r.appendStarted)
	})
	<-r.allowAppend
	r.mu.Lock()
	defer r.mu.Unlock()
	r.chunks = append(r.chunks, recordingCollectorChunk{
		recordingID: recordingID,
		direction:   direction,
		dataEnc:     dataEnc,
		byteCount:   byteCount,
	})
	return nil
}

func (r *recordingCollectorRepoStub) FinishRecordingBySession(context.Context, string, string, string, time.Time, int64) error {
	r.finishOnce.Do(func() {
		close(r.finishCalled)
	})
	return nil
}

func (r *recordingCollectorRepoStub) ListRecordingsByUserID(context.Context, string, int, int) ([]model.TerminalRecording, int, error) {
	return nil, 0, nil
}

func (r *recordingCollectorRepoStub) GetRecordingByID(context.Context, string, string) (model.TerminalRecording, error) {
	return model.TerminalRecording{}, nil
}

func (r *recordingCollectorRepoStub) ListRecordingChunks(context.Context, string, int, int) ([]model.TerminalRecordingChunk, error) {
	return nil, nil
}

func (r *recordingCollectorRepoStub) UpdateRecordingBookmark(context.Context, string, string, bool) (model.TerminalRecording, error) {
	return model.TerminalRecording{}, nil
}

func (r *recordingCollectorRepoStub) DeleteRecording(context.Context, string, string) error {
	return nil
}
