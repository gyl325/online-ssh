## 1. 文档目标

定义第一版在线 SSH 平台的安全模型，包括认证、会话、凭据加密、SSH 主机校验、操作审计与后续扩展边界。

---

## 2. 安全目标

第一版至少需要保证：

1. 用户登录过程安全
2. 浏览器到平台的传输安全
3. 平台到远程主机的连接安全
4. 保存的 SSH 密码与私钥不明文落库
5. 主机身份可校验
6. 用户操作可追踪

---

## 3. 威胁模型（MVP 视角）

重点防范：

1. 平台明文保存 SSH 密码/私钥
2. 中间人伪造远程主机
3. 用户会话被窃取
4. 未授权用户访问其他人的主机与日志
5. 上传/下载与危险文件操作无法追踪

第一版暂不主打：

- 高级零信任接入
- 硬件安全模块强依赖
- 全量会话回放
- 企业级审批流

---

## 4. 认证与会话

### 4.1 用户登录

- 账号密码登录
- 登录密码采用强哈希存储（如 Argon2id 或 bcrypt）
- 禁止明文存储平台用户密码

### 4.2 会话管理

推荐：

- HttpOnly Secure Cookie 为主
- SameSite=Lax 或更严格
- 支持刷新会话
- 支持退出登录后失效

### 4.3 登录日志

记录：

- user_id
- login_result
- client_ip
- user_agent
- occurred_at

---

## 5. 浏览器到平台安全

### 5.1 TLS

- 全站强制 HTTPS
- WebSocket 使用 WSS
- 禁止明文 HTTP 登录与敏感操作

### 5.2 前端敏感数据处理

- SSH 密码输入框不持久缓存
- 私钥输入框避免长时间回显
- 不在 localStorage 中存储明文敏感凭据

---

## 6. 平台到远程主机安全

### 6.1 SSH 通道

- 所有远程连接使用 SSH
- 终端与 SFTP 均基于 SSH 安全通道

### 6.2 host fingerprint

第一版必须支持：

1. 首次连接获取 host key fingerprint
2. 用户确认并保存
3. 后续连接强校验
4. 指纹变化时阻断或至少强提醒

推荐存储：

- host_id
- algorithm
- fingerprint
- first_seen_at
- last_verified_at
- status

---

## 7. 凭据安全

### 7.1 保存范围

第一版允许用户保存：

- SSH 密码
- 私钥内容
- 私钥 passphrase（如有）

### 7.2 存储原则

- 不明文入库
- 使用服务端主密钥加密后保存
- 主密钥不在数据库中
- 解密只发生在建立 SSH 连接前短时间内
- 连接建立完成后尽快释放敏感内容

### 7.3 主密钥来源

建议优先顺序：

1. KMS
2. 部署环境变量 + 安全注入
3. 本地开发环境专用密钥

### 7.4 密钥轮换

当前凭据记录已包含：

- key_version
- encrypted_secret
- encrypted_private_key
- encrypted_passphrase

主密钥轮换应通过版本化 key ring 渐进式重加密，详见 `docs/architecture/credential-key-rotation.md`。

---

## 8. 授权边界

第一版虽不完整落地 RBAC，但必须从数据结构上保证：

- 主机归属用户
- 凭据归属用户
- 审计日志归属用户
- 任务归属用户
- 工作区归属用户

所有 API 查询默认按 user_id 做资源隔离。

团队空间 / RBAC 的后续设计见 `docs/architecture/team-rbac.md`。团队版应使用显式 organization scope，不能隐式共享个人资源。

---

## 9. 审计模型

### 9.1 第一版范围

第一版先做结构化操作审计：

- 登录/登出
- 登录失败、邮箱验证码发送、邮箱验证码校验失败
- 管理员禁用/启用用户、踢出会话、变更角色
- 终端连接/断开
- 文件上传/下载
- 文件删除/重命名/新建目录/权限修改
- 任务暂停/恢复/取消/失败

### 9.2 日志字段建议

- id
- user_id
- event_type
- resource_type
- resource_id
- target_host_id
- target_path
- result
- message
- client_ip
- user_agent
- metadata_json
- occurred_at

### 9.3 后续扩展

为后续支持用户开启“命令审计/输出审计”，建议预留：

- terminal_session_id
- command_text
- output_ref
- audit_level

第一版可以不填，但字段与表结构需要预留扩展空间。

命令审计和输出审计的级别、采集位置、脱敏与保留策略见 `docs/architecture/terminal-audit-levels.md`。

---

## 10. 风险操作控制建议

第一版建议对以下操作增加二次确认：

- 删除文件/文件夹
- 批量上传
- chmod 高风险权限修改
- 替换已存在目标文件

---

## 11. 默认安全策略

1. 默认支持密码认证与私钥认证
2. 默认优先引导密码认证
3. 默认禁止明文导出私钥
4. 默认不记录完整终端输出
5. 默认只做操作审计
6. 默认首次连接要求确认主机指纹

---

## 12. 安全验收标准

1. 平台数据库中不存在明文 SSH 密码与明文私钥
2. 登录、主机连接、文件操作、传输操作均有日志
3. 首次连接会记录 host fingerprint
4. 指纹变化会产生明确阻断或提醒
5. 用户无法通过 API 访问其他用户的主机、任务与日志
6. 敏感数据只通过 HTTPS / WSS / SSH 传输

---

## 13. 本文结论

第一版安全方案应聚焦：**TLS + SSH 双层传输保护、凭据加密存储、主机指纹校验、用户资源隔离、操作审计优先。**
