# P4-C 交接文档（单包安装事务、manifest 最后写与 vault）

> 写于 **2026-10-22 15:40**。读者：接手 P4-D 的下一个工作站 Agent。
>
> 分支 `codex/vpm-p4c-transaction`。本卡是 P4 的核心 go/no-go：
> **manifest 是最后一步原子写**，这一条决定整个 P4 是不是 go。

---

## 0. 一页结论（先读这段）

**P4-C 已完成。下一个工作站可以直接开 P4-D。**

| 项 | 状态 |
|---|---|
| 代码实现 | ✅ 12 个新文件（含 3 个测试与 2 个 README）+ 8 个改动文件 |
| 全量测试 | ✅ `2420 passed / 1 failed / 19 skipped (2440)`；唯一红的是无关 perf 噪声，见 §5.1 |
| 定向测试 | ✅ `tests/vpm/install` + `tests/vpm/vault` + `manifest.spec` = **5 files / 63 tests** |
| 类型检查 | ✅ `tsc --noEmit` exit 0，两个 project 都干净 |
| 三语文案 | ✅ zh-CN / en / ja 各 +11 错误码 +3 警告码 |
| 组合根接线 | ✅ `vpm/index.ts` 已注入 `VaultStore` + `InstallTransactionService` |
| 模块 README | ✅ `install/README.md` 重写；新增 `vault/README.md` |
| 任务板状态 | ✅ `docs/VPM-TASKS.md` 里 P4-C 已是 `done`，§12 有交接记录 |
| **未验证** | ❌ **没有在真 Unity 沙盒里装过包**（详见 §5） |

**下一步：`git checkout -b codex/vpm-p4d-failure-recovery` 开 P4-D。**

---

## 1. 现场精确状态

### 1.1 Git

```
分支：codex/vpm-p4c-transaction（从 main 62e69ef 切出）
上一张卡：P4-B（已在 main 上，HEAD 62e69ef）
```

### 1.2 新增文件

| 文件 | 作用 |
|---|---|
| `src/main/vpm/fsUtil.ts` | 共享 fs 原语：原子写、rename 退避重试、树复制+摘要、占用统计 |
| `src/main/vpm/vault/types.ts` | 回滚仓对外类型 |
| `src/main/vpm/vault/store.ts` | `VaultStore`：归档/校验/用量 |
| `src/main/vpm/vault/index.ts` | 模块公开面 |
| `src/main/vpm/vault/README.md` | 模块合同 |
| `src/main/vpm/install/preflight.ts` | 预检拒绝矩阵（纯函数）+ 只读事实采集 |
| `src/main/vpm/install/legacy.ts` | 旧 Assets 路径级清理 + 保护端口 |
| `src/main/vpm/install/transaction.ts` | 安装事务编排、回滚、提交点 |
| `src/shared/vpm/domain/manifest.ts` | `buildManifest` 纯函数（未知字段/locked 规则） |
| `tests/vpm/install/transaction.spec.ts` | 29 条事务用例 |
| `tests/vpm/vault/store.spec.ts` | 7 条回滚仓用例 |
| `tests/vpm/domain/manifest.spec.ts` | 6 条 manifest 纯逻辑用例 |

### 1.3 改动文件

| 文件 | 变化 |
|---|---|
| `src/main/vpm/install/journal.ts` | 新增 `transactionLayout()` / `ensureTransactionLayout()`（`.atrium-tx/<op>` 的唯一路径来源） |
| `src/main/vpm/install/index.ts` | 导出新服务/类型/常量 |
| `src/main/vpm/planService.ts` | 新增 `get(planId)`；`explain` 复用它 |
| `src/main/vpm/index.ts` | 组合根注入 vault/transactions/activity/legacyGuard |
| `src/shared/vpm/errors.ts` | +11 错误码、+3 警告码 |
| `src/renderer/i18n/{zh-CN,en,ja}.json` | 各 +11 errors、+3 warnings |
| `src/main/vpm/install/README.md` | 重写为 P4-A/B/C 三块合同 |
| `docs/VPM-TASKS.md` | P4-C 标 done + §12 交接段 |

---

## 2. 事务到底怎么走

```text
apply({ projectKey, planId })
  ├─ plans.get(planId)                 只从主进程缓存取；过期/不存在 → vpmPlanExpired/NotFound
  ├─ projects.load(projectKey)         现读工程快照（不信任何缓存 manifest）
  ├─ operations.create(planned)        同工程唯一；写 journal.json
  ├─ transition(preflight)
  │    collectPreflightFacts → evaluatePreflight
  │    失败 → transition(failed, code)，工程一个字节都没动
  ├─ transition(applying)
  │    1 prepare    校验 manifest hash == plan.manifestHashBefore
  │                 → 复制 manifest.original.json
  │    2 download   每个 download → packageCache.ensurePackage（只消费 path/sha256/size）
  │    3 extract    → .atrium-tx/<op>/install/<name>，expected 精确匹配 name+version
  │    4 move-out   Packages/<id> → trash/packages/<id>（同卷 rename，5 次退避重试）
  │    5 move-in    install/<id> → Packages/<id>（目标已存在 → vpmProjectChanged）
  │    6 manifest   提交前再比一次 hash → 写 vpm-manifest.new.json（fsync）
  │                 → 校验写入 hash → setManifestHashes → rename 覆盖 = **提交点**
  │                 → markCommitPoint（3 次重试）
  │    7 legacy     路径级清理旧 Assets（失败只 warning）
  │    8 vault      trash → vault，逐文件校验后才删 trash
  │    9 cleanup    只清自己的 install 区；journal 与 manifest 副本保留
  └─ transition(committed)
```

### 2.1 失败分支（这是 P4-D 要接的地方）

| 失败位置 | 处理 | 工程状态 |
|---|---|---|
| preflight | `failed` | 未改动 |
| prepare / download / extract | `failed` | 未改动（事务区留现场） |
| move-out / move-in | 反向恢复 → `rolled_back` | 恢复原状 |
| manifest 写临时文件/校验 | 反向恢复 → `rolled_back` | 恢复原状 |
| manifest rename 之后（含 markCommitPoint 失败） | `needs_attention` | 已是新状态，**不回滚** |
| 回滚本身失败 | `needs_attention` + `vpmRollbackFailed` | 现场保留，不删 |
| legacy 清理 | 只 warning，仍 `committed` | 包已装好，旧文件还在 |
| vault 归档 | 只 warning + `vault_pending=1`，仍 `committed` | 工程可用，trash 保留 |

### 2.2 提交点窗口（**给 P4-D 的第一件事**）

`rename` 成功到 `markCommitPoint` 之间有一个极短窗口：manifest 已经是新的，
但 journal 还写着 `before`。当前实现是 `markCommitPoint` 重试 3 次；3 次都失败就
`needs_attention`（`vpmJournalWriteFailed`），**不会假装回滚**。

如果进程在这个窗口里崩溃，恢复扫描会看到 `commitPoint=before` 而判 `rollback` —— 那会把
一个已经提交成功的工程往旧状态推。**P4-D 必须先补一条判据**：

```text
磁盘 Packages/vpm-manifest.json 的 hash == journal.manifest.afterHash
  → 即使 commitPoint 还是 before，也判 complete（不是 rollback）
```

`manifest.afterHash` 在 rename **之前**就已经写进 journal（`setManifestHashes`），
证据是齐的，只差恢复侧读它。

---

## 3. 预检拒绝矩阵（完整表）

| 条件 | 错误码 |
|---|---|
| planId 过期/不存在 | `vpmPlanExpired` / `vpmPlanNotFound` |
| 计划 hash 或工程键与缓存不一致 | `vpmPlanChanged` |
| 计划 blocked / 有冲突 / 缺依赖 | `vpmPlanBlocked` |
| manifest 不存在或不可解析 | `vpmManifestInvalid` |
| manifest hash 与计划 before 不一致 | `vpmProjectChanged` |
| Unity 正在运行该工程 | `vpmUnityRunning` |
| 素材正在导入该工程 | `vpmProjectImporting` |
| 变更里出现受保护包 | `vpmProtectedPackage` |
| 下载缺 URL / 缺 SHA-256 | `vpmResolutionFailed` / `vpmCacheHashMissing` |
| 工程卷空间不足 | `vpmProjectNoSpace`（`required` = 字节数） |
| 数据根空间不足 | `vpmCacheNoSpace` |
| 回滚仓不可写 | `vpmVaultUnavailable` |
| `.atrium-tx` 不可用 | `vpmJournalInvalid` |
| `Packages`/`Packages/<id>` 是文件或符号链接 | `vpmProjectPathUnsafe` |
| 计划说“新装”但目录已存在 | `vpmProjectChanged` |
| 计划要移除但目录不存在 | 警告 `vpmProjectMissingPackage`（不阻断） |

空间公式（`requiredBytesFor`）：

- 工程卷：`installBytes × 1.2 + 512 MiB`（`installBytes = 0` 时跳过，纯卸载不该被挡住）；
- 数据根：`downloadBytes + 512 MiB`（`downloadBytes = 0` 时跳过）。

`collectPreflightFacts` 只读：不建工程内目录，不写工程文件；`vault.ensureUsable()` 只在
数据根里写一个探针文件再删掉。

---

## 4. 旧 Assets 清理的边界（P4-C 只做路径级）

- 只处理 `vpm-manifest.json` 的 `legacyFolders` / `legacyFiles` **声明**，
  且 `packageId` 必须属于本次移除的包；`packageId` 为空的条目一律不动。
- 必须在 `Assets/` 下、不是 `Assets` 本身；路径归一后不允许 `..`/盘符/控制字符。
- 符号链接/junction → 整条跳过；目录里发现链接 → **整目录**跳过。
- `LegacyGuardPort.isProtected(path)` 命中 → 保留并报告。
  **P4-C 默认实现不保护任何路径**；`import_log` 已知资产要等 P4-F 注入真实实现。
- 文件与目录都连同同名 `.meta` 一起移到 `trash/legacy/Assets/...`；
  **不生成、不改写 `.meta`**；孤儿 meta 也会被一起搬走。
- 任何不确定都跳过，`vpmLegacyCleanupSkipped` 的 detail 是 `reason:path` 明细（≤1000 字符）。
- 清理发生在提交点之后：失败不回滚包，只给 `vpmLegacyCleanupFailed`。

---

## 5. 证据（实际跑过，可复现）

```
npm run typecheck                                   → exit 0
npx vitest run tests/vpm/install tests/vpm/vault tests/vpm/domain/manifest.spec.ts
                                                    → 5 files / 63 tests passed
npx vitest run（全量）                              → 187 passed | 1 failed | 9 skipped (197 files)
                                                      2420 passed | 1 failed | 19 skipped (2440 tests)
                                                      耗时约 195s
npx vitest run tests/classify/unitypackage.spec.ts   → 21 passed | 1 skipped（单独跑全绿）
```

定向明细：transaction 29 / journal 13 / archive 8 / vault 7 / manifest 6。

### 5.1 全量里那 1 条红（**不是回归**）

```
FAIL  tests/classify/unitypackage.spec.ts > 32MB 的 asset 主体不该进内存
AssertionError: expected 5005 to be less than 5000
```

- 单独重跑该文件 **21 passed**，阈值是 5000ms，全量并行时量到 5005ms；
- 与 P4-C 代码路径零重叠：该用例只 import `src/main/classify`，P4-C 改动全在
  `src/main/vpm/`、`src/shared/vpm/`、`src/renderer/i18n/`、`tests/vpm/`、`docs/`；
- 和 P4-B 交接里记录 perf 噪声是同一类现象（并行 197 个文件时的 CPU 争抢）。
- **没有去放宽阈值**。下次全量若再看到，先单独重跑该文件再判断。

### 5.2 已覆盖的用例（逐条）

**事务（`transaction.spec.ts`，29 例）**
- 安装：包目录就位、manifest `dependencies`/`locked` 正确、journal `commitPoint=manifest_written`、
  9 个步骤顺序、没有旧包时不建回滚仓；
- 未知顶层字段与 `legacyFolders` 保留、`locked` 里非最终集合的条目（受保护包）保留；
- 升级：新版本就位、旧目录进回滚仓、`vpm_operation_file` 的 move-out/move-in/vault 行；
- 降级、重装（用户改过的文件能在回滚仓找到）、卸载（不删、进回滚仓、`kind=remove`）；
- 预检拒绝：Unity 运行、素材导入、manifest 外部改动、工程卷空间不足、回滚仓不可用、并发操作；
- 失败注入：下载失败、解压失败、移入失败（→ `rolled_back`，旧包回原位、manifest 不变）、
  `markCommitPoint` 失败（→ `needs_attention`，不回滚）、回滚记录失败（→ `needs_attention`）、
  vault 归档失败（→ `committed` + `vault_pending` + trash 保留）；
- legacy：目录整移 + `.meta` 归档、受保护文件让整目录跳过、非本包声明不动、`Assets/` 外不动。

**回滚仓（`store.spec.ts`，7 例）**：根目录约束、slug/opId 校验、目录与单文件归档、
树摘要、失败保留源目录、路径逃逸、junction 拒绝、用量统计。

**manifest（`manifest.spec.ts`，6 例）**：排序与未知字段、locked 规则、稳定性、
依赖回退、非法名/范围丢弃。

---

## 6. 未验证项（**照实记录，不许说成"已完成"**）

> **2026-10-22 更新**：本节的多数条目已在 `docs/VPM-P4-VERIFICATION.md` 里用真实字节验证过
> （真实仓库下载、真实 zip 解压、statfs、长路径、真实 EBUSY/EPERM、跨进程并发、进程被杀后恢复、
> 缓存配额与 `vpm_cache_entry` 一致性）。仍然未验证的只有需要真 Unity / Electron 的项与真断电。

1. **真 Unity 沙盒装包**：所有用例都是临时工程 + 夹具 zip + 假包源。**一次真 Unity 都没开。**
2. **真实仓库包**：没有对 VRChat 官方/curated 仓库跑过完整"下载→解压→换入"。
3. **`.atrium-tx` 是否被 Unity 忽略**：P4-C 真机项，本站没碰。
4. **rename 被占用**（EBUSY/EPERM，杀毒/索引/Unity 残留）：退避重试只做了代码路径，
   没有在真实占用下验证过。
5. **崩溃恢复**：`markCommitPoint` 与 rename 之间的窗口未演练（见 §2.2，交给 P4-D）。
6. **并发/多工程并行**：同一工程串行有测试；不同工程并行、下载全局限流未压测。
7. **长路径 >260**：路径语义有校验，真实 NTFS 长路径未实测。
8. **回滚仓配额与清理**：`usage()` 有了，配额/回收站清理属 P8-B，未做。
9. **`vpmProjectNoSpace` 的文案**：现在直接把字节数塞进 `{{required}}`，没有做 KB/MB 格式化
   （P4-E 接 UI 时应在渲染层格式化）。

---

## 7. 给 P4-D 的接口与坑

### 7.1 可以直接用的

```ts
// 组合根已经建好，P4-D 从 runtime 拿
runtime.transactions  // InstallTransactionService
runtime.vault         // VaultStore
runtime.operations    // OperationStore
runtime.recovery      // RecoveryService（当前只判定，不碰文件）

// 事务区的唯一路径来源
import { transactionLayout, ensureTransactionLayout } from './install'
const layout = transactionLayout(projectPath, opId)
// layout.rolledback / layout.manifestOriginal / layout.trash / layout.journal
```

### 7.2 必须补的

1. **恢复判据**：见 §2.2，用 `manifest.afterHash` 对账，避免把已提交的工程推回旧状态。
2. **真实回滚**：`RecoveryService.applyOne` 现在把 `rollback` 判定落成 `needs_attention`；
   P4-D 要按 journal 的 `moves`（`state=done` 的 move-in / move-out）反向恢复，
   复用 `fsUtil.renameWithRetry` 与 `transactionLayout`。
3. **失败注入**：测试里已有三种注入写法（假 `packages`、假 `extract`、Proxy 包 `operations`），
   直接复用；每一步都要能回答"工程是否可用、旧包在哪、manifest 是什么、用户看到什么"。
4. **崩溃点**：在 9 个步骤之间各留一个"进程死掉"的用例；P4-A 的 journal 已足够支撑判定，
   缺的是"能证明安全就真的恢复"。

### 7.3 三个容易踩的坑

| 坑 | 说明 |
|---|---|
| `beginStep` 同一操作同时只能有一个 `running` | 失败时先 `finishStep(..., 'failed')` 再开 rollback 步，否则 `vpmOperationInvalid` |
| `transition('failed')` 在提交点之后会被拒绝 | 提交点后只能 `needs_attention`；`tryTransition` 会吞掉二次异常并返回当前状态 |
| `buildManifest` 会保留非最终集合的 locked 条目 | 这是刻意的（受保护/旧式/unlisted 包）；"移除"必须走 `removed` 参数，不能靠"不在 finalPackages 里" |

---

## 8. 环境与坑（省得下个工作站重新踩）

| 坑 | 说明 |
|---|---|
| `better-sqlite3` ABI | 跑测试前先 `npm run native:node`（本次遇到 `NODE_MODULE_VERSION 137 vs 127`）；`npm test` 会自动切 |
| 全量测试约 3.5 分钟 | 别以为卡死了；`tests/perf/scale.spec.ts` 一个文件就 160s |
| 全量测试 PowerShell 报 `exit code 1` | Vite CJS 警告走 stderr，**不是失败**，看 `Test Files` 行 |
| 项目路径含中文 | `C:\程序\A素材管家`，shell 里注意引号 |
| 真机沙盒规则 | `AVCA_APP_HOME` 必须含 `avca`/`sandbox` 且带 `AVCA_REQUIRE_SANDBOX_HOME=1`；**绝不用 `E:\vrc\A`、`E:\Atriumdate`、`%APPDATA%\A\library.db` 做试验** |
| Unity 版本 | 真机一律 **2022.3.22f1**；不要 `taskkill /F /IM Unity.exe`（会误杀 Hub），按 PID 杀 |
| 数据根 | 必须**非 C**；没有合法数据根就不启用 VPM，**不提供"临时放 C"后门**（测试里用 `os.tmpdir()` 只是因为 `VaultStore` 不做非 C 校验，那是 gate 的职责） |

---

## 9. 如果只能记三件事

1. **P4-C 已经落地**：`install/transaction.ts` 把"预检 → 暂存 → 换入 → manifest 最后写 →
   旧 Assets → vault"跑通了，63 条定向用例全绿，typecheck 干净。
2. **底线是"manifest 最后写"**：rename 之前任何失败都能回到旧状态；rename 之后只能补完或
   `needs_attention`，不许假装回滚。P4-D 的真实恢复必须守住同一条线。
3. **还没在真 Unity 里装过包**：P4-D 之后的第一件事应该是沙盒真机跑一次
   "装一个真实小包 → 打开 Unity → 确认包在 → 关 Unity → 卸载 → 确认回到原状"。
