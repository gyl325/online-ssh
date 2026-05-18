# Operational Logging Runbook

更新时间：2026-05-16

本文记录后端已落地的安全结构化应用日志字段，用于线上排障和后续可观测性维护。这里说的是 `log/slog` 应用日志，不是数据库里的 `audit_logs` 操作审计。审计日志服务产品内查询与导出；应用日志用于运维侧按事件、用户、任务、会话和主机定位问题。

## 使用边界

- 日志事件通过 `internal/observability` 和 `log/slog` 输出结构化属性；实际落盘格式取决于运行环境的 slog handler 或日志采集器。
- 当前目标是轻量可排障，不引入外部 observability 平台。
- 排障时优先按 `event` 精确过滤，再用 `component`、`user_id`、`host_id`、`session_id`、`task_id`、`share_id` 或 `recording_id` 缩小范围。
- `error_kind` 和 `reason_kind` 是归一化分类，用于聚合趋势；不要依赖 raw error 文本做查询。

## 禁止记录项

后续新增应用日志时不要记录以下内容：

- session cookie、refresh token、attach token、viewer token、公开分享 token、API key、验证码、密码、私钥、TOTP secret、恢复码。
- 终端输入、命令明文、终端输出、录制 payload。
- HTTP query、request body、Authorization header。
- 搜索关键词、完整远端路径、完整本地路径、文件内容。
- raw error message、SSH/SFTP 原始错误串，除非先做安全分类和脱敏。

允许记录的定位字段包括内部 ID、状态枚举、计数、耗时、字节数、HTTP method/path/status，以及安全归类后的 `error_code` / `error_kind` / `reason_kind`。

## 通用字段

| 字段 | 含义 | 备注 |
|---|---|---|
| `component` | 模块名 | 当前常见值：`http`、`transfer`、`files`、`terminal`。 |
| `event` | 事件名 | 排障入口字段。 |
| `user_id` | 用户 ID | 不代表权限判断，只用于归因。 |
| `host_id` | 主机 ID | 只记录 ID，不记录 hostname、IP、路径或凭据。 |
| `status` | 当前业务状态 | 例如 task / session / recording 状态。 |
| `error_code` | 已归一化业务错误码 | 来自现有错误码，不放 raw error。 |
| `error_kind` | 错误分类 | 由 `observability.ErrorKindFromCode` 生成。 |
| `reason_kind` | 关闭或断开原因分类 | 由 terminal close reason 归类生成。 |

当前 `error_kind` 分类包括：

- `permission_denied`
- `no_space`
- `not_found`
- `timeout`
- `canceled`
- `validation`
- `connection`
- `unknown`

当前 terminal `reason_kind` 分类包括：

- `admin`
- `operator`
- `share_revoked`
- `share_expired`
- `auth`
- `expired`
- `share`
- `client`
- `runtime`
- `unknown`

## HTTP Access

| event | level | 字段 | 用途 |
|---|---|---|---|
| `http_request_completed` | info | `component`、`event`、`method`、`path`、`status`、`duration_ms` | 观察接口状态码、慢请求和 WebSocket upgrade 前的 HTTP 请求路径。 |

排障建议：

- 按 `status >= 500` 找服务端错误，再按 `path` 聚合。
- 按 `duration_ms` 排慢请求，优先看上传、下载、导出和远程搜索相关接口。
- 该事件不记录 query 和 body；需要用户级操作追踪时查 `audit_logs`。

## Transfer

| event | level | 字段 | 用途 |
|---|---|---|---|
| `transfer_task_failed` | warn | `component`、`event`、`user_id`、`task_id`、`host_id`、`task_type`、`status`、`error_code`、`error_kind` | 定位上传/下载任务失败原因分类。 |
| `transfer_task_completed` | info | `component`、`event`、`user_id`、`task_id`、`host_id`、`task_type`、`status`、`transferred_bytes` | 确认任务完成和传输字节数。 |
| `transfer_task_canceled` | info | `component`、`event`、`user_id`、`task_id`、`host_id`、`task_type`、`status`、`transferred_bytes` | 区分用户取消和失败。 |

排障建议：

- 单任务：用 `task_id` 过滤完整生命周期。
- 主机维度：按 `host_id` 聚合 `transfer_task_failed`，观察是否集中在某台主机。
- 容量问题：筛 `error_kind=no_space`。
- 权限问题：筛 `error_kind=permission_denied`。

## File Search

| event | level | 字段 | 用途 |
|---|---|---|---|
| `file_search_task_started` | info | `component`、`event`、`user_id`、`task_id`、`host_id`、`status` | 确认远程搜索 worker 已开始执行。 |
| `file_search_task_finished` | info / warn | `component`、`event`、`user_id`、`task_id`、`host_id`、`status`、`scanned_entries`、`matched_entries`、`skipped_errors_count`、`limit_reached`、可选 `error_code`、`error_kind` | 判断搜索完成、取消、失败、命中数和跳过错误数量。 |
| `file_search_task_cancel_requested` | info | `component`、`event`、`user_id`、`task_id`、`host_id`、`status` | 区分用户主动取消请求和 worker 后续结束状态。 |

排障建议：

- 搜索“看起来没结果”：按 `task_id` 查看 `matched_entries`、`scanned_entries` 和 `limit_reached`。
- 搜索频繁失败：按 `host_id` 聚合 warn 级 `file_search_task_finished`。
- 搜索被取消：先找 `file_search_task_cancel_requested`，再看同 `task_id` 的 `file_search_task_finished`。
- 该类日志不记录 `base_path` 和 keyword；路径/关键词只允许在受控审计或用户界面上下文中查看。

## Terminal Runtime

| event | level | 字段 | 用途 |
|---|---|---|---|
| `terminal_runtime_attached` | info | `component`、`event`、`user_id`、`session_id`、`auth_session_id`、`host_id`、`status` | 终端主连接 attach 成功。 |
| `terminal_runtime_detached` | info | `component`、`event`、`user_id`、`session_id`、`host_id`、`status`、`reason_kind` | 主连接 detach，但 runtime 可能仍由 keepalive 托管。 |
| `terminal_runtime_closed` | warn | `component`、`event`、`user_id`、`session_id`、`host_id`、`status`、`reason_kind` | runtime 关闭或失败。 |
| `terminal_runtime_expired` | warn | `component`、`event`、`user_id`、`session_id`、`host_id`、`expiry_kind`、`reason_kind` | keepalive / detached TTL 到期关闭前的独立事件。 |

`expiry_kind` 当前值：

- `keepalive`
- `detached_ttl`

排障建议：

- 用户反馈刷新后终端丢失：按 `session_id` 查 `terminal_runtime_detached`、`terminal_runtime_expired`、`terminal_runtime_closed`。
- 判断是否被管理员或强制关闭：看 `reason_kind=admin` 或 `reason_kind=operator`。
- 判断是否保活到期：看 `terminal_runtime_expired`，再看同 `session_id` 的 `terminal_runtime_closed`。
- `auth_session_id` 只用于区分同一用户多认证会话，不要写入 cookie 或 token。

## Terminal Share Viewer

| event | level | 字段 | 用途 |
|---|---|---|---|
| `terminal_share_viewer_attached` | info | `component`、`event`、`user_id`、`session_id`、`share_id`、`host_id`、`viewer_id` | 只读分享 viewer 已接入 runtime。 |
| `terminal_share_viewer_detached` | info | `component`、`event`、`user_id`、`session_id`、`share_id`、`host_id`、`viewer_id`、`reason_kind` | viewer 已离开或被关闭。 |
| `terminal_share_viewer_expired` | warn | `component`、`event`、`user_id`、`session_id`、`share_id`、`host_id`、`viewer_id`、`reason_kind` | 分享到期 timer 关闭 viewer 的独立事件。 |

排障建议：

- 分享观看异常：按 `share_id` 查 viewer attach/detach。
- 分享到期：筛 `terminal_share_viewer_expired` 或 `reason_kind=share_expired`。
- 分享被 owner/admin revoke：筛 `terminal_share_viewer_detached` + `reason_kind=share_revoked`。
- 日志中只允许 `share_id`，不允许 token、公开 token、viewer token 或密码。

## Terminal Recording

| event | level | 字段 | 用途 |
|---|---|---|---|
| `terminal_recording_flush_completed` | info | `component`、`event`、`user_id`、`session_id`、`recording_id` | recording collector 结束前 flush barrier 已完成。 |
| `terminal_recording_finished` | info | `component`、`event`、`user_id`、`session_id`、`recording_id`、`status`、`dropped_bytes` | recording 已标记完成或失败，并记录丢弃字节数。 |

排障建议：

- 录制尾部缺失：按 `recording_id` 查是否有 `terminal_recording_flush_completed`。
- 录制队列压力：按 `dropped_bytes > 0` 聚合。
- 录制状态异常：按 `status` 聚合 `terminal_recording_finished`。
- 不能记录录制 payload、终端输入、终端输出或命令明文。

## 新增日志检查清单

新增应用日志前必须确认：

- 是否已有 `audit_logs` 事件能满足产品内追踪；应用日志只补运维排障。
- 是否能用稳定 ID、状态和分类字段定位问题，而不输出敏感文本。
- 是否需要新增 `error_kind` / `reason_kind` 分类，而不是输出 raw error。
- 是否有测试证明日志字段存在且敏感内容没有出现。
- 是否同步更新本文档和相关架构/运行文档。
