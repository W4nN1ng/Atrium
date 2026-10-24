# P4-D 交接文档（失败注入、崩溃恢复与并发）

> 写于 **2026-10-22 16:10**。读者：接手 P4-E 的下一个工作站 Agent。
>
> 分支 `codex/vpm-p4d-failure-recovery`（基于 P4-C 分支）。
> 本卡是 P4 的"出门条件"：**失败注入全绿、恢复不留半成品、同工程并发被拒**。

---

## 0. 一页结论（先读这段）

**P4-D 已完成。下一个工作站可以直接开 P4-E。**

| 项 | 状态 |
|---|---|
| 代码实现 | ✅ 3 个新测试文件 + 1 个测试夹具 + 5 个改动文件 |
| 全量测试 | ✅ `2442 passed / 1 failed / 19 skipped (2462)`；唯一红的是无关 perf 噪声，见 §6.1 |
| 定向测试 | ✅ `tests/vpm/install` = **6 files / 103 tests** |
| 类型检查 | ✅ `tsc --noEmit` exit 0 |
| 失败矩阵 | ✅ 24 个注入点逐个验证，表在 `install/README.md` |
| 崩溃恢复 | ✅ 提交点前后、rename↔markCommitPoint 窗口、幂等、Unity 活动、外部改动 |
| 并发 | ✅ 同工程拒绝、不同工程并行、锁在正常/崩溃后释放 |
| 任务板状态 | ✅ `docs/VPM-TASKS.md` 里 P4-D 已是 `done`，§12 有交接记录 |
| **未验证** | ❌ **仍然没有在真 Unity 沙盒里装过包**（详见 §7） |

**下一步：`git checkout -b codex/vpm-p4e-package-ui` 开 P4-E。**

---

## 1. 现场精确状态

```
分支：codex/vpm-p4d-failure-recovery（从 codex/vpm-p4c-transaction 切出）
上一张卡：P4-C（2 个 commit 在 codex/vpm-p4c-transaction 上）
```

### 1.1 新增文件

| 文件 | 作用 |
|---|---|
| `tests/vpm/install/failure-injection.spec.ts` | 29 条：24 个注入点 + 下载 hash 不符 + legacy 失败 + 崩溃模拟 + 不变量 |
| `tests/vpm/install/recovery.spec.ts` | 15 条：提交点前后恢复、窗口、归档补完、幂等、wait、外部改动、journal 损坏 |
| `tests/vpm/install/concurrency.spec.ts` | 9 条：工程锁、并行、锁释放、活动闸门、双击、事务中途外部改动 |
| `tests/vpm/install/harness.ts` | 三个用例共用的临时工程/DB/回滚仓夹具（非 spec） |
| `docs/VPM-P4D-HANDOVER.md` | 本文档 |

### 1.2 改动文件

| 文件 | 变化 |
|---|---|
| `src/main/vpm/install/transaction.ts` | 24 个注入点、`crashOnError`、进程内工程锁、`runApply` 拆分 |
| `src/main/vpm/install/recovery.ts` | 真实回滚 + 补完归档 + manifest 对账 + 关掉遗留 running 步骤；`apply` 变 async |
| `src/main/vpm/install/types.ts` | `RecoveryReason` 新增 `project_changed` |
| `src/main/vpm/install/index.ts` | 导出 `TRANSACTION_HOOK_POINTS` 与 hook 类型 |
| `src/main/vpm/fsUtil.ts` | 新增 `renameSyncWithRetry`（恢复用） |
| `src/main/vpm/index.ts` | vault 先于 recovery 构造；`await recovery.scanAndApply()` |
| `src/main/vpm/install/README.md` | 失败矩阵、恢复语义、并发与锁、测试入口 |
| `tests/vpm/install/journal.spec.ts` | 恢复语义变更：beforeHash 改成真实值；`apply` 改 await；未提交失败 → `failed` |
| `tests/vpm/runtime.spec.ts` | 启动恢复用例改成真实工程夹具，断言 `failed` 且 manifest 未被改写 |
| `docs/VPM-TASKS.md` | P4-D 标 done + §12 交接段 |

---

## 2. 失败注入：怎么做的、证明了什么

### 2.1 注入点（测试专用，不是环境变量开关）

```ts
new InstallTransactionService({
  ...,
  hooks: {
    onPoint: (point, ctx) => { if (point === 'move-in:item:after') throw new Error('boom') },
    crashOnError: false   // true = 模拟进程死亡
  }
})
```

24 个点：`prepare:before/after`、`download:before/after`、`extract:before/after`、
`move-out:before/item:before/item:after/after`、`move-in:*` 同理、
`manifest:before/after-write/after-rename/after-commit-point`、`legacy:before`、
`vault:before/after`、`cleanup:before/after`。

组合根**不传** `hooks`，运行时没有任何开关能让用户触发这些点。

### 2.2 失败矩阵（实测结果，升级 `1.0.0 → 2.0.0`）

| 注入点 | 状态 | 工程文件 | manifest |
|---|---|---|---|
| `prepare:*` / `download:*` / `extract:*` | `failed` | 未改动 | 未动 |
| `move-out:before` / `move-out:item:before` | `failed` | 未改动 | 未动 |
| `move-out:item:after` / `move-out:after` | `rolled_back` | 旧包回原位 | 逐字节一致 |
| `move-in:before` / `move-in:item:before` | `rolled_back` | 旧包回原位 | 逐字节一致 |
| `move-in:item:after` / `move-in:after` | `rolled_back` | 新包进 `rolledback/`、旧包回原位 | 逐字节一致 |
| `manifest:before` / `manifest:after-write` | `rolled_back` | 旧包回原位 | 逐字节一致 |
| `manifest:after-rename` | `needs_attention` | 新包就位 | **已是新 manifest** |
| `manifest:after-commit-point` | `needs_attention` | 新包就位 | 已是新 manifest |
| `legacy:before` | `committed` + warning | 包已换好，旧 Assets 未动 | 新 manifest |
| `vault:before` / `vault:after` | `committed` + warning + `vault_pending=1` | 包已换好 | 新 manifest |
| `cleanup:before` / `cleanup:after` | `committed` + warning | 包已换好 | 新 manifest |

"逐字节一致"的判定方式：对整棵工程树（跳过 `.atrium-tx`）逐文件算 SHA-256 再比较，
不是只看 manifest 文本。

### 2.3 为什么 `legacy` / `vault` / `cleanup` 失败不 fail 整个操作

它们都在**提交点之后**。包已经换好、manifest 已经落盘，此时把操作标成 `needs_attention`
会让用户以为工程不可用。所以：

- legacy 失败 → `vpmLegacyCleanupFailed`（旧文件还在，可以再来一次）；
- vault 失败 → `vpmVaultArchiveFailed` + `vpmVaultPending`，事务区保留可重试；
- cleanup 失败 → `vpmTransactionFailed` 警告，只影响临时区。

**但**模拟崩溃（`crashOnError: true`）时这些 catch 会把错误继续抛出去，
所以崩溃测试仍然能看到"进程死在 vault 之前"的真实现场。

---

## 3. 恢复：判定与执行

### 3.1 判定（`scan()`，只读）

| 条件 | 判定 |
|---|---|
| 工程目录不存在 | `needs_attention` / `project_missing` |
| Unity 或素材导入正在用这个工程 | `wait` / `unity_running`（不改状态、不碰文件） |
| journal 缺失 / 损坏 / opId·工程键·kind 不符 | `needs_attention`（对应 reason） |
| `commitPoint = manifest_written` | `complete` / `manifest_committed` |
| **journal 还写 `before`，磁盘 manifest hash == `afterHash`** | `complete` / `manifest_committed` |
| 磁盘 manifest 既非 before 也非 after | `needs_attention` / `project_changed` |
| 其余 | `rollback` / `before_commit` |

第二条加粗的判据就是 P4-C 交接里点名的 rename↔markCommitPoint 崩溃窗口：
`setManifestHashes` 在 rename **之前**就把 `afterHash` 写进了 journal，所以恢复侧有证据。

### 3.2 执行（`apply()`，会动文件，async）

```text
complete:
  closeDanglingSteps()
  if commitPoint != manifest_written: markCommitPoint()   // 补证据
  transition(committed)
  finishArchive()                                          // 尽力而为

rollback:
  closeDanglingSteps()
  move-in  done/pending 的包: Packages/<id> → rolledback/<id>
  move-out done/pending 的包: trash/packages/<id> → Packages/<id>
  legacy   done/pending 的项: trash/legacy/Assets/... → Assets/...
  manifest 与 beforeHash 不一致: manifest.original.json → Packages/vpm-manifest.json
  moved > 0 ? transition(rolled_back) : transition(failed)
```

- 每一步都**先看磁盘现状**（目标存在才动），所以重复执行不会产生新的移动；
- 已终态的操作 `apply` 直接返回 `applied: false`；
- 回滚任一步抛错 → `needs_attention` + `vpmRollbackFailed`，**不删任何文件**；
- `closeDanglingSteps()` 把崩溃留下的 `running` 步骤标成 `failed`，否则后续 `beginStep`
  和人工操作都会被 `vpmRunningStep` 挡住；
- 恢复**不重跑** legacy 清理：那是前进操作，不是回滚。崩溃在 legacy 之前时，包已提交、
  旧 Assets 留在工程里——符合"宁可留旧文件"。

### 3.3 归档补完

`complete` 之后会扫 `journal.moves` 里 `move-out`/`legacy` 且仍存在于 `trash` 的条目，
调 `VaultStore.archive()` 归档。成功 → `vault_pending=0`；失败 → 保持 `vault_pending=1`，
事务区不动，工程仍可用。

**注意**：`trySetVaultPending` 不能拿 `applyOne` 开头读到的 `operation` 快照做"值没变就跳过"，
否则归档成功后会漏写 `false`（P4-D 实际踩到过，已修）。

---

## 4. 并发与工程锁

| 机制 | 位置 | 作用 |
|---|---|---|
| 进程内锁 | `InstallTransactionService.activeProjects` | 同工程第二个 `apply()` 立刻 `vpmProjectBusy`，连操作行都不建；`finally` 释放，崩溃随进程消失 |
| 持久锁 | `vpm_operation` 部分唯一索引（`planned/preflight/applying`） | 跨进程兜底 |
| 活动闸门 | `ProjectActivityPort` | `unityRunning`/`importing` 时预检拒绝；端口抛错按 `vpmUnityRunning` 拒绝（fail closed） |
| 外部改动 | 提交前重读 manifest 算 hash | 不一致 → 回滚，且**不覆盖**外部内容 |
| 双击 | 同一 `planId` 再应用 | manifest 已变 → `vpmProjectChanged`，不重复安装 |

不同工程可以并行：各自的 journal、事务区、回滚仓目录互不相交。

---

## 5. 代码里最值得先读的三处

1. `transaction.ts` 的 `runApply()` / `execute()` / `fail()`：状态机与注入点都在这里。
2. `recovery.ts` 的 `decide()` / `rollbackFiles()` / `finishArchive()`：判定、回滚、归档三段。
3. `tests/vpm/install/harness.ts`：想加用例时直接 `h.addProject()` + `h.makePlan()` +
   `h.apply(project, planId, { hooks })`。

---

## 6. 证据（实际跑过，可复现）

```
npm run typecheck                                   → exit 0
npx vitest run tests/vpm/install                    → 6 files / 103 tests passed
npx vitest run（全量）                              → 189 passed | 1 failed | 9 skipped (199 files)
                                                      2442 passed | 1 failed | 19 skipped (2462 tests)
                                                      耗时约 185s
npx vitest run tests/classify/unitypackage.spec.ts  → 21 passed | 1 skipped（单独跑全绿）
```

定向明细：archive 8 / journal 13 / transaction 29 / failure-injection 29 / recovery 15 / concurrency 9。

### 6.1 全量里那 1 条红（**不是回归**）

```
FAIL  tests/classify/unitypackage.spec.ts > 32MB 的 asset 主体不该进内存
AssertionError: expected <heap growth> to be less than 16777216
```

- 单独重跑该文件 **21 passed**；P4-C 那次全量红的是同一个用例的耗时断言（5005ms vs 5000ms），
  这次是内存断言 —— 同一个 flaky 用例在不同并行压力下换着红；
- 与 P4-D 代码路径零重叠：该用例只 import `src/main/classify`；
- **没有放宽阈值**。下次全量若再看到，先单独重跑该文件再判断。

---

## 7. 未验证项（**照实记录**）

> **2026-10-22 更新**：本节的多数条目已在 `docs/VPM-P4-VERIFICATION.md` 里用真实字节验证过
> （真实仓库下载、真实 zip 解压、statfs、长路径、真实 EBUSY/EPERM、跨进程并发、进程被杀后恢复、
> 缓存配额与 `vpm_cache_entry` 一致性）。仍然未验证的只有需要真 Unity / Electron 的项与真断电。

1. **真 Unity 沙盒装包**：一次都没开过 Unity。P4-E 的出门条件。
2. **真实仓库包**：没有对 VRChat 官方/curated 仓库跑过完整流程。
3. **rename 被占用**（EBUSY/EPERM）：恢复用的是同步立即重试（3 次），没有在真实占用下验证过。
4. **跨进程并发**：两个 Atrium 实例同时操作同一工程，只有 DB 唯一索引兜底，没有实测。
5. **真断电**：只做了"重复执行恢复"的幂等验证，没有在恢复中途再杀一次进程。
6. **长路径 >260**：未实测。
7. **`.atrium-tx` 是否被 Unity 忽略**：仍然是 P4-C 留下的真机项。

---

## 8. 给 P4-E 的接口与坑

### 8.1 可以直接用的

```ts
// 应用计划
const result = await runtime.transactions.apply({
  projectKey,
  planId,                       // 只给 planId，不给计划内容
  onProgress: (p) => emit('vpm:operation', p)   // { step, phase, index, total }
})

// 恢复（启动时组合根已经跑过一次；UI 只做展示/确认）
const decisions = runtime.recovery.scan()       // 同步、只读
await runtime.recovery.apply(decisions)         // async、会动文件
```

### 8.2 必须注意

1. **`apply()` 只在"操作开不起来"时抛错**（`vpmPlanNotFound`/`vpmPlanExpired`/`vpmPlanChanged`/
   `vpmProjectInvalid`/`vpmProjectBusy`/`vpmRecoveryRequired`）；预检拒绝和执行失败都通过
   返回值的 `status`/`errorCode`/`warnings` 表达。IPC 层不要把这三种混成一种。
2. **`warnings` 要原样透传**：`vpmLegacyCleanupSkipped`/`vpmVaultArchiveFailed` 的 `detail`
   是 `reason:path` 明细，UI 折叠展示，不要丢掉。
3. **不要自己判断"要不要恢复"**：判定在 `recovery.scan()`，UI 只展示 decision 并让用户确认。
   `needs_attention` 只能由人工推进到 committed/failed/rolled_back。
4. **进度事件是内存回调**，不落库；崩溃后没有历史进度，只有 journal 的步骤记录。
5. `planId` 有效期 10 分钟（`PlanService`），过期要提示"重新预览"。

---

## 9. 环境与坑（省得下个工作站重新踩）

| 坑 | 说明 |
|---|---|
| `better-sqlite3` ABI | 跑测试前先 `npm run native:node`；构建过 Electron 之后必然要切回来 |
| 全量测试约 3.5 分钟 | `tests/perf/scale.spec.ts` 一个文件就 160s |
| 全量测试 PowerShell 报 `exit code 1` | Vite CJS 警告走 stderr，**不是失败**，看 `Test Files` 行 |
| 项目路径含中文 | `C:\程序\A素材管家`，shell 里注意引号 |
| 真机沙盒规则 | `AVCA_APP_HOME` 必须含 `avca`/`sandbox` 且带 `AVCA_REQUIRE_SANDBOX_HOME=1`；**绝不用 `E:\vrc\A`、`E:\Atriumdate`、`%APPDATA%\A\library.db` 做试验** |
| Unity 版本 | 真机一律 **2022.3.22f1**；不要 `taskkill /F /IM Unity.exe`（会误杀 Hub），按 PID 杀 |
| 数据根 | 必须**非 C**；没有合法数据根就不启用 VPM |
| **不要弹窗** | 用户明确要求：开发期间不启动 Electron/dev server/浏览器预览，只用无头命令 |

---

## 10. 如果只能记三件事

1. **P4-D 已经落地**：24 个注入点全绿，恢复能真的回滚/补完，同工程并发被拒。
2. **恢复的判据是"磁盘优先"**：journal 说 before、磁盘 manifest 说 after，就按 after 算——
   这是 rename 与 markCommitPoint 之间崩溃窗口的唯一正确解法。
3. **还是没在真 Unity 里装过包**：P4-E 的第一件事应该是沙盒真机跑一次
   "装真实小包 → 打开 Unity 确认 → 关 Unity → 卸载 → 撤销"。
