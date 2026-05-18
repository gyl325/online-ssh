# 凭据与主密钥轮换设计

## 目标

定义 SSH 凭据更新、平台主密钥轮换和批量重加密的安全边界。当前已落地 versioned encryptor、key ring 配置、按 `key_version` 解密和 `credential key-status` CLI。批量 rotate/re-encrypt 仍未落地，应作为独立后续工作实施。

## 当前基线

当前代码事实：

- `credentials` 表包含 `encrypted_secret`、`encrypted_private_key`、`encrypted_passphrase` 和 `key_version INT NOT NULL DEFAULT 1`。
- API 响应中 `key_version` 为字符串，原因是早期 OpenAPI 兼容；内部模型仍是 `int`。
- `credential.AESEncryptor` 继续使用 `sha256(masterKey)` 派生 AES-256-GCM 密钥，`credential.KeyRingEncryptor` 在其上按 version 管理多个 key。
- `CREDENTIAL_MASTER_KEY` 仍兼容为 version 1；`CREDENTIAL_KEY_RING` + `CREDENTIAL_ACTIVE_KEY_VERSION` 可配置多个 version:key 条目和 active version。
- `credential.Service.Create` 会写入 active key version。
- `credential.Service.Update` 更新密码/私钥/passphrase 时，会用 active key version 重新加密敏感字段；私钥凭据因 `key_version` 是行级字段，会同步重写 private key 和 passphrase。
- `host.Service` 在连接测试前按凭据记录的 `key_version` 解密，解密只发生在服务端。
- `cmd/credential key-status` 已能输出 active/configured versions、各 key version 凭据数量、缺失 key 配置和旧 version 记录。

当前限制：

- 批量 rotate/re-encrypt 命令尚未落地；当前只能靠新建/更新凭据逐步写入 active version，或通过后续 CLI 做批量重加密。
- key ring 仍来自环境变量，尚未接入 KMS、动态 reload 或集中密钥管理。
- 没有区分“用户更换 SSH 密码/私钥”和“平台主密钥轮换”。

## 概念边界

### 用户凭据轮换

用户凭据轮换指用户主动替换 SSH 密码、私钥或 passphrase。它改变的是远端 SSH 登录材料。

已有 `PUT /api/credentials/{credentialId}` 可以作为入口，后续只需要增强：

- 更新成功后保留现有 `credential_update` 审计事件。
- 可选地提示用户重新执行 host test。
- 如果凭据被多个 host 引用，前端应展示影响范围。

### 平台主密钥轮换

平台主密钥轮换指替换用于加密数据库中凭据密文的服务端密钥。它不改变用户的 SSH 登录材料，只改变密文使用的加密密钥。

主密钥轮换必须支持：

- 旧密钥和新密钥同时存在的过渡期。
- 新写入使用 active key。
- 旧记录按 `key_version` 解密，再用 active key 重加密。
- 失败可重试，不能让已经轮换的记录变得不可解密。

## 密钥配置设计

当前支持 key ring 配置：

```bash
CREDENTIAL_KEY_RING=1:old-secret,2:new-secret
CREDENTIAL_ACTIVE_KEY_VERSION=2
```

兼容规则：

- 如果只配置 `CREDENTIAL_MASTER_KEY`，等价于 `CREDENTIAL_KEY_RING=1:<CREDENTIAL_MASTER_KEY>` 且 active version 为 `1`。
- 如果配置 `CREDENTIAL_KEY_RING`，必须配置 `CREDENTIAL_ACTIVE_KEY_VERSION`。
- active version 必须存在于 key ring。
- key ring 中的 version 使用正整数，与当前 `credentials.key_version INT` 保持一致。
- 启动时不强制 key ring 包含数据库里所有历史 version，但 `credential key status` 命令必须能检查缺失版本；生产轮换期间必须同时保留旧 key 和新 key。

当前加密器已提供 versioned 入口，核心形态如下：

```go
type VersionedEncryptor interface {
  EncryptWithActiveVersion(plain string) (EncryptedValue, error)
  DecryptWithVersion(cipherText string, keyVersion int) (string, error)
  ActiveKeyVersion() int
  ConfiguredKeyVersions() []int
  IsKeyVersionConfigured(keyVersion int) bool
}
```

现有 `Encryptor` 已保留为适配层，避免一次性修改所有调用点。

## 密文格式

第一版可以继续沿用当前 base64(AES-GCM nonce+ciphertext) 格式，通过 `key_version` 选择解密密钥。

后续如需更强自描述能力，可引入 `v2:<base64>` 前缀或 envelope payload，但不要在第一版强制迁移所有密文格式。

建议第一版保持：

- AES-256-GCM。
- nonce 每次随机生成。
- 加密前继续 trim 用户输入，保持当前行为。
- 不把 user_id、credential_id 写入密文，避免影响现有数据兼容。

## 批量重加密流程

新增运维命令，优先放在后端 CLI：

```bash
go run ./cmd/credential key-status
credential rotate --from 1 --to 2 --batch-size 100 --dry-run
credential rotate --from 1 --to 2 --batch-size 100
```

推荐执行步骤：

1. 备份数据库，并确认当前服务能正常使用旧 key。
2. 部署包含旧 key 和新 key 的 key ring，active version 暂时仍设为旧 key，执行 `key-status`。
3. 将 active version 切到新 key，确认新建/更新凭据写入新 `key_version`。
4. 执行 `rotate --from 1 --to 2 --dry-run`，统计可轮换数量和潜在解密失败。
5. 分批执行真实 rotate。
6. 确认 `key-status` 中旧 version 记录数为 0。
7. 保留旧 key 一个观察窗口，确认 host test / terminal / files / transfer 真实链路正常。
8. 从 key ring 移除旧 key。

### 单条记录处理

每条 credential 在事务内处理：

1. `SELECT ... FOR UPDATE SKIP LOCKED` 取 `key_version = from` 的一批记录。
2. 逐个按当前 `key_version` 解密非空密文字段。
3. 使用目标 version 重加密非空字段。
4. 一次性更新密文字段和 `key_version = to`。
5. 记录成功计数；失败时回滚该记录或整批，并记录失败原因，不写入明文。

处理规则：

- `encrypted_secret`、`encrypted_private_key`、`encrypted_passphrase` 分别处理，空字段保持空。
- 如果任一字段解密失败，该 credential 不更新，继续保留旧 `key_version`。
- 命令可重复运行；已是目标 version 的记录直接跳过。
- 支持 `--limit` 或 `--batch-size`，避免长事务和大范围锁。

## 审计与可观测性

用户级凭据更新继续记录：

- `credential_update`

平台主密钥轮换建议记录运维审计事件：

- `credential_key_rotation_start`
- `credential_key_rotation_batch`
- `credential_key_rotation_failed`
- `credential_key_rotation_complete`

审计 metadata 只允许包含：

- `from_version`
- `to_version`
- `batch_size`
- `success_count`
- `failure_count`
- `skipped_count`

不得写入明文、密文全文、master key、private key、password 或 passphrase。

指标建议：

- 当前各 `key_version` 的 credential 数量。
- 轮换成功/失败数量。
- 解密失败数量。
- 按 version 的连接测试失败趋势。

## 失败恢复

### 部署失败

如果新版本服务启动失败：

- 回滚服务版本。
- 保留数据库不变。
- 不移除旧 key。

### 部分轮换失败

如果 rotate 中途失败：

- 已更新为新 version 的记录继续可用，因为 key ring 同时包含旧 key 和新 key。
- 未更新记录仍使用旧 version。
- 修复问题后重复执行 rotate。

### 新 key 错误

如果新 key 写入后发现无法稳定使用：

- 只要 key ring 中仍有旧 key，可以执行反向 rotate：`--from 2 --to 1`。
- 反向 rotate 成功且新 version 记录数为 0 后，再把 active version 切回旧 key。

### 丢失旧 key

如果旧 key 已移除且还有旧 version 记录：

- 这些记录无法恢复明文。
- 只能从备份恢复旧 key 或让用户重新录入凭据。
- 因此移除旧 key 前必须强制 `key-status` 检查旧 version 数量为 0。

## 实现状态与后续工作

1. 新增 versioned encryptor 和 key ring config，保持 `CREDENTIAL_MASTER_KEY` 兼容。已完成。
2. 修改 credential create/update，使新写入使用 active version。已完成。
3. 修改 host credential 解密路径，按记录 `key_version` 解密。已完成。
4. 增加 `credential key-status` 运维命令。已完成。
5. 增加 `credential rotate` dry-run 和真实执行命令。
6. 增加审计事件和指标。
7. 前端只展示当前 `key_version`，不提供主密钥轮换入口。

## 测试矩阵

- 单元测试：
  - 单 key 兼容旧 `CREDENTIAL_MASTER_KEY`。
  - 多 key ring active version 校验。
  - 使用 version 1 加密、version 2 active 时仍可解密旧记录。
  - 缺失 key version 时返回明确错误。
  - 新建凭据写入 active version。
- 数据库集成测试：
  - rotate dry-run 不修改数据。
  - rotate 后密文字段变化、明文解密一致、`key_version` 更新。
  - 私钥 passphrase 为空时保持空。
  - 中途失败不会把记录更新成不可解密状态。
  - 多批次重复执行具备幂等性。
- 真实链路 smoke：
  - 轮换前后 host test 成功。
  - 使用已轮换凭据打开 terminal 成功。
  - 使用已轮换凭据执行 files list / transfer smoke 成功。

## 暂不处理

- KMS 直接集成。
- 团队级凭据共享与授权。
- 前端发起主密钥轮换。
- 对旧密文格式做强制 envelope 迁移。
- 自动轮换远端 SSH 密码或私钥。
