# P4-A vpm.db v3、journal 与操作状态机

> 阶段规格：`../VPM-P4.md`（只读 §4、§7.1、§7.4）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P3-C
> 覆盖对账项：B19 / I3
> 建议上下文：≤ 25k tokens

## 目标

- 建立操作/步骤 journal 与状态机：planned/preflight/applying/committed/failed/rolled_back/needs_attention。
- 迁移 vpm.db v3，记录操作、计划 hash、工程指纹、每步状态与证据。
- 实现启动时恢复扫描骨架：只处理能证明安全的操作。

## 不做什么

- 不执行真实安装、不下载、不写工程。
- 不做 UI（P4-E）。
- 不在 journal 里存 token/文件内容。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §6.4、§7.1、§8
- `docs/prompts/VPM-P4.md` §4、§7.1、§7.4
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §4.2
- `src/main/vpm/db/`

## 文件所有权

- 新增：`src/main/vpm/install/journal.ts`、`state.ts`、`recovery.ts` 骨架
- 新增：vpm.db v3 迁移
- 新增：`tests/vpm/install/journal.spec.ts`

## 交付物

- operations/operation_steps 表与仓储。
- 合法状态迁移 + 非法迁移拒绝。
- 每步开始/结束写 journal；幂等键。
- 恢复扫描：未完成操作→needs_attention 或安全回滚（先只做判定）。

## 施工步骤

1. 定义状态机与表结构。
2. 实现迁移 v3 与仓储。
3. 实现状态迁移与 journal 写入。
4. 实现恢复判定骨架。
5. 写状态/崩溃模拟测试。

## 契约与不变量

- 一个工程同时最多一个 applying 操作。
- journal 只追加/更新状态，不删历史。
- 无法判定的恢复必须 needs_attention，不自动猜。

## 测试与证据

- 合法/非法状态迁移。
- 每步 journal 顺序与幂等。
- 模拟崩溃在步骤之间→恢复判定。
- 全量测试/typecheck。

## 完成定义

- journal/状态机可被 P4-C 直接使用。
- 恢复不会对未完成操作假装成功。
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
