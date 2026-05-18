package hostgroup

import (
	"context"
	"testing"

	"github.com/example/online-ssh-platform/server/internal/model"
)

type hostGroupRepoStub struct {
	items []model.HostGroup
}

func (r *hostGroupRepoStub) ListByUserID(_ context.Context, userID string) ([]model.HostGroup, error) {
	return r.items, nil
}

func (r *hostGroupRepoStub) GetByID(_ context.Context, userID, groupID string) (model.HostGroup, error) {
	return model.HostGroup{}, nil
}

func (r *hostGroupRepoStub) Create(_ context.Context, item model.HostGroup) (model.HostGroup, error) {
	item.ID = "group-created"
	return item, nil
}

func (r *hostGroupRepoStub) Update(_ context.Context, userID string, item model.HostGroup) (model.HostGroup, error) {
	return item, nil
}

func (r *hostGroupRepoStub) Delete(_ context.Context, userID, groupID string) error {
	return nil
}

type hostGroupAuditRecorder struct {
	logs []model.AuditLog
}

func (r *hostGroupAuditRecorder) Record(_ context.Context, log model.AuditLog) error {
	r.logs = append(r.logs, log)
	return nil
}

func TestServiceCreatesUpdatesAndDeletesHostGroups(t *testing.T) {
	audit := &hostGroupAuditRecorder{}
	service := NewService(&hostGroupRepoStub{}, audit)
	ctx := context.Background()

	created, err := service.Create(ctx, "user-1", SaveInput{Name: "  Ops  ", SortOrder: 10})
	if err != nil {
		t.Fatalf("create host group: %v", err)
	}
	if created.Name != "Ops" || created.SortOrder != 10 {
		t.Fatalf("unexpected created group: %#v", created)
	}

	updated, err := service.Update(ctx, "user-1", created.ID, SaveInput{Name: "Prod", SortOrder: 2})
	if err != nil {
		t.Fatalf("update host group: %v", err)
	}
	if updated.Name != "Prod" || updated.ID != created.ID {
		t.Fatalf("unexpected updated group: %#v", updated)
	}

	if err := service.Delete(ctx, "user-1", updated.ID); err != nil {
		t.Fatalf("delete host group: %v", err)
	}

	if len(audit.logs) != 3 {
		t.Fatalf("expected 3 audit logs, got %d", len(audit.logs))
	}
	if audit.logs[0].EventType != "host_group_create" || audit.logs[1].EventType != "host_group_update" || audit.logs[2].EventType != "host_group_delete" {
		t.Fatalf("unexpected audit logs: %#v", audit.logs)
	}
}

func TestServiceRejectsInvalidHostGroupInput(t *testing.T) {
	service := NewService(&hostGroupRepoStub{}, nil)
	ctx := context.Background()

	if _, err := service.Create(ctx, "user-1", SaveInput{Name: "   "}); err != ErrInvalidInput {
		t.Fatalf("expected ErrInvalidInput for empty name, got %v", err)
	}
	if _, err := service.Create(ctx, "", SaveInput{Name: "Ops"}); err != ErrInvalidInput {
		t.Fatalf("expected ErrInvalidInput for empty user, got %v", err)
	}
	if err := service.Delete(ctx, "user-1", ""); err != ErrInvalidInput {
		t.Fatalf("expected ErrInvalidInput for empty group id, got %v", err)
	}
}
