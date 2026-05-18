# Online SSH 中文说明

Online SSH 是一个自托管的浏览器 SSH 管理平台，包含 Go 后端、Vite/React 前端、PostgreSQL 存储、浏览器终端、SFTP 文件管理、传输任务、审计日志和管理员设置。

## 主要功能

- 密码登录、邮箱验证码登录、TOTP 2FA、恢复码、Session Cookie 和 HttpOnly Refresh Cookie。
- 空数据库首次启动时，通过 setup wizard 创建第一个管理员。
- 加密保存 SSH 密码和私钥凭据。
- 主机分组、主机 CRUD、SSH 连通性测试、Host fingerprint 确认和连接状态检测。
- 浏览器终端，支持 WebSocket、PTY resize、刷新重连、后台保活、历史记录、常用命令、关键词高亮和临时只读分享。
- SFTP 远程文件浏览、本地过滤、显式远程搜索、上传下载任务、压缩解压、校验和、预览和轻量文本编辑。
- 审计日志、异步 CSV 导出、管理员用户/会话/角色管理、数据库导入导出、SMTP 设置和终端 AI 命令助手配置。

## 目录结构

```text
.
├── apps/web                  # Vite + React 前端
├── backend-skeleton/server   # Go 后端
├── docs                      # 产品、架构、API 和运行文档
├── Dockerfile
├── compose.yaml              # 本地/试用 compose
└── compose.production.yaml   # 生产镜像 compose
```

## Docker 快速启动

本地试用：

```bash
cp .env.example .env
docker compose up -d
```

启动后打开 `http://localhost:8080`，根据 setup wizard 创建第一个管理员账号。

默认 `compose.yaml` 会本地构建应用、启动 PostgreSQL、把数据保存到 `./data/postgres`，并由 Go 服务托管 React 静态文件。默认启用 `AUTO_MIGRATE=true`，Web 端口绑定到 `127.0.0.1:8080`。

生产公开部署建议使用 `compose.production.yaml` 和不可变镜像：

```bash
ONLINE_SSH_IMAGE=registry.example.com/online-ssh:2026-05-18 \
docker compose -f compose.production.yaml up -d
```

生产 `.env` 至少设置 `POSTGRES_PASSWORD`、`CREDENTIAL_MASTER_KEY` 和 `BOOTSTRAP_SETUP_TOKEN`。如果通过 HTTPS 访问，保持 `SESSION_COOKIE_SECURE=true`。`BOOTSTRAP_SETUP_TOKEN` 用于保护空库首次初始化，避免第一个管理员被非预期访问者创建。

数据库备份示例：

```bash
docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > online_ssh_backup.sql
```

恢复时先停止 app，把备份恢复到 PostgreSQL，再启动 app。如果 schema 已升级，只能回滚到兼容该 schema 的版本，或先恢复升级前备份。

## 本地开发

后端：

```bash
cd backend-skeleton/server
go run ./cmd/app
```

前端：

```bash
cd apps/web
npm install
npm run dev
```

默认地址：

- 后端：`http://127.0.0.1:8080`
- 前端开发服务器：`http://127.0.0.1:5173`
- 前端 dev proxy：`/api` 和 `/ws` 代理到后端

## 后端配置

后端会向上查找 `.env.local`。非 Docker 部署时，可以把 `.env.local` 放在后端二进制旁边，或从能找到该文件的目录启动服务。

必填：

```bash
DATABASE_URL=postgres://user:password@127.0.0.1:5432/online_ssh?sslmode=disable
CREDENTIAL_MASTER_KEY=replace-with-32-bytes-or-longer-secret
```

常用可选项：

```bash
APP_ENV=production
HTTP_ADDR=127.0.0.1:8080
SESSION_COOKIE_SECURE=true
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

`FILE_SFTP_IDLE_TTL_MINUTES` 控制文件页 SFTP 空闲连接复用时间。`HOST_CONNECTIVITY_POLL_INTERVAL_SECONDS` 控制主机状态检测轮询间隔。`LLM_*` 是终端 AI 命令助手的环境默认值，管理员设置可在运行时覆盖；API key 在界面中按写入式处理，不会从读取接口回显。

## 数据库迁移

源码或二进制部署时，启动或重启 app 前先执行迁移：

```bash
cd backend-skeleton/server
go run ./cmd/migrate up
```

查看迁移状态：

```bash
go run ./cmd/migrate status
```

Docker 镜像默认 `AUTO_MIGRATE=true`、`MIGRATIONS_DIR=/app/migrations`，会在提供 HTTP 服务前自动应用 pending migration。

## CI 与部署

仓库包含 `.gitlab-ci.yml` 作为通用 GitLab CI 模板，阶段包括 `test`、`build`、`deploy` 和 `smoke`。

常用 CI 变量：

- `ONLINE_SSH_IMAGE_REPOSITORY`：完整镜像仓库，例如 `registry.example.com/team/online-ssh`。
- `ONLINE_SSH_REGISTRY`：无法自动推断时使用的 registry 登录主机。
- `ONLINE_SSH_REGISTRY_USER` / `ONLINE_SSH_REGISTRY_PASSWORD`：registry 凭据。
- `ONLINE_SSH_IMAGE_PUSH=0`：只构建镜像，不推送，适合 fork 或早期 CI 配置。
- `DEPLOY_SSH_TARGET`、`DEPLOY_SSH_PORT`、`DEPLOY_SSH_PRIVATE_KEY`、`DEPLOY_SSH_KNOWN_HOSTS`、`DEPLOY_DOCKER_DIR`：Docker Compose 部署目标。
- `DIRECT_DEPLOY_SSH_TARGET`、`DIRECT_DEPLOY_SSH_PORT`、`DIRECT_DEPLOY_SSH_PRIVATE_KEY`、`DIRECT_DEPLOY_SSH_KNOWN_HOSTS`、`DIRECT_DEPLOY_DIR`、`DIRECT_DEPLOY_HTTP_ADDR`：直接二进制部署目标。
- `DATABASE_URL_TEST`：启用后端 PostgreSQL 集成测试。

私钥、数据库 URL、registry 密码和生产 secret 应使用 CI 的 masked/protected variables，不要提交到仓库。

## 可选测试

后端 PostgreSQL 集成测试：

```bash
cd backend-skeleton/server
ONLINE_SSH_RUN_DB_TESTS=1 go test ./internal/auth ./internal/admin ./internal/audit ./internal/auditexport ./internal/migration ./internal/connection ./internal/credential ./internal/files ./internal/host ./internal/hostgroup ./internal/transfer ./internal/savedcommand ./internal/terminal -count=1
```

真实 SSH/SFTP 冒烟测试：

```bash
cd backend-skeleton/server
go run ./cmd/smoke
```

只有测试账号允许在目标目录创建和删除文件时，才设置 `ONLINE_SSH_SMOKE_RUN_WRITE=1`。更多变量见 `docs/smoke-tests.md`。

## 反向代理

生产建议在反向代理层终止 HTTPS，并让 app 绑定到 `127.0.0.1:8080` 等私有地址。

Nginx 示例：

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

## 文档入口

- `docs/README.md`：文档索引。
- `docs/api/openapi.yaml`：HTTP API 描述。
- `docs/architecture/system-overview.md`：系统概览。
- `docs/architecture/storage-schema.md`：数据库 schema。
- `docs/architecture/security-model.md`：安全模型。
- `docs/frontend-terminal-reconnect.md`：终端刷新重连和后台保活行为。
- `docs/smoke-tests.md`：真实 SSH/SFTP 冒烟测试。
