package files

import (
	"context"
	"sync"
	"time"

	"github.com/example/online-ssh-platform/server/internal/host"
	"github.com/example/online-ssh-platform/server/internal/model"
)

type Service struct {
	hostService *host.Service
	audit       AuditRecorder
	sftpPool    *SFTPPool

	searchRepo SearchRepository

	searchWorkerCtx    context.Context
	searchWorkerCancel context.CancelFunc
	searchWorkerQueue  chan string
	searchWorkerWG     sync.WaitGroup

	mu             sync.Mutex
	activeSearches map[string]context.CancelFunc
}

type ServiceOptions struct {
	SFTPIdleTTL         time.Duration
	SFTPIdleTTLProvider func() time.Duration
}

type AuditRecorder interface {
	Record(ctx context.Context, log model.AuditLog) error
}

func NewService(hostService *host.Service, audit AuditRecorder) *Service {
	return NewServiceWithSearchRepository(hostService, audit, nil)
}

func NewServiceWithSearchRepository(hostService *host.Service, audit AuditRecorder, searchRepo SearchRepository) *Service {
	return NewServiceWithOptions(hostService, audit, searchRepo, ServiceOptions{})
}

func NewServiceWithOptions(hostService *host.Service, audit AuditRecorder, searchRepo SearchRepository, options ServiceOptions) *Service {
	workerCtx, workerCancel := context.WithCancel(context.Background())
	service := &Service{
		hostService:        hostService,
		audit:              audit,
		sftpPool:           NewSFTPPoolWithOptions(hostService, SFTPPoolOptions{IdleTTL: options.SFTPIdleTTL, TTLProvider: options.SFTPIdleTTLProvider}),
		searchRepo:         searchRepo,
		searchWorkerCtx:    workerCtx,
		searchWorkerCancel: workerCancel,
		searchWorkerQueue:  make(chan string, searchWorkerQueueSize),
		activeSearches:     make(map[string]context.CancelFunc),
	}
	if searchRepo != nil {
		service.searchWorkerWG.Add(1)
		go service.searchWorkerLoop()
	}
	return service
}

func (s *Service) Close() {
	if s != nil && s.searchWorkerCancel != nil {
		s.searchWorkerCancel()
		s.cancelAllActiveSearches()
		s.searchWorkerWG.Wait()
	}
	if s == nil || s.sftpPool == nil {
		return
	}
	s.sftpPool.Close()
}

func (s *Service) openSFTPLease(ctx context.Context, userID, hostID string) (*sftpLease, error) {
	if s.sftpPool == nil {
		return nil, ErrInvalidInput
	}
	return s.sftpPool.Acquire(ctx, userID, hostID)
}
