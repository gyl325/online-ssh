# Online SSH Documentation

This directory contains the public documentation for Online SSH. It is organized as product scope, architecture references, API contracts, operations notes, and test runbooks.

If documentation conflicts with code, treat code as the source of truth. For HTTP routes, start with `backend-skeleton/server/internal/httpapi/router.go`, then update `docs/api/openapi.yaml` when behavior changes.

## Start Here

| Need | Read |
|---|---|
| Install, run, configure, deploy | `../README.md` |
| Frontend setup | `../apps/web/README.md` |
| Backend setup | `../backend-skeleton/server/README.md` |
| HTTP API | `api/openapi.yaml` |
| Database schema | `architecture/storage-schema.md` and `../backend-skeleton/server/migrations/` |
| Security boundaries | `architecture/security-model.md` |
| Real SSH/SFTP smoke testing | `smoke-tests.md` |

## Product

- `product/mvp-scope.md`: product scope and first-version intent.
- `future-backlog.md`: optional future capabilities that are not required for the current core product.

## Architecture

- `architecture/system-overview.md`: system boundaries and module responsibilities.
- `architecture/storage-schema.md`: tables, migration order, import/export notes, and schema conventions.
- `architecture/security-model.md`: auth, credentials, fingerprint checks, audit boundaries, and sensitive data handling.
- `architecture/auth-refresh.md`: HttpOnly refresh cookie flow.
- `architecture/file-transfer.md`: upload, download, resume, and transfer task model.
- `architecture/remote-file-search.md`: remote search task model.
- `architecture/audit-export.md`: asynchronous audit CSV export model.
- `architecture/credential-key-rotation.md`: credential master-key versioning and rotation plan.
- `architecture/team-rbac.md`: team/RBAC design notes; not part of the default personal-user deployment path.
- `architecture/terminal-audit-levels.md`: terminal audit levels design; full terminal IO capture is not enabled by default.
- `architecture/frontend-engineering.md`: frontend route/feature/shared layering rules.

## Operations

- `smoke-tests.md`: manual smoke test for a real SSH/SFTP target.
- `frontend-terminal-reconnect.md`: browser refresh, reconnect, keepalive, and terminal runtime behavior.
- `operational-logging.md`: structured application log events and fields for troubleshooting.

## Frontend Standards

- `design-system.md`: design tokens, shared UI usage, and frontend visual review checklist.
- `architecture/frontend-engineering.md`: ownership boundaries and test expectations for frontend changes.

## Maintenance Rules

- Keep process notes, personal planning files, transition notes, and agent-generated execution plans outside the public repository.
- Do not commit local deployment addresses, private registry hosts, SSH usernames, private keys, API keys, or `.env` files.
- When adding a migration, update `architecture/storage-schema.md`, backend deployment notes, and tests.
- When changing an API, update router tests, frontend API clients, and `api/openapi.yaml`.
- When changing security-sensitive behavior, update `architecture/security-model.md` or the relevant architecture document.
