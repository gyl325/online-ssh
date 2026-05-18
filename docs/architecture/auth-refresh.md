# Auth Refresh 安全设计

## 状态

当前实现已按本文落地。

`POST /api/auth/refresh` 已暴露，前端可通过 `GET /api/auth/me` + refresh 恢复登录态。WebSocket 仍不接收 refresh token；主终端 WebSocket 在 session cookie 之外还需要短生命周期 attach token。

## 当前实现基线

- 登录成功后，后端生成一个随机 session token。
- 数据库存储 `user_sessions.session_token_hash`，不保存明文 token。
- 浏览器收到 session 与 refresh 两个 HttpOnly cookie，默认名称分别为 `online_ssh_session` 和 `online_ssh_refresh`。
- 后续 HTTP 请求依赖这个 session cookie；主 terminal WebSocket 握手依赖 session cookie 和短生命周期 attach token，并在 token 校验通过后兼容 Host 重写反代导致的 Origin 不匹配。公开分享 WebSocket 依赖 viewer token，token 校验通过后采用同样的反代兼容策略。
- `user_sessions.refresh_token_hash`、`refresh_expires_at` 和 `refresh_rotated_at` 已由 auth refresh 实现使用。
- 当前实现启用单设备在线：同一用户新登录成功后，会撤销该用户旧的 active session 和 refresh token；旧设备的 HTTP 请求、refresh、WebSocket 重连都会失效。后端会关闭或 detach 与被撤销 auth session 绑定的 terminal runtime，让已打开的终端连接尽快断开，同时保留既有 keepalive 语义。
- 认证入口已扩展为密码登录、邮箱验证码登录和邮箱验证码注册；邮箱验证码本身只保存 hash，并受邮箱白名单、发送频率和尝试次数限制，但 refresh / session 仍按本文原有 cookie 策略工作。
- OpenAPI 中 `POST /api/auth/refresh` 已移除 `x-online-ssh-status: future`。

## 设计目标

1. 缩短日常请求使用的 session token 生命周期。
2. 使用独立 refresh token 延长登录态，但不让前端 JavaScript 读取 token。
3. refresh token 每次使用都轮换，旧 refresh token 立即失效。
4. logout 能撤销当前会话并清理 session / refresh 两个 cookie。
5. terminal WebSocket 不直接接收 refresh token；主终端 WebSocket 通过 session cookie + 短生命周期 attach token 建立连接。
6. 失败路径可审计，测试能覆盖 repository、service、handler 和前端会话恢复。

## 非目标

- 不在 localStorage、sessionStorage 或 JS 可读内存里保存 session / refresh token；短生命周期 terminal attach token 只随 bootstrap、可恢复会话列表或单会话查询返回，用于建立 `/ws/terminal`。
- 不引入 OAuth、OIDC、多租户 SSO 或第三方登录。
- 当前不实现多设备管理 UI。
- 不让 WebSocket 自己做 refresh；WebSocket 只在握手时验证当前 session cookie 和 terminal attach token。

## Cookie 策略

| Cookie | 默认名称 | Path | HttpOnly | SameSite | Secure | 用途 |
|---|---|---|---|---|---|---|
| session | `online_ssh_session` | `/` | yes | Lax | 跟随 `SESSION_COOKIE_SECURE` | 普通 HTTP API 与 WebSocket session 鉴权 |
| refresh | `online_ssh_refresh` | `/api/auth` | yes | Lax | 跟随 `SESSION_COOKIE_SECURE` | 刷新 session，并支持 logout 尽力撤销 |

设计理由：

- refresh cookie 使用独立名称和窄 Path，避免 files、transfer 等业务 API 请求携带长寿命 refresh token；Path 使用 `/api/auth` 是为了让 logout 在 session 已过期时仍可携带 refresh cookie 做尽力撤销。
- 两个 cookie 都必须是 HttpOnly，前端只观察 `/api/auth/me`、`/api/auth/refresh` 的响应结果。
- 生产环境必须配置 HTTPS，并把 `SESSION_COOKIE_SECURE=true`；后续可把配置名扩展为通用 `AUTH_COOKIE_SECURE`，但保持兼容现有变量。
- logout 响应必须同时清理两个 cookie，其中 refresh cookie 清理时要使用相同 Path `/api/auth`。

## TTL 策略

建议新增配置：

| 配置 | 默认值 | 说明 |
|---|---:|---|
| `SESSION_TTL_MINUTES` | `30` | session cookie 和 `session_token_hash` 的有效期 |
| `REFRESH_TOKEN_TTL_HOURS` | `168` | refresh token 的绝对有效期，默认 7 天 |
| `REFRESH_COOKIE_NAME` | `online_ssh_refresh` | refresh cookie 名称 |

兼容规则：

- 实施时保留现有 `SESSION_TTL_HOURS`，用于未开启 refresh 的旧模式。
- 开启 refresh 后使用 `SESSION_TTL_MINUTES` 控制短 session。
- refresh token 采用绝对过期时间，不因每次刷新无限延长。每次刷新只重新签发短 session token，并轮换 refresh token 到同一个绝对过期点。

## 数据库模型

现有 `user_sessions.refresh_token_hash` 可以保存当前有效 refresh token 的哈希，但还需要补充过期时间和唯一约束。

建议 migration：

```sql
ALTER TABLE user_sessions
  ADD COLUMN refresh_expires_at TIMESTAMPTZ NULL,
  ADD COLUMN refresh_rotated_at TIMESTAMPTZ NULL;

CREATE UNIQUE INDEX idx_user_sessions_refresh_token_hash
  ON user_sessions(refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL;

CREATE INDEX idx_user_sessions_refresh_expires_at
  ON user_sessions(refresh_expires_at)
  WHERE refresh_token_hash IS NOT NULL AND revoked_at IS NULL;
```

字段语义：

- `expires_at`：短 session token 过期时间。
- `refresh_expires_at`：refresh token 绝对过期时间。
- `refresh_rotated_at`：最近一次 refresh token 轮换时间，用于审计和排查。
- `last_seen_at`：最近一次有效 session 请求或 refresh 时间；refresh 时会用 `SESSION_IDLE_TIMEOUT_MINUTES` 做空闲超时判断。
- `revoked_at`：会话被 logout 或安全策略撤销后，session 和 refresh 都失效。

## Service 流程

### Login

1. 校验邮箱、密码、用户状态。
2. 生成 `session_token` 和 `refresh_token`。
3. 写入：
   - `session_token_hash = hash(session_token)`
   - `refresh_token_hash = hash(refresh_token)`
   - `expires_at = now + SESSION_TTL_MINUTES`
   - `refresh_expires_at = now + REFRESH_TOKEN_TTL_HOURS`
4. 撤销同一用户旧的 active sessions，保留本次新建 session；撤销旧 session 会同时让旧 refresh token 失效。
5. 通知 terminal runtime hub 关闭该用户当前托管的终端 runtime。
6. 返回前重新确认本次新建 session 仍有效，避免并发登录时把已被后续登录撤销的 token 写回浏览器。
7. 返回用户、session token、refresh token、两个过期时间。
8. handler 写入两个 HttpOnly cookie。
9. 记录 `auth_login` 审计。

### Refresh

1. handler 只从 refresh cookie 读取 refresh token。
2. service 对 refresh token 做空值校验和哈希。
3. repository 通过 `UPDATE ... RETURNING` 原子轮换 token：
   - `refresh_token_hash = hash(refresh_token)`
   - `revoked_at IS NULL`
   - `refresh_expires_at > now`
   - `last_seen_at >= now - SESSION_IDLE_TIMEOUT_MINUTES`
4. 若用户不存在、禁用、refresh 绝对过期、空闲超时或找不到 session，返回 `ErrUnauthorized`。
5. 生成新的 `session_token` 和新的 `refresh_token`。
6. 在同一事务内更新同一条 session：
   - 替换 `session_token_hash`
   - 替换 `refresh_token_hash`
   - `expires_at = now + SESSION_TTL_MINUTES`
   - 保持原 `refresh_expires_at` 不变
   - 更新 `last_seen_at` 和 `refresh_rotated_at`
7. 返回用户、新 session token、新 refresh token、session 过期时间、refresh 绝对过期时间。
8. handler 重写两个 cookie。
9. 记录 `auth_refresh` 审计。

旧 refresh token 如何失效：

- 轮换时 `refresh_token_hash` 被替换，因此旧 refresh token 哈希不再匹配任何有效会话。
- 使用旧 refresh token 调 refresh 会得到 401，并清理浏览器端两个 cookie。
- 如果后续需要“检测旧 token 重放并撤销整个 token family”，再新增 refresh token 历史表；当前个人使用场景先采用当前有效 token 唯一匹配策略。

### Logout

1. logout 应保持幂等：无论后端能否找到有效 session，都返回清理 cookie 的响应。
2. 如果 session cookie 有效，按当前 session ID 撤销 `user_sessions.revoked_at`。
3. 如果 session cookie 已过期但 refresh cookie 存在，允许通过 refresh token hash 找到会话并撤销。
4. handler 同时清理 session cookie 和 refresh cookie。
5. 记录 `auth_logout` 审计；如果只能清 cookie、找不到服务端会话，不记录成功审计。

## Handler 与路由

- `POST /api/auth/login` 写入两个 cookie。
- `POST /api/auth/refresh` 不要求当前 session cookie 有效，只要求 refresh cookie 有效。
- `POST /api/auth/logout` 建议从 `requireAuth` 中移出，改为 handler 内部尽力鉴权和撤销，然后总是清理 cookie。
- `GET /api/auth/me` 继续只依赖 session cookie，不自动使用 refresh cookie。
- 所有 auth mutation 应做同源校验：生产环境中 `Origin` 或 `Referer` 必须匹配服务端允许的前端 origin；当前无 CORS 中间件，默认不允许跨站读取响应，但仍应防 CSRF 写入。

## 前端行为

第一版建议：

1. 应用启动仍先调用 `GET /api/auth/me`。
2. 如果返回 401，再调用一次 `POST /api/auth/refresh`。
3. refresh 成功后重新调用 `GET /api/auth/me` 或直接使用 refresh 响应中的 user。
4. refresh 失败后进入未登录态。
5. 普通 API 请求遇到 401 时最多触发一次 refresh + retry，避免并发请求造成多次 refresh 轮换。
6. WebSocket 断开或新建 terminal session 失败为 401 时，走普通 auth 恢复流程后再让用户重新连接，不在 WebSocket 内部传 refresh token。

并发控制：

- 前端 HTTP client 需要维护一个全局 `refreshPromise`。
- 多个请求同时 401 时，只允许第一个请求发起 refresh，其余请求等待同一个 promise。
- refresh 成功后每个请求最多 retry 一次。

## 错误与审计

建议错误码：

| 场景 | HTTP | code |
|---|---:|---|
| refresh cookie 缺失或空 | 401 | `UNAUTHORIZED` |
| refresh token 无效、过期、已撤销 | 401 | `UNAUTHORIZED` |
| 用户已禁用 | 401 | `UNAUTHORIZED` |
| refresh 存储更新失败 | 500 | `REFRESH_FAILED` |

审计事件：

- `auth_login`：密码或邮箱验证码登录成功。
- `auth_login_failed`：登录失败；邮箱不存在时 `audit_logs.user_id` 允许为空，metadata 保留归一化邮箱和失败原因。
- `auth_email_code_send`：邮箱验证码发送成功。
- `auth_email_code_verify_failed`：邮箱验证码校验失败。
- `auth_refresh`：refresh 成功。
- `auth_refresh_failed`：可选，仅记录能关联到 user/session 的失败；不能识别用户的无效 token 不记录，避免日志被探测请求刷爆。
- `auth_logout`：撤销成功。

## 测试要求

后端 service 测试：

- login 同时生成 session token 和 refresh token。
- refresh 成功会轮换两个 token，并保持 refresh 绝对过期时间。
- refresh token 为空、过期、用户禁用、session revoked 时返回 unauthorized。
- 旧 refresh token 在轮换后不可再次使用。
- logout 能撤销 session，并清理 refresh 语义。

后端 repository / PostgreSQL 集成测试：

- refresh token hash 唯一约束生效。
- 通过 refresh hash 查询有效 session 时会过滤 revoked 和过期记录。
- 轮换更新在事务内完成，返回新 token hash 和用户数据。

后端 handler 测试：

- login 设置 session 与 refresh 两个 cookie，且 HttpOnly / SameSite / Path 正确。
- refresh 成功重写两个 cookie。
- refresh 失败返回 401 并清理两个 cookie。
- logout 清理两个 cookie。

前端测试：

- 启动时 `me` 返回 401，refresh 成功后恢复用户。
- 多个请求同时 401 只发起一次 refresh。
- refresh 失败后进入未登录态。
- WebSocket 或 terminal 页面不读取 refresh token。

## 实施顺序

1. 新增 migration 和 repository 方法：已完成。
2. 扩展 config，保持旧 `SESSION_TTL_HOURS` 兼容：已完成。
3. 扩展 service 的 login result，并新增 refresh service 方法：已完成。
4. 更新 handler cookie 写入 / 清理逻辑：已完成。
5. 调整 router，暴露 `POST /api/auth/refresh`：已完成。
6. 更新 OpenAPI，移除 `x-online-ssh-status: future`：已完成。
7. 更新前端 HTTP client 和 AuthContext：已完成。
8. 补齐后端纯测试、数据库集成测试、前端 auth 测试：已完成。
9. 更新 README、future backlog 和相关架构文档：已完成。

## 当前结论

Auth refresh 已完成第一版落地。后续如果需要更强的重放检测和 token family 撤销，可以新增 refresh token 历史表。
