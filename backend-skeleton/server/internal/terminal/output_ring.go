package terminal

type outputRing struct {
	maxBytes int
	total    int
	chunks   [][]byte
}

func newOutputRing(maxBytes int) *outputRing {
	return &outputRing{maxBytes: maxBytes}
}

func (r *outputRing) add(payload []byte) {
	if r == nil || r.maxBytes <= 0 || len(payload) == 0 {
		return
	}
	chunk := append([]byte(nil), payload...)
	r.chunks = append(r.chunks, chunk)
	r.total += len(chunk)
	for r.total > r.maxBytes && len(r.chunks) > 0 {
		r.total -= len(r.chunks[0])
		r.chunks = r.chunks[1:]
	}
}

func (r *outputRing) snapshot() [][]byte {
	if r == nil || len(r.chunks) == 0 {
		return nil
	}
	items := make([][]byte, 0, len(r.chunks))
	for _, chunk := range r.chunks {
		items = append(items, append([]byte(nil), chunk...))
	}
	return items
}
