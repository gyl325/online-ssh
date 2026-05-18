package terminal

import "sync"

type attachmentHandle struct {
	id     int
	output chan []byte
	closed chan AttachmentClose
	once   sync.Once
}

func (h *attachmentHandle) close(reason AttachmentClose) {
	h.once.Do(func() {
		h.closed <- reason
		close(h.output)
	})
}

type viewerAttachmentHandle struct {
	id      int
	shareID string
	output  chan []byte
	closed  chan AttachmentClose
	once    sync.Once
}

func (h *viewerAttachmentHandle) close(reason AttachmentClose) {
	h.once.Do(func() {
		h.closed <- reason
		close(h.output)
	})
}
