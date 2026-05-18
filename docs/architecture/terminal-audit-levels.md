# 终端命令审计与输出审计设计

## 目标

定义终端命令审计、输出审计、审计级别、脱敏、保留周期和访问边界。本文是后续安全与隐私设计参考，当前产品不默认采集完整终端 IO。

## 当前基线

当前系统已经具备：

- `audit_logs` 结构化操作审计。
- `AuditLevel` 枚举：`basic`、`command`、`full_io`。
- `terminal_sessions` 和 `audit_logs.terminal_session_id`。
- 终端 WebSocket 入口：
  - 输入从 `terminal.Handler.streamAttachment` 读取后写入 `attachment.WriteInput`。
  - 输出由 `managedRuntime.forwardOutput` 读取，再通过 `managedRuntime.publish` 推送到前端。
- `terminal_audit_settings` 在 storage schema 中已有预留说明，但尚未实现。
- 个人版终端历史已通过 `terminal_recording_settings`、`terminal_recordings`、`terminal_recording_chunks` 落地：默认关闭，用户开启后为新会话保存加密 input/output chunks，供本人短期回看和删除。

当前系统仍没有实现团队/合规口径的 command/full_io 审计；个人终端历史不写入 `audit_logs.metadata_json`，也不等同于可跨用户查看的审计证据。

## 审计级别

### basic

默认级别。

记录内容：

- session 创建、连接、断开、失败。
- keepalive 开关。
- 目标 host、结果、时间、客户端信息。

不记录：

- 命令文本。
- 终端输出。
- 交互输入内容。

### command

记录“用户提交给终端的命令行”，不记录输出。

浏览器终端连接的是 PTY，不是 shell AST。后端看到的是字节流，无法 100% 判断某行是否真实 shell 命令。因此第一版 command 审计应标记为 best-effort。

采集规则：

- 在 WebSocket input 写入 SSH stdin 前复制输入字节。
- 通过 per-session line parser 处理普通字符、Enter、Backspace、Ctrl+C、Ctrl+U、Ctrl+D、Bracketed paste。
- 遇到 Enter 时生成一条 command log。
- 空行不记录。
- 记录前执行脱敏。
- 如果 parser 判断输入包含不可解析控制序列，仍可记录 redacted / partial 标记，或直接跳过。

限制：

- 不能保证捕获远端程序内部执行的命令。
- 不能保证区分 shell 命令和 REPL 输入。
- 不能把 command 审计作为强安全隔离或合规唯一证据。

### full_io

记录终端输入与输出流，用于高审计要求或会话回放。

默认关闭。只能在明确配置、明确告知用户、明确保留周期后启用。

风险：

- 输出可能包含密码、token、私钥片段、数据库内容、客户数据。
- 自动脱敏无法可靠覆盖所有敏感信息。
- 存储量和导出风险显著高于 basic / command。

因此 full_io 第一版不建议直接落地，除非已有明确的合规要求和访问控制。

## 设置模型

建议新增设置表：

```sql
CREATE TABLE terminal_audit_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NULL,
  host_id UUID NULL REFERENCES hosts(id) ON DELETE CASCADE,
  audit_level VARCHAR(20) NOT NULL DEFAULT 'basic',
  command_retention_days INT NOT NULL DEFAULT 90,
  full_io_retention_days INT NOT NULL DEFAULT 7,
  redact_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (audit_level IN ('basic', 'command', 'full_io'))
);
```

生效优先级：

1. host-specific setting。
2. organization setting。
3. user setting。
4. system default：`basic`。

团队版策略：

- organization owner/admin 可设置团队默认审计级别。
- 普通成员不能降低团队要求的审计级别。
- 如果启用 command 或 full_io，前端必须在打开终端前和终端内显示明确提示。

## 数据模型

### terminal_command_logs

用于 command 级别。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| user_id | uuid | actor |
| organization_id | uuid null | 团队上下文 |
| terminal_session_id | uuid | 终端 session |
| target_host_id | uuid | 目标主机 |
| command_text | text | 脱敏后的命令文本 |
| command_hash | text | 原始命令 hash，用于去重或取证比对 |
| redacted | boolean | 是否发生脱敏 |
| parse_status | varchar(20) | complete / partial / skipped |
| submitted_at | timestamptz | 提交时间 |
| metadata_json | jsonb null | 控制键、paste 等补充信息 |

`audit_logs` 中可同步写轻量事件：

- `terminal_command_submitted`
- `audit_level = command`
- metadata 中只放 command log id、redacted、parse status，不放完整命令文本。

### terminal_io_recordings

用于 full_io 级别。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| user_id | uuid | actor |
| organization_id | uuid null | 团队上下文 |
| terminal_session_id | uuid | 终端 session |
| target_host_id | uuid | 目标主机 |
| storage_ref | text | 对象存储或文件引用 |
| key_version | int | 加密密钥版本 |
| input_bytes | bigint | 输入字节数 |
| output_bytes | bigint | 输出字节数 |
| dropped_bytes | bigint | 因队列满丢弃的字节数 |
| started_at | timestamptz | 记录开始 |
| ended_at | timestamptz null | 记录结束 |
| expires_at | timestamptz | 到期删除时间 |

full_io 内容不建议直接放 PostgreSQL `audit_logs.metadata_json`。应使用单独加密存储，`audit_logs` 只保存 recording id。

## 脱敏策略

第一版 command 脱敏使用保守规则：

- `--password value`、`--password=value`。
- `token=...`、`access_token=...`、`secret=...`、`apikey=...`。
- `Authorization: Bearer ...`。
- 常见云密钥形态。
- PEM private key block。

规则：

- 默认 `redact_enabled = true`。
- 被脱敏的命令 `redacted = true`。
- 不保留未脱敏原文。
- `command_hash` 使用 HMAC 或带服务端 pepper 的 hash，避免低成本字典反推。

full_io 不能依赖自动脱敏。启用 full_io 时必须靠权限、保留周期、加密和访问审计控制风险。

## 采集位置

### 输入

推荐在 `TerminalAttachment.WriteInput` 或其上层 handler 调用前复制输入，传给 non-blocking audit collector。

要求：

- 审计 collector 不得阻塞 WebSocket read loop。
- collector queue 满时丢弃审计输入，并记录 dropped counter。
- 写入 SSH stdin 失败时，不记录为成功命令。

### 输出

full_io 推荐在 `managedRuntime.publish` 处复制输出 chunk。

要求：

- output collector 不得阻塞 `publish`。
- collector queue 满时丢弃输出 chunk，并累计 `dropped_bytes`。
- replay buffer 仅用于前端重连，不作为审计存储。

## 访问控制

personal scope：

- 用户只能查看自己的 command logs。
- full_io 回放/下载默认不提供，若提供也仅限本人，且需要二次确认。

organization scope：

- 普通成员可查看自己的 command logs。
- `auditor` / `admin` / `owner` 可查看团队范围 command logs。
- full_io 访问建议单独权限：`terminal_io.read`。
- 查看或导出 full_io 自身必须写审计事件。

## 保留与删除

建议默认：

- basic audit：180 天。
- command logs：90 天。
- full_io recordings：7 天，最大不超过 30 天。

删除策略：

- 定时任务按 `expires_at` 清理。
- full_io 删除必须删除对象存储内容和 metadata。
- 审计导出不应绕过保留策略。
- 用户删除账号或团队注销时，按数据保留政策清理或匿名化。

## 前端提示

打开终端前：

- 如果 audit level 为 `command`，提示“将记录提交的命令文本，敏感字段会尽量脱敏”。
- 如果 audit level 为 `full_io`，提示“将记录终端输入与输出，可能包含敏感信息”。

终端内：

- 顶部或状态区显示当前审计级别。
- full_io 使用更明显的状态标识。

## 最小实施顺序

1. 实现 `terminal_audit_settings` 和 effective policy 查询，只返回当前 session audit level。
2. 前端显示 audit level 提示，不采集新内容。
3. 实现 command parser、redactor、`terminal_command_logs` 和测试。
4. 在输入路径接入 non-blocking command collector。
5. 增加 command log 列表和审计导出支持。
6. 单独评估 full_io 存储、加密和访问审计后，再决定是否实现。

## 测试计划

- parser 单测：普通命令、Backspace、Ctrl+U、bracketed paste、不可解析控制序列。
- redactor 单测：password、token、Authorization header、private key block，且不误伤普通参数。
- service 测试：basic 不生成 command log；command 生成脱敏 command log；collector queue 满时不阻塞输入。
- 权限测试：普通用户不能看他人 command logs；auditor 可看团队 command logs；full_io 读取必须有 `terminal_io.read`。
- smoke：command level 下执行 `printf online-ssh-smoke` 后能查到脱敏 command log；basic level 下不生成 command log。

## 暂不处理

- 默认开启 command 或 full_io。
- 完整会话回放播放器。
- 对 full_io 做可靠自动脱敏。
- 捕获远端 shell 内部扩展后的真实执行计划。
- 捕获 sudo/password prompt 的明文输入。
