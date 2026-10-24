# VPM P9-B 可靠性与并发硬化报告

> 2026-10-23。范围：`docs/prompts/tasks/P9-B.md`（I3/I9）。
> 只扩大失败/恢复/并发证据并修恢复路径；**没有改事务语义、没有 schema 迁移、没有新增产品功能**。
>
> 复现：
>
> ```bash
> npm run native:node
> npx vitest run tests/vpm/reliability
> npx vitest run tests/vpm/install/failure-injection.spec.ts \
>   tests/vpm/install/recovery.spec.ts tests/vpm/install/concurrency.spec.ts \
>   tests/vpm/install/process.spec.ts
> npx vitest run tests/vpm/ipc/install.spec.ts tests/renderer/vpm-recovery.spec.ts
> ```

## 1. 结论

- **`needs_attention` 不再只有状态没有出口**：新增 `RecoveryService.inspect()/recover()`，
  IPC `vpm:operation-recover`，操作结果与历史行都能看到原因并重试。
- 恢复动作**不由渲染层指定**：只传 `operationId`，主进程每次重新读 journal + 磁盘判定；
  点按钮前外部又改 manifest 也不会执行旧判定（有用例）。
- 证据不足（journal 缺失/损坏/对不上、工程不存在、manifest 被外部改成第三态）时
  **只解释、不动文件**；证据修好后同一操作可以再次恢复。
- Unity 占用时恢复返回 `wait`，不写工程；关闭 Unity 后再点即可。
- 同进程事务、素材导入、备份/复制/迁移/换版本的维护租约也会返回 `wait/project_busy`；
  占用检查自己抛错按占用处理（fail closed）。
- 恢复期间 UI 显示"正在恢复"，不能取消（恢复本身不是可取消的下载事务），也不能关掉
  对话框把未完成状态藏起来。
- 维护租约、进程内活动锁、DB 活动行在成功/失败/模拟崩溃/批量失败/多轮崩溃恢复后
  都没有泄漏。
- 发现并修复 1 个真实可靠性问题：**提交后的归档补完若在 `lstat/transactionLayout`
  阶段抛错，会从 `scanAndApply()` 冒出去，卡住整个 VPM 运行时启动**。现在归档阶段
  任何意外都只保留 `vault_pending`，不阻塞启动/工程。
- 40 次连续真实文件事务后 active 行 0、running 步骤 0、journal 全 `committed`、
  SQLite `integrity_check=ok`。
- 归档阶段的"看不了事务区"（`EACCES`）不会把已提交的操作变回失败，也不会卡启动；
  只保留 `vault_pending`，后续可重试。

## 2. 失败注入全集（既有 + 本次复核）

`TRANSACTION_HOOK_POINTS` 共 **24 个**，`failure-injection.spec.ts` 逐点注入，
`failure-matrix.spec.ts` 另有静态闸门确认每个点都真的从事务里触发：

| 阶段 | 注入点 | 结果 |
|---|---|---|
| prepare | before / after | `failed`，文件树不变 |
| download | before / after | `failed`，文件树不变；hash 不符 `vpmCacheHashMismatch` |
| extract | before / after | `failed`，文件树不变（安全解压另有攻击矩阵） |
| move-out | before / after / item before / item after | 前两点 `failed`，后两点 `rolled_back` |
| move-in | before / after / item before / item after | `rolled_back`，新包进 `rolledback/` 不删 |
| manifest | before / after-write | `rolled_back`，manifest 字节回到 before |
| manifest | after-rename / after-commit-point | `needs_attention`，磁盘已是新 manifest |
| legacy | before / after | `before` 只报警告、资源不动；`after` 已清理的资源仍进回滚仓，只报警告 |
| vault | before / after | `committed` + `vault_pending=1`，工程可用 |
| cleanup | before / after | `committed` + 警告，事务证据保留 |

另有真实/半真实故障：

| 故障 | 证据 | 结果 |
|---|---|---|
| manifest 只读 → 真实 EPERM | `failure-injection.spec.ts` | 回滚，旧包恢复 |
| 包目录被别的进程占用 → 真实 EBUSY | 同上 | 重试后回滚 |
| 回滚本身失败 | 同上 | `needs_attention` + `vpmRollbackFailed`，现场保留 |
| 下载 hash 与计划不符 | 同上 | 拒绝，不落盘 |
| legacy 清理失败 | 同上 | 警告 + 继续，不回滚 |
| 磁盘空间不足 | `transaction.spec.ts` | 预检 `vpmProjectNoSpace`，不拿租约 |
| vault 不可用 | `transaction.spec.ts` | 预检/归档失败按契约处理 |
| 外部在事务中改 manifest | `concurrency.spec.ts` | `rolled_back`，外部内容保留 |

## 3. 崩溃点与恢复

| 崩溃窗口 | 判定 | 结果 |
|---|---|---|
| move-out / move-in 任一条目之后 | `rollback` | 旧包回 `Packages/`，新包进 `rolledback/` |
| manifest 新文件已写、尚未 rename | `rollback` | manifest 仍 before，字节完全恢复 |
| rename 成功、commitPoint 尚未写 | `complete` | 磁盘 manifest 是真相，补写提交点 |
| commitPoint 已写、归档前 | `complete` | 补完 vault，`committed` |
| 归档中崩溃 | `complete` | 包已可用，失败只留 `vault_pending` |
| Unity/导入占用 | `wait` | 不改状态、不碰文件 |
| 工程目录消失 | `needs_attention` | `project_missing` |
| journal 缺失/损坏/对不上 | `needs_attention` | 不自造证据 |
| manifest 被外部改成第三态 | `needs_attention` | 不覆盖外部内容 |

真实进程死亡：

- `tests/vpm/install/process.spec.ts`：事务中 `process.exit(37)`，新连接恢复；
- `tests/vpm/reliability/restart.spec.ts`：同样真实死亡后，**手动 recover**，
  随后另一个子进程能重新拿到同一工程的活动操作名额（跨进程锁确实释放）。

## 4. `needs_attention` 恢复路径（本次新增）

```text
UI 历史行 / 结果对话框
  → inspect(operationId)      只读：action + reason + journalPhase + canApply
  → recover(operationId)      主进程重新判定：
       rollback / complete → 真的回滚或补完
       needs_attention/wait → applied:false + 原因，文件/状态不动
```

边界：

- 只接受 `operationId`，不接受渲染层传动作、路径或 journal；
- 同一操作两路恢复互斥（`vpmProjectBusy`），不会同时 rename；
- 正在当前进程跑的操作拒绝恢复；
- `needs_attention` 的工程锁只在恢复成 `committed/rolled_back/failed` 后释放；
  **journal 永久无法修复时没有"强制解锁"**——宁可拒绝新操作，也不在无法证明现场时继续写；
- 恢复失败不改写 journal；修复后重新 `inspect` 会重新判定；
- 迁移/关闭 Unity 后不必重启应用。

UI：三语文案覆盖 10 种 reason；结果对话框显示原因与"尝试恢复/重新检查"，
历史行对未收尾操作提供"恢复"；动作结果仍写回同一条操作记录（journal 里有状态事件）。

## 5. 锁与泄漏审计

| 锁 | 获取 | 释放 | 证据 |
|---|---|---|---|
| 维护租约 `ProjectActivityPort` | 预检通过后、写盘前 | `finally`，release 幂等 | `reliability/locks.spec.ts`：成功/失败/模拟崩溃/12 连败全 `acquired=released` |
| 进程内活动锁 `activeProjects` | `apply()` 入口 | `finally` | 同工程并发、崩溃恢复后重试 |
| DB 活动行 | `vpm_operation` 部分唯一索引 | 终态 / 恢复 | 6 轮崩溃恢复无残留 active；跨进程子进程抢锁 |
| `needs_attention` 未解决锁 | `findUnresolved` | 恢复终态 | 损坏 journal 时拒绝新操作；修复后释放 |

"不泄漏"不等于"永远放行"：`needs_attention` 在证据不足时**故意**继续挡住该工程，
这是安全锁；报告与 UI 都必须把这个区别讲清楚。

## 6. 外部改动检测

- 事务开始/提交前各读一次 manifest hash，不一致就中止并回滚；
- 恢复每次重新按 `beforeHash/afterHash` 对账，第三态一律 `needs_attention`；
- `recover()` 在点击时重新判定，不复用 UI 上次的 `inspect` 结果；
- 恢复/回滚不覆盖外部写入的 manifest；旧包/旧 Assets 只移动不删除。

## 7. 长稳（加速版）

`tests/vpm/reliability/long-run.spec.ts`：同一工程连续 **40 次安装事务**：

- 40/40 `committed`，每次 manifest 依赖 +1；
- `listActive()` 每轮为空；最终 `findUnresolved=null`；
- 40 条操作记录全部 `committed`，无 `running` 步骤；
- 40 份 journal 全部 `commitPoint=manifest_written / phase=committed`；
- `PRAGMA integrity_check` = `ok`；
- 本机实测 **定向 9.75–10.18 秒；全量并行约 12.1 秒**（含真实 zip 解压/文件移动；
  不同机器/负载会不同）。

这不是数小时挂机；真机长时间运行仍归 P9-D 的安装版回归。

## 8. 真机/进程级验证

- Windows 11、Node v24.21.0（测试 ABI 137）、Electron 33.4.11（构建 ABI 130）。
- 真实子进程死亡 + 新连接恢复 + 另一进程抢锁：`restart.spec.ts` 通过。
- 真实 EPERM/EBUSY、真实磁盘/文件系统：沿用 P4-D 用例并通过。
- 安装版 0.9.0 的构建、安装、启动见 PR/任务板交接段。
- **P9-B 安装版实测**：`npm run build` 0（237 files / 2820 passed / 22 skipped；
  2842 tests；worker 依赖图 2 个文件全部自包含），静默重装 0.9.0 后启动，
  主日志 `15:44:52` 记录 VPM 运行时已加载、`degraded=false`、窗口 `visible=true`。

**未验证（明确留白）**：

- 没有在真实窗口里点"恢复"按钮（渲染层只有静态合同 + 单元/IPC 用例）；
- 没有在真 Unity 正开着工程时对**生产工程**执行恢复（Unity 归 P9-D 沙盒验收）；
- 没有做小时级长稳、断电、杀毒软件锁文件、网络盘/UNC 上事务的实测；
- journal 永久丢失后的处置仍需要人工从备份修复，产品不提供强制解锁。
