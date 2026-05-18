package terminal

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/example/online-ssh-platform/server/internal/credential"
	"github.com/example/online-ssh-platform/server/internal/model"
	"github.com/example/online-ssh-platform/server/internal/observability"
)

const defaultRecordingQueueSize = 1024

type RecordingCollector struct {
	repo      RecordingRepository
	encryptor credential.Encryptor
	queue     chan recordingChunkEvent
	ctx       context.Context
	cancel    context.CancelFunc
	wg        sync.WaitGroup
}

type RecordingHandle struct {
	RecordingID string
	UserID      string
	SessionID   string

	collector  *RecordingCollector
	dropped    atomic.Int64
	finishOnce sync.Once
}

type recordingChunkEvent struct {
	handle    *RecordingHandle
	direction model.TerminalRecordingDirection
	payload   []byte
	occurred  time.Time
	flush     chan struct{}
}

func NewRecordingCollector(repo RecordingRepository, encryptor credential.Encryptor, queueSize int) *RecordingCollector {
	if repo == nil || encryptor == nil {
		return nil
	}
	if queueSize <= 0 {
		queueSize = defaultRecordingQueueSize
	}
	ctx, cancel := context.WithCancel(context.Background())
	collector := &RecordingCollector{
		repo:      repo,
		encryptor: encryptor,
		queue:     make(chan recordingChunkEvent, queueSize),
		ctx:       ctx,
		cancel:    cancel,
	}
	collector.wg.Add(1)
	go collector.workerLoop()
	return collector
}

func (c *RecordingCollector) Handle(recording model.TerminalRecording) *RecordingHandle {
	if c == nil {
		return nil
	}
	sessionID := ""
	if recording.TerminalSessionID != nil {
		sessionID = *recording.TerminalSessionID
	}
	return &RecordingHandle{
		RecordingID: recording.ID,
		UserID:      recording.UserID,
		SessionID:   sessionID,
		collector:   c,
	}
}

func (c *RecordingCollector) Close() {
	if c == nil || c.cancel == nil {
		return
	}
	c.cancel()
	c.wg.Wait()
}

func (h *RecordingHandle) Record(direction model.TerminalRecordingDirection, payload []byte) {
	if h == nil || h.collector == nil || h.RecordingID == "" || len(payload) == 0 {
		return
	}

	copied := append([]byte(nil), payload...)
	event := recordingChunkEvent{
		handle:    h,
		direction: direction,
		payload:   copied,
		occurred:  time.Now().UTC(),
	}
	select {
	case h.collector.queue <- event:
	case <-h.collector.ctx.Done():
	default:
		h.dropped.Add(int64(len(copied)))
	}
}

func (h *RecordingHandle) Finish(status model.TerminalRecordingStatus) {
	if h == nil || h.collector == nil || h.UserID == "" || h.SessionID == "" {
		return
	}
	h.finishOnce.Do(func() {
		h.collector.flush(h)
		h.collector.finish(h, status, h.dropped.Load())
	})
}

func (c *RecordingCollector) workerLoop() {
	defer c.wg.Done()
	for {
		select {
		case event := <-c.queue:
			if event.flush != nil {
				close(event.flush)
				continue
			}
			c.writeChunk(event)
		case <-c.ctx.Done():
			return
		}
	}
}

func (c *RecordingCollector) flush(handle *RecordingHandle) {
	if c == nil || handle == nil {
		return
	}
	completed := false
	done := make(chan struct{})
	event := recordingChunkEvent{
		handle: handle,
		flush:  done,
	}
	select {
	case c.queue <- event:
		select {
		case <-done:
			completed = true
		case <-c.ctx.Done():
		}
	case <-c.ctx.Done():
	}
	if completed {
		logRecordingFlushCompleted(handle)
	}
}

func (c *RecordingCollector) writeChunk(event recordingChunkEvent) {
	if event.handle == nil || len(event.payload) == 0 {
		return
	}
	encrypted, err := credential.EncryptWithActiveVersion(c.encryptor, string(event.payload))
	if err != nil {
		event.handle.dropped.Add(int64(len(event.payload)))
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.repo.AppendRecordingChunk(
		ctx,
		event.handle.RecordingID,
		string(event.direction),
		encrypted.CipherText,
		int64(len(event.payload)),
		encrypted.KeyVersion,
		event.occurred,
	); err != nil {
		event.handle.dropped.Add(int64(len(event.payload)))
	}
}

func (c *RecordingCollector) finish(handle *RecordingHandle, status model.TerminalRecordingStatus, droppedBytes int64) {
	if c == nil || handle == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = c.repo.FinishRecordingBySession(ctx, handle.UserID, handle.SessionID, string(status), time.Now().UTC(), droppedBytes)
	logRecordingFinished(handle, status, droppedBytes)
}

func logRecordingFlushCompleted(handle *RecordingHandle) {
	if handle == nil {
		return
	}
	observability.Info(context.Background(), "terminal recording flush completed",
		slog.String("component", "terminal"),
		slog.String("event", "terminal_recording_flush_completed"),
		slog.String("user_id", handle.UserID),
		slog.String("session_id", handle.SessionID),
		slog.String("recording_id", handle.RecordingID),
	)
}

func logRecordingFinished(handle *RecordingHandle, status model.TerminalRecordingStatus, droppedBytes int64) {
	if handle == nil {
		return
	}
	observability.Info(context.Background(), "terminal recording finished",
		slog.String("component", "terminal"),
		slog.String("event", "terminal_recording_finished"),
		slog.String("user_id", handle.UserID),
		slog.String("session_id", handle.SessionID),
		slog.String("recording_id", handle.RecordingID),
		slog.String("status", string(status)),
		slog.Int64("dropped_bytes", droppedBytes),
	)
}
