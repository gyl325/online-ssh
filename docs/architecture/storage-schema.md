# docs/architecture/storage-schema.md

## 1. 文档目标

本文档定义在线 SSH 平台第一版（MVP）的数据库存储模型，包括：

- 核心业务表
- 关键字段约束
- 索引设计
- 状态枚举建议
- 表间关系
- 数据保留与清理建议
- 后续扩展预留位

本文档面向后端开发、数据库迁移编写、审计查询实现，以及 AI 辅助代码生成。

---

## 2. 设计原则

第一版数据库设计遵循以下原则：

1. **先个人版，后团队版**
   - 当前所有核心资源默认归属单个 `user_id`
   - 当前已支持平台级用户角色与权限；未来团队空间仍作为独立扩展

2. **安全优先**
   - 凭据使用加密字段，不明文落库
   - 审计日志结构化保存，便于追踪

3. **传输任务必须可恢复**
   - 任务状态与偏移持久化
   - 服务重启后可恢复未完成任务

4. **终端会话与文件操作可追踪**
   - 登录、主机连接、文件操作、传输操作均需要审计表支持

5. **避免过度设计**
   - 第一版只实现平台级角色、权限和管理员用户管理
   - 团队、审批和组织内资源授权仍作为后续扩展，不与当前个人资源表强绑定

---

## 3. 命名规范

- 数据库：**PostgreSQL**
- 主键：统一使用 `BIGSERIAL` 或 `UUID`
- 推荐第一版统一使用 **UUID** 作为主键，便于后期服务拆分与日志聚合
- 时间字段统一使用：
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- 删除策略：
  - 核心业务表优先 **软删除** 或禁用标记
  - 高体量流水表（如审计日志）优先 **仅追加，不更新，不软删**

> 下文示例均以 `UUID` 为主键说明。

---

## 4. 推荐扩展与枚举

推荐启用：

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
```

版本化迁移由 `cmd/migrate` 维护 `schema_migrations`：

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`version` 使用迁移文件名去掉 `.up.sql` 后的值，例如 `000004_audit_export_tasks`。命令会按文件名排序，只执行未记录的迁移，并在执行成功后记录 checksum；已记录 checksum 与当前文件不一致时会停止。

### 4.1 推荐枚举（可用 PostgreSQL ENUM 或应用层字符串常量）

#### user_status
- `active`
- `disabled`

#### user_role
- 内置角色：
  - `admin`
  - `user`
- 也可以是管理员在 `roles` 表中创建的自定义角色 key。

#### auth_type
- `password`
- `private_key`

#### host_status
- `active`
- `archived`

#### fingerprint_status
- `trusted`
- `changed`
- `revoked`

#### terminal_session_status
- `connecting`
- `connected`
- `disconnected`
- `failed`

#### transfer_task_type
- `upload`
- `download`

#### transfer_task_status
- `pending`
- `uploading_to_platform`
- `queued_for_remote_transfer`
- `transferring`
- `paused`
- `failed`
- `completed`
- `canceled`

#### audit_result
- `success`
- `failure`

#### audit_level
- `basic`
- `command`
- `full_io`

---

## 5. 核心 ER 关系概览

```text
users
 ├── roles (users.role -> roles.key)
 ├── user_sessions
 ├── user_mfa_settings
 │    ├── user_mfa_recovery_codes
 │    └── user_mfa_tokens
 ├── hosts
 │    ├── host_fingerprints
 │    ├── terminal_sessions
 │    │    ├── terminal_recordings
 │    │    └── terminal_shares
 │    │         ├── terminal_share_access_logs
 │    │         └── terminal_share_viewer_tokens
 │    ├── transfer_tasks (source_host_id / target_host_id)
 │    └── audit_logs
 ├── credentials
 ├── terminal_recording_settings
 ├── terminal_recordings
 ├── saved_commands
 ├── workspace_layouts
 ├── transfer_tasks
 └── audit_logs
```

---

## 6. 表设计

## 6.1 users

存储平台用户。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 用户主键 |
| email | citext | unique not null | 登录邮箱 |
| password_hash | text | not null | 平台登录密码哈希 |
| display_name | varchar(100) | unique not null | 用户名 / 显示名称，登录时可作为邮箱之外的账号标识 |
| preferred_locale | varchar(10) | not null default 'zh-CN' | 语言偏好 |
| theme | varchar(20) | not null default 'system' | 主题偏好 |
| status | varchar(20) | not null default 'active' | 用户状态 |
| role | varchar(50) | fk -> roles(key), not null default 'user' | 平台角色 key，内置值为 `admin` / `user`，也允许自定义角色 |
| last_login_at | timestamptz | null | 最近登录时间 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 索引

```sql
CREATE UNIQUE INDEX uq_users_email ON users(email);
CREATE UNIQUE INDEX uq_users_display_name_lower ON users(lower(display_name));
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_role ON users(role);
```

### 说明

- 从无角色字段升级时，迁移会先把既有用户默认设置为 `admin`，避免升级后无人可以进入管理员设置。
- 迁移完成后，新注册用户默认 `role = 'user'`。
- 登录时会检查 `status`，禁用用户不能登录；禁用用户时管理员接口会撤销该用户已有 sessions，使 session token 和 refresh token 在下一次请求或刷新时失效。

---

## 6.2 roles

存储平台级角色。角色 key 直接写入 `users.role`，用于登录后展开权限列表。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| key | varchar(50) | pk | 角色 key，例如 `admin` / `user` / `auditor` |
| name | varchar(120) | not null | 角色显示名称 |
| description | text | not null default '' | 角色说明 |
| is_system | boolean | not null default false | 是否系统内置角色；系统角色不能删除，也不能禁用 |
| is_active | boolean | not null default true | 是否可继续分配给用户 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 说明

- 内置 `admin` 角色拥有全部平台权限，内置 `user` 角色拥有普通用户权限。
- 自定义角色可以由管理员创建、编辑和删除；仍有用户引用的角色不能删除。
- 如果某次角色修改会移除最后一个 `admin.access` 权限持有者，服务端必须拒绝。

---

## 6.3 role_permissions

存储角色到权限 key 的多对多映射。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| role_key | varchar(50) | pk, fk -> roles(key) on delete cascade | 角色 key |
| permission | varchar(100) | pk | 权限 key |
| created_at | timestamptz | not null | 创建时间 |

### 当前权限 key

| 权限 | 说明 |
|---|---|
| admin.access | 打开并使用管理员设置 |
| admin.users.manage | 启用、禁用、删除用户和修改用户角色 |
| admin.sessions.manage | 查看并撤销用户会话 |
| admin.roles.manage | 创建、编辑和删除角色 |
| admin.database.manage | 导出或导入管理数据库数据 |
| hosts.manage | 管理主机 |
| credentials.manage | 管理凭据 |
| terminal.connect | 打开 SSH 终端 |
| files.manage | 浏览和操作远程文件 |
| transfers.manage | 创建和管理文件传输任务 |
| audit.read | 查看审计日志 |

### 索引

```sql
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission);
```

---

## 6.4 user_sessions

存储用户会话与登录设备信息。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 会话主键 |
| user_id | uuid | fk -> users(id) | 用户 |
| session_token_hash | text | not null | 会话 token 哈希，不保存明文 |
| refresh_token_hash | text | null | 刷新 token 哈希 |
| refresh_expires_at | timestamptz | null | refresh token 绝对过期时间 |
| refresh_rotated_at | timestamptz | null | 最近一次 refresh token 轮换时间 |
| client_ip | inet | null | 登录来源 IP |
| user_agent | text | null | 完整 UA |
| device_label | varchar(255) | null | 解析后设备描述 |
| login_method | varchar(20) | not null default 'password' | 当前会话创建时使用的登录方式：`password` / `email_code` |
| last_seen_at | timestamptz | not null | 最近活跃时间，用于 `SESSION_IDLE_TIMEOUT_MINUTES` 空闲超时判断 |
| expires_at | timestamptz | not null | 过期时间 |
| revoked_at | timestamptz | null | 注销时间 |
| created_at | timestamptz | not null | 创建时间 |

### 索引

```sql
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX idx_user_sessions_last_seen_at ON user_sessions(last_seen_at);
CREATE UNIQUE INDEX idx_user_sessions_refresh_token_hash ON user_sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;
CREATE INDEX idx_user_sessions_refresh_expires_at ON user_sessions(refresh_expires_at) WHERE refresh_expires_at IS NOT NULL;
```

### 说明

- `session_token_hash` 必须存哈希值，避免数据库泄漏时直接复用会话。
- `client_ip` 记录会优先使用可信反代传入的 `CF-Connecting-IP`、`X-Forwarded-For` 和 `X-Real-IP`，管理员列表展示时使用 PostgreSQL `host(client_ip)` 避免 `127.0.0.1/32` 这类 CIDR 后缀。
- `device_label` 可由后端根据 UA 解析，例如：`Edge on macOS`.
- `login_method` 用于区分密码登录与邮箱验证码登录，管理员用户 / 会话列表和个人中心当前会话展示都读取该字段。
- 用户禁用、管理员踢出会话、登出和 refresh token 撤销都通过设置 `revoked_at` 生效。
- 当前单设备在线策略通过登录时撤销同一用户其他 active sessions 落地；新登录会保留本次 session，并让旧设备的 session token 与 refresh token 同时失效。

---

## 6.5 user_mfa_settings / user_mfa_recovery_codes / user_mfa_tokens

存储 TOTP 2FA 设置、一次性恢复码哈希和登录 pending MFA token。pending MFA 不写入 `user_sessions`，避免被正式会话鉴权误用。

### user_mfa_settings 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| user_id | uuid | pk, fk -> users(id) | 用户 |
| totp_enabled | boolean | not null default false | 是否已启用 TOTP |
| totp_secret_encrypted | text | null | 加密后的 TOTP secret，不保存明文 |
| totp_secret_key_version | int | not null default 1 | 加密密钥版本，复用 credential key ring |
| totp_confirmed_at | timestamptz | null | 绑定确认时间 |
| pending_totp_secret_encrypted | text | null | setup 后、confirm 前的临时加密 secret |
| pending_totp_secret_key_version | int | not null default 1 | 临时 secret 加密密钥版本 |
| pending_totp_expires_at | timestamptz | null | 临时 secret 过期时间 |
| last_used_at | timestamptz | null | 最近一次 MFA 验证成功时间 |
| created_at / updated_at | timestamptz | not null | 创建与更新时间 |

### user_mfa_recovery_codes 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 恢复码记录 |
| user_id | uuid | fk -> users(id) | 用户 |
| code_hash | text | not null | 恢复码哈希，不保存明文 |
| used_at | timestamptz | null | 使用时间；使用后立即失效 |
| created_at | timestamptz | not null | 创建时间 |

### user_mfa_tokens 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | pending MFA token 记录 |
| user_id | uuid | fk -> users(id) | 用户 |
| token_hash | text | unique not null | mfa_token 哈希，不保存明文 |
| login_method | varchar(20) | not null | 密码或邮箱验证码已通过的登录方式 |
| client_ip | inet | null | 登录来源 IP |
| user_agent | text | null | 登录 UA |
| attempts / max_attempts | int | not null | MFA 尝试次数和上限 |
| expires_at | timestamptz | not null | 默认 5 分钟有效 |
| consumed_at | timestamptz | null | 成功使用时间 |
| created_at | timestamptz | not null | 创建时间 |

### 说明

- TOTP secret 使用服务端主密钥加密存储，并记录 key version；当前实现复用凭据加密的 key ring。
- 恢复码只在启用或重新生成后返回一次，数据库仅保存哈希；成功使用后设置 `used_at`。
- MFA 登录成功后才创建正式 `user_sessions` 记录和 session / refresh cookie。
- 关键事件写入 `audit_logs`，包括 `mfa_setup_started`、`mfa_enabled`、`mfa_login_verified`、`mfa_login_failed`、`mfa_recovery_code_used`、`mfa_recovery_codes_regenerated`、`mfa_disabled`、`admin_mfa_reset`。

---

## 6.6 email_verification_codes

存储邮箱验证码发送与校验状态。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 验证码记录主键 |
| email | citext | not null | 目标邮箱 |
| purpose | text | not null | 用途，`register`、`login`、`email_change_current` 或 `email_change_new` |
| code_hash | text | not null | 验证码 HMAC hash，不保存明文 |
| client_ip | inet | null | 发送验证码时的客户端 IP |
| attempts | int | not null default 0 | 校验尝试次数 |
| max_attempts | int | not null default 5 | 本条记录最多允许的尝试次数 |
| expires_at | timestamptz | not null | 过期时间 |
| consumed_at | timestamptz | null | 成功验证时间，成功后作废 |
| created_at | timestamptz | not null | 创建时间 |

### 索引

```sql
CREATE INDEX idx_email_verification_codes_email_purpose_created_at ON email_verification_codes(email, purpose, created_at DESC);
CREATE INDEX idx_email_verification_codes_client_ip_created_at ON email_verification_codes(client_ip, created_at DESC) WHERE client_ip IS NOT NULL;
```

### 说明

- 验证码只保存 hash，不保存明文 code。
- 发送频率和校验尝试次数由后端配置控制；同一邮箱和同一 IP 的限流都可以通过这张表统计。
- `purpose` 用于区分注册、登录、邮箱换绑旧邮箱验证和邮箱换绑新邮箱验证，避免同一邮箱的不同场景混用。

---

## 6.7 host_groups

个人版也建议保留轻量分组能力。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 分组主键 |
| user_id | uuid | fk -> users(id) | 所属用户 |
| name | varchar(100) | not null | 分组名 |
| sort_order | int | not null default 0 | 排序 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 索引

```sql
CREATE INDEX idx_host_groups_user_id ON host_groups(user_id);
CREATE UNIQUE INDEX uq_host_groups_user_name ON host_groups(user_id, name);
```

---

## 6.8 credentials

存储 SSH 凭据。**禁止明文保存密码或私钥**。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 凭据主键 |
| user_id | uuid | fk -> users(id) | 所属用户 |
| name | varchar(120) | not null | 凭据名称 |
| auth_type | varchar(20) | not null | `password` / `private_key` |
| encrypted_secret | text | null | 加密后的密码或统一密文载荷 |
| encrypted_private_key | text | null | 加密后的私钥内容 |
| encrypted_passphrase | text | null | 加密后的私钥口令 |
| key_version | int | not null default 1 | 主密钥版本 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 约束建议

- `auth_type = 'password'` 时，`encrypted_secret` 必填
- `auth_type = 'private_key'` 时，`encrypted_private_key` 必填
- `encrypted_passphrase` 可选

### 索引

```sql
CREATE INDEX idx_credentials_user_id ON credentials(user_id);
CREATE INDEX idx_credentials_user_auth_type ON credentials(user_id, auth_type);
```

### 说明

- 推荐后端将加密后的密文结构封装为 JSON（再整体加密或直接保存文本），以便未来扩展算法/metadata。
- 第一版用户直接填写私钥内容时，保存到 `encrypted_private_key`。
- 管理员数据库 JSON 导出不会输出明文密码、私钥或 passphrase，只保留 `encrypted_secret`、`encrypted_private_key`、`encrypted_passphrase`、`key_version` 和用于去重的 `content_hash`。

---

## 6.9 hosts

存储远程主机配置。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主机主键 |
| user_id | uuid | fk -> users(id) | 所属用户 |
| group_id | uuid | fk -> host_groups(id) null | 所属分组 |
| credential_id | uuid | fk -> credentials(id) null | 默认凭据 |
| name | varchar(120) | not null | 主机名称 |
| host | varchar(255) | not null | IP / 域名 |
| port | int | not null default 22 | SSH 端口 |
| username | varchar(120) | not null | 远程用户名 |
| auth_type | varchar(20) | not null | 默认认证方式 |
| remark | text | null | 备注 |
| is_favorite | boolean | not null default false | 是否收藏 |
| status | varchar(20) | not null default 'active' | 主机状态 |
| last_connected_at | timestamptz | null | 最近连接时间 |
| archived_at | timestamptz | null | 归档时间 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 约束建议

- `credential_id` 可为空，允许用户连接时临时输入密码或私钥
- `user_id` 必须与 `credential_id` 的所属用户一致（在应用层校验）

### 索引

```sql
CREATE INDEX idx_hosts_user_id ON hosts(user_id);
CREATE INDEX idx_hosts_group_id ON hosts(group_id);
CREATE INDEX idx_hosts_user_favorite ON hosts(user_id, is_favorite);
CREATE INDEX idx_hosts_user_status ON hosts(user_id, status);
CREATE INDEX idx_hosts_user_last_connected_at ON hosts(user_id, last_connected_at DESC);
CREATE UNIQUE INDEX uq_hosts_user_host_port_username ON hosts(user_id, host, port, username);
```

---

## 6.10 host_fingerprints

存储主机指纹，用于 SSH host key 校验。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| host_id | uuid | fk -> hosts(id) | 所属主机 |
| algorithm | varchar(50) | not null | 如 `ssh-ed25519` |
| fingerprint | varchar(255) | not null | 指纹 |
| status | varchar(20) | not null default 'trusted' | 指纹状态 |
| first_seen_at | timestamptz | not null | 首次记录时间 |
| last_verified_at | timestamptz | null | 最近验证时间 |
| changed_at | timestamptz | null | 指纹变化时间 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 索引

```sql
CREATE INDEX idx_host_fingerprints_host_id ON host_fingerprints(host_id);
CREATE UNIQUE INDEX uq_host_fingerprints_host_algorithm ON host_fingerprints(host_id, algorithm);
```

### 说明

- 第一版可以约束每个主机每种算法仅保留一条当前可信记录。
- 若需要历史追踪，可另加 `host_fingerprint_history` 表，第一版不是必须。

---

## 6.11 terminal_sessions

存储终端连接会话元信息。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 终端会话主键 |
| user_id | uuid | fk -> users(id) | 所属用户 |
| host_id | uuid | fk -> hosts(id) | 连接主机 |
| status | varchar(30) | not null | 连接状态 |
| started_at | timestamptz | not null | 开始时间 |
| ended_at | timestamptz | null | 结束时间 |
| client_ip | inet | null | 客户端 IP |
| user_agent | text | null | 客户端 UA |
| workspace_id | uuid | null | 预留，关联布局/工作区 |
| metadata_json | jsonb | null | 预留，窗口尺寸等 |
| created_at | timestamptz | not null | 创建时间 |

### 索引

```sql
CREATE INDEX idx_terminal_sessions_user_id ON terminal_sessions(user_id);
CREATE INDEX idx_terminal_sessions_host_id ON terminal_sessions(host_id);
CREATE INDEX idx_terminal_sessions_started_at ON terminal_sessions(started_at DESC);
CREATE INDEX idx_terminal_sessions_status ON terminal_sessions(status);
```

### 说明

- `terminal_sessions` 仍只保存会话元信息和 runtime 恢复所需状态。
- 输入/输出历史不写入本表，也不写入 `audit_logs.metadata_json`；个人版终端历史使用独立的 `terminal_recordings` 与 `terminal_recording_chunks`。

### 6.9.1 terminal_recording_settings / terminal_recordings / terminal_recording_chunks

存储个人用户可选开启的终端输入输出历史。默认关闭，开启后只影响新建终端会话。

#### terminal_recording_settings

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| user_id | uuid | pk, fk -> users(id) | 用户 |
| enabled | boolean | not null default false | 是否保存新终端会话的输入输出 |
| retention_days | int | not null default 7, 1-30 | 保留天数 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

#### terminal_recordings

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 记录主键 |
| user_id | uuid | fk -> users(id) | 用户 |
| terminal_session_id | uuid | fk -> terminal_sessions(id) null | 关联终端会话 |
| host_id | uuid | fk -> hosts(id) null | 关联主机 |
| status | varchar(20) | active/completed/failed | 记录状态 |
| started_at | timestamptz | not null | 开始记录时间 |
| ended_at | timestamptz | null | 结束记录时间 |
| expires_at | timestamptz | not null | 过期时间 |
| is_bookmarked | boolean | not null default false | 是否标记为长期保留书签；书签记录列表/详情不受过期时间过滤 |
| input_bytes | bigint | not null default 0 | 已保存输入字节数 |
| output_bytes | bigint | not null default 0 | 已保存输出字节数 |
| dropped_bytes | bigint | not null default 0 | 队列满或写入失败时丢弃的字节数 |
| key_version | int | not null default 0 | 第一批 chunk 使用的平台密钥版本 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

#### terminal_recording_chunks

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | chunk 主键 |
| recording_id | uuid | fk -> terminal_recordings(id) | 所属记录 |
| sequence | int | not null | 记录内递增序号 |
| direction | varchar(10) | input/output | 输入或输出 |
| occurred_at | timestamptz | not null | 采集时间 |
| data_enc | text | not null | 加密后的输入/输出片段 |
| byte_count | bigint | not null | 明文字节数 |
| key_version | int | not null | 本 chunk 使用的平台密钥版本 |
| created_at | timestamptz | not null | 创建时间 |

### 说明

- collector 必须非阻塞；队列满时增加 `dropped_bytes`，不能阻塞 WebSocket 或 SSH stdin/stdout。
- API 解密后只返回当前用户自己的 recording chunks。

### 6.11.2 terminal_shares / terminal_share_access_logs / terminal_share_viewer_tokens

存储单个终端会话的临时只读分享。分享不作用于 split workspace；同一用户可以同时分享多个 terminal session。

#### terminal_shares

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 分享主键 |
| user_id | uuid | fk -> users(id) on delete cascade | 分享创建者 |
| terminal_session_id | uuid | fk -> terminal_sessions(id) on delete cascade | 被分享的单个终端会话 |
| host_id | uuid | fk -> hosts(id) on delete cascade | 冗余记录主机，便于查询和审计 |
| token_hash | text | unique not null | 分享 token 的 SHA-256 hash，用于公开访问校验 |
| public_token | text | unique not null | 高强度公开分享 token，用于管理端刷新或重新打开弹窗时持续展示分享链接 |
| password_hash | text | null | 可选访问密码的 bcrypt hash |
| expires_at | timestamptz | not null | 分享过期时间 |
| revoked_at | timestamptz | null | 主动撤销时间 |
| max_accesses | int | null | 可选访问次数上限，范围 1-1000 |
| access_count | int | not null default 0 | 成功换取 viewer token 的次数 |
| sensitive_prompt | text | not null default '' | 观看页展示的说明信息，最多 500 字符 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

推荐索引：

```sql
CREATE UNIQUE INDEX uq_terminal_shares_token_hash ON terminal_shares(token_hash);
CREATE UNIQUE INDEX uq_terminal_shares_public_token ON terminal_shares(public_token);
CREATE INDEX idx_terminal_shares_user_session_active ON terminal_shares(user_id, terminal_session_id, expires_at) WHERE revoked_at IS NULL;
CREATE INDEX idx_terminal_shares_expires_at ON terminal_shares(expires_at);
```

#### terminal_share_access_logs

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 访问日志主键 |
| share_id | uuid | fk -> terminal_shares(id) on delete cascade | 分享 |
| terminal_session_id | uuid | fk -> terminal_sessions(id) on delete cascade | 终端会话 |
| client_ip | inet | null | 访问者 IP |
| user_agent | text | null | 访问者 UA |
| result | varchar(20) | success/failure | 访问结果 |
| failure_reason | varchar(80) | null | `invalid_password` / `access_limit` / `unavailable` 等 |
| accessed_at | timestamptz | not null default now() | 访问时间 |

#### terminal_share_viewer_tokens

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | viewer token 主键 |
| share_id | uuid | fk -> terminal_shares(id) on delete cascade | 分享 |
| token_hash | text | unique not null | 短期 viewer token 的 SHA-256 hash |
| expires_at | timestamptz | not null | viewer token 过期时间，不能超过分享本身过期时间 |
| created_at | timestamptz | not null | 创建时间 |

### 说明

- 主终端 WebSocket 仍可读写；分享观看者使用独立 `/ws/terminal/share` 只读路径，不占用主 terminal attachment。
- 后端只从 terminal runtime 的输出广播路径推送 stdout/stderr 给 viewer；viewer 输入、resize 或二进制消息不会写入 SSH stdin。
- 创建、续期、撤销写 `audit_logs` 事件；公开访问成功/失败写 `terminal_share_access_logs`。
- viewer token 当前为短期授权凭据，不作为正式登录 session，也不进入通用鉴权中间件。

---

## 6.12 saved_commands

存储用户常用命令。当前第一版实现为用户级收藏，不绑定具体主机；前端只提供复制入口，不自动写入或执行命令。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| user_id | uuid | fk -> users(id) | 所属用户 |
| name | varchar(120) | not null | 名称 |
| command_text | text | not null | 命令内容 |
| category | varchar(80) | null | 用户自定义分类 |
| description | text | null | 说明 |
| sort_order | int | not null default 0 | 排序 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 索引

```sql
CREATE INDEX idx_saved_commands_user_id ON saved_commands(user_id);
```

---

## 6.13 workspace_layouts

存储用户工作区布局（标签、分屏、面板树）。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| user_id | uuid | fk -> users(id) | 所属用户 |
| name | varchar(120) | not null | 布局名称 |
| layout_json | jsonb | not null | 布局定义 |
| is_default | boolean | not null default false | 默认布局 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 索引

```sql
CREATE INDEX idx_workspace_layouts_user_id ON workspace_layouts(user_id);
CREATE UNIQUE INDEX uq_workspace_layouts_user_default ON workspace_layouts(user_id) WHERE is_default = true;
```

---

## 6.14 transfer_tasks

文件传输核心表。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 任务主键 |
| user_id | uuid | fk -> users(id) | 所属用户 |
| task_type | varchar(20) | not null | `upload` / `download` |
| source_type | varchar(30) | not null | `local` / `remote` / `platform_tmp` |
| target_type | varchar(30) | not null | `remote` / `local` / `platform_tmp` |
| source_host_id | uuid | fk -> hosts(id) null | 来源主机 |
| target_host_id | uuid | fk -> hosts(id) null | 目标主机 |
| source_path | text | null | 源路径 |
| target_path | text | null | 目标路径 |
| tmp_path | text | null | 平台暂存文件路径 |
| remote_tmp_path | text | null | 远程 `.part` 路径 |
| file_name | varchar(255) | not null | 文件名 |
| total_bytes | bigint | not null default 0 | 总大小 |
| transferred_bytes | bigint | not null default 0 | 已完成字节数 |
| chunk_size | int | not null default 5242880 | 分片大小 |
| status | varchar(50) | not null | 任务状态 |
| resumable | boolean | not null default true | 是否允许恢复 |
| retry_count | int | not null default 0 | 重试次数 |
| checksum_algo | varchar(20) | null | 校验算法 |
| checksum_value | varchar(128) | null | 校验值 |
| last_error_code | varchar(100) | null | 最近错误码 |
| last_error_message | text | null | 最近错误信息 |
| started_at | timestamptz | null | 开始时间 |
| finished_at | timestamptz | null | 结束时间 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 索引

```sql
CREATE INDEX idx_transfer_tasks_user_id ON transfer_tasks(user_id);
CREATE INDEX idx_transfer_tasks_status ON transfer_tasks(status);
CREATE INDEX idx_transfer_tasks_created_at ON transfer_tasks(created_at DESC);
CREATE INDEX idx_transfer_tasks_user_status_created ON transfer_tasks(user_id, status, created_at DESC);
CREATE INDEX idx_transfer_tasks_source_host_id ON transfer_tasks(source_host_id);
CREATE INDEX idx_transfer_tasks_target_host_id ON transfer_tasks(target_host_id);
```

### 说明

- `transferred_bytes` 是第一版恢复的核心字段。
- `remote_tmp_path` 便于上传中断后对齐远程偏移。
- 第一版以**顺序分片**为主，`transferred_bytes` 足够支撑大多数恢复场景。

---

## 6.15 transfer_task_chunks（可选，但推荐）

如果希望为后续更复杂恢复或调试保留能力，可以增加分片记录表。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| task_id | uuid | fk -> transfer_tasks(id) | 所属任务 |
| chunk_index | int | not null | 分片编号 |
| offset_start | bigint | not null | 起始偏移 |
| offset_end | bigint | not null | 结束偏移 |
| size_bytes | int | not null | 分片大小 |
| status | varchar(30) | not null | `pending`/`uploaded`/`verified` |
| checksum_value | varchar(128) | null | 分片校验 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 索引

```sql
CREATE INDEX idx_transfer_task_chunks_task_id ON transfer_task_chunks(task_id);
CREATE UNIQUE INDEX uq_transfer_task_chunks_task_index ON transfer_task_chunks(task_id, chunk_index);
```

### 说明

- 第一版不是必须。
- 若先走顺序上传，这个表可以暂缓，避免初期复杂度过高。

---

## 6.16 audit_logs

统一结构化审计事件表。第一版重点表之一。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| user_id | uuid | fk -> users(id) null | 事件归属用户；匿名登录失败、邮箱验证码发送等无法可靠归属用户的事件允许为空 |
| session_id | uuid | fk -> user_sessions(id) null | 平台会话 |
| terminal_session_id | uuid | fk -> terminal_sessions(id) null | 终端会话 |
| target_host_id | uuid | fk -> hosts(id) null | 目标主机 |
| event_type | varchar(100) | not null | 事件类型 |
| resource_type | varchar(50) | null | 资源类型 |
| resource_id | uuid | null | 资源 ID |
| target_path | text | null | 路径类资源 |
| result | varchar(20) | not null | success / failure |
| message | text | null | 摘要 |
| metadata_json | jsonb | null | 结构化补充信息 |
| client_ip | inet | null | 客户端 IP |
| user_agent | text | null | 客户端 UA |
| occurred_at | timestamptz | not null | 事件发生时间 |
| created_at | timestamptz | not null | 入库时间 |

### 推荐事件类型

- `auth_login`
- `auth_login_failed`
- `auth_logout`
- `auth_email_code_send`
- `auth_email_code_verify_failed`
- `admin_user_disabled`
- `admin_user_enabled`
- `admin_user_kicked`
- `admin_user_role_changed`
- `terminal_session_connect`
- `terminal_session_disconnected`
- `terminal_session_failed`
- `file_list`
- `file_upload_start`
- `file_upload_success`
- `file_upload_failed`
- `file_download_start`
- `file_download_success`
- `file_download_failed`
- `file_delete`
- `file_rename`
- `file_mkdir`
- `file_chmod`
- `transfer_pause`
- `transfer_resume`
- `transfer_cancel`
- `transfer_retry`

### 索引

```sql
CREATE INDEX idx_audit_logs_user_occurred_at ON audit_logs(user_id, occurred_at DESC);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_target_host_id ON audit_logs(target_host_id);
CREATE INDEX idx_audit_logs_terminal_session_id ON audit_logs(terminal_session_id);
CREATE INDEX idx_audit_logs_metadata_gin ON audit_logs USING GIN (metadata_json);
```

### 说明

- 体量会比较大，应只追加、少更新。
- 后续可按月份分区，第一版可暂不分区，若预估日志量较大则建议从第一天使用 `RANGE PARTITION BY occurred_at`。

---

## 6.17 audit_export_tasks

审计日志异步导出任务表。第一版由后端生成 CSV 并直接保存在 `result_csv` 中，结果默认保留 24 小时。

### 字段

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 任务 ID |
| user_id | uuid | fk -> users(id) | 所属用户 |
| filter_event_type | text | not null default '' | 事件类型筛选 |
| filter_target_host_id | uuid | fk -> hosts(id), nullable | 主机筛选 |
| filter_result | text | not null default '' | 结果筛选，空值表示全部 |
| filter_start_time | timestamptz | nullable | 起始时间筛选 |
| filter_end_time | timestamptz | nullable | 结束时间筛选 |
| status | varchar(20) | not null | pending / running / completed / failed / canceled |
| total_rows | int | not null default 0 | 匹配总行数 |
| exported_rows | int | not null default 0 | 已写入 CSV 行数 |
| result_csv | text | not null default '' | CSV 内容 |
| error_code | varchar(100) | nullable | 失败码 |
| error_message | text | nullable | 失败原因 |
| started_at | timestamptz | nullable | 开始时间 |
| finished_at | timestamptz | nullable | 结束时间 |
| expires_at | timestamptz | not null | 结果过期时间 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 索引

```sql
CREATE INDEX idx_audit_export_tasks_user_created_at ON audit_export_tasks(user_id, created_at DESC);
CREATE INDEX idx_audit_export_tasks_status_created_at ON audit_export_tasks(status, created_at);
CREATE INDEX idx_audit_export_tasks_expires_at ON audit_export_tasks(expires_at);
```

---

## 6.18 terminal_audit_settings（预留）

为后续用户自定义命令审计等级预留。

### 字段建议

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| user_id | uuid | fk -> users(id) | 用户 |
| audit_level | varchar(20) | not null default 'basic' | 审计级别 |
| command_logging_enabled | boolean | not null default false | 是否记录命令 |
| output_logging_enabled | boolean | not null default false | 是否记录输出 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

---

## 6.19 system_settings

管理员通用配置表，用于保存可在后台调整的全局运行配置。服务启动时会用环境变量作为默认值，再用本表中的值覆盖；管理员保存后会同时更新进程内运行时配置。

### 字段

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| key | varchar(120) | pk | 配置键，例如 `allow_user_registration` |
| value | text | not null | 配置值，统一以字符串保存，由业务层按类型解析 |
| updated_by | uuid | fk -> users(id), nullable | 最近更新该配置的管理员；用户删除时置空 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

### 当前管理范围

- 注册与会话：`allow_user_registration`、`session_idle_timeout_minutes`、`refresh_token_ttl_hours`
- 终端与文件：`terminal_max_sessions_per_user`、`terminal_max_sessions_total`、`terminal_keep_alive_hours`、`file_sftp_idle_ttl_minutes`、`host_connectivity_poll_interval_seconds`
- SMTP 发件信息：`smtp_host`、`smtp_port`、`smtp_from`、`smtp_from_name`、`smtp_username`、`smtp_password`、`smtp_use_ssl`
- 新注册邮箱白名单：`auth_allowed_emails`、`auth_allowed_email_domains`；只限制新注册，不限制已注册用户登录或个人中心邮箱换绑
- 邮箱验证码规则：`auth_email_code_length`、`auth_email_code_ttl_minutes`、`auth_email_code_max_attempts`、`auth_email_code_resend_cooldown_seconds`、`auth_email_code_email_window_minutes`、`auth_email_code_email_window_max_sends`、`auth_email_code_ip_window_minutes`、`auth_email_code_ip_window_max_sends`
- 终端 AI 命令生成：`llm_enabled`、`llm_protocol`、`llm_base_url`、`llm_model`、`llm_auth_header`、`llm_api_key`、`llm_timeout_seconds`、`llm_max_tokens`

SMTP 密码和大模型 API key 读取时不回显明文，只通过管理接口返回是否已配置。邮箱验证码 hash secret 不进入该表，仍由服务端环境变量提供。

### 索引

主键 `key` 即可满足第一版读取和 upsert。

---

## 7. 推荐建表顺序（迁移顺序）

1. `users`
2. `user_sessions`
3. `roles`
4. `role_permissions`
5. `host_groups`
6. `credentials`
7. `hosts`
8. `host_fingerprints`
9. `saved_commands`
10. `workspace_layouts`
11. `terminal_sessions`
12. `transfer_tasks`
13. `transfer_task_chunks`（若启用）
14. `audit_logs`
15. `audit_export_tasks`
16. `terminal_recording_settings`
17. `terminal_recordings`
18. `terminal_recording_chunks`
19. `terminal_shares`
20. `terminal_share_access_logs`
21. `terminal_share_viewer_tokens`
22. `terminal_audit_settings`
23. `system_settings`

迁移 `000013` 在不新增表的情况下扩展 `email_verification_codes.purpose`，允许邮箱换绑的旧邮箱与新邮箱验证码场景。迁移 `000014` 为 `user_sessions` 增加 `login_method`，用于展示本次会话的登录方式。迁移 `000015` 为 `users.lower(display_name)` 增加唯一索引，使用户名可作为大小写不敏感的登录标识。迁移 `000016` 增加 `user_mfa_settings`、`user_mfa_recovery_codes` 和 `user_mfa_tokens`，用于 TOTP 2FA、恢复码和 pending MFA 登录流程。迁移 `000017` 增加 `terminal_shares`、`terminal_share_access_logs` 和 `terminal_share_viewer_tokens`，用于临时只读终端分享。迁移 `000018` 为 `terminal_shares` 增加可恢复展示链接所需的 `public_token`、唯一索引和后续输入约束。

---

## 8. 典型建表 SQL 草案（节选）

### 8.1 users

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  password_hash text NOT NULL,
  display_name varchar(100) NOT NULL,
  preferred_locale varchar(10) NOT NULL DEFAULT 'zh-CN',
  theme varchar(20) NOT NULL DEFAULT 'system',
  status varchar(20) NOT NULL DEFAULT 'active',
  role varchar(50) NOT NULL DEFAULT 'user',
  last_login_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX uq_users_email ON users(email);
CREATE UNIQUE INDEX uq_users_display_name_lower ON users(lower(display_name));
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_role ON users(role);
```

### 8.2 roles / role_permissions

```sql
CREATE TABLE roles (
  key varchar(50) PRIMARY KEY,
  name varchar(120) NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_key varchar(50) NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  permission varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_key, permission)
);

ALTER TABLE users
  ADD CONSTRAINT fk_users_role FOREIGN KEY (role) REFERENCES roles(key);

CREATE INDEX idx_role_permissions_permission ON role_permissions(permission);
```

### 8.3 credentials

```sql
CREATE TABLE credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  auth_type varchar(20) NOT NULL,
  encrypted_secret text NULL,
  encrypted_private_key text NULL,
  encrypted_passphrase text NULL,
  key_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (auth_type IN ('password', 'private_key'))
);

CREATE INDEX idx_credentials_user_id ON credentials(user_id);
CREATE INDEX idx_credentials_user_auth_type ON credentials(user_id, auth_type);
```

### 8.4 transfer_tasks

```sql
CREATE TABLE transfer_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_type varchar(20) NOT NULL,
  source_type varchar(30) NOT NULL,
  target_type varchar(30) NOT NULL,
  source_host_id uuid NULL REFERENCES hosts(id) ON DELETE SET NULL,
  target_host_id uuid NULL REFERENCES hosts(id) ON DELETE SET NULL,
  source_path text NULL,
  target_path text NULL,
  tmp_path text NULL,
  remote_tmp_path text NULL,
  file_name varchar(255) NOT NULL,
  total_bytes bigint NOT NULL DEFAULT 0,
  transferred_bytes bigint NOT NULL DEFAULT 0,
  chunk_size int NOT NULL DEFAULT 5242880,
  status varchar(50) NOT NULL,
  resumable boolean NOT NULL DEFAULT true,
  retry_count int NOT NULL DEFAULT 0,
  checksum_algo varchar(20) NULL,
  checksum_value varchar(128) NULL,
  last_error_code varchar(100) NULL,
  last_error_message text NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 9. 数据清理与归档建议

### 9.1 user_sessions
- 过期会话可定期清理
- 保留最近 30~90 天即可

### 9.2 terminal_sessions
- 第一版可长期保留元信息
- 若量大，可按 180 天归档

### 9.3 transfer_tasks
- 已完成任务建议长期保留简要记录
- 临时文件路径在完成后需要清理

### 9.4 audit_logs
- 建议至少保留 180 天
- 若后续支持命令/输出审计，可考虑冷热分层存储

---

## 10. 管理员数据库导入导出

管理员设置中的数据库导入导出第一版只覆盖个人资源主链：

- `host_groups`
- `credentials`
- `hosts`

导出格式为 JSON，顶层包含 `schema_version`、`exported_at`、`host_groups`、`credentials` 和 `hosts`。凭据不会以明文形式导出；备份中只包含加密后的凭据字段、`key_version` 和 `content_hash`。导入时服务端需要使用当前实例配置的凭据密钥环解密备份中的 `key_version`，再用当前 active key version 重新加密后写入数据库。因此该备份方式适合在同一密钥体系内迁移或恢复；如果目标实例缺少旧 `key_version` 对应密钥，导入会失败。

### 去重规则

| 资源 | 去重键 | 行为 |
|---|---|---|
| 主机分组 | `user_id + lower(name)` | 已存在则跳过，并把备份分组 ID 映射到已有分组 |
| 凭据 | `user_id + content_hash` | 已存在则跳过，并把备份凭据 ID 映射到已有凭据 |
| 主机 | `user_id + lower(host) + username + port` | 已存在则跳过 |

导入主机时，`group_id` 和 `credential_id` 会优先映射到本轮新建记录；如果对应资源因去重被跳过，则映射到当前数据库已有记录。找不到映射时保留为空，避免写入悬空外键。

---

## 11. 后续扩展建议

### 11.1 团队与组织级 RBAC
后续可新增：

- `organizations`
- `organization_members`
- 组织成员角色与组织内资源权限
- 各核心资源的 `organization_id` 可空字段

当前表设计中保留的 `user_id` 可在未来扩展为 `owner_user_id` / `owner_org_id` 模式。
团队版设计方向是：个人端点保持当前 `user_id` 隔离；团队版优先通过 `organization_id NULL` 的 additive migration 扩展资源归属，详见 `docs/architecture/team-rbac.md`。
当前 `roles` / `role_permissions` 是平台级账号权限，不等同于未来组织内成员权限。

### 11.2 命令审计
后续可新增：

- `terminal_command_logs`
- `terminal_output_blobs`
- `terminal_replay_chunks`

终端审计设计方向是：`terminal_command_logs` 用于 command 级别，`terminal_io_recordings` 或对象存储引用用于 full_io 级别；full_io 不应直接写入 `audit_logs.metadata_json`，详见 `docs/architecture/terminal-audit-levels.md`。

### 11.3 远端到远端直传
后续可在 `transfer_tasks` 中增加：

- `execution_mode`
  - `platform_relay`
  - `remote_pull`
  - `remote_push`

---

## 12. AI 辅助开发建议

为了便于 AI 正确生成迁移、Repository、ORM 模型和查询代码，建议进一步固定：

1. 所有状态字段枚举集中维护
2. 所有审计事件类型集中维护
3. 所有表的 `updated_at` 通过统一触发器或应用层更新
4. 查询接口按“用户可见资源”统一封装过滤条件
5. 传输状态变更必须通过单一服务层函数推进，避免状态散落

---

## 12. 本文结论

第一版数据库设计应围绕以下四件事构建：

- **用户资源隔离**
- **凭据安全存储**
- **传输任务可恢复**
- **操作事件可审计**

在此基础上，保持表结构简洁、可演进，并为后续 RBAC、命令审计和远端直传预留扩展空间。
