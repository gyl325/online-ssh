# 远程全量文件搜索设计

状态：第一版已完成；后端任务模型和前端显式远程搜索面板已落地。

本文档约束远程全量文件搜索的实现边界。当前目录搜索仍采用“已加载目录项的前端本地过滤”，远程全量搜索需要通过显式搜索任务入口启动。

## 背景

当前仓库中已经存在 `GET /api/files/search`：

- 后端入口：`backend-skeleton/server/internal/files/handler.go`
- 后端实现：`backend-skeleton/server/internal/files/service.go`
- 前端 API client：`apps/web/src/features/files/api.ts`

但当前文件页实际使用的是 `FilesPage` 中的本地过滤：

- 只过滤当前已加载目录列表
- 使用 `useDeferredValue(searchKeyword.trim().toLowerCase())`
- 输入框文案也是“搜索当前目录”

这个取舍是有意的。现有同步远程搜索在 `recursive=true` 时直接走 SFTP `Walk`，缺少最大深度、最大结果数、任务进度、取消、权限错误聚合和超时控制。如果直接作为全量搜索体验，会在大目录、慢链路或权限复杂目录上阻塞请求和用户界面。

## 目标

远程全量搜索第一版只解决“按文件名或路径名搜索远端目录树”的问题：

- 可从文件页显式启动远程搜索任务。
- 搜索任务可查询进度、查看部分结果并取消。
- 后端必须限制深度、结果数、扫描量和运行时间。
- 权限错误、单个目录读取失败不能直接让整个任务失败。
- 当前目录本地过滤继续保留，作为默认即时体验。

## 非目标

第一版不做：

- 文件内容全文检索。
- 持久索引、增量索引或后台主动建索引。
- 跨主机搜索。
- 正则表达式搜索。
- 远程系统级命令搜索，例如 `find`、`locate` 或 `ripgrep`。
- 将搜索结果直接混入当前目录列表。

## 设计决策

### 1. 使用独立异步搜索任务模型

远程全量搜索应使用独立任务模型，不复用 `transfer_tasks` 表。

理由：

- 传输任务表达的是字节传输，字段如 `total_bytes`、`transferred_bytes`、`download_url` 不适合搜索。
- 搜索需要记录扫描目录数、扫描条目数、匹配数、跳过错误数、限制触发原因等不同进度。
- 搜索任务的取消和过期清理可以复用 transfer service 的 worker / active cancel 思路，但不应污染 transfer 的状态枚举。

建议新增：

- `file_search_tasks`
- `file_search_results`

### 2. 保留现有同步接口，但不作为全量搜索入口

`GET /api/files/search` 可以继续表示轻量搜索能力，后续可收紧为：

- `recursive=false` 时只搜索当前目录。
- `recursive=true` 仅作为兼容接口保留或加严格限制。
- 新前端全量搜索只调用异步 task API。

实施时不要删除旧接口，避免破坏现有 API client 和 OpenAPI。

### 3. 先做名称/路径搜索，不做内容搜索

第一版匹配规则：

- 对 `name` 做大小写不敏感包含匹配。
- 可选对完整 `path` 做大小写不敏感包含匹配。
- 不打开文件内容，不读取文件体。

这样可以避免远程读取大文件、编码检测和权限扩散。

### 4. 显式限制资源

建议默认限制：

| 参数 | 默认值 | 服务端最大值 |
|------|--------|--------------|
| keyword length | 2 到 128 字符 | 128 |
| max_depth | 6 | 10 |
| max_results | 500 | 2000 |
| max_scanned_entries | 50000 | 200000 |
| timeout_seconds | 30 | 60 |
| page_size | 50 | 200 |

`base_path="/"` 可以允许，但 UI 必须提示会更慢，并使用默认限制。服务端仍以限制为最终保护。

### 5. 取消必须能中断 SFTP 操作

搜索 worker 应维护 `task_id -> cancel func`。

取消任务时：

- 标记任务为 `canceled`。
- 调用 context cancel。
- 对长耗时 SFTP 连接执行 discard / close，避免阻塞中的 `ReadDir` 长时间占用连接。

现有 SFTP pool 面向短请求复用连接；全量搜索是长任务，实施时要么使用专用 lease 并在取消时丢弃，要么给 pool 增加可安全中断的 lease 语义。

### 6. 权限错误聚合

读取某个目录失败时：

- 记录到任务的 `skipped_errors_count`。
- 保留有限数量的 `warnings`，例如最多 20 条。
- 继续扫描其他可访问目录。

只有这些情况应让任务失败：

- host / credential / fingerprint 校验失败。
- base path 不存在或不可访问。
- 建立 SSH/SFTP 失败。
- 全局超时。
- worker 内部不可恢复错误。

## 数据模型草案

### file_search_tasks

建议字段：

- `id`
- `user_id`
- `host_id`
- `base_path`
- `keyword`
- `match_mode`
- `recursive`
- `include_hidden`
- `max_depth`
- `max_results`
- `max_scanned_entries`
- `timeout_seconds`
- `status`
- `scanned_dirs`
- `scanned_entries`
- `matched_entries`
- `skipped_errors_count`
- `limit_reached`
- `error_code`
- `error_message`
- `warnings_json`
- `created_at`
- `started_at`
- `finished_at`
- `expires_at`

建议状态：

- `pending`
- `running`
- `completed`
- `failed`
- `canceled`

建议索引：

- `(user_id, created_at DESC)`
- `(status, created_at)`
- `(expires_at)`

### file_search_results

建议字段：

- `id`
- `task_id`
- `rank`
- `name`
- `path`
- `entry_type`
- `size_bytes`
- `permissions`
- `owner`
- `group`
- `modified_at`
- `is_hidden`
- `created_at`

建议约束：

- `UNIQUE (task_id, path)`
- `INDEX (task_id, rank)`

结果可以按发现顺序写入，也可以在任务完成后按“目录优先、路径升序”重排 rank。第一版建议按发现顺序写入，减少内存占用。

## API 草案

实施前再写入 OpenAPI。当前文档只作为设计依据。

### 创建搜索任务

`POST /api/files/search-tasks`

请求：

```json
{
  "host_id": "uuid",
  "base_path": "/var/log",
  "keyword": "nginx",
  "recursive": true,
  "include_hidden": false,
  "max_depth": 6,
  "max_results": 500
}
```

响应 `201`：

```json
{
  "task": {
    "id": "uuid",
    "host_id": "uuid",
    "base_path": "/var/log",
    "keyword": "nginx",
    "status": "pending",
    "scanned_dirs": 0,
    "scanned_entries": 0,
    "matched_entries": 0,
    "skipped_errors_count": 0,
    "limit_reached": false,
    "created_at": "2026-04-25T00:00:00Z"
  }
}
```

### 查询任务状态

`GET /api/files/search-tasks/{taskId}`

返回任务进度、状态、错误和 warnings 摘要。

### 查询结果

`GET /api/files/search-tasks/{taskId}/results?page=1&page_size=50`

返回分页结果。任务运行中也可以返回已写入的部分结果。

### 取消任务

`POST /api/files/search-tasks/{taskId}/cancel`

只有 `pending` 和 `running` 可取消。已完成、失败或已取消时返回当前任务状态，不重复报错。

## 后端实现建议

### Worker

- 使用固定大小 worker queue，避免每个请求都启动无限 goroutine。
- 每个用户同时运行的搜索任务建议限制为 2 个，全局运行任务建议限制为 16 个。
- 进度更新不必每个条目写库，可以按时间或计数节流，例如每 500 条或每 1 秒更新一次。
- 结果写入可批量 insert，批次建议 100 条。

### 遍历方式

不建议直接使用 `sftp.Client.Walk` 作为最终实现，因为它不方便控制深度和错误聚合。建议使用队列式 BFS：

1. 从 `base_path` 开始。
2. 每次 `ReadDir(current)`。
3. 对目录按 `depth < max_depth` 入队。
4. 对每个条目做 keyword 匹配。
5. 达到 `max_results`、`max_scanned_entries`、timeout 或 cancel 后停止。

隐藏文件处理：

- 默认 `include_hidden=false`。
- 文件名以 `.` 开头的条目不匹配，也不向下递归。

### SFTP 连接

搜索任务运行时间可能明显长于普通 list 请求。实施时要明确：

- 是否复用现有 `sftp_pool`。
- 取消或超时是否会关闭当前 SFTP/SSH 连接。
- 长任务是否会占满同一 host 的连接池。

第一版建议搜索任务使用专用 lease，并在 cancel / timeout / connection error 时丢弃该 lease。

### 审计

建议记录：

- `file_search_task_created`
- `file_search_task_started`
- `file_search_task_completed`
- `file_search_task_failed`
- `file_search_task_canceled`

审计 metadata 可包含：

- `task_id`
- `base_path`
- `recursive`
- `max_depth`
- `max_results`
- `scanned_entries`
- `matched_entries`
- `skipped_errors_count`
- `limit_reached`

不要在错误日志里散落完整结果列表。keyword 可以记录在审计 metadata 中，但普通应用日志应避免输出过多用户查询内容。

## 前端体验建议

文件页保留两个清晰入口：

1. 当前目录搜索：现有输入框，本地过滤已加载目录。
2. 远程搜索：显式按钮或模式切换，打开搜索面板。

远程搜索面板应包含：

- base path，默认当前目录。
- keyword。
- recursive 开关。
- max depth 选择。
- include hidden 开关。
- 开始、取消、刷新。
- 进度：已扫描目录、已扫描条目、匹配数、跳过错误数。
- 结果区：独立列表，不替换当前目录列表。

交互原则：

- 输入 keyword 不自动触发全量远程搜索，必须显式点击开始。
- 运行中可取消。
- 任务完成后可点击结果跳转到所在目录或打开文件。
- 如果任务达到限制，展示“已达到结果或扫描限制”的状态，而不是伪装成完整结果。

## 测试要求

后端：

- service 单测使用 fake walker / fake repository，不依赖真实 SFTP。
- handler 测试覆盖参数校验、创建任务、查询、取消、分页。
- repository 集成测试覆盖任务生命周期、结果分页、用户隔离、过期清理。
- worker 测试覆盖取消、timeout、max_depth、max_results、权限错误聚合。

前端：

- 文件页保留当前目录本地过滤测试。
- 新增远程搜索面板测试：创建任务、轮询进度、取消、展示 partial results、limit reached。
- fingerprint conflict 仍复用现有确认弹窗流程。

OpenAPI / 文档：

- 新接口实现后再写入 `docs/api/openapi.yaml`。
- router/OpenAPI 差异比对必须保持无未解释差异。

## 当前落地状态

截至 2026-04-25：

- 已新增 `file_search_tasks` / `file_search_results` migration。
- 已新增后端 model、repository、service worker、取消注册表、handler/router 和 OpenAPI。
- 已保留 `GET /api/files/search` 兼容行为，新全量搜索入口为 `POST /api/files/search-tasks`。
- 已通过后端默认测试、显式 PostgreSQL 集成测试批次、OpenAPI YAML 解析、router/OpenAPI 比对和 `git diff --check`。
- 前端远程搜索面板已实现，文件页仍默认使用当前目录本地过滤；远程搜索必须显式点击开始。

## 实施顺序

1. 新增 migration、model、repository 和纯 repository 集成测试。
2. 新增 search task service、worker、取消注册表和 service 单测。
3. 新增 handler/router/OpenAPI 和 HTTP handler 测试。
4. 前端新增 search task API client、类型和文件页远程搜索面板。
5. 更新 README、future backlog 和相关架构文档。
6. 执行后端默认测试、相关 DB 集成测试、前端测试、前端构建、OpenAPI/router 比对和 `git diff --check`。

## 待决策项

- 是否允许用户保存常用搜索配置。
- 是否在任务列表中展示历史搜索任务。
- 搜索结果保留多久，建议第一版 24 小时。
- 是否允许搜索 symlink 目录，第一版建议不跟随 symlink 目录，避免循环。
