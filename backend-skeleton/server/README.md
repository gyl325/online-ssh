# Online SSH Server

这是在线 SSH 平台的 Go 后端实现，当前已不再是骨架工程，并与 `apps/web` 前端形成完整联调产品。

## 当前能力

- 用户注册、邮箱或用户名密码登录、邮箱验证码登录、TOTP 2FA / 恢复码、登出、session cookie 鉴权、HttpOnly refresh cookie 和 `GET /api/auth/me` 会话恢复；注册成功会立即写入会话 cookie
- 用户自助账号安全：修改密码、邮箱换绑、TOTP 2FA 管理和删除当前账号
- 单设备在线、注册邮箱白名单、真实登录 IP 提取、session 登录方式记录和关键登录/2FA/管理员事件审计
- 凭据加密存储，支持密码与私钥凭据
- 主机分组、主机 CRUD、真实 SSH 连接测试、host fingerprint 首次确认与冲突阻断
- 管理员设置：用户、角色、会话、数据库导入导出、通用运行配置和 SMTP 测试邮件
- 浏览器 terminal：HTTP bootstrap、WebSocket、SSH PTY、resize、keepalive、连接日志、历史记录、只读临时分享、关闭与进程内恢复
- 远程文件：目录列表、搜索任务、mkdir、touch、rename、delete、chmod、copy、checksum、archive、文本读取/保存
- 文件传输：上传初始化、分片上传、下载任务、任务列表/详情、pause/resume/cancel/retry、下载内容
- 审计日志列表、详情与后端异步 CSV 导出任务

## 目录说明

- `cmd/app`：HTTP 服务入口
- `cmd/migrate`：版本化数据库迁移入口，支持 `up` / `status`
- `internal/app`：应用装配、repository/service/handler 串联
- `internal/config`：环境配置
- `internal/db`：PostgreSQL 连接封装
- `internal/model`：跨模块共享领域模型与枚举
- `internal/httpapi`：真实 HTTP router、统一响应、请求日志
- `internal/auth`：认证、session、鉴权中间件
- `internal/admin`：管理员用户、角色、会话、数据库导入导出和通用设置
- `internal/settings`：运行时通用配置 store
- `internal/credential`：凭据加密、存储与业务逻辑
- `internal/host`：主机管理、SSH 探测与 fingerprint 判定
- `internal/hostgroup`：个人版主机分组管理
- `internal/terminal`：terminal session、runtime hub、WebSocket/SSH PTY、只读分享
- `internal/files`：远程文件操作与 SFTP 连接池
- `internal/transfer`：传输任务、上传/下载、状态控制与恢复
- `internal/audit`：审计日志查询与记录
- `internal/auditexport`：审计日志异步 CSV 导出任务
- `internal/testutil/pgtest`：PostgreSQL 集成测试辅助
- `migrations`：当前初始化 schema

## 本地运行

后端启动时会向上查找 `.env.local`。项目根目录通常需要配置：

```bash
DATABASE_URL=postgres://user:password@127.0.0.1:5432/online_ssh?sslmode=disable
CREDENTIAL_MASTER_KEY=replace-with-32-bytes-or-longer-secret
```

`CREDENTIAL_MASTER_KEY` keeps the legacy single-key mode. For staged credential master-key rotation, configure a versioned key ring instead:

```bash
CREDENTIAL_KEY_RING=1:old-secret,2:new-secret
CREDENTIAL_ACTIVE_KEY_VERSION=2
```

When a key ring is set, new or updated credential secrets are written with `CREDENTIAL_ACTIVE_KEY_VERSION`; existing records continue to decrypt by their stored `key_version` while the matching key remains configured.

可选配置：

```bash
APP_ENV=development
HTTP_ADDR=127.0.0.1:8080
SESSION_COOKIE_NAME=online_ssh_session
REFRESH_COOKIE_NAME=online_ssh_refresh
SESSION_COOKIE_SECURE=false
SESSION_TTL_HOURS=168
SESSION_TTL_MINUTES=30
SESSION_IDLE_TIMEOUT_MINUTES=120
REFRESH_TOKEN_TTL_HOURS=168
ALLOW_USER_REGISTRATION=true
TERMINAL_MAX_SESSIONS_PER_USER=16
TERMINAL_MAX_SESSIONS_TOTAL=16
TERMINAL_KEEP_ALIVE_HOURS=24
FILE_SFTP_IDLE_TTL_MINUTES=5
HOST_CONNECTIVITY_POLL_INTERVAL_SECONDS=30
AUTH_ALLOWED_EMAILS=admin@example.com,user@example.com
AUTH_ALLOWED_EMAIL_DOMAINS=example.org
AUTH_EMAIL_CODE_LENGTH=6
AUTH_EMAIL_CODE_TTL_MINUTES=5
AUTH_EMAIL_CODE_MAX_ATTEMPTS=5
AUTH_EMAIL_CODE_RESEND_COOLDOWN_SECONDS=60
AUTH_EMAIL_CODE_EMAIL_WINDOW_MINUTES=15
AUTH_EMAIL_CODE_EMAIL_WINDOW_MAX_SENDS=5
AUTH_EMAIL_CODE_IP_WINDOW_MINUTES=15
AUTH_EMAIL_CODE_IP_WINDOW_MAX_SENDS=10
AUTH_EMAIL_CODE_HASH_SECRET=replace-with-email-code-hmac-secret
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USERNAME=smtp-user
SMTP_PASSWORD=smtp-password
SMTP_FROM=noreply@example.com
SMTP_FROM_NAME=Online SSH
SMTP_USE_SSL=true
LLM_ENABLED=false
LLM_PROTOCOL=openai
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4.1-mini
LLM_AUTH_HEADER=bearer
LLM_API_KEY=replace-with-model-api-key
LLM_TIMEOUT_SECONDS=30
LLM_MAX_TOKENS=1024
```

邮箱验证码注册/登录和个人中心邮箱换绑会通过 SMTP 发送验证码。验证码只保存 HMAC hash，不明文入库；如果没有单独配置 `AUTH_EMAIL_CODE_HASH_SECRET`，服务装配会用现有凭据主密钥/密钥环作为服务端 hash secret 兜底。登录验证码发送前会先确认邮箱或用户名对应已注册且 active 的账号，未注册登录标识不会创建验证码或发送邮件。`AUTH_ALLOWED_EMAILS` 与 `AUTH_ALLOWED_EMAIL_DOMAINS` 为空时不限制新注册邮箱；配置后只限制新注册的验证码发送和最终注册，不影响已注册用户的密码登录、验证码登录或个人中心邮箱换绑。管理员通用设置中的运行时白名单也按同一作用域立即参与校验。

个人中心账号接口位于 `/api/account/*`：修改密码会验证当前密码并撤销当前会话以外的同账号 sessions/refresh tokens；邮箱换绑需要旧邮箱验证码与新邮箱验证码都通过；删除账号需要当前密码，并会拒绝删除最后一个拥有 `admin.access` 权限的账号。

管理员设置的“通用信息”会把部分运行配置持久化到 `system_settings`，并在运行时覆盖上面的环境默认值。当前可由管理员调整注册开关、会话/refresh TTL、终端容量与保活、SFTP 空闲 TTL、主机连接检测轮询、SMTP 主机/端口/发件人/用户名/密码、注册邮箱白名单、验证码规则和终端 AI 命令生成的大模型配置。SMTP 密码和大模型 API key 可通过管理员界面保存，但读取接口只返回是否已配置；空白密钥/密码表示保留已保存值，只有明确清除才会删除。`AUTH_EMAIL_CODE_HASH_SECRET` 仍只来自环境变量。终端 AI 命令助手支持 OpenAI-compatible 和 Anthropic-compatible 协议；`LLM_AUTH_HEADER` 可选 `bearer` 或 `api_key`。命令助手会要求模型只返回结构化 JSON；无关请求会返回非命令拒绝结果，明显高风险的命令或意图会由后端提升风险等级。用户可选择发送当前激活主机的系统信息作为提示上下文；如果模型返回了文本但无法解析，后端会把原始输出带回前端展示，不会自动写入终端或导入常用命令。

启动服务：

```bash
go run ./cmd/app
```

健康检查：

```bash
curl http://127.0.0.1:8080/healthz
```

查看凭据密钥版本分布：

```bash
go run ./cmd/credential key-status
```

初始化或更新数据库 schema：

```bash
go run ./cmd/migrate up
```

migration 命令会维护 `schema_migrations` 版本表，按文件名顺序只执行尚未应用的 `*.up.sql`。重复执行 `go run ./cmd/migrate up` 为 no-op；`go run ./cmd/migrate status` 可查看 applied / pending 状态。对于已经存在但还没有版本表的历史库，命令会根据关键表/字段 baseline 已存在的 000001-000004 迁移，再继续应用缺失迁移。

本地 source/shell 启动默认不会自动执行 migration。开发或非 Docker 部署升级后，先运行 `go run ./cmd/migrate up`，确认 `go run ./cmd/migrate status` 没有 pending migration，再启动或重启 `go run ./cmd/app`。只有显式设置 `AUTO_MIGRATE=true` 时，`cmd/app` 才会在启动阶段按 `MIGRATIONS_DIR` 指向的目录执行 pending migration。

Docker 部署可使用仓库根目录的 `compose.yaml`：

```bash
cp .env.example .env
docker compose up --build
```

Compose 会启动 app 与 PostgreSQL，并通过 `${POSTGRES_DATA_DIR:-./data/postgres}` 持久化数据库数据。Docker 镜像内置前端静态资源和 migration 文件，默认设置 `STATIC_DIR=/app/web`、`MIGRATIONS_DIR=/app/migrations`、`AUTO_MIGRATE=true`，因此 Docker 部署会在 serving HTTP 前应用 pending migration。仓库根目录的 `compose.yaml` 默认只绑定 `127.0.0.1:8080`，用于本地试用或反代后方部署；外部访问的生产部署应使用 `compose.production.yaml`，设置 `ONLINE_SSH_BIND_HOST=0.0.0.0` 或接入反代，并在 `.env` 中设置 `POSTGRES_PASSWORD`、`CREDENTIAL_MASTER_KEY` 和 `BOOTSTRAP_SETUP_TOKEN`。配置了 `BOOTSTRAP_SETUP_TOKEN` 后，空库首次 setup wizard 会要求该一次性令牌，防止 fresh deploy 被其他访问者抢先创建管理员。生产环境还应按 HTTPS 入口情况设置 `SESSION_COOKIE_SECURE`。如果数据库密码包含 `/`、`?`、`#`、`%`、`:` 等 URL 保留字符，请在 `.env` 中显式设置 URL 编码后的 `DATABASE_URL`，并保持它与 `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` 一致。Docker 构建默认使用 `.env.example` 中的 `GOPROXY`；网络环境不同可在 `.env` 中覆盖。CI 镜像仓库、基础镜像来源和 registry 凭据都通过变量配置，默认不绑定某个私有 registry。对外部署在首个管理员创建完成后，除非确实需要开放注册，否则应设置 `ALLOW_USER_REGISTRATION=false`。

## 测试

默认测试不依赖真实 PostgreSQL、SSH 或 SFTP：

```bash
go test ./...
```

数据库集成测试默认跳过，需要显式开启：

```bash
ONLINE_SSH_RUN_DB_TESTS=1 go test ./internal/auth ./internal/admin ./internal/audit ./internal/auditexport ./internal/migration ./internal/connection ./internal/credential ./internal/files ./internal/host ./internal/hostgroup ./internal/transfer ./internal/savedcommand ./internal/terminal -count=1
```

数据库集成测试连接串优先级：

1. `.env.local` 中的 `DATABASE_URL_TEST`
2. 环境变量 `ONLINE_SSH_TEST_DATABASE_URL`
3. `.env.local` 中的 `DATABASE_URL`

集成测试会创建临时 schema，执行 migration，结束后清理；测试辅助会先确保 `pgcrypto` 和 `citext` 扩展存在，避免并发包测试互相抢扩展创建。
`internal/migration` 集成测试会直接验证版本化迁移器的新库初始化、重复执行 no-op、历史库 baseline 和失败回滚记录。

真实 SSH/SFTP 冒烟测试不属于默认测试门禁，需要后端已启动并能访问测试 SSH 主机：

```bash
go run ./cmd/smoke
```

该命令会执行健康检查、登录、凭据/主机创建、真实 SSH `host test`、fingerprint 确认、SFTP list、terminal WebSocket IO 和清理流程。完整远程文件写入验证默认关闭，需要显式设置：

```bash
ONLINE_SSH_SMOKE_RUN_WRITE=1 go run ./cmd/smoke
```

环境变量和运行边界见仓库根目录 `docs/smoke-tests.md`。

## 接口事实源

- 实际暴露接口以 `internal/httpapi/router.go` 为第一事实源。
- `docs/api/openapi.yaml` 用于描述当前接口和少量 future 接口；future 接口必须显式标注。
- 当前没有已知 OpenAPI 已定义但 router 未暴露的接口。

## 下一步

当前不需要继续补“基础后端能力”。下一批后端工作优先级是：

1. 持续保持远程搜索 task API、审计导出任务 API、主机分组 API、OpenAPI 和前端面板行为一致。
2. 按用户新的产品反馈推进个人版体验、管理员设置或审计能力。
3. 持续保持 README、OpenAPI、router、migration 和部署文档的接口口径一致。
