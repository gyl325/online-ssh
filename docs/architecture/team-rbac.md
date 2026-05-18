# 团队空间与 RBAC 设计

## 目标

定义团队空间、成员角色、权限模型和资源归属迁移策略。本文是后续团队化设计参考，不直接修改现有个人版和平台管理员权限实现。

## 当前基线

当前系统是个人版资源模型：

- `users` 是唯一主体。
- 核心资源通过 `user_id` 隔离：host groups、credentials、hosts、terminal sessions、transfer tasks、audit logs、saved commands 等。
- handler 通过 session 取当前用户，service/repository 默认按 `user_id` 查询。
- 凭据密文不会返回前端；host test、terminal、files、transfer 在服务端短时间解密使用。

这个模型稳定且简单。团队版不能直接把现有 `user_id` 语义替换成团队语义，否则容易破坏个人版隔离和现有数据。

## 设计原则

- 个人版端点和个人资源语义保持不变。
- 团队能力走显式 organization scope，不隐式把个人资源共享出去。
- 凭据共享只共享“使用权”，不共享明文。
- 权限检查在 service 层集中处理，repository 只做明确 scope 下的数据查询。
- 审计必须记录 actor、organization、resource 和结果。
- 第一版团队空间不做复杂 ABAC、审批流、临时授权或外部 IdP。

## 数据模型

### organizations

团队空间。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| name | varchar(120) | 团队名称 |
| slug | varchar(120) | 可读标识，团队内唯一 |
| created_by_user_id | uuid | 创建人 |
| status | varchar(20) | active / disabled |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

### organization_members

团队成员。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| organization_id | uuid | 所属团队 |
| user_id | uuid | 成员用户 |
| role | varchar(30) | owner / admin / operator / auditor / viewer |
| status | varchar(20) | active / invited / disabled |
| invited_by_user_id | uuid null | 邀请人 |
| joined_at | timestamptz null | 加入时间 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

约束：

- `(organization_id, user_id)` 唯一。
- 每个 organization 至少保留一个 active owner。

## 角色与权限

第一版建议角色固定写在代码和文档中，不急于做自定义角色表。等角色稳定后再引入 `roles` / `role_permissions` 表。

权限枚举建议：

| 权限 | 说明 |
|---|---|
| `org.manage` | 更新团队信息、禁用团队 |
| `member.manage` | 邀请、禁用、调整成员角色 |
| `host.read` | 查看团队主机 |
| `host.write` | 创建、编辑团队主机和分组 |
| `host.delete` | 删除或归档团队主机 |
| `host.connect` | 使用团队主机打开终端、文件页、传输 |
| `credential.read` | 查看凭据元信息，不含明文 |
| `credential.write` | 创建、编辑、删除团队凭据 |
| `credential.use` | 使用团队凭据建立连接，不可查看明文 |
| `terminal.open` | 打开团队主机终端 |
| `file.read` | 浏览、下载团队主机文件 |
| `file.write` | 上传、写入、删除、重命名、chmod |
| `transfer.read` | 查看团队范围传输任务 |
| `transfer.manage` | 取消、重试、暂停、恢复团队任务 |
| `saved_command.read` | 查看团队常用命令 |
| `saved_command.write` | 管理团队常用命令 |
| `audit.read` | 查看团队审计日志 |
| `audit.export` | 导出团队审计日志 |

角色建议：

| 角色 | 权限 |
|---|---|
| owner | 全部权限，且可转让 owner / 删除团队 |
| admin | 除删除团队、转让 owner 外的管理权限 |
| operator | host read/connect、credential use、terminal/file/transfer 操作、saved command read |
| auditor | audit read/export、transfer read、host read |
| viewer | host read、saved command read |

## 资源归属模型

推荐使用 additive migration，而不是重命名现有 `user_id`：

- 现有 `user_id` 保持个人资源 owner 语义。
- 团队资源新增 `organization_id NULL`。
- `organization_id IS NULL` 表示个人资源，继续由 `user_id` 隔离。
- `organization_id IS NOT NULL` 表示团队资源，`user_id` 表示创建人或最后归属用户，不作为访问控制唯一条件。

第一批需要团队化的 durable 资源：

- `host_groups`
- `credentials`
- `hosts`
- `saved_commands`

运行态和审计资源：

- `terminal_sessions`、`transfer_tasks`、`file_search_tasks`、`audit_export_tasks` 应继续记录 `user_id` 作为 actor，并新增 `organization_id NULL` 表示团队上下文。
- `audit_logs.user_id` 保持 actor 语义，新增 `organization_id NULL`、`resource_scope` 或 `resource_owner` 字段用于团队审计过滤。

## API 边界

现有个人端点保持不变：

- `/api/hosts`
- `/api/credentials`
- `/api/saved-commands`

团队端点使用显式 organization prefix：

- `/api/organizations`
- `/api/organizations/{organizationId}/members`
- `/api/organizations/{organizationId}/hosts`
- `/api/organizations/{organizationId}/credentials`
- `/api/organizations/{organizationId}/saved-commands`
- `/api/organizations/{organizationId}/audit/logs`
- `/api/organizations/{organizationId}/audit/exports`

不建议第一版用 `scope=org` 混在现有个人端点里。显式 prefix 能减少误用，也便于前端清楚区分个人空间和团队空间。

## 资源共享边界

### Hosts

团队 host 可引用同一 organization 下的 credential 和 host group。

规则：

- 创建团队 host 需要 `host.write`。
- 连接团队 host 需要 `host.connect`。
- 如果 host 使用团队 credential，还需要 `credential.use`。
- 个人 host 不能引用团队 credential；团队 host 不能引用个人 credential。

### Credentials

团队 credential 是最高风险资源。

规则：

- `credential.read` 只允许查看名称、类型、是否有 password/private key/passphrase、key version，不返回明文或密文。
- `credential.use` 只允许服务端在 host test / terminal / files / transfer 中短时解密使用。
- `credential.write` 才能创建、更新或删除团队凭据。
- 个人 credential 不允许直接“移动”到团队。必须显式复制，且要求用户重新确认敏感字段或走后端受控复制流程。

第一版建议不提供“把个人凭据一键共享到团队”的操作，避免误共享。

### Saved Commands

团队常用命令可以团队共享，但继续保持“不自动执行”。

规则：

- `saved_command.read` 可查看团队命令。
- `saved_command.write` 可创建、编辑、排序、删除团队命令。
- 高危命令发送到终端仍需二次确认。

### Workspace Layouts

第一版仍保持个人 workspace 为主。

可选增强：

- 团队 workspace template 只保存 layout 和 panel 上下文，不保存终端输出、文件内容或凭据明文。
- 恢复团队 template 时，用户仍必须有对应 organization 资源权限。

### Audit

审计按 actor 和 organization 双维度记录：

- 普通成员默认只能看自己的团队操作日志。
- `auditor` / `admin` / `owner` 可看 organization 范围日志。
- 审计导出同样要求 `audit.export`。

审计事件必须能回答：

- 谁操作的：`actor_user_id`，可沿用当前 `audit_logs.user_id`。
- 在哪个团队：`organization_id`。
- 操作了什么资源：`resource_type` / `resource_id`。
- 结果如何：`result`。

## 个人资源迁移策略

不做自动迁移。

推荐提供显式操作：

1. 创建 organization。
2. 邀请成员。
3. 新建团队凭据，或由有权限用户复制个人凭据到团队。
4. 复制或移动个人 host 到团队。
5. 验证 host test。
6. 根据需要复制 saved commands。

复制与移动区别：

- 复制：个人资源保留，团队资源新建。
- 移动：个人资源变为团队资源，风险更高；第一版建议暂不提供移动。

## 权限检查流程

service 层统一做：

1. 解析 scope：personal 或 organization。
2. personal scope：要求 `resource.user_id == current_user_id`。
3. organization scope：读取 membership，确认 active。
4. 判断 role 是否包含所需 permission。
5. 对资源引用做同 scope 校验。
6. 执行业务操作。
7. 写审计，包含 organization context。

示例：

- 打开团队 host 终端：
  - `host.connect`
  - 如果 host 绑定 credential：`credential.use`
  - 写 `terminal_session_create`，带 `organization_id`
- 下载团队 host 文件：
  - `host.connect`
  - `file.read`
  - 写 transfer task，带 `organization_id`
- 导出团队审计：
  - `audit.export`
  - 导出任务带 `organization_id`

## 最小实施顺序

1. 新增 organization / membership 数据表、model、repository、service、handler。
2. 实现当前用户 organization 列表、创建团队、邀请/禁用成员、调整角色。
3. 增加权限 helper：`RequireOrgPermission(ctx, userID, orgID, permission)`。
4. 先将 host groups / hosts 团队化。
5. 再将 credentials 团队化，只开放 `credential.use`，不暴露明文。
6. 再将 saved commands 团队化。
7. 最后扩展 audit / transfer / terminal / files 的 organization context。

不建议第一步就改所有资源表。先做 organization + hosts，可以验证权限模型和前端空间切换。

## 测试计划

- 单元测试：
  - role 到 permission 映射。
  - owner 不能移除最后一个 owner。
  - disabled member 没有权限。
  - viewer 不能连接 host。
  - operator 可连接 host 但不能管理 credential。
- 数据库集成测试：
  - organization CRUD 和 membership 唯一约束。
  - 团队 host 不能引用个人 credential。
  - 个人 endpoint 看不到团队资源，团队 endpoint 看不到个人资源。
  - 跨 organization 资源引用失败。
- 前端测试：
  - 空团队列表、创建团队、切换个人/团队空间。
  - 不同角色下按钮可见性和错误提示。
  - 无权限 API 返回 403 时展示明确反馈。
- smoke：
  - operator 使用团队 host 打开 terminal。
  - operator 使用团队 host 浏览 files。
  - auditor 导出团队审计。

## 暂不处理

- 自定义角色。
- 资源级单独授权。
- 审批流。
- 外部 SSO / SCIM。
- 凭据明文共享。
- 多团队嵌套。
- 团队级计费与配额。
