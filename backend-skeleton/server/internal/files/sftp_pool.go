package files

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const (
	defaultSFTPIdleTTL = 5 * time.Minute
	sftpPoolSweepEvery = time.Minute
)

type SFTPPoolOptions struct {
	IdleTTL     time.Duration
	TTLProvider func() time.Duration
}

type SFTPPool struct {
	hostService *host.Service
	idleTTL     time.Duration
	ttlProvider func() time.Duration

	mu      sync.Mutex
	entries map[string]*pooledSFTPClient
	stopCh  chan struct{}
	doneCh  chan struct{}
}

type pooledSFTPClient struct {
	pool       *SFTPPool
	key        string
	sshClient  *ssh.Client
	sftpClient *sftp.Client

	opMu      sync.Mutex
	mu        sync.Mutex
	inUse     bool
	closed    bool
	lastUsed  time.Time
	closeOnce sync.Once
}

type sftpLease struct {
	entry  *pooledSFTPClient
	reused bool
	once   sync.Once
}

func NewSFTPPool(hostService *host.Service) *SFTPPool {
	return NewSFTPPoolWithOptions(hostService, SFTPPoolOptions{})
}

func NewSFTPPoolWithOptions(hostService *host.Service, options SFTPPoolOptions) *SFTPPool {
	idleTTL := options.IdleTTL
	if idleTTL <= 0 {
		idleTTL = defaultSFTPIdleTTL
	}
	pool := &SFTPPool{
		hostService: hostService,
		idleTTL:     idleTTL,
		ttlProvider: options.TTLProvider,
		entries:     make(map[string]*pooledSFTPClient),
		stopCh:      make(chan struct{}),
		doneCh:      make(chan struct{}),
	}
	go pool.janitor()
	return pool
}

func (p *SFTPPool) Acquire(ctx context.Context, userID, hostID string) (*sftpLease, error) {
	if p == nil || p.hostService == nil {
		return nil, ErrInvalidInput
	}

	key := sftpPoolKey(userID, hostID)
	for {
		entry, reused, err := p.getOrCreate(ctx, key, userID, hostID)
		if err != nil {
			return nil, err
		}

		entry.opMu.Lock()
		entry.mu.Lock()
		if entry.closed {
			entry.mu.Unlock()
			entry.opMu.Unlock()
			p.removeIfSame(entry)
			continue
		}
		entry.inUse = true
		entry.mu.Unlock()

		return &sftpLease{entry: entry, reused: reused}, nil
	}
}

func (p *SFTPPool) Close() {
	if p == nil {
		return
	}
	close(p.stopCh)
	<-p.doneCh

	p.mu.Lock()
	items := make([]*pooledSFTPClient, 0, len(p.entries))
	for _, entry := range p.entries {
		items = append(items, entry)
	}
	p.entries = make(map[string]*pooledSFTPClient)
	p.mu.Unlock()

	for _, entry := range items {
		entry.markClosedAndClose()
	}
}

func (p *SFTPPool) getOrCreate(ctx context.Context, key, userID, hostID string) (*pooledSFTPClient, bool, error) {
	p.mu.Lock()
	entry := p.entries[key]
	p.mu.Unlock()
	if entry != nil {
		return entry, true, nil
	}

	created, err := p.create(ctx, key, userID, hostID)
	if err != nil {
		return nil, false, err
	}

	p.mu.Lock()
	existing := p.entries[key]
	if existing == nil {
		p.entries[key] = created
		p.mu.Unlock()
		return created, false, nil
	}
	p.mu.Unlock()

	created.markClosedAndClose()
	return existing, true, nil
}

func (p *SFTPPool) create(ctx context.Context, key, userID, hostID string) (*pooledSFTPClient, error) {
	sshClient, _, err := p.hostService.OpenSSHClient(ctx, userID, hostID, host.TestConnectionInput{})
	if err != nil {
		return nil, err
	}

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		_ = sshClient.Close()
		return nil, fmt.Errorf("create sftp client: %w", err)
	}

	return &pooledSFTPClient{
		pool:       p,
		key:        key,
		sshClient:  sshClient,
		sftpClient: sftpClient,
		lastUsed:   time.Now(),
	}, nil
}

func (p *SFTPPool) removeIfSame(entry *pooledSFTPClient) {
	if p == nil || entry == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.entries[entry.key] == entry {
		delete(p.entries, entry.key)
	}
}

func (p *SFTPPool) janitor() {
	defer close(p.doneCh)

	ticker := time.NewTicker(sftpPoolSweepEvery)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			p.closeIdle()
		case <-p.stopCh:
			return
		}
	}
}

func (p *SFTPPool) closeIdle() {
	now := time.Now()
	idleTTL := p.currentIdleTTL()
	var toClose []*pooledSFTPClient

	p.mu.Lock()
	for key, entry := range p.entries {
		entry.mu.Lock()
		shouldClose := !entry.inUse && !entry.closed && now.Sub(entry.lastUsed) > idleTTL
		if shouldClose {
			entry.closed = true
			delete(p.entries, key)
			toClose = append(toClose, entry)
		}
		entry.mu.Unlock()
	}
	p.mu.Unlock()

	for _, entry := range toClose {
		entry.closeClients()
	}
}

func (p *SFTPPool) currentIdleTTL() time.Duration {
	if p == nil {
		return defaultSFTPIdleTTL
	}
	if p.ttlProvider != nil {
		if ttl := p.ttlProvider(); ttl > 0 {
			return ttl
		}
	}
	return p.idleTTL
}

func (l *sftpLease) Client() *sftp.Client {
	if l == nil || l.entry == nil {
		return nil
	}
	return l.entry.sftpClient
}

func (l *sftpLease) Reused() bool {
	return l != nil && l.reused
}

func (l *sftpLease) Release() {
	if l == nil || l.entry == nil {
		return
	}
	l.once.Do(func() {
		l.entry.release(false)
	})
}

func (l *sftpLease) Discard() {
	if l == nil || l.entry == nil {
		return
	}
	l.once.Do(func() {
		l.entry.release(true)
	})
}

func (l *sftpLease) DiscardIfConnectionError(err error) {
	if isSFTPConnectionError(err) {
		l.Discard()
	}
}

func (e *pooledSFTPClient) release(discard bool) {
	e.mu.Lock()
	e.inUse = false
	e.lastUsed = time.Now()
	shouldClose := discard && !e.closed
	if shouldClose {
		e.closed = true
	}
	e.mu.Unlock()
	e.opMu.Unlock()

	if shouldClose {
		e.pool.removeIfSame(e)
		e.closeClients()
	}
}

func (e *pooledSFTPClient) markClosedAndClose() {
	e.mu.Lock()
	alreadyClosed := e.closed
	e.closed = true
	e.mu.Unlock()
	if !alreadyClosed {
		e.closeClients()
	}
}

func (e *pooledSFTPClient) closeClients() {
	e.closeOnce.Do(func() {
		if e.sftpClient != nil {
			_ = e.sftpClient.Close()
		}
		if e.sshClient != nil {
			_ = e.sshClient.Close()
		}
	})
}

func sftpPoolKey(userID, hostID string) string {
	return userID + "\x00" + hostID
}

func isSFTPConnectionError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) {
		return false
	}

	message := strings.ToLower(err.Error())
	connectionMarkers := []string{
		"broken pipe",
		"connection reset",
		"connection refused",
		"connection lost",
		"eof",
		"use of closed network connection",
		"ssh:",
		"sftp: unexpected packet",
	}
	for _, marker := range connectionMarkers {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}
