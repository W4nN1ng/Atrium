# src/main/vpm/install

> 本模块分四块，独立演进：**journal/状态机**（P4-A）、**ZIP 安全解压**（P4-B）、
> **预检/旧 Assets 清理/安装事务**（P4-C）、**失败注入、崩溃恢复与并发**（P4-D）。

## 职责

**P4-A —— 事务持久化地基**：`vpm_operation` / `vpm_operation_step` / `vpm_operation_file`
的操作状态机、工程内 `.atrium-tx/<op>/journal.json` 的原子读写，以及启动恢复扫描的判定骨架。

**P4-B —— `archive.ts`**：把已校验/缓存的包 zip **安全解压**到调用方给出的同卷新建目录，
并校验解压结果确实是合法 VPM 包。

**P4-C —— `preflight.ts` / `legacy.ts` / `transaction.ts`**：单计划的安装事务。
预检拒绝矩阵 → 暂存 → 旧包入事务区 → 新包换入 → **manifest 最后原子写**（提交点）→
旧 Assets 路径级清理 → 回滚仓归档 → 清理临时区。失败按 journal 反向恢复，
无法证明安全时进 `needs_attention`。

**P4-D —— `recovery.ts` 的真实恢复 + 事务的失败注入/工程锁**：启动时按 journal 与磁盘
manifest 对账，能证明安全的自动回滚或补完归档，判不了的落 `needs_attention`；
事务提供**测试专用**注入点覆盖每一步，并用进程内锁 + DB 唯一索引挡住同工程并发。

**P9-B —— 可解释、可重试的恢复**：`RecoveryService.inspect()` 只读单个操作，
`recover()` 允许人工重试 `needs_attention`；证据不足时只返回原因不动文件。
同一操作两路恢复互斥；提交后的归档补完做了兜底，任何意外都不会卡住启动/工程。

## 不负责什么

- 不下载（下载在 `../cache/service.ts`）；事务只消费 `{ path, sha256, size }`。
- 不生成计划（计划在 P3 `planService.ts`；事务只按 `planId` 取缓存并重新校验）。
- 不做 IPC/UI（P4-E）；不把数据库行或文件句柄交给渲染层。
- 不做 GUID 级 legacy 匹配、不做旧式包迁移（P6）。
- 不永久删用户文件：旧包/旧 Assets 进 `.atrium-tx/<op>/trash` → 回滚仓。
- 不写 `library.db`、不写 VCC、不手写 `.meta`。

## 公开 API

只从 `index.ts` 导出：

- `OperationStore`：
  - `create/get/findActive/findUnresolved/listActive/list`
  - `transition(id, status, options?)`：合法迁移校验；`committed` 必须有
    `commitPoint=manifest_written`，提交后禁止 `failed/rolled_back`；
  - `beginStep/finishStep/nextStepSequence`：每步开始/结束、单步 running、序号递增、重复调用幂等；
  - `upsertFile/setFileState`：`vpm_operation_file` 的路径/动作/校验/状态；
  - `setManifestHashes/markCommitPoint/setLegacyPaths/setVaultPending/commitPoint`。
- `OperationJournalStore`：`pathFor/exists/inspect/read/create/write`；`inspect` 区分
  `ok/missing/invalid`，恢复扫描用它，不抛异常。
- `RecoveryService`：`scan()`（只读判定）/ `inspect(operationId)`（只读单操作）/
  `apply(decisions)`（**async**，会动文件）/ `scanAndApply()`（**async**）/
  `recover(operationId)`（**async**，人工重试 `needs_attention`/活动操作）。
  判定见「恢复语义」一节；P4-D 起会真的回滚/补完归档。
- `transactionLayout(projectPath, opId)` / `ensureTransactionLayout(...)`：
  `.atrium-tx/<op>/{install,trash,trash/packages,trash/legacy,rolledback}` 与
  `manifest.original.json` / `vpm-manifest.new.json` / `journal.json` 的唯一路径来源。
- `TRANSACTION_HOOK_POINTS` / `TransactionHooks`：**测试专用**失败注入点（构造参数，
  生产组合根不传；没有环境变量开关）。`crashOnError: true` 时 hook 抛错会模拟进程死亡：
  不写状态、不回滚、不 finishStep。
- `evaluatePreflight(facts)`：**纯函数**拒绝矩阵，返回 `{ ok, issues, warnings, required }`。
- `collectPreflightFacts(input)`：只读采集（工程卷/数据根空间、`Packages/<id>` 类型、
  `.atrium-tx` 可用性、回滚仓探针）。
- `requiredBytesFor(plan)`：工程卷 `installBytes × 1.2 + 512 MiB`、
  数据根 `downloadBytes + 512 MiB`（纯卸载不要求额外空间）。
- `cleanupLegacyAssets(input)`：路径级旧 Assets 清理（见下）。
- `InstallTransactionService.apply({ projectKey, planId, signal?, onProgress? })`
  → `ApplyPlanResult`：
  `{ operationId, status, errorCode, errorDetail, warnings, installed, removed, kept, vaultPending, elapsedMs }`。
  只在“操作都开不起来”时抛错（`vpmPlanNotFound`/`vpmPlanExpired`/`vpmPlanChanged`/
  `vpmProjectInvalid`/`vpmProjectBusy`/`vpmRecoveryRequired`）。
- 类型/常量：`OperationStatus`、`OperationKind`、`JournalMove`、`RecoveryDecision`、
  `TransactionProgress`、`TransactionWarning`、`LegacyGuardPort`、`ProjectActivityPort`、
  `MANIFEST_RELATIVE_PATH`、`TRANSACTION_DIR`、`PROTECTED_PACKAGE_ID` 等。

### `archive.ts`（P4-B，安全解压）

- `extractPackageZip({ zipPath, targetDir, expected?, limits? })` → `ExtractedPackage`
  （`{ rootDir, packageJsonPath, name, version, manifest, entries, bytes }`）。
  - `zipPath` 必须是**绝对路径的常规文件**（拒绝 symlink）；函数只读它。
  - `targetDir` 必须**尚不存在**，函数自己 `mkdir`（非递归），随后用 realpath 确认
    它不是 symlink 且确实是目录。
  - `expected: { name, version }` 提供时，解压后包身份必须**精确匹配**。
  - `limits` 可覆盖 `DEFAULT_ARCHIVE_LIMITS` 的任意项；非法值直接抛 `vpmArchiveInvalid`。
- `DEFAULT_ARCHIVE_LIMITS`：

  | 项 | 默认 | 含义 |
  |---|---|---|
  | `maxZipBytes` | 4 GiB | 压缩包文件本身上限 |
  | `maxEntries` | 100_000 | 条目数上限（含目录） |
  | `maxEntryBytes` | 4 GiB | 单条目展开上限 |
  | `maxTotalBytes` | 8 GiB | 全部条目展开总量上限 |
  | `maxCompressionRatio` | 1000 | 压缩比阈值（配合 `ratioMinBytes`） |
  | `ratioMinBytes` | 64 MiB | 低于此展开量不判压缩比 |
  | `maxPathLength` | 260 | 目标绝对路径长度上限（Windows 保守值） |

- 类型：`ArchiveLimits`、`ExtractPackageZipInput`、`ExtractedPackage`、`PreparedPackage`。
  `PreparedPackage` 是 `zip` 与 `local` 的联合；**P4-B 只实现 `zip`，`local` 留给 P7**。

## 事务顺序（P4-C）

```text
apply(planId)
  ├─ PlanService.get(planId)                    只接受主进程缓存里的计划
  ├─ OperationStore.create(status=planned)      同工程唯一 + journal 建档
  ├─ transition(preflight)
  │    └─ collectPreflightFacts → evaluatePreflight
  │         失败 → transition(failed, code)，不动工程
  ├─ transition(applying)
  │    1 prepare    校验 manifest 未变 + 复制 manifest.original.json
  │    2 download   每个 download → packageCache.ensurePackage（校验 hash）
  │    3 extract    每个包 → .atrium-tx/<op>/install/<name>（expected 精确匹配）
  │    4 move-out   Packages/<id> → trash/packages/<id>（同卷 rename + 退避重试）
  │    5 move-in    install/<id> → Packages/<id>（目标已存在即失败）
  │    6 manifest   提交前再比 manifest hash → 写 vpm-manifest.new.json（fsync）
  │                 → setManifestHashes → rename 覆盖 = **提交点** → markCommitPoint
  │    7 legacy     只按包声明路径清旧 Assets（失败只 warning，不回滚包）
  │    8 vault      trash → <dataRoot>/vault/<slug>/<op>，逐文件校验后才清 trash
  │    9 cleanup    只清自己的 install 区；journal/manifest.original.json 保留
  └─ transition(committed)
```

失败处理：

- 提交点**之前**：新包移入 `rolledback/`、旧包从 trash 移回 `Packages/`，
  `rolled_back`；没有任何移动时 `failed`。
- 提交点**之后**（manifest 已 rename）：不回滚，只 `needs_attention`。
- 回滚本身失败：`needs_attention` + `vpmRollbackFailed`，**不删现场**。
- 旧 Assets 清理失败 / 回滚仓归档失败：工程已可用，只记 warning
  （`vpmLegacyCleanupFailed` / `vpmVaultArchiveFailed` + `vpmVaultPending`）。

### 失败矩阵（P4-D，`failure-injection.spec.ts` 逐点验证）

每一步都有"在这里抛错"的用例；下表是实测结果（升级场景 `1.0.0 → 2.0.0`）。

| 注入点 | 操作状态 | 工程文件 | manifest | 现场 |
|---|---|---|---|---|
| `prepare:before` / `prepare:after` | `failed` | 未改动 | 未动 | 事务区保留 |
| `download:before` / `download:after` | `failed` | 未改动 | 未动 | 事务区保留 |
| `extract:before` / `extract:after` | `failed` | 未改动 | 未动 | `install/` 保留 |
| `move-out:before` / `move-out:item:before` | `failed` | 未改动 | 未动 | 事务区保留 |
| `move-out:item:after` / `move-out:after` | `rolled_back` | 旧包回原位 | 逐字节一致 | 事务区保留 |
| `move-in:before` / `move-in:item:before` | `rolled_back` | 旧包回原位 | 逐字节一致 | 事务区保留 |
| `move-in:item:after` / `move-in:after` | `rolled_back` | 新包进 `rolledback/`、旧包回原位 | 逐字节一致 | 事务区保留 |
| `manifest:before` / `manifest:after-write` | `rolled_back` | 旧包回原位 | 逐字节一致（新 manifest 只在事务区） | 事务区保留 |
| `manifest:after-rename` | `needs_attention` | 新包就位 | **已是新 manifest** | 不回滚，留给恢复 |
| `manifest:after-commit-point` | `needs_attention` | 新包就位 | 已是新 manifest | 恢复后可补成 `committed` |
| `legacy:before` | `committed` + `vpmLegacyCleanupFailed` | 包已换好，旧 Assets 未动 | 新 manifest | 事务区保留 |
| `vault:before` / `vault:after` | `committed` + `vpmVaultArchiveFailed` + `vault_pending=1` | 包已换好 | 新 manifest | `trash` 保留，可重试归档 |
| `cleanup:before` / `cleanup:after` | `committed` + `vpmTransactionFailed` | 包已换好 | 新 manifest | 只影响临时区清理 |

补充用例：

- 下载返回的 SHA-256 与计划不符 → `vpmCacheHashMismatch`，包目录不出现；
- `legacy:before` 失败**不会**回滚已提交的包（旧 Assets 只是没清）；
- 回滚自身失败 → `needs_attention` + `vpmRollbackFailed`，**不删现场**；
- 提交点之前失败时 manifest 与操作前**逐字节一致**（按内容 hash 比较整棵工程树）。

### 预检拒绝矩阵

| 条件 | 错误码 |
|---|---|
| planId 过期/不存在 | `vpmPlanExpired` / `vpmPlanNotFound` |
| 计划 hash/工程键与缓存不一致 | `vpmPlanChanged` |
| 计划 blocked / 有冲突 / 缺依赖 | `vpmPlanBlocked` |
| manifest 不存在或不可解析 | `vpmManifestInvalid` |
| manifest hash 与计划 before 不一致 | `vpmProjectChanged` |
| Unity 正在运行该工程 | `vpmUnityRunning` |
| 素材正在导入该工程 | `vpmProjectImporting` |
| 变更里出现受保护包（`com.avca.bridge`） | `vpmProtectedPackage` |
| 下载缺 URL / 缺 SHA-256 | `vpmResolutionFailed` / `vpmCacheHashMissing` |
| 工程卷空间不足 | `vpmProjectNoSpace` |
| 数据根空间不足 | `vpmCacheNoSpace` |
| 回滚仓不可写 | `vpmVaultUnavailable` |
| `.atrium-tx` 不可用 | `vpmJournalInvalid` |
| `Packages`/`Packages/<id>` 是文件或符号链接 | `vpmProjectPathUnsafe` |
| 计划说“新装”但目录已存在 | `vpmProjectChanged` |
| 计划要移除但目录不存在 | 警告 `vpmProjectMissingPackage`（不阻断） |

### 旧 Assets 清理（`legacy.ts`，路径级）

- 只处理 `vpm-manifest.json` 的 `legacyFolders` / `legacyFiles` **声明**，
  且 `packageId` 必须属于本次移除的包；`packageId` 为空的条目不处理（`unknownOwner`）。
- 路径必须归一后仍在 `<project>/Assets/` 下、不是 `Assets` 本身。
- 符号链接/junction → 整条跳过；目录里出现链接 → **整目录**跳过。
- `LegacyGuardPort.isProtected(path)` 命中（`import_log` 已知资产、桥接写入）→ 保留并报告。
- 文件/目录连同同名 `.meta` 一起移动；**不生成、不改写 `.meta`**。
- 只移到 `.atrium-tx/<op>/trash/legacy/Assets/...`，随后由 vault 步归档。
- 任何不确定都跳过，`vpmLegacyCleanupSkipped` 汇总原因（`reason:path` 明细在 detail）。

## 解压安全边界（P4-B）

逐条目校验，任一不满足即拒绝：

| 类别 | 拒绝内容 |
|---|---|
| 路径逃逸 | `..`、绝对路径、前导 `/` 或 `//`、盘符（`C:`） |
| Windows 语义 | 保留名（CON/PRN/AUX/NUL/COM1–9/LPT1–9）、非法字符 `<>:"\|?*`、结尾点或空格 |
| 控制字符 | `\u0000-\u001f`、`\u007f`（含 ADS 冒号与空字节） |
| 重复/冲突 | NFC+小写归一后重复路径、文件与目录同名冲突、祖先已被文件占用 |
| 链接 | 符号链接（mode `0xa000`）→ `vpmArchiveSymlink`；其他特殊文件直接拒绝 |
| 压缩包类型 | 加密条目、非 store/deflate 压缩方式 |
| 炸弹 | 条目数、单条目、展开总量、压缩比、zip 文件大小（四维 + 大小上限） |
| 超长路径 | 目标绝对路径 ≥ `maxPathLength` |

额外防线：

- **不跟随链接**：每个文件写入前后、每个目录创建后都用 `realpathSync` 再确认
  仍在目标根内（`isSameOrInside`）。
- 写入用 `flags: 'wx'`（**不覆盖已存在文件**）与 `mode: 0o600`。
- 流式计量器（`Transform`）在写入过程中实时核对，实际字节超过声明的
  `uncompressedSize` 或总量上限立即中止。
- 解压结束后核对实际写入字节数与 `uncompressedSize` 一致。

### 包根识别与身份校验

1. 目标根有 `package.json`（常规文件、非 symlink、≤ 256 KiB）→ 它在根。
2. 否则扫描**直接子目录**，恰好**一个**子目录含 `package.json` → 那是包根
   （兼容"单层 wrapper 目录"的包）。
3. 0 个或多个候选 → `vpmArchivePackageInvalid`。
4. 校验 `package.json`：去 BOM 后 `JSON.parse`；`name` 过 `normalizePackageId`；
   `version` 过 `parseVpmVersion`；有 `vpmDependencies` 时逐项校验包名与范围。
5. 提供 `expected` 时，`name` 与 `version.raw` 必须精确匹配。

### 失败时的取舍

**失败保留目标目录（可能含已解出的前缀文件），绝不删除、也绝不回滚工程文件。**
这是刻意选择：现场是诊断证据，清理由事务层（P4-C）按 journal 决定。

## manifest 写入规则（P4-C）

- 未知顶层字段原样保留；`legacyFolders/legacyFiles/legacyPackages` 不删（清理未完成时仍要能追溯）。
- `dependencies` = `plan.roots`（排序）；`upgradeAll` 不改根。
- `locked` = 最终包精确版本 + 依赖范围；**不在最终集合、也没被显式移除的旧条目保留**
  （受保护包、旧式包、unlisted 包靠这条不被抹掉）。
- 先在 `.atrium-tx/<op>/vpm-manifest.new.json` 写完并 `fsync`、校验 hash，
  再 `rename` 覆盖 `Packages/vpm-manifest.json`；**不在 Packages 留临时文件**。
- 提交前再读一次原 manifest 算 hash，与 `plan.manifestHashBefore` 不一致就中止并回滚。

## 恢复语义（P4-D）

`RecoveryService.scan()` 只看 `planned/preflight/applying` 的操作：

| 条件 | 判定 |
|---|---|
| 工程目录不存在 | `needs_attention` / `project_missing` |
| Unity 或素材导入正在用这个工程 | `wait`（不改状态、不碰文件） |
| journal 缺失 / 损坏 / opId·工程键·kind 对不上 | `needs_attention`（对应 reason） |
| journal `commitPoint=manifest_written` | `complete` |
| journal 还写 `before`，但磁盘 manifest hash == `afterHash` | `complete`（rename 与 markCommitPoint 之间的崩溃窗口） |
| 磁盘 manifest 既不是 `beforeHash` 也不是 `afterHash` | `needs_attention` / `project_changed` |
| 其余 | `rollback` |

`apply()` 的执行（P4-D 起会真的动文件）：

- `complete`：关掉遗留的 `running` 步骤 → 缺提交点就先 `markCommitPoint` → `committed`
  → 补完 vault 归档（失败保留 `vault_pending=1`，工程仍可用）。
- `rollback`：move-in 的新包 → `rolledback/`；move-out 的旧包 → 回 `Packages/`；
  legacy 的旧文件 → 回 `Assets/`；manifest 与 `beforeHash` 不一致时用
  `manifest.original.json` 还原。移动了文件 → `rolled_back`，一步没动 → `failed`。
- 回滚任一步失败 → `needs_attention` + `vpmRollbackFailed`，不删任何文件。
- 幂等：每一步都先看磁盘现状，重复执行不会产生新的移动；已终态的操作 `apply` 返回
  `applied: false`。
- 恢复**不重跑** legacy 清理（那是前进操作，不是回滚）：崩溃在 legacy 之前时包已提交、
  旧 Assets 仍留在工程里，符合"宁可留旧文件"。
- 恢复在 `initVpm()` 里 `await recovery.scanAndApply()`，早于仓库种子与 IPC 注册。

### 手动恢复（P9-B）

`scan()` **不会**重扫 `needs_attention`：它是等人工/外部修复的终态。UI 通过
`inspect()` 展示原因，通过 `recover()` 重试：

- `inspect()` 对 `needs_attention` 重新按 journal+磁盘判定，不迷信数据库里的旧结论；
- 判定为 `rollback`/`complete` 时，`recover()` 才真的动文件；判定仍为
  `needs_attention`/`wait` 时只返回原因，状态和文件都不变；
- 外部修复后（恢复 manifest、修复 journal、关闭 Unity）再点一次即可；
- 同进程事务、素材导入、备份/复制/迁移/换版本的维护租约也会让恢复返回
  `wait/project_busy`；占用检查抛错按占用处理；
- 同一操作的 `recover` 在进程内互斥（`vpmProjectBusy`），不会两路同时 rename；
- 活动操作（如启动时 Unity 还开着而留下的 `applying`）也可手动重试；
- `inspect/recover` 读不到 journal 时不伪造证据；证据修好后才能解除
  `findUnresolved` 的工程锁。

**"锁可恢复"的边界**：journal 永久丢失且无法从备份修复时，工程仍会保持
`needs_attention` 并拒绝新操作；这是为了避免在无法证明现场的情况下继续写。UI 必须把
`journal_missing/journal_invalid/journal_mismatch` 原样解释给用户，不能提供"强制解锁"。

## 并发与工程锁（P4-D）

- **进程内锁**：`InstallTransactionService.activeProjects` 按 `projectKey` 占位，
  同一工程第二个 `apply()` 直接 `vpmProjectBusy`（连操作行都不建）；`finally` 释放，
  崩溃时随进程消失。
- **跨进程/持久锁**：`vpm_operation` 的部分唯一索引（`planned/preflight/applying`），
  进程内锁只是第一道闸。
- **不同工程可并行**：各自的 journal/事务区/回滚仓目录互不相交。
- **活动闸门**：`ProjectActivityPort` 返回 `unityRunning`/`importing` 时预检拒绝；
  端口自己抛错按"Unity 可能在用"处理（fail closed）。
- **双击/重复应用**：同一 `planId` 第二次应用会因为 manifest 已变而 `vpmProjectChanged`，
  不会重复安装。
- **外部改动**：提交前再读一次 manifest 算 hash；不一致就回滚，且**不覆盖**外部写入的内容。

## 失败码（P4-C 新增）

- `vpmPlanBlocked`：计划 blocked / 有冲突 / 缺依赖。
- `vpmProjectChanged`：manifest 或目标目录在预览后被外部改动。
- `vpmUnityRunning` / `vpmProjectImporting`：工程正在被 Unity/素材导入占用。
- `vpmProtectedPackage`：变更里出现 `com.avca.bridge`（或注入的其他受保护包）。
- `vpmProjectNoSpace`：工程卷空间不足（`required` 参数给字节数）。
- `vpmProjectPathUnsafe`：`Packages`/`Packages/<id>` 是文件、符号链接或 junction。
- `vpmTransactionFailed`：事务步骤的 IO 失败（`step` 参数给步骤名）。
- `vpmRollbackFailed`：回滚没有完全成功，工程需要人工确认。
- `vpmVaultUnavailable` / `vpmVaultArchiveFailed`：回滚仓不可用 / 归档失败。
- 警告：`vpmLegacyCleanupSkipped`、`vpmLegacyCleanupFailed`、`vpmVaultPending`。

## 状态机

```text
planned → preflight → applying → committed
    │          │          ├─ 可回滚失败 → rolled_back
    │          │          └─ 不可判定   → needs_attention
    │          └─ 预检失败 → failed
    └─ 计划失效/取消 → failed

needs_attention → committed / failed / rolled_back（只能由恢复动作推进）
```

- 同一工程同时最多一个 `planned/preflight/applying`（DB 部分唯一索引）。
- 同一工程存在 `needs_attention` 时，`create` 拒绝新操作（`vpmRecoveryRequired`）。
- 提交点是 `markCommitPoint` 写入 journal 的 `manifest_written`；manifest 写入前不能
  `committed`，写入后不能 `failed/rolled_back`。
- `needs_attention` 不算成功；没有 journal 或 journal 损坏时绝不自造/覆盖证据。

## 数据 / 写入

- `vpm.db` v3：`vpm_operation`、`vpm_operation_step`、`vpm_operation_file`、`vpm_cache_entry`
  （表结构由 `../db/migrations.ts` 拥有；SQL 只在 `state.ts`，和状态机/journal 双写同事务）。
- `<project>/.atrium-tx/<opId>/`：
  - `journal.json`（schemaVersion 1，原子写，只追加事件）；
  - `manifest.original.json`（变更前副本）、`vpm-manifest.new.json`（提交前暂存）；
  - `install/<pkg>`（解压暂存）、`trash/packages/<pkg>`、`trash/legacy/Assets/...`；
  - `rolledback/<pkg>`（回滚时把新包移出的地方，不删除）。
  - 成功后只清 `install` 与空的 `trash`/`rolledback`；journal 与 manifest 副本保留当证据。
- 回滚仓：`<dataRoot>/vault/<projectSlug>/<opId>/`（见 `../vault/README.md`）。
- 工程路径存 realpath；`project_key` 由 realpath 归一化小写派生。
- 不记录：token、Authorization、cookie、完整 manifest、用户文件内容。

## 失败模式

- 合法迁移表之外 → `vpmOperationInvalid`；找不到操作 → `vpmOperationNotFound`。
- 同工程已有活动操作 → `vpmProjectBusy`；已有未恢复操作 → `vpmRecoveryRequired`。
- journal 缺失/损坏/工程键不符 → `vpmJournalInvalid`；恢复扫描标 `needs_attention`。
- journal 写入/rename/fsync 失败 → `vpmJournalWriteFailed`，本次 DB 事务回滚。
- 工程路径无效/不存在 → `vpmProjectInvalid`；恢复扫描对“工程已不在”标 `needs_attention`。
- 未到提交点 → 判定 `rollback` 并真的反向恢复（`rolled_back`/`failed`）；
  已过提交点 → 判定 `complete` 并补完归档。
- 磁盘 manifest 被外部改过（既不是 before 也不是 after）→ `needs_attention`，
  不覆盖外部内容。
- 恢复时回滚失败 → `needs_attention` + `vpmRollbackFailed`；归档补完失败只保留
  `vault_pending`。
- 同一工程并发第二个操作 → `vpmProjectBusy`（进程内锁先拦，DB 唯一索引兜底）。
- 活动闸门抛错 → 按 `vpmUnityRunning` 拒绝（fail closed）。
- `markCommitPoint` 连续 3 次失败 → `vpmJournalWriteFailed` → `needs_attention`
  （manifest 已 rename，不回滚）。
- 数据库迁移/完整性失败由 `../db/` 负责；本模块不做降级重建。

## 测试入口

- `tests/vpm/install/journal.spec.ts`：合法/非法迁移、活动唯一、步骤顺序/幂等、
  journal 原子证据、崩溃模拟、缺失/损坏/工程丢失判定、提交点、活动闸门。
- `tests/vpm/install/archive.spec.ts`（P4-B）：正常解压保 `.meta` 字节/空目录/包根识别、
  单层 wrapper 与歧义根、`package.json` 身份与依赖范围校验、zip-slip/绝对/盘符/UNC/
  保留名/ADS/尾点/重复路径、symlink 条目、压缩炸弹四维、损坏包与已存在目标、
  失败保留现场。
- `tests/vpm/install/transaction.spec.ts`（P4-C）：安装/升级/降级/重装/卸载成功路径、
  未知字段保留、vault 归档、预检拒绝矩阵（Unity/导入/外部改动/空间/vault/并发）、
  每步失败注入（下载/解压/移入）、回滚成功与 `needs_attention`、vault 失败标
  `vault_pending`、legacy 路径级清理与保护。
- `tests/vpm/install/failure-injection.spec.ts`（P4-D）：`TRANSACTION_HOOK_POINTS`
  逐点注入失败，断言状态/文件树/manifest/journal/vault（见「失败矩阵」）。
- `tests/vpm/install/recovery.spec.ts`（P4-D）：崩溃在提交点前后、rename 与
  markCommitPoint 之间的窗口、归档补完、幂等、Unity 活动等待、外部改动、
  journal 损坏、遗留 running 步骤收尾。
- `tests/vpm/install/concurrency.spec.ts`（P4-D）：同工程并发被拒、不同工程并行、
  锁在正常/崩溃恢复后释放、活动闸门拒绝、双击不重复、事务中途外部改动。
- `tests/vpm/reliability/manual-recovery.spec.ts`（P9-B）：`needs_attention` 后修复
  manifest/journal 再重试、Unity 占用等待、终态/未知 id。
- `tests/vpm/reliability/locks.spec.ts`（P9-B）：维护租约在成功/失败/崩溃/批量失败后
  全部释放；同一操作多轮崩溃恢复后仍可提交。
- `tests/vpm/reliability/long-run.spec.ts`（P9-B）：40 次连续事务的 active 行、running
  步骤、journal 提交点与 SQLite 完整性。
- `tests/vpm/reliability/archive-hardening.spec.ts`（P9-B）：提交后归档检查抛
  `EACCES` 也只保留 `vault_pending`，不阻塞启动/后续安装。
- `tests/vpm/reliability/failure-matrix.spec.ts`（P9-B）：24 个注入点唯一且都真的
  从事务里触发（防"声明了但永远不触发"）。
- `tests/vpm/reliability/restart.spec.ts`（P9-B）：真实子进程 `exit(37)` 后新连接手动
  恢复，再由另一个子进程抢同一工程锁。
- `tests/vpm/install/harness.ts`：三个 P4-D 用例共用的临时工程/DB/回滚仓夹具
  （非 spec，不被收集）。
- `tests/vpm/install/zip-fixture.ts`：恶意/正常 zip 夹具构造器（非 spec，不被收集）。
- `tests/vpm/vault/store.spec.ts`：回滚仓路径约束、归档与校验、失败保留源目录。
- `tests/vpm/domain/manifest.spec.ts`：manifest 构建的稳定性、未知字段保留、locked 规则。
- 运行：`npx vitest run tests/vpm/install tests/vpm/vault`；全量 `npx vitest run`。
  （`npm test` 会先切 Node ABI；涉及 Electron 构建时再跑 `npm run build:dir`。）

## 谁依赖我 / 我依赖谁

- 被 `src/main/vpm/index.ts` 组合根使用；P4-E 消费 `InstallTransactionService` 与
  `TransactionProgress`；P4-D 消费 `RecoveryService`/journal 做真实回滚；P8-B 消费操作记录。
- 依赖：`../db`（句柄类型）、`../cache`（只通过 `PackageSourcePort` 注入，不 import）、
  `../vault`、`../fsUtil`、`shared/vpm` 纯领域（`packageId`/`version`/`range`/`plan`/
  `manifest`/`project`/`dataRoot`/`hash`）、`node:fs`/`node:path`/`node:stream`、`yauzl`、`VpmError`。
- 不依赖 Electron、HTTP、渲染层；不直接 import 核心 `project`/`import`/`bridge`。
- **`archive.ts` 不读、不写 `vpm.db`**：它是纯文件适配器，状态由调用方（P4-C）经
  `OperationStore` 记账。
