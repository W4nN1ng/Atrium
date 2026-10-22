# src/main/vpm/install

## 职责

P4 安装事务的持久化地基：`vpm_operation` / `vpm_operation_step` / `vpm_operation_file`
的操作状态机、工程内 `.atrium-tx/<op>/journal.json` 的原子读写，以及启动恢复扫描的判定骨架。

P4-A 只做“记录、判定、保守落状态”；真正的下载、解压、移动、manifest 写入、回滚和
回滚仓归档在 P4-B/P4-C/P4-D。

## 不负责什么

- 不下载、不解压、不移动/删除工程文件、不写 `Packages/`、不写 manifest。
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
- 运行：`npm test`（会先切 Node ABI）；涉及 Electron 构建时再跑 `npm run build:dir`。

## 谁依赖我 / 我依赖谁

- 被 `src/main/vpm/index.ts` 组合根使用；P4-C 的事务服务直接消费 `OperationStore`；
  P4-D/P4-E 消费 `RecoveryService`/操作历史；P8-B 消费操作记录。
- 依赖：`../db`（句柄类型）、`shared/vpm` 纯领域、`node:fs`/`node:path`、`VpmError`。
- 不依赖 Electron、HTTP、渲染层；不直接 import 核心 `project`/`import`/`bridge`。
