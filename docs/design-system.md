# Online SSH Design System

更新时间：2026-05-13

本文是前端视觉规范和 shared UI 使用边界的长期事实源，用于后续页面优化、review 和 UI 变更验收。

## 目标

- 让页面视觉收口到同一套 `--ui-*` token、shared UI 组件和密度规则。
- 优先服务个人工作台场景：界面应清晰、紧凑、可反复操作，不做营销式 hero 或装饰性重排。
- 遇到历史大页面时，只做低风险视觉替换和小切片迁移，不借视觉优化重写业务状态。

## Token 分层

全局 token 定义在 `apps/web/src/styles.css`。新增 `var(--ui-*)` 引用必须同时定义 token，并让 `apps/web/src/styles.test.ts` 继续通过。

常用 token 家族：

| 家族 | 用途 |
|---|---|
| `--ui-space-*` | 页面和组件间距，优先替代裸 `0.75rem` / `1rem` 这类重复间距。 |
| `--ui-control-height-*` | 输入框、按钮、筛选项等可点击控件高度。 |
| `--ui-control-icon-*` | 图标按钮尺寸。 |
| `--ui-card-*` | 卡片、面板、密码表单、占位框等 surface 的背景、边框、圆角、阴影。 |
| `--ui-duration-*` / `--ui-ease-*` | 交互过渡节奏。 |
| `--ui-z-*` | Dialog、Popover、Tooltip 等浮层层级。 |
| 语义色 token | `success`、`warning`、`danger`、`info`、`neutral` 状态色和背景。 |

规则：

- 页面级 surface 优先使用 `--ui-card-bg`、`--ui-card-border`、`--ui-card-radius`。
- 表单、按钮、筛选和验证码类控件优先使用 `--ui-control-height-sm/md/lg`。
- 状态色必须用语义 token，不直接写新的 hex / rgba。
- light / dark 主题必须同时考虑；新增 token 不允许只在一个主题中有效。

## Shared UI 组件

`apps/web/src/shared/ui` 是通用展示层，不依赖 route、feature API、业务 store 或具体页面文案。

| 组件 | 推荐用途 |
|---|---|
| `Button` / `IconButton` / `InlineIconButton` | 普通按钮、图标按钮、列表行内工具按钮。 |
| `Badge` | 角色、状态、只读、风险、数量等短标签。 |
| `Card` / `Panel` | 可重复资源卡、页面内面板和低风险 surface。 |
| `Dialog` / `ConfirmDialog` / `DetailDialog` | 弹窗和确认流程。 |
| `FormField` / `TextInput` / `SelectInput` / `AuthCodeField` | 表单标签、说明、错误和输入。 |
| `LoadingState` / `EmptyState` / `InlineNote` | 加载、空态和行内提示。 |
| `Toolbar` / `FilterBar` / `FilterChip` / `SegmentedControl` | 页面工具栏、筛选和模式切换。 |
| `DataTable` / `Pagination` / `ProgressBar` / `StepProgress` | 表格、分页、进度和步骤。 |
| `ToggleRow` / `SensitiveFields` | 开关行和敏感字段展示。 |

迁移原则：

- 低风险页面先迁移 loading、empty、badge、card surface、inline note、toggle 和 icon button。
- `TerminalPage` / `FilesPage` 只在局部边界替换 shared UI，不碰主 session / 文件操作状态。
- 如果页面需要特定布局，可以保留页面 class，但基础形态不重新定义 shared UI 已有能力。

## 页面视觉规则

- 工作台类页面保持信息密度，避免过大的标题、装饰卡片和无功能插画。
- 页面 section 不要嵌套卡片；卡片只用于单个资源项、弹窗内分组或明确 framed 工具。
- 状态标签统一用 `Badge`，不要新增页面私有 `*-badge` 视觉实现；确需布局修饰时只补 class。
- 控件尺寸不写裸 `38px` / `42px` / `44px`，改用 `--ui-control-height-*`。
- 卡片和表单 surface 不写私有 radius / border / background，改用 `--ui-card-*`。
- 图标按钮必须有可访问名称；优先 lucide 图标，不使用 emoji 作为功能图标。
- 文本不得依赖 hover 才可见；长路径、token、密钥、URL 需要换行或 `title` 暴露全文。

## 当前共享 UI 基线

- 已补齐 baseline token、基础组件能力和低风险页面 shared UI 迁移。
- `CredentialsPage` 已迁移 loading/empty/card/inline-note/toggle。
- `TransfersPage`、`AuditPage`、`HostsPage` 已迁移主要 loading overlay。
- `HostsPage` 收藏 toggle 和分组行内按钮已迁移到 shared UI。
- 公开分享页只读标签复用 `Badge`；`UserCenterPage` / 公开分享页低风险 surface 复用 `--ui-card-*`；公开分享页密码控件高度复用 `--ui-control-height-lg`。

## Review Checklist

- 新增 `var(--ui-*)` 引用后，`npm run test -- styles.test.ts` 必须通过。
- 新增状态标签优先检查是否能用 `Badge`。
- 新增 loading / empty / note 优先检查是否能用 `LoadingState`、`EmptyState`、`InlineNote`。
- 新增卡片或 surface 优先检查是否能用 `Card` / `Panel` 或至少引用 `--ui-card-*`。
- 视觉改动涉及路由页面时，运行对应页面测试和 `npm run typecheck`。
