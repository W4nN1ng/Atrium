# P3-B 解析器引擎、锁定与冲突

> 阶段规格：`../VPM-P3.md`（只读 §4.2–§4.4）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P3-A、P1-D
> 覆盖对账项：B10 / B11 / B12 / B16 / B22 / K5
> 建议上下文：≤ 30k tokens

## 目标

- 实现确定性贪心解析：根依赖、locked、传递依赖、pending 队列、同名去重。
- 候选选择考虑仓库顺序、最高版本、预发布开关、Unity 兼容、yanked、受保护包。
- 冲突/缺失可解释；不回溯、不静默降级、不装一半。

## 不做什么

- 不写工程、不下载/安装。
- 不做 UI/计划展示（P3-C/D）。
- 不引入通用 SAT 求解器或复杂回溯。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §6.3、§7
- `docs/prompts/VPM-P3.md` §4.2–§4.4
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §3.2
- `src/shared/vpm/domain/version.ts`、`range.ts`、`manifest.ts`

## 文件所有权

- 新增：`src/shared/vpm/domain/resolver.ts` 及类型
- 新增：`tests/vpm/domain/resolver.spec.ts`
- 修改：`domain/README.md` 的解析语义

## 交付物

- `ResolverInput/ResolveResult`，纯函数、可重复。
- 根请求/已装/锁定/传递依赖的队列与来源记录。
- 冲突：版本不满足、来源冲突、缺失、Unity 不兼容、受保护包。
- 候选顺序规则写进 README，并有测试钉住。

## 施工步骤

1. 先用 fixture 写输入/输出测试。
2. 实现根依赖与 locked 处理。
3. 实现候选选择与 pending 队列。
4. 实现冲突收集与去重。
5. 用顺序/重复运行测试证明确定性。

## 契约与不变量

- 同样输入永远同样输出（顺序稳定）。
- 不回溯；冲突时返回原因，不偷偷换版本。
- 受保护包（至少 `com.avca.bridge`）不可被解析为安装/升级/降级/卸载，仓库同名包也拒绝。

## 测试与证据

- 根依赖/传递依赖/同名去重/锁定。
- 预发布/yanked/Unity 兼容/多仓库顺序。
- 冲突/缺失/受保护包。
- 全量测试/typecheck。

## 完成定义

- 解析器无 IO，可在毫秒级跑完 fixture 矩阵。
- 每个冲突都有结构化原因，不只是字符串。
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
