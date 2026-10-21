# P3-D 解析测试矩阵与只读计划 UI/IPC

> 阶段规格：`../VPM-P3.md`（只读 §5、§6）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P3-C、P2-D
> 覆盖对账项：B9 / B11 / B27 / I9
> 建议上下文：≤ 25k tokens

## 目标

- 补齐解析/计划的冲突、锁定、Unity 兼容、批量升级矩阵。
- 把计划预览接到工程页：动作、来源、冲突、风险；应用按钮明确禁用/说明下一阶段。
- IPC 只读，不写工程。

## 不做什么

- 不执行安装、不下载。
- 不提前做 P4 的事务 UI。
- 不允许 UI 直接拼解析逻辑。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §6.3、§6.5、§11
- `docs/prompts/VPM-P3.md` §5、§6
- `src/shared/vpm/domain/resolver.ts`、`plan.ts`
- `src/main/vpm/ipc/`、`src/renderer/vpm/`

## 文件所有权

- 新增：`tests/vpm/domain/resolver-matrix.spec.ts`、`plan-matrix.spec.ts`
- 新增：`src/main/vpm/ipc/plan.ts`、DTO
- 新增：`src/renderer/vpm/components/plan/*`、hook
- 修改：工程详情容器

## 交付物

- 矩阵测试：锁定/冲突/缺失/预发布/yanked/多源/受保护/批量。
- IPC：PlanResolve/PlanExplain；返回计划与解释。
- 计划预览 UI：空/冲突/可执行（但按钮禁用）/解释展开。
- 沙盒截图。

## 施工步骤

1. 补矩阵测试，先暴露解析不足。
2. 定 IPC/DTO，主进程校验工程路径。
3. 做计划预览组件，不接执行。
4. 补错误/冲突/空状态。
5. 沙盒截图 + 全量测试/typecheck。

## 契约与不变量

- 计划预览不写盘、不联网下载。
- 冲突必须显示到来源/版本级别。
- 应用按钮不假装可用。

## 测试与证据

- 矩阵用例全绿，且每个冲突有解释。
- IPC/渲染 wiring。
- 计划前后工程文件 mtime/hash 不变。
- 全量测试/typecheck。

## 完成定义

- 用户能看到“会发生什么/为什么不行”。
- P3 全程只读有证据。
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
