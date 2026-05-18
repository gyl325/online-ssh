# Online SSH Web

前端采用 `Vite + React + TypeScript + React Router`，并逐步使用 Radix/headless primitives、lucide-react 和项目内 shared UI 组件。

## 运行

```bash
cd apps/web
npm install
npm run dev
```

默认开发地址：

- `http://127.0.0.1:5173`

默认代理：

- `/api` -> `http://127.0.0.1:8080`
- `/ws` -> `ws://127.0.0.1:8080`

如需覆盖目标地址，可在 `apps/web/.env.local` 中配置：

```bash
VITE_API_PROXY_TARGET=http://127.0.0.1:8080
VITE_WS_PROXY_TARGET=ws://127.0.0.1:8080
```

## 测试

```bash
cd apps/web
npm run typecheck
npm run test
npm run build
```

## 当前范围

- 应用壳、受保护路由、登录 / 注册 / 登出、`GET /api/auth/me` 会话恢复
- 邮箱验证码登录/注册、邮箱或用户名密码登录、TOTP 2FA / 恢复码验证、新注册白名单提示和登录失效原因提示
- 统一 API client、cookie 鉴权、Vite dev proxy
- 个人中心：账号信息、当前会话设备/IP/登录方式、语言/主题/终端主题、字号与关键词高亮偏好、修改密码、邮箱换绑、TOTP 2FA 管理和账号删除
- 管理员设置：通用配置、用户、角色、会话、数据库导入导出和用户 2FA 重置
- 凭据管理、密钥生成/上传、主机分组、主机管理、host test、fingerprint 确认、主机连接状态和详情监控
- terminal 标签页、WebSocket、输入输出、resize、keepalive、连接日志、历史记录、只读临时分享、关键词高亮、书签、全屏、常用命令收藏/分类筛选与发送到当前终端输入行
- 文件页远程目录浏览、本地过滤、显式远程搜索面板、结果分页、基础文件操作、上传入口、下载入口、右键菜单、压缩/解压、校验和、只读预览与轻编辑保存
- 传输页任务列表、状态、进度、速度/耗时、当前页历史摘要、失败摘要、时间范围筛选、详情查看与 pause/resume/cancel/retry 控制
- 审计页列表、筛选、分页、详情深链、常用筛选预设与后端异步 CSV 导出任务弹窗
- 文件页和终端页会在本地保存当前上下文，用于刷新后继续工作
- 语言、主题、终端主题、终端字体大小和关键词高亮规则在本地偏好中保存；终端主题、字号和高亮会同步影响当前 terminal、示例终端与历史回放，高亮只作为前端视觉装饰，不修改 SSH 输出。

当前页面边界：

- 文件上传 / 下载功能在文件页，传输页只展示任务列表和详情。
- 当前目录搜索输入框采用前端本地过滤；递归远程搜索必须通过显式远程搜索面板启动，远程结果按后端分页查询。
- 审计详情支持 `/audit/:logId` 深链，列表点击会先用缓存展示，再通过后端详情接口刷新恢复。
- 审计 CSV 导出使用后端异步任务模型；已结束任务可手动删除，pending/running 任务需先取消。
- 旧布局快照保存/管理/恢复入口已移除，当前不再依赖 workspace layout 能力。
