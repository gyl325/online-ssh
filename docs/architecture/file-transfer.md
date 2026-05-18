## 1. 文档目标

定义第一版文件传输系统的职责、任务模型、状态机、断点续传机制、平台中转策略与错误恢复策略。

---

## 2. 传输范围

第一版支持：

1. 本地 -> 远程 上传
2. 远程 -> 本地 下载
3. 平台中转传输

第一版暂不强做：

- 真正的浏览器本地目录面板
- 远程 -> 远程 直连绕过平台
- 目录级高级同步

---

## 3. 传输原则

1. 传输任务必须持久化
2. 大文件必须可恢复
3. 失败后必须可重试
4. 目标文件必须避免半成品污染
5. 任务状态必须对用户可见
6. 重要动作必须产生日志

---

## 4. 统一任务模型

建议以 `transfer_tasks` 为核心。

### 4.1 核心字段

- id
- user_id
- task_type：`upload` / `download`
- source_type：`local` / `remote` / `platform_tmp`
- target_type：`remote` / `local` / `platform_tmp`
- source_host_id
- target_host_id
- source_path
- target_path
- tmp_path
- file_name
- total_bytes
- transferred_bytes
- chunk_size
- status
- resumable
- retry_count
- error_code
- error_message
- created_at
- started_at
- finished_at

### 4.2 推荐状态枚举

- `pending`
- `uploading_to_platform`
- `queued_for_remote_transfer`
- `transferring`
- `paused`
- `failed`
- `completed`
- `canceled`

---

## 5. 本地上传流程

### 5.1 流程概述

本地上传拆为两阶段：

1. 浏览器 -> 平台暂存区
2. 平台暂存区 -> 远程主机

### 5.2 原因

- 浏览器与远程主机之间不能直接建立 SFTP
- 平台中转便于断点恢复、统一审计、统一限流
- 服务端可以可靠记录偏移与传输状态

### 5.3 上传步骤

1. 用户拖拽文件
2. 前端读取文件元信息
3. 调用 `upload/init` 创建任务
4. 后端返回 task_id、chunk_size、已接收偏移（若存在旧任务）
5. 前端按 chunk 上传
6. 后端写入平台临时文件并记录偏移
7. 当前端完成全部 chunk 后，任务进入 `queued_for_remote_transfer`
8. worker 读取临时文件并通过 SFTP 发送到远程 `.part`
9. 完成后 rename 为目标文件
10. 任务标记 `completed`

---

## 6. 下载流程

### 6.1 流程概述

远程下载也按任务执行：

1. 远程主机 -> 平台临时文件（可选流式输出）
2. 平台 -> 浏览器下载

### 6.2 推荐第一版实现

对第一版，建议优先采用：

- 远程文件先拉到平台临时区
- 平台生成一次性下载入口
- 浏览器触发下载

### 6.3 原因

- 实现更稳定
- 更容易断点控制与审计
- 更容易处理权限、失败重试与下载日志

---

## 7. 断点续传设计

## 7.1 浏览器 -> 平台 续传

需要记录：

- task_id
- file_size
- chunk_size
- received_bytes
- chunk bitmap（可选）
- file hash（可选）

续传时：

1. 前端重新查询任务状态
2. 后端返回已接收偏移
3. 前端从偏移后继续上传

对于严格顺序上传，记录 `received_bytes` 即可。
对于乱序分片上传，则需记录 chunk bitmap。

第一版建议：**顺序上传优先**，降低实现复杂度。

## 7.2 平台 -> 远程 续传

需要记录：

- 远程临时文件路径
- 已确认写入的远程偏移
- 最后更新时间

恢复时：

1. worker 读取任务状态
2. 检查远程 `.part` 文件大小
3. 与数据库中的 `transferred_bytes` 对齐
4. 从一致偏移继续写入

## 7.3 服务重启后的恢复

服务启动时扫描：

- `uploading_to_platform`
- `queued_for_remote_transfer`
- `transferring`
- `paused`

处理策略：

- `uploading_to_platform`：允许前端继续上传
- `queued_for_remote_transfer`：重新入队
- `transferring`：检查远程偏移后恢复或标记待人工恢复
- `paused`：保持暂停

---

## 8. 临时文件与原子提交

### 8.1 平台侧

上传阶段先写入平台临时目录，例如：

```text
/tmp/transfers/{task_id}.uploading
```

### 8.2 远程侧

写入远程目标时先写：

```text
{target}.part
```

完成后：

```text
rename {target}.part -> {target}
```

### 8.3 好处

- 避免用户看到半成品文件
- 方便续传
- 失败时容易识别与清理

---

## 9. 失败与重试策略

### 9.1 可重试错误

- 网络中断
- SSH 会话断开
- 临时超时
- 平台重启

### 9.2 不可自动重试错误

- 权限不足
- 目标目录不存在且无法创建
- 磁盘空间不足
- 用户取消

### 9.3 重试设计

- 用户可手动点击重试
- 后端可对少量网络错误自动重试 1~3 次
- 每次重试必须记录 `retry_count`

---

## 10. 任务控制接口建议

### 10.1 初始化上传

`POST /api/transfers/upload/init`

请求：

- target_host_id
- target_path
- file_name
- file_size

响应：

- task_id
- chunk_size
- resume_offset
- status

### 10.2 上传 chunk

`PATCH /api/transfers/upload/{task_id}/chunk`

头或参数：

- offset
- content-length

响应：

- accepted_bytes
- received_bytes
- next_offset

### 10.3 控制任务

- `POST /api/transfers/{id}/pause`
- `POST /api/transfers/{id}/resume`
- `POST /api/transfers/{id}/cancel`
- `POST /api/transfers/{id}/retry`

### 10.4 查询任务

- `GET /api/transfers`
- `GET /api/transfers/{id}`
- `GET /api/transfers/{id}/content`：下载任务完成后回读平台临时文件

### 10.5 保守文件内容接口

当前已落地保守版文本内容接口：

- `GET /api/files/content`
- `PUT /api/files/content`

约束：

- 仅支持 UTF-8 文本文件
- 文件大小上限 1 MiB
- 保存时采用远端临时文件 + 原子 rename 覆盖

---

## 11. 前端交互要求

1. 文件拖入后立即创建任务项
2. 传输面板显示：文件名、方向、目标主机、进度、速度、状态、错误
3. 失败时可见明确原因
4. 大文件可暂停/恢复
5. 页面刷新后任务列表能恢复
6. 已完成与失败任务可查询历史

---

## 12. 审计事件建议

- `file_upload_start`
- `file_upload_success`
- `file_upload_failed`
- `file_download_start`
- `file_download_success`
- `file_download_failed`
- `transfer_pause`
- `transfer_resume`
- `transfer_cancel`
- `transfer_retry`

每条日志推荐附带：

- user_id
- host_id
- source_path
- target_path
- file_size
- duration_ms
- result
- error_message

---

## 13. 第一版验收标准

1. 上传大文件中断后可继续
2. 服务重启后未完成任务不会直接丢失
3. 下载远程文件流程稳定
4. 远程目标目录中不会留下伪装成正式文件的半成品
5. 用户能在界面看到清晰的任务状态与失败原因
6. 关键传输动作均有审计记录

---

## 14. 本文结论

第一版最稳妥的方案是：**采用平台中转、任务持久化、临时文件 + 原子提交、顺序分片上传优先、偏移恢复优先于复杂乱序并发模型。**
