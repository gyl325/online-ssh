# Terminal 刷新重连与后台托管前端对接说明

## 1. 目标

当前 terminal 后端已经从“WebSocket 断开即关闭 SSH”改为“SSH runtime 由后端进程托管，WebSocket 只负责 attach/detach”。

前端需要实现：

- 页面刷新后重新 attach 到已有 terminal session
- 网络短暂断开后自动重连
- 用户关闭终端标签时显式关闭后端 runtime
- 用户可主动开启后台保活

当前不支持：

- 后端进程重启后恢复原 SSH PTY
- 跨实例恢复 terminal runtime
- 远端 `tmux/screen` 自动托管

如果用户需要后端重启后仍恢复 shell，需要用户自己在远端使用 `tmux` 或 `screen`。

---

## 2. 生命周期语义

### 2.1 session 与 runtime

- `terminal_session` 是数据库记录。
- `runtime` 是后端进程内的 SSH client + SSH session + PTY + shell。
- WebSocket 是浏览器对 runtime 的一次 attach。

当前语义：

- 创建 session：`POST /api/terminal/sessions`
- 建立 WebSocket：`GET /ws/terminal?session_id=...&attach_token=...`
- WebSocket 刷新 / 断网关闭：runtime 进入 detached，不立即关闭 SSH
- 使用同一个 `session_id` 和后端返回的短生命周期 `attach_token` 再连 WebSocket：重新 attach 到同一个 runtime
- 用户点击“关闭终端”：调用 close API，真正关闭 SSH runtime

### 2.2 detached TTL

默认策略：

- WebSocket detach 后，后端托管 runtime 1 小时。
- 超过 1 小时没有重新 attach，后端关闭 SSH runtime。
- 用户主动启用 keepalive 后，会延长托管有效期。
- 当前实现的主动 keepalive 窗口默认 24 小时，可通过 `TERMINAL_KEEP_ALIVE_HOURS` 配置。

注意：

- 这个 TTL 是后端进程内状态。
- 后端服务重启后，runtime 会丢失，已 connected 的旧 session 不能继续 attach。
- 当前用户级和全局 terminal runtime 托管上限默认都是 16，分别可通过 `TERMINAL_MAX_SESSIONS_PER_USER`、`TERMINAL_MAX_SESSIONS_TOTAL` 配置。

---

## 3. HTTP 接口

### 3.1 创建 terminal session

```http
POST /api/terminal/sessions
Content-Type: application/json

{
  "host_id": "uuid",
  "rows": 36,
  "cols": 120
}
```

成功返回：

```json
{
  "session": {
    "id": "uuid",
    "host_id": "uuid",
    "status": "connecting",
    "started_at": "2026-04-11T10:00:00Z",
    "ended_at": null
  },
  "websocket": {
    "url": "ws://localhost:8080/ws/terminal?session_id=uuid&rows=36&cols=120&attach_token=token",
    "protocol": "terminal.v1",
    "token": "token"
  }
}
```

前端应保存：

- `session.id`
- `host_id`
- `rows`
- `cols`
- 标签页标题 / 本地 UI 状态

建议保存在前端状态里，并同步到 `localStorage` 或 workspace layout，便于刷新恢复。

如果返回 `429 TERMINAL_SESSION_LIMIT_EXCEEDED`，说明当前用户级或全局后端托管 runtime 已达到上限，前端应提示用户关闭已有终端或等待 detached runtime 过期。

### 3.2 查询 terminal session

```http
GET /api/terminal/sessions/{sessionId}
```

如果该 runtime 仍在当前后端进程中，返回会附带 runtime 状态：

```json
{
  "session": {
    "id": "uuid",
    "host_id": "uuid",
    "status": "connected",
    "started_at": "2026-04-11T10:00:00Z",
    "ended_at": null,
    "attached": false,
    "detached_at": "2026-04-11T10:10:00Z",
    "expires_at": "2026-04-11T11:10:00Z",
    "keep_alive_until": null
  }
}
```

字段说明：

- `status`：DB 中的 terminal session 状态，仍为 `connecting / connected / disconnected / failed`
- `attached`：当前 runtime 是否有活跃 WebSocket
- `detached_at`：最近一次前端 detach 时间
- `expires_at`：后端预计自动关闭 runtime 的时间
- `keep_alive_until`：主动保活到期时间

如果后端进程重启过，可能只能查到 DB 状态，没有 `attached/detached_at/expires_at`。

### 3.3 列出当前可恢复 terminal session

```http
GET /api/terminal/sessions
```

返回当前登录用户在当前后端进程内仍被托管、可以重新 attach 的 runtime：

```json
{
  "items": [
    {
      "id": "uuid",
      "host_id": "uuid",
      "status": "connected",
      "started_at": "2026-04-11T10:00:00Z",
      "ended_at": null,
      "attached": false,
      "detached_at": "2026-04-11T10:10:00Z",
      "expires_at": "2026-04-11T11:10:00Z",
      "keep_alive_until": null
    }
  ]
}
```

前端刷新恢复时可以优先用这个接口拿“后端仍然可恢复”的 session；本地 layout 里存在但这个接口没有返回的 session，应按不可恢复处理并提示用户重开。

### 3.4 开启或关闭后台保活

```http
POST /api/terminal/sessions/{sessionId}/keepalive
Content-Type: application/json

{
  "enabled": true
}
```

关闭保活：

```json
{
  "enabled": false
}
```

前端建议：

- 做成“后台保活”开关
- 开启后显示 `keep_alive_until`
- 关闭后恢复默认 detached TTL
- 如果返回 `409 TERMINAL_SESSION_INVALID_STATE`，说明当前服务进程里已经没有可托管的 runtime

### 3.5 显式关闭 terminal

```http
POST /api/terminal/sessions/{sessionId}/close
```

前端必须区分：

- 页面刷新 / 网络断开：不要调用 close
- 用户点击关闭标签 / 关闭终端按钮：必须调用 close

关闭成功后：

- 后端关闭 SSH session / PTY / SSH client
- DB session 进入 `disconnected`
- 该 `session_id` 不能再 attach

---

## 4. WebSocket 协议

连接：

```text
GET /ws/terminal?session_id={sessionId}&rows=36&cols=120&attach_token={attachToken}
Sec-WebSocket-Protocol: terminal.v1
Cookie: online_ssh_session=...
```

鉴权：

- 使用登录 session cookie + 短生命周期 attach token
- 主终端在 session cookie 和 attach token 校验通过后，兼容 Host 重写反代导致的 Origin 不匹配；无 `Origin` 的非浏览器客户端允许连接
- 公开分享 `/ws/terminal/share` 使用 viewer token；viewer token 校验通过后同样兼容 Host 重写反代导致的 Origin 不匹配
- 前端通过同域代理时，浏览器会自动带 cookie
- 如果跨域开发，需要确保 HTTP 与 WebSocket 都能带 cookie；当前后端没有 CORS 中间件，建议优先走 dev proxy

### 4.1 服务端事件

连接成功后会收到文本 JSON：

```json
{
  "type": "ready",
  "session_id": "uuid",
  "host_id": "uuid",
  "status": "connected",
  "protocol": "terminal.v1",
  "attached": true,
  "detached_at": null,
  "expires_at": null,
  "keep_alive_until": null,
  "fingerprint": {
    "algorithm": "ssh-ed25519",
    "fingerprint": "SHA256:...",
    "status": "trusted"
  }
}
```

服务端输出：

- 终端 stdout / stderr 仍然走二进制帧。
- 前端应把二进制帧内容直接写入 xterm.js。
- 重新 attach 时，后端会先 replay 最近的输出 ring buffer，再继续推送新输出。

其他文本事件：

```json
{"type":"pong","session_id":"uuid"}
```

```json
{"type":"error","code":"TERMINAL_RUNTIME_FAILED","message":"..."}
```

```json
{
  "type": "exit",
  "status": "disconnected",
  "message": "websocket client detached",
  "runtime_closed": false
}
```

`runtime_closed` 语义：

- `false`：只是当前 WebSocket detach，SSH runtime 仍在后端托管
- `true`：SSH runtime 已结束，不能继续 attach

### 4.2 客户端消息

输入：

```json
{"type":"input","data":"ls -la\n"}
```

resize：

```json
{"type":"resize","rows":36,"cols":120}
```

应用层 ping：

```json
{"type":"ping"}
```

说明：

- 当前后端也会主动发送 WebSocket ping frame，前端 WebSocket 实现通常会自动响应 pong。
- 如果前端使用封装库，需要确认不会屏蔽浏览器原生 pong 行为。

---

## 5. 前端推荐实现流程

### 5.1 新建终端

1. 用户点击主机“连接终端”
2. 调 `POST /api/terminal/sessions`
3. 保存 `session.id`
4. 建立 WebSocket
5. 收到 `ready` 后把标签状态设为 connected

### 5.2 页面刷新恢复

1. 前端启动时调用 `GET /api/terminal/sessions` 获取当前后端进程内可恢复 session
2. 同时读取 `localStorage` 或 workspace layout 中已打开 terminal 标签
3. 对仍在可恢复列表里的 session，按 `attached=false` 优先重新建立 WebSocket
4. 对本地存在但可恢复列表没有返回的 session，标记为“会话不可恢复”，必要时再用 `GET /api/terminal/sessions/{sessionId}` 查询历史状态
5. WebSocket 连接成功后继续正常交互

### 5.3 网络断开自动重连

建议策略：

- WebSocket 非用户主动关闭时，进入 reconnecting 状态
- 指数退避重连，例如 1s、2s、5s、10s
- 每次重连仍使用同一个 `session_id`
- 如果重连返回 `409 TERMINAL_SESSION_INVALID_STATE`，说明 runtime 已结束或不在当前进程，停止重连并提示用户重新创建终端

### 5.4 用户关闭标签

1. 前端先调用 `POST /api/terminal/sessions/{sessionId}/close`
2. 再关闭本地 WebSocket
3. 从本地打开 session 列表中移除该 session

不要只关闭 WebSocket，否则后端会认为这是 detach，并继续托管 SSH runtime。

### 5.5 用户选择后台保活

建议 UI：

- 标签页右键菜单或工具栏按钮：“后台保活”
- 开启后显示到期时间
- 关闭后回到默认 1 小时 detached TTL

流程：

1. 调 `POST /api/terminal/sessions/{sessionId}/keepalive`，`enabled=true`
2. 把返回的 `keep_alive_until` 展示在 UI
3. 用户关闭页面或刷新时，不调用 close
4. 用户回来后用同一个 `session_id` 重新 attach

---

## 6. 当前限制与后续可增强项

当前限制：

- 后端进程重启后 runtime 丢失
- 输出 replay 只是内存 ring buffer，不是完整终端录像
- 当前同一 session 多个 WebSocket 同时连接时，新连接会接管旧连接
- 当前保活时长和托管上限只支持服务端 env 配置，不提供运行时 API 修改
- 超过用户级或全局托管上限时，新建 WebSocket runtime 会返回 `429 TERMINAL_SESSION_LIMIT_EXCEEDED`

后续可增强：

- 增加前端“恢复上次工作区”能力
- 如果未来需要后端重启恢复，再评估远端 `tmux/screen` 集成或 agent 方案
