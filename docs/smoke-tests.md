# SSH/SFTP 冒烟测试

本文档定义真实 SSH/SFTP 链路的手动冒烟测试。它不属于默认 CI 质量门禁，因为它依赖可访问的后端、测试数据库状态和真实 SSH 目标。

## 覆盖范围

`backend-skeleton/server/cmd/smoke` 会按顺序执行：

1. `GET /healthz`
2. 注册或登录 smoke 用户
3. 创建密码凭据
4. 创建主机
5. 执行真实 SSH `host test`
6. 如遇首次 fingerprint 阻断，确认 fingerprint 后重试
7. 使用 SFTP 列出远程目录
8. 创建 terminal session，attach WebSocket，发送固定命令并验证 shell 输出
9. 可选：在远程目录下创建独立测试目录，验证 `mkdir`、目录列表、`touch`、文本写入/读取、`chmod`、`rename`、搜索、download transfer、upload transfer、文件删除和目录删除
10. 清理本次创建的 host 和 credential

第 9 步默认关闭，只有设置 `ONLINE_SSH_SMOKE_RUN_WRITE=1` 才会执行。

## 环境变量

必填变量：

```bash
SERVER_HOST=127.0.0.1
SERVER_PORT=22
SERVER_USERNAME=deploy
SERVER_PASSWORD=replace-with-test-password
```

后端访问变量：

```bash
ONLINE_SSH_SMOKE_BASE_URL=http://127.0.0.1:8080
```

smoke 用户变量：

```bash
ONLINE_SSH_SMOKE_EMAIL=online-ssh-smoke@example.local
ONLINE_SSH_SMOKE_PASSWORD=OnlineSshSmoke123!
```

如果后端允许注册，脚本会自动注册该用户；如果注册已关闭，该用户必须已经存在且密码匹配。

远程目录变量：

```bash
ONLINE_SSH_SMOKE_REMOTE_DIR=/tmp
ONLINE_SSH_SMOKE_RUN_WRITE=0
```

`ONLINE_SSH_SMOKE_REMOTE_DIR` 必须是测试账号可读取的目录；当开启写流程时，它还必须可写。写流程会在该目录下创建 `online-ssh-smoke-*` 子目录，并在成功时删除子目录。

Terminal WebSocket 变量：

```bash
ONLINE_SSH_SMOKE_TERMINAL_COMMAND=
ONLINE_SSH_SMOKE_TERMINAL_EXPECT=
ONLINE_SSH_SMOKE_TERMINAL_TIMEOUT_SECONDS=20
```

默认不需要设置这些变量。脚本会生成唯一 token，并通过 `printf '<token>\n'` 验证 WebSocket shell IO。如果覆盖 `ONLINE_SSH_SMOKE_TERMINAL_COMMAND`，建议同时设置 `ONLINE_SSH_SMOKE_TERMINAL_EXPECT` 为输出中必须出现的文本。

## 本地运行

先启动后端并确保数据库已经初始化：

```bash
cd backend-skeleton/server
go run ./cmd/app
```

另开终端运行：

```bash
cd backend-skeleton/server
go run ./cmd/smoke
```

如果在已有开发库上运行，并且该库创建于 auth refresh、远程搜索任务或审计导出任务落地之前，需要先执行 `go run ./cmd/migrate up`。当前迁移命令会维护 `schema_migrations` 版本表；对于还没有版本表的历史库，会先 baseline 已存在的 000001-000004 历史迁移，再只应用缺失迁移。可用 `go run ./cmd/migrate status` 查看 applied / pending 状态。

如需覆盖后端地址；Docker compose 默认也暴露同一个本地端口：

```bash
ONLINE_SSH_SMOKE_BASE_URL=http://127.0.0.1:8080 go run ./cmd/smoke
```

Docker 空库第一次启动时，必须先打开 Web UI 完成 setup wizard 并创建首个管理员。如果生产部署设置了 `BOOTSTRAP_SETUP_TOKEN`，wizard 会要求输入该初始化令牌。当前 smoke tool 不会自动 bootstrap 首个管理员；如果以后扩展了该能力，再更新这里的前置条件。

开启远程写入验证：

```bash
ONLINE_SSH_SMOKE_RUN_WRITE=1 go run ./cmd/smoke
```

## GitLab 手动触发

`.gitlab-ci.yml` 提供 `ssh_sftp_smoke_tests` 手动 job。启用条件：

- 设置 CI 变量 `ONLINE_SSH_RUN_SMOKE_TESTS=1`
- 设置 `ONLINE_SSH_SMOKE_BASE_URL`
- 设置 `SERVER_HOST`、`SERVER_PORT`、`SERVER_USERNAME`、`SERVER_PASSWORD`
- 如果注册关闭，设置已存在的 `ONLINE_SSH_SMOKE_EMAIL`、`ONLINE_SSH_SMOKE_PASSWORD`

该 job `allow_failure: true`，用于真实环境验收，不阻塞默认分支部署。

## 注意事项

- 不要把生产 SSH 密码作为 smoke 目标长期复用；建议准备专门的低权限测试账号。
- 默认只读流程不会写远程文件，但会在平台数据库中临时创建 host 和 credential，结束时会调用清理接口。
- Terminal WebSocket 流程会启动一个真实远程 shell，发送一条可配置命令，验证输出后关闭 session。
- 写流程会在远程目录创建并删除 `online-ssh-smoke-*` 子目录，子目录内会短暂包含 `source.txt`、`renamed.txt` 和 `uploaded.txt`。
- 如果 smoke 运行中断，可能遗留本次创建的 host、credential 或远程临时文件，需要手动清理。
