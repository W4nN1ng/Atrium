# P3-C 变更计划、卸载、升级全部与解释

> 阶段规格：`../VPM-P3.md`（只读 §4.5–§4.6）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P3-B
> 覆盖对账项：B5 / B7 / B8 / B9 / B11 / B27
> 建议上下文：≤ 25k tokens

## 目标

- 把解析结果转成可读的变更计划：装/升/降/重装/卸载/保持。
- 实现 mark-and-sweep 卸载、批量升级全部、受保护包规则。
- 计划包含风险/冲突/缺失/来源解释，供 UI 与事务预检使用。

## 不做什么

- 不执行计划、不写工程。
- 不做计划 UI（P3-D）。
- 不把解释文案写进主进程。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §6.3、§8
- `docs/prompts/VPM-P3.md` §4.5–§4.6
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §3.2
- `src/shared/vpm/domain/resolver.ts`

## 文件所有权

- 新增：`src/shared/vpm/domain/plan.ts`
- 新增：`tests/vpm/domain/plan.spec.ts`
- 修改：`domain/README.md` 的计划语义

## 交付物

- `ChangePlan`：动作、包、from/to、来源、原因、风险标记。
- 卸载根可达性/mark-and-sweep；升级全部 preset。
- 计划 hash（供事务预检/幂等）。
- 冲突/缺失解释结构（包、要求来源、可选版本、原因码）。

## 施工步骤

1. 定义计划 DTO 与动作枚举。
2. 实现 diff 与卸载清理。
3. 实现 upgradeAll preset 与受保护包过滤。
4. 实现解释结构与 plan hash。
5. 写变更/空计划/冲突测试。

## 契约与不变量

- 计划只读，不产生文件/网络副作用。
- 同一输入的计划 hash 稳定。
- 受保护包不出现在可执行动作里。

## 测试与证据

- 装/升/降/重装/卸载/保持。
- mark-and-sweep 只清无用依赖。
- upgradeAll 与单包同一语义。
- 全量测试/typecheck。

## 完成定义

- 计划能被事务预检直接消费。
- 每个动作都有原因/来源。
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
