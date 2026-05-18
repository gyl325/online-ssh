package admin

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/example/online-ssh-platform/server/internal/model"
)

func TestServiceAdminMFA(t *testing.T) {
	ctx := context.Background()

	t.Run("reset mfa requires user management permission and writes audit", func(t *testing.T) {
		recorder := &serviceAuditRecorder{}
		var resetUserID string
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserFn: func(_ context.Context, userID string) (model.User, error) {
				return model.User{ID: userID, Role: string(model.UserRoleUser)}, nil
			},
			getRoleFn: func(_ context.Context, key string) (Role, error) {
				return Role{Key: key, Name: "User", IsActive: true}, nil
			},
			resetUserMFAFn: func(_ context.Context, userID string) error {
				resetUserID = userID
				return nil
			},
		}, ServiceOptions{AuditRecorder: recorder})

		err := service.ResetUserMFA(ctx, Actor{
			UserID:      "admin-1",
			SessionID:   "session-1",
			Permissions: []string{model.PermissionAdminUsers},
		}, "user-1", AdminRequestMetadata{ClientIP: "203.0.113.10", UserAgent: "test-agent"})
		if err != nil {
			t.Fatalf("reset returned error: %v", err)
		}
		if resetUserID != "user-1" {
			t.Fatalf("expected reset target user-1, got %q", resetUserID)
		}
		if len(recorder.logs) != 1 {
			t.Fatalf("expected one audit log, got %d", len(recorder.logs))
		}
		log := recorder.logs[0]
		if log.EventType != "admin_mfa_reset" || log.UserID != "admin-1" || log.ClientIP == nil || *log.ClientIP != "203.0.113.10" {
			t.Fatalf("unexpected audit log: %+v", log)
		}
	})

	t.Run("rejects resetting mfa for self or another admin", func(t *testing.T) {
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserFn: func(_ context.Context, userID string) (model.User, error) {
				return model.User{ID: userID, Role: string(model.UserRoleAdmin)}, nil
			},
			getRoleFn: func(_ context.Context, key string) (Role, error) {
				return Role{Key: key, Name: "Admin", IsActive: true, Permissions: []string{model.PermissionAdminAccess}}, nil
			},
			resetUserMFAFn: func(context.Context, string) error {
				t.Fatal("reset mfa should not be called for admin users")
				return nil
			},
		}, ServiceOptions{})

		err := service.ResetUserMFA(ctx, Actor{
			UserID:      "admin-1",
			Permissions: []string{model.PermissionAdminUsers},
		}, "admin-1", AdminRequestMetadata{})
		if !errors.Is(err, ErrCannotModifySelf) {
			t.Fatalf("expected ErrCannotModifySelf, got %v", err)
		}

		err = service.ResetUserMFA(ctx, Actor{
			UserID:      "admin-1",
			Permissions: []string{model.PermissionAdminUsers},
		}, "admin-2", AdminRequestMetadata{})
		if !errors.Is(err, ErrCannotModifyAdmin) {
			t.Fatalf("expected ErrCannotModifyAdmin, got %v", err)
		}
	})

	t.Run("reports mfa status", func(t *testing.T) {
		now := time.Now()
		service := NewServiceWithOptions(&serviceRepoStub{
			getUserMFAStatusFn: func(_ context.Context, userID string) (UserMFAStatus, error) {
				if userID != "user-1" {
					t.Fatalf("unexpected user id %q", userID)
				}
				return UserMFAStatus{
					UserID:            userID,
					TOTPEnabled:       true,
					ConfirmedAt:       &now,
					RecoveryCodeCount: 8,
				}, nil
			},
		}, ServiceOptions{})

		status, err := service.GetUserMFA(ctx, Actor{
			UserID:      "admin-1",
			Permissions: []string{model.PermissionAdminUsers},
		}, "user-1")
		if err != nil {
			t.Fatalf("status returned error: %v", err)
		}
		if !status.TOTPEnabled || status.RecoveryCodeCount != 8 || status.ConfirmedAt == nil {
			t.Fatalf("unexpected status: %+v", status)
		}
	})
}
