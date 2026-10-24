# VPM P9-A 安全硬化报告

> 2026-10-23。范围：`docs/prompts/tasks/P9-A.md`（I4/I5/I6/I7）。
> 只做安全复核、攻击用例与必要修复；没有新功能、没有 schema 迁移、没有改产品行为。

## 1. 结论

- **I4（不永久删用户文件）/ I5（不手写 .meta）/ I7（核心库 schema 不变）通过。**
- **I6（缓存不在 C）是已接受例外**：用户 2026-10-23 明确接受 R19，
  数据根/cache/vault/backups 固定在 `%APPDATA%\Atrium`。本报告不把它记成“安全通过”。
- 发现并修复 1 个真实问题：**陈旧 `Temp/UnityLockfile` 原来直接 `rmSync`**；
  改为同目录改名为 `UnityLockfile.atrium-stale-<timestamp>`，不再永久删工程文件。
- 新增 `tests/vpm/security/` 4 个文件 19 条攻击/静态用例；`launch.spec` 新增 1 条锁文件处置用例。
  没有降低任何已有校验。

## 2. 攻击面矩阵

| 面 | 防线 | 证据 | 状态 |
|---|---|---|---|
| 网络出口 | 只有 `main/vpm/http/` 可以发请求；HTTP 端口 fail closed | `tests/vpm/security/static.spec.ts`、`tests/vpm/http/client.spec.ts`、`tests/vpm/architecture.spec.ts` | 通过 |
| HTTPS/重定向/超时/大小/证书 | 只允许 HTTPS；逐跳校验；跨源自定义头停止；证书校验始终开启 | `tests/vpm/http/client.spec.ts`、`electron.spec.ts`、静态 TLS bypass 扫描 | 通过 |
| 请求头/token | safeStorage 加密；不可用拒绝存储；只回显头名；日志 `redactHeaders` | `tests/vpm/secrets/store.spec.ts`、`tests/vpm/log/diagnostics.spec.ts` | 通过 |
| ZIP slip/绝对/盘符/UNC/ADS/保留名/尾点/大小写/长路径 | 逐条目校验，目标根 realpath 二次确认 | `tests/vpm/install/archive.spec.ts`、`tests/vpm/security/archive-attacks.spec.ts` | 通过 |
| ZIP 符号链接/加密/未知压缩/炸弹 | 拒绝 symlink/特殊类型、encrypted、非 store/deflate；条目/单条/总量/压缩比/zip 大小五维 | `archive-attacks.spec.ts`、`archive.spec.ts` | 通过 |
| 工程/数据根路径 | 数据根非 C 或 R19 接受例外；工程 realpath + 根内校验；长路径/UNC 拒绝 | `data-root.spec.ts`、`projects/reader.spec.ts`、`archive.spec.ts` | 通过（C 根例外） |
| 受保护包 `com.avca.bridge` | 解析器/计划/事务/legacy 全链路排除 | `tests/vpm/security/protected-and-templates.spec.ts`、resolver/transaction 用例 | 通过 |
| Unity/导入进行中 | 活动闸门拒绝包事务/备份/迁移/换版本；恢复不写 | `tests/project/activity.spec.ts`、`tests/vpm/install/activity-gate.spec.ts`、`recovery.spec.ts` | 通过 |
| 永久删除用户文件 | 旧包/旧资源进事务区/vault；清理走回收站；静态删除白名单 | `static.spec.ts`、`vault/store.spec.ts`、事务失败注入 | 通过（见 §4） |
| 手写 `.meta` | 只搬包内原 `asset.meta`；不生成/不改写；静态扫描 | `static.spec.ts`、`unitypackage.spec.ts` | 通过 |
| 缓存落 C | R19 固定 `%APPDATA%\Atrium` | `docs/VPM-GAPS.md` GAP-02、README/DEVELOPMENT | **接受例外** |
| 联网关闭/安全模式 | 关闭时 HTTP 不建立连接；安全模式不加载 VPM | `http/client.spec.ts`、`gate.spec.ts` | 通过 |
| 深链凭据 | headers/token/authorization/password/secret/cookie 整条拒绝 | `tests/vpm/security/deeplink.spec.ts`、`interop/deeplink.spec.ts` | 通过 |
| 模板路径 | id/base/附件路径白名单；base 循环拒绝；删除只隐藏 | `protected-and-templates.spec.ts`、`templates/service.spec.ts` | 通过 |
| 启动绑定/目标 | 先绑定再 spawn；失败/关闭/移除清理；不跨重启持久化 | `launch.spec.ts`、`launch-target.spec.ts`、核心 connections 测试 | 通过 |
| 手动恢复 IPC | 只接受 `operationId`；动作/路径由主进程按 journal+磁盘判定；正在跑的操作拒绝；证据不足不动文件 | `tests/vpm/ipc/install.spec.ts`、`reliability/manual-recovery.spec.ts` | 通过（P9-B） |

## 3. 静态闸门

`tests/vpm/security/static.spec.ts` 6 条：

1. `src/main/vpm` 里除 `http/` 外没有 `fetch`、`net.request`、`node:http(s)`、`http://` 字面量；
2. 渲染层 VPM 没有直连网络；
3. 没有 `rejectUnauthorized:false`、`ignore-certificate`、`NODE_TLS_REJECT_UNAUTHORIZED`；
4. 删除调用只出现在白名单文件（缓存/临时/事务/vault/更新/日志/回收站回退）；
5. 陈旧锁文件只 rename 成 `.atrium-stale-*`，不删；
6. 没有代码生成/改写 `.meta`；只有 legacy/unitypackage 原样搬包内 meta。

> 删除白名单是“新增删除必须先过安全评审”的闸门，不是“所有删除都安全”的证明；
> 语义由 vault/事务/回收站测试继续兜底。

## 4. 发现与修复

### 4.1 陈旧 UnityLockfile 被永久删除（已修）

- **原实现**：`Temp/UnityLockfile` 存在且能删就 `fs.rmSync(lockfile)`。
- **风险**：它是工程里的文件；虽然只是锁文件，但违反“不永久删用户文件”的底线。
- **修复**：同目录改名为 `UnityLockfile.atrium-stale-<timestamp>`，然后启动 Unity；
  改名失败（被真正运行中的 Unity 持有）则按 alreadyRunning 处理并清绑定。
- **证据**：`tests/vpm/unity/launch.spec.ts` 新增用例断言旧文件仍以新名字存在、内容不变。

### 4.2 没有其它需要改代码的发现

- ZIP、路径、HTTP、密钥、深链、模板、受保护包、活动闸门在本轮攻击矩阵下均按预期拒绝。
- 没有发现 token/请求头进入日志、诊断或错误详情。
- 没有发现新增的网络出口或 TLS 绕过。

## 5. 接受例外与未验证

### 接受例外

- **I6/R19**：缓存/回滚仓/备份在 `%APPDATA%\Atrium`（C 盘），用户明确接受，不再改。
- **回收站不可用时的 copy+delete 回退**：先把整个工程复制到
  `<dataRoot>/trash/<时间戳>-<名>`，复制成功后才移除源；复制抛错时不会走到移除。
  这是“移动”而非直接删，且源仍可从 Atrium 回收站恢复。
- **`.meta` 原样搬移**：legacy 清理与 unitypackage 导入只搬包内已有 meta，
  不生成/不改写；静态白名单只允许这两个文件做 meta rename/copy。

### 未验证

- 真实 Unity 打开/导入/迁移/安装后的终态仍归 P9-D；本轮不启动 Unity。
- 真实 VCC/ALCOM 设置读取、真实安装器/更新器仍归 P9-D/P9-E。
- 操作系统级 ACL/UNC/只读盘/杀毒软件占用、极端 zip bomb、TOCTOU 竞态没有专项压测。
- 真实屏幕阅读器/DPI 与 P8-E 记录一致，不重复。

## 6. 证据与复现

```bash
npm run native:node
npx vitest run tests/vpm/security tests/vpm/unity/launch.spec.ts
npm run typecheck
npm test
npm run build
```

本轮定向：安全 4 个文件 19 条 + launch 16 条全绿；
全量 **230 files / 2790 passed / 22 skipped**，`npm run build` 0（含安装包）。

## 7. 给 P9-B

- 继续保留 `static.spec.ts` 的删除/网络/.meta 白名单；新增删除点先过它。
- 失效注入/崩溃恢复/并发仍按 P4-D、P8-B 的现有矩阵跑；不要为了通过率降低校验。
- I6 的 C 根是产品例外，不要把它“修”回非 C；如果产品改主意，先改 GAP-02/README。
