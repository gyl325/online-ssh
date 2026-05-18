# Online SSH

[中文说明](README.zh-CN.md)

Online SSH is a self-hosted browser-based SSH management platform. It combines a Go API server, a Vite/React frontend, PostgreSQL storage, browser terminals, SFTP file management, transfer tasks, audit logs, and admin settings.

## Features

- Password login, email-code login, TOTP 2FA, recovery codes, session cookies, and HttpOnly refresh cookies.
- First-run setup wizard for creating the first administrator on a fresh database.
- Encrypted SSH credentials for password and private-key authentication.
- Host groups, host CRUD, SSH connectivity tests, host fingerprint confirmation, and host status checks.
- Browser terminal over WebSocket with PTY resize, reconnect, keepalive, history, saved commands, highlighting, and temporary read-only sharing.
- Remote file browsing over SFTP, local filtering, explicit remote search tasks, upload/download tasks, archive operations, checksums, preview, and light text editing.
- Audit logs, asynchronous CSV exports, admin user/session/role management, database import/export, SMTP settings, and LLM command assistant settings.

## Repository Layout

```text
.
├── apps/web                  # Vite + React frontend
├── backend-skeleton/server   # Go backend
├── docs                      # Public product, architecture, API, and operation docs
├── Dockerfile
├── compose.yaml              # Local/trial compose stack
└── compose.production.yaml   # Image-based production compose stack
```

## Docker Quick Start

For local evaluation:

```bash
cp .env.example .env
docker compose up -d
```

Open `http://localhost:8080`, then complete the setup wizard to create the first administrator.

The default `compose.yaml` builds the app locally, runs PostgreSQL, stores data under `./data/postgres`, serves the React app from the Go process, enables `AUTO_MIGRATE=true`, and binds the web port to `127.0.0.1:8080`.

For public production deployments, use `compose.production.yaml` with an immutable image and explicit secrets:

```bash
ONLINE_SSH_IMAGE=registry.example.com/online-ssh:2026-05-18 \
docker compose -f compose.production.yaml up -d
```

Set at least `POSTGRES_PASSWORD`, `CREDENTIAL_MASTER_KEY`, and `BOOTSTRAP_SETUP_TOKEN` in the server `.env`. Keep `SESSION_COOKIE_SECURE=true` when serving through HTTPS. `BOOTSTRAP_SETUP_TOKEN` protects a fresh public deployment from having its first administrator created by an unintended visitor.

Database backup example:

```bash
docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > online_ssh_backup.sql
```

Restore by stopping the app, restoring the dump into PostgreSQL, and starting the app again. If a later release has already applied schema migrations, roll back only to a version compatible with the current schema or restore the matching backup first.

## Local Development

Backend:

```bash
cd backend-skeleton/server
go run ./cmd/app
```

Frontend:

```bash
cd apps/web
npm install
npm run dev
```

Default URLs:

- Backend: `http://127.0.0.1:8080`
- Frontend dev server: `http://127.0.0.1:5173`
- Frontend dev proxy: `/api` and `/ws` proxy to the backend

## Backend Configuration

The backend looks for `.env.local` while walking up from the working directory. For non-Docker deployments, place the file next to the backend binary or run the binary from a directory that can find it.

Required:

```bash
DATABASE_URL=postgres://user:password@127.0.0.1:5432/online_ssh?sslmode=disable
CREDENTIAL_MASTER_KEY=replace-with-32-bytes-or-longer-secret
```

Common optional settings:

```bash
APP_ENV=production
HTTP_ADDR=127.0.0.1:8080
SESSION_COOKIE_NAME=online_ssh_session
REFRESH_COOKIE_NAME=online_ssh_refresh
SESSION_COOKIE_SECURE=true
SESSION_TTL_HOURS=168
SESSION_TTL_MINUTES=30
REFRESH_TOKEN_TTL_HOURS=168
ALLOW_USER_REGISTRATION=false
TERMINAL_MAX_SESSIONS_PER_USER=16
TERMINAL_MAX_SESSIONS_TOTAL=16
TERMINAL_KEEP_ALIVE_HOURS=24
FILE_SFTP_IDLE_TTL_MINUTES=5
HOST_CONNECTIVITY_POLL_INTERVAL_SECONDS=30
LLM_ENABLED=false
LLM_PROTOCOL=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini
LLM_AUTH_HEADER=bearer
LLM_API_KEY=replace-with-model-api-key
LLM_TIMEOUT_SECONDS=30
LLM_MAX_TOKENS=1024
```

`FILE_SFTP_IDLE_TTL_MINUTES` controls idle SFTP connection reuse. `HOST_CONNECTIVITY_POLL_INTERVAL_SECONDS` controls host status polling. `LLM_*` values provide environment defaults for the terminal command assistant; admin settings can override them at runtime. API keys are write-only in the UI and are never returned in read responses.

## Database Migrations

For source or direct binary deployments, run migrations before starting or restarting the app:

```bash
cd backend-skeleton/server
go run ./cmd/migrate up
```

The migration runner maintains `schema_migrations`, applies pending `*.up.sql` files in order, and treats repeated `up` runs as no-op. Check state with:

```bash
go run ./cmd/migrate status
```

Docker images default to `AUTO_MIGRATE=true`, `MIGRATIONS_DIR=/app/migrations`, and apply pending migrations before serving HTTP.

## CI And Deployment

The included `.gitlab-ci.yml` is a generic GitLab CI template with four stages: `test`, `build`, `deploy`, and `smoke`.

Default jobs:

- `frontend_tests`: runs `npm ci`, frontend tests, and production build in `apps/web`.
- `backend_tests`: runs `go test ./...` in `backend-skeleton/server`.
- `backend_db_integration_tests`: runs PostgreSQL integration packages only when `DATABASE_URL_TEST` is configured.
- `docker_image`: builds an immutable Docker image and pushes it when registry credentials are configured.
- `deploy_docker_production`: SSHes to a server that runs Docker Compose and deploys `compose.production.yaml`.
- `deploy_direct_remote`: extracts the built image into a binary/static/migrations bundle and runs it directly on a server without Docker for the app.
- `ssh_sftp_smoke_tests`: manual real SSH/SFTP smoke test.

Important CI variables:

- `ONLINE_SSH_IMAGE_REPOSITORY`: full image repository, for example `registry.example.com/team/online-ssh`.
- `ONLINE_SSH_REGISTRY`: registry login host when it cannot be inferred.
- `ONLINE_SSH_REGISTRY_USER` / `ONLINE_SSH_REGISTRY_PASSWORD`: registry credentials.
- `ONLINE_SSH_IMAGE_PUSH=0`: build image without pushing, useful for forks or early CI setup.
- `DEPLOY_SSH_TARGET`, `DEPLOY_SSH_PORT`, `DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_SSH_KNOWN_HOSTS`, `DEPLOY_DOCKER_DIR`: Docker deployment target.
- `DIRECT_DEPLOY_SSH_TARGET`, `DIRECT_DEPLOY_SSH_PORT`, `DIRECT_DEPLOY_SSH_PRIVATE_KEY`, `DIRECT_DEPLOY_SSH_KNOWN_HOSTS`, `DIRECT_DEPLOY_DIR`, `DIRECT_DEPLOY_HTTP_ADDR`: direct binary deployment target.
- `DATABASE_URL_TEST`: enables backend PostgreSQL integration tests.

Use masked/protected CI variables for private keys, database URLs, registry credentials, and production secrets. Do not commit `.env`, SSH keys, registry passwords, or deployment server-specific addresses.

## Optional Tests

Backend PostgreSQL integration tests:

```bash
cd backend-skeleton/server
ONLINE_SSH_RUN_DB_TESTS=1 go test ./internal/auth ./internal/admin ./internal/audit ./internal/auditexport ./internal/migration ./internal/connection ./internal/credential ./internal/files ./internal/host ./internal/hostgroup ./internal/transfer ./internal/savedcommand ./internal/terminal -count=1
```

The test DSN priority is `.env.local` `DATABASE_URL_TEST`, then `ONLINE_SSH_TEST_DATABASE_URL`, then `.env.local` `DATABASE_URL`.

Real SSH/SFTP smoke test:

```bash
cd backend-skeleton/server
go run ./cmd/smoke
```

Set `ONLINE_SSH_SMOKE_RUN_WRITE=1` only when the remote test account may create and delete files under the configured test directory. See `docs/smoke-tests.md`.

## Reverse Proxy

For production, terminate HTTPS at a reverse proxy and keep the app bound to a private address such as `127.0.0.1:8080`.

Example Nginx shape:

```nginx
server {
    listen 80;
    server_name ssh.example.com;

    client_max_body_size 512m;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Documentation

- `docs/README.md`: documentation index.
- `docs/api/openapi.yaml`: HTTP API description.
- `docs/architecture/system-overview.md`: system overview.
- `docs/architecture/storage-schema.md`: database schema.
- `docs/architecture/security-model.md`: security model.
- `docs/frontend-terminal-reconnect.md`: terminal reconnect and keepalive behavior.
- `docs/smoke-tests.md`: real SSH/SFTP smoke test.
