# 审计日志异步导出（Audit Export）

## 背景与目标

早期 `AuditPage` 的 CSV 导出由前端循环 `listAuditLogs(page=N, page_size=100)` 拼装而成，且最多导出前 1000 条匹配日志。该方案在数据量大时会：

- 前端长时间发出连续请求，体验差。
- 导出条数被硬性截断在 1000，无法满足跨周/跨月审计需求。
- 一次请求失败即整个流程失败。

第一版异步导出目标：

- 在后端用任务模型生成 CSV，前端只创建任务、轮询进度、下载结果。
- 单任务最多 100,000 行（覆盖典型半年审计），超过时返回 `LIMIT_REACHED`。
- 单用户最多 3 个 pending/running 任务，避免重复任务挤占 worker。
- 任务结果保留 24 小时后过期。

> 第一版**不**做：流式 chunked 下载、外部对象存储（S3 等）、邮件分发、定时调度。

## 数据模型

新增 migration `000004_audit_export_tasks.up.sql`：

```sql
CREATE TABLE audit_export_tasks (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filter_event_type      TEXT NOT NULL DEFAULT '',
  filter_target_host_id  UUID NULL REFERENCES hosts(id) ON DELETE SET NULL,
  filter_result          TEXT NOT NULL DEFAULT '',
  filter_start_time      TIMESTAMPTZ NULL,
  filter_end_time        TIMESTAMPTZ NULL,
  status                 TEXT NOT NULL DEFAULT 'pending',
  total_rows             INTEGER NOT NULL DEFAULT 0,
  exported_rows          INTEGER NOT NULL DEFAULT 0,
  result_csv             TEXT NOT NULL DEFAULT '',
  error_code             TEXT NULL,
  error_message          TEXT NULL,
  started_at             TIMESTAMPTZ NULL,
  finished_at            TIMESTAMPTZ NULL,
  expires_at             TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_export_tasks_user_created
  ON audit_export_tasks(user_id, created_at DESC);
```

状态值：`pending` → `running` → (`completed` | `failed` | `canceled`)。

CSV 文本直接放在 `result_csv`（PostgreSQL TEXT 上限 1GB；100,000 条审计行预计 < 30 MB）。第二版可换成对象存储引用。

## 后端模块（`internal/auditexport`）

状态：后端 migration、model、repository、service worker、handler、router、OpenAPI 和测试已落地；前端已切换为导出任务弹窗，不再使用旧的 1000 条前端导出。已结束任务可删除，pending/running 任务仍只能取消。

参考 `internal/files` 中 `file_search_tasks` 的实现：

- `repository.go`：`Create / GetByID / GetByIDAny / List / Start / UpdateProgress / Finish / Cancel` 等方法。
- `service.go`：
  - 单 worker goroutine + buffered channel queue；启动时从 app 装配。
  - `CreateExportTask` 验证参数 + 入队，超出并发上限返回 `AUDIT_EXPORT_QUEUE_FULL`。
  - `runExportTask` 通过 audit repository 分页读取过滤后的日志，每 500 行 flush 一次进度，遇到 ctx 取消/超时返回失败。
  - 复用 `audit.Repository.ListByUserID` 的过滤参数；如需更严格上限，加一个 `ListForExport(ctx, userID, filter, limit, offset)` 的精简方法。
- `handler.go`：5 个 HTTP 端点。
- `service_test.go` + `repository_integration_test.go`：覆盖创建、运行、取消、过滤、超出上限、用户隔离。

`activeExports map[taskID]context.CancelFunc`（与 file_search 一致）支持取消。

## HTTP 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/audit/exports` | 创建导出任务，body 复用 audit list filter |
| GET  | `/api/audit/exports` | 列出当前用户最近 N 条任务（默认 20） |
| GET  | `/api/audit/exports/{id}` | 获取单个任务状态 |
| DELETE | `/api/audit/exports/{id}` | 删除 completed/failed/canceled 等已结束任务 |
| GET  | `/api/audit/exports/{id}/download` | 下载 CSV（Content-Type `text/csv; charset=utf-8`，UTF-8 BOM） |
| POST | `/api/audit/exports/{id}/cancel` | 取消 pending/running 任务 |

错误码：

- `AUDIT_EXPORT_QUEUE_FULL`：用户已有 ≥ 3 个 pending/running 任务。
- `AUDIT_EXPORT_NOT_READY`：下载尚未完成。
- `AUDIT_EXPORT_EXPIRED`：超过 `expires_at`。
- `AUDIT_EXPORT_LIMIT_REACHED`：超过 100k 行上限。

## 前端

- `features/auditExports/{api.ts,types.ts}`：HTTP client + 类型。
- `routes/AuditPage.tsx`：把现有「导出 CSV」按钮改为「打开导出任务」入口；弹窗展示任务列表 + 「按当前筛选条件创建任务」按钮 + 状态/进度/下载/取消/删除。
- 任务列表首次打开或手动刷新时显示 loading；仅当存在 pending/running 任务时通过 3 秒静默轮询刷新进度，任务全部结束后停止轮询。任务完成后展示下载按钮，点击触发浏览器 `<a download>` 下载 `/api/audit/exports/{id}/download`。已结束任务可删除。
- 中英文 i18n key（`audit.exportTask.*`）。
- `routes/AuditPage.test.tsx` 覆盖：创建任务、轮询完成、下载点击、取消任务。

## 实现状态

已完成：

1. 后端：migration、model、repository、service、worker、handler、router、OpenAPI、storage-schema、单元/集成测试。
2. 前端：API client、AuditPage 弹窗、i18n、测试。
3. 导出流程已切换到任务模型并移除旧的前端循环。

## 验收

- 后端 `go test ./...` + audit_export DB 集成测试通过。
- 前端 Vitest + 生产构建通过。
- OpenAPI YAML 解析通过且 router 与 OpenAPI 无未解释差异。
- `git diff --check` 无空白错误。
- 文档：本文件 + `storage-schema.md` 同步表结构。
