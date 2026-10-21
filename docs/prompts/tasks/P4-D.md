# P4-D 失败注入、崩溃恢复与并发

> 阶段规格：`../VPM-P4.md`（只读 §11.1–§11.3）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P4-C
> 覆盖对账项：B19 / B23 / B29 / I3 / K4
> 建议上下文：≤ 30k tokens

## 目标

- 给事务每一步加失败注入，证明无半成品、manifest 不被错误改写、可回滚。
- 实现启动恢复：能安全回滚的自动回滚，不能判定的标 needs_attention。
- 实现工程级并发锁与外部变更检测，防两个操作同时改一个工程；
  接 P4-F 的工程活动闸门，素材写入进行中不允许包事务。

## 不做什么

- 不加新功能、不改事务语义（只修 bug）。
- 不做 UI（P4-E）。
- 不靠“重新安装一遍”掩盖回滚失败。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §7.1、§7.3、§10.3
- `docs/prompts/VPM-P4.md` §11.1–§11.3
- `install/transaction.ts`、`journal.ts`、`recovery.ts`

## 文件所有权

- 扩展：`tests/vpm/install/failure-injection.spec.ts`、`recovery.spec.ts`、`concurrency.spec.ts`
- 修改：`install/transaction.ts`、`recovery.ts`、`state.ts` 只修失败路径
- 新增：`install/README.md` 的失败矩阵

## 交付物

- 每一步失败用例 + 断言（文件树/manifest/vault/journal）。
- 崩溃在步骤前/后/中间的状态与恢复结果。
- 工程锁：同工程第二个操作被拒绝；不同工程可并行；导入活动中拒绝安装。
- 失败矩阵文档。

## 施工步骤

1. 列出所有步骤与失败点。
2. 逐个注入失败，先让测试红。
3. 修事务/恢复，直到全部回滚或 needs_attention。
4. 加并发/外部修改测试。
5. 把失败矩阵写进 README。

## 契约与不变量

- 没有“半装”状态被标成功。
- 恢复不删除用户文件；只回滚能证明的部分。
- 锁不跨进程泄漏；退出/崩溃后可恢复。

## 测试与证据

- 所有步骤失败注入通过。
- 崩溃恢复不留半成品。
- 同工程并发被拒；不同工程可并行。
- 全量测试/typecheck。

## 完成定义

- P4 出门条件：失败注入全绿。
- 失败矩阵在 README 可查。
- 更新 `docs/VPM-TASKS.md`：该任务标为 done（或按实际状态标 blocked/review）。
- PR 含交接段；未验证项明确写出。

## 交接（写进 PR）

```text
Task: <ID>
状态: 完成 / 部分 / 阻塞
公开 API/契约变化: ...
新增/修改模块 README: ...
已验证: ...
未验证: ...
给下一个任务: ...
```

共同质量闸门、沙盒规则、停止规则见 `../_COMMON.md`。
