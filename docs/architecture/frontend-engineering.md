# Frontend Engineering Boundaries

更新时间：2026-05-13

本文是 `apps/web` 的前端工程边界事实源。它用于后续重构和 review，避免把 route、feature、shared 层职责混在一起。

## 分层原则

| 层级 | 目录 | 职责 |
|---|---|---|
| App shell | `src/app` | 全局布局、路由保持、跨页面 catalog 注入、应用级导航。 |
| Routes | `src/routes` | 页面编排、URL / route 参数、局部状态组合和用户流程入口。 |
| Features | `src/features/*` | 业务 API、领域类型、hooks、展示组件和领域纯逻辑。 |
| Shared API / lib | `src/shared/api`、`src/shared/lib` | HTTP client、日期、下载、通用工具等跨业务能力。 |
| Shared UI | `src/shared/ui` | 无业务依赖的基础展示组件。 |
| Test helpers | `src/test` | provider render、Radix/select helpers、mock 支撑。 |

硬边界：

- `shared/ui` 不依赖 feature、route、业务 store 或文案 key。
- `shared/lib` 不调用业务 API，不读取 route 状态。
- `features/*` 可以依赖 `shared/*`，但不要跨 feature 借用非通用 helper；若两个 feature 都需要，先上移到 `shared/lib`。
- `routes/*` 可以组合 feature hooks 和 shared UI，但不应继续沉淀可复用业务算法。
- AppShell 可以注入跨页面 catalog，但页面必须保留独立渲染 fallback，便于测试和局部复用。

## Route 层边界

Route 文件只负责“页面如何组合”：

- 读取 URL、query、route params。
- 组织 feature hooks、API 调用和 toast / confirm / fingerprint 流程。
- 保留和当前页面强相关的临时 UI 状态。
- 把可测试的纯计算、展示弹窗和可复用状态逐步移到 `features/*`。

高风险 route：

| 文件 | 当前策略 |
|---|---|
| `TerminalPage.tsx` | 已抽 split layout、AI 弹窗、分享弹窗、常用命令弹窗、saved command hooks；主 session / reconnect / workspace snapshot 暂不大拆。 |
| `FilesPage.tsx` | 已抽路径/预览/归档/移动 helper、host context、directory listing hook、文件操作弹窗和远程搜索弹窗；上传下载、远程搜索 API、预览 API、文件操作提交主流程暂不重写。 |
| `AppShell.tsx` | 已抽 `useHostCatalog`，页面复用共享 host catalog；继续改动时优先保持页面 fallback。 |
| `PreferencesContext.tsx` | 已抽 storage、translator 和 context value helper；多 Provider 拆分暂缓。 |

## Feature 层边界

Feature 内可以包含：

- `api.ts`：领域 API client 和请求/响应类型。
- `types.ts`：领域类型。
- `*.test.ts` / `*.test.tsx`：领域测试。
- 展示组件：只负责该领域 UI，不持有 route 级副作用。
- hooks：封装领域状态，但通过参数注入 toast、fingerprint、active tab 等 route 桥接。
- 纯 helper：路径、日期转换、布局计算、状态转移等可独立测试逻辑。

Feature 内不应包含：

- 其它 feature 的私有 API 细节。
- AppShell-only 假设。
- 直接访问 unrelated localStorage key。
- 无法测试的全局副作用。

## Shared API 与工具

当前已收敛的 shared 工具：

- `shared/api/http.ts`：统一 request、query、blob 请求。
- `shared/lib/date.ts`：日期格式化和 datetime-local 转换。
- `shared/lib/download.ts`：浏览器 blob 下载。
- `features/fingerprint/apiResult.ts`：fingerprint conflict result 包装，已被 files / hosts / terminal 复用。

规则：

- 新增 API query 构造优先用 `request({ query })`，保留 `0` 这类有效值。
- Blob 请求优先用 `requestBlob`。
- 日期展示优先用 shared date helper，并明确 invalid / empty fallback。
- 跨 feature 重复第二次出现时，先评估上移到 `shared/lib`。

## Keepalive 与页面副作用

AppShell 会保留访问过的页面，因此隐藏页面必须避免继续无意义轮询。

当前已处理：

- `AuditPage`：隐藏时暂停导出任务初次加载和 3 秒轮询。
- `FilesPage`：隐藏时暂停 document 快捷键和远程搜索轮询；上传下载后台任务轮询保留。
- `HostsPage`：隐藏时暂停 metrics、详情和 connectivity 自动请求。
- `TransfersPage`：隐藏时暂停任务列表自动加载。
- `AdminPage`：隐藏时暂停管理数据初始化加载。

新增隐藏副作用时应接入 `visible` 或等价门禁。手动刷新、用户操作后的 reload 和真实后台任务不要被误停。

## 测试边界

- 纯 helper：写普通 Vitest 单元测试。
- 展示组件：写组件测试，断言角色、文本、事件转发和关键 class 合约。
- Route 页面：覆盖真实用户路径和回归行为，不把所有 feature 细节塞到 route 测试。
- CSS / token：`styles.test.ts` 负责 token 合约和关键视觉规则。
- Radix Select 等 headless 组件：使用 `src/test/selectInput.ts` 这类 helper，不假设原生 select 行为。

## 变更策略

- 每个分支只处理一个小切片。
- 历史大文件新增净行数应尽量为负；如果为了 bugfix 必须新增，也不要新增长期状态或重复 helper。
- 后续继续拆 `TerminalPage` / `FilesPage` 前，优先寻找纯函数、展示组件、hook、API helper 这类可测试边界。
- `terminal/hub.go`、`files/search.go` 这类并发 / cancel 边界在继续拆前，先做只读边界审计。

## Review Checklist

- 新 route 逻辑是否能下沉到 feature helper 或 hook？
- 新 shared UI 是否保持无业务依赖？
- 新 feature helper 是否有单元测试？
- 新 API 是否同步 OpenAPI / 类型 / mock？
- 新页面副作用在 AppShell keepalive 隐藏状态下是否会继续运行？
- 新视觉样式是否遵守 `docs/design-system.md`？
