# src/main/vpm/install

> 本模块分两块，独立演进：**journal/状态机**（P4-A）与 **ZIP 安全解压**（P4-B）。

## 职责

**P4-A —— 事务持久化地基**：`vpm_operation` / `vpm_operation_step` / `vpm_operation_file`
的操作状态机、工程内 `.atrium-tx/<op>/journal.json` 的原子读写，以及启动恢复扫描的判定骨架。
只做“记录、判定、保守落状态”。

**P4-B —— `archive.ts`**：把已校验/缓存的包 zip **安全解压**到调用方给出的同卷新建目录，
并校验解压结果确实是合法 VPM 包。

真正的移动目录、manifest 写入、回滚和回滚仓归档在 **P4-C/P4-D**。

## 不负责什么

- 不下载（下载在 `../cache/service.ts`）。
- **`archive.ts` 只解压到一个已存在之外的空白目标目录**；不移动/删除工程文件、
  不写 `Packages/`、不写 manifest、不做回滚——那是 P4-C 事务的事。
- 不做 IPC/UI；不把数据库行或文件句柄交给渲染层。
- 不存 token、请求头、完整 manifest 或文件内容；journal 只存路径、动作、hash、大小和状态。
- 不清理 `.atrium-tx`/journal；历史只追加，归档/清理留给 P4-D/P4-E。

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
- `RecoveryService`：`scan/apply/scanAndApply`。P4-A 的 `apply` 只把安全判定落成
  `committed` 或 `needs_attention`，不碰文件；真实回滚留给 P4-D。
- 类型/常量：`OperationStatus`、`OperationKind`、`JournalMove`、`RecoveryDecision`、
  `MANIFEST_RELATIVE_PATH`、`TRANSACTION_DIR` 等。

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
  `PreparedPackage` 是 `zip` 与 `local` 的联合；**P4-B 只实现 `zip`，`local` 留给 P7**，
  现在只把类型定下来，避免 P4-C 写死 zip。

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

## 失败码（P4-B）

- `vpmArchiveInvalid`：zip 损坏/读不出、压缩包含非法条目类型、条目声明大小与实际不符、
  limits 非法、`zipPath` 不是常规文件。
- `vpmArchiveUnsafePath`：路径逃逸、绝对路径、盘符、UNC、保留名、非法字符、
  尾点空格、重复路径、文件/目录冲突、超长路径。
- `vpmArchiveSymlink`：压缩包含符号链接条目。
- `vpmArchiveBomb`：条目数/单条目/总量/压缩比/zip 大小超限。
- `vpmArchivePackageInvalid`：找不到唯一 `package.json`、包名/版本/deps 非法、
  与 `expected` 不一致、`package.json` 过大或是 symlink。
- `vpmArchiveWriteFailed`：`mkdir`、创建目录/写文件失败；`targetDir` 已存在或不是目录。

## 状态机

```text
planned → preflight → applying → committed
    │          │          ├─ 可回滚失败 → rolled_back（P4-C/D）
    │          │          └─ 不可判定   → needs_attention
    │          └─ 预检失败 → failed
    └─ 计划失效/取消 → failed

needs_attention → committed / failed / rolled_back（只能由恢复动作推进）
```

- `planned/preflight → needs_attention` 只给恢复扫描用，表示“现场无法证明安全”；
  正常流程失败走 `failed`。
- 同一工程同时最多一个 `planned/preflight/applying`（DB 部分唯一索引）。
- 同一工程存在 `needs_attention` 时，`create` 拒绝新操作（`vpmRecoveryRequired`），
  不会在未恢复的现场上继续写。
- 提交点是 `markCommitPoint` 写入 journal 的 `manifest_written`；manifest 写入前不能
  `committed`，写入后不能 `failed/rolled_back`。
- `needs_attention` 不算成功；没有 journal 或 journal 损坏时绝不自造/覆盖证据。

## 数据 / 写入

- `vpm.db` v3：`vpm_operation`、`vpm_operation_step`、`vpm_operation_file`、`vpm_cache_entry`
  （表结构由 `../db/migrations.ts` 拥有；SQL 只在 `state.ts`，和状态机/journal 双写同事务）。
- `<project>/.atrium-tx/<opId>/journal.json`：
  - `schemaVersion: 1`；`opId/projectKey/kind/phase/commitPoint/planHash/projectFingerprint`；
  - `manifest` 路径与 before/after hash；`steps/moves/legacyPaths/vaultPending`；
  - `events` 只追加（幂等键去重），不删历史；
  - 原子写：同目录临时文件 → fsync → rename；读只认常规文件，拒绝 symlink/超限/结构不符。
- `opId` 必须是 ULID；`.atrium-tx` 必须是工程根下的真实目录，不能是 symlink；
  journal 路径不能逃出工程。
- 工程路径存 realpath；`project_key` 由 realpath 归一化小写派生。
- 不记录：token、Authorization、cookie、完整 manifest、用户文件内容。

## 失败模式

- 合法迁移表之外 → `vpmOperationInvalid`；找不到操作 → `vpmOperationNotFound`。
- 同工程已有活动操作 → `vpmProjectBusy`；已有未恢复操作 → `vpmRecoveryRequired`。
- journal 缺失/损坏/工程键不符 → `vpmJournalInvalid`；恢复扫描标 `needs_attention`。
- journal 写入/rename/fsync 失败 → `vpmJournalWriteFailed`，本次 DB 事务回滚。
- 工程路径无效/不存在 → `vpmProjectInvalid`；恢复扫描对“工程已不在”标 `needs_attention`。
- 未到提交点 → 判定 `rollback`，P4-A 先落 `needs_attention`；已过提交点 → 判定 `complete`。
- Unity/导入活动 → 判定 `wait`，不改状态，下次关闭后重扫。
- 数据库迁移/完整性失败由 `../db/` 负责；本模块不做降级重建。

## 测试入口

- `tests/vpm/install/journal.spec.ts`：合法/非法迁移、活动唯一、步骤顺序/幂等、
  journal 原子证据、崩溃模拟、缺失/损坏/工程丢失判定、提交点、活动闸门。
- `tests/vpm/db/migrate.spec.ts`：v1→v3、v3→v4 失败回滚、备份与必需表。
- `tests/vpm/runtime.spec.ts`：启动恢复扫描接线。
- `tests/vpm/install/archive.spec.ts`（P4-B）：正常解压保 `.meta` 字节/空目录/包根识别、
  单层 wrapper 与歧义根、`package.json` 身份与依赖范围校验、zip-slip/绝对/盘符/UNC/
  保留名/ADS/尾点/重复路径、symlink 条目、压缩炸弹四维、损坏包与已存在目标、
  失败保留现场。
- `tests/vpm/install/zip-fixture.ts`（P4-B）：恶意 zip 夹具构造器（非 spec，不被收集）。
- 运行：`npx vitest run tests/vpm/install`；全量 `npx vitest run`。
  （`npm test` 会先切 Node ABI；涉及 Electron 构建时再跑 `npm run build:dir`。）

## 谁依赖我 / 我依赖谁

- 被 `src/main/vpm/index.ts` 组合根使用；P4-C 的事务服务直接消费 `OperationStore`
  **与 `extractPackageZip()`**（解压到 `.atrium-tx/<op>/install/<pkg>`）；
  P4-D/P4-E 消费 `RecoveryService`/操作历史；P8-B 消费操作记录。
- 依赖：`../db`（句柄类型）、`shared/vpm` 纯领域（`packageId`/`version`/`range`/`dataRoot`）、
  `node:fs`/`node:path`/`node:stream`、`yauzl`、`VpmError`。
- 不依赖 Electron、HTTP、`../cache`、渲染层；不直接 import 核心 `project`/`import`/`bridge`。
- **`archive.ts` 不读、不写 `vpm.db`**：它是纯文件适配器，状态由调用方（P4-C）经
  `OperationStore` 记账。
