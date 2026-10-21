# P2-C 工程台账 v2、VCC 工程与核心整合

> 阶段规格：`../VPM-P2.md`（只读 §5.6、§6）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P2-A、P2-B
> 覆盖对账项：A1 / A2 / A3 / A18 / A23 / B28 / F1
> 建议上下文：≤ 30k tokens

## 目标

- 把 P2-B 的工程快照缓存到 vpm.db v2，支持添加/移除记录（不删盘）。
- 只读导入 VCC `settings.json` 的 userProjects，去重，不写 VCC。
- 与现有工程发现/运行状态整合：VPM 记录只是附加台账，不取代核心发现器。

## 不做什么

- 不修改核心 `library.db` schema；不写 VCC。
- 不复制工程、不改工程。
- 不做工程页 UI（P2-D）。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§7.3
- `docs/prompts/VPM-P2.md` §5.6、§6
- `src/main/project/`、`src/main/index.ts`（工程发现/当前工程）
- `src/main/vpm/gate.ts` 的 deps 接口

## 文件所有权

- 新增：`src/main/vpm/projects/`（ledger、reader 适配、VCC 工程读取）
- 使用：P2-A 已建的 vpm.db v2 工程表（本卡不新增迁移）
- 修改：`src/main/vpm/index.ts` 组合根、`gate.ts` 的 deps（只加必要读取）
- 新增：`tests/vpm/projects/*.spec.ts`

## 交付物

- 工程台账：路径、Unity 版本、manifest 快照、最后扫描时间、状态。
- 添加/移除记录；移除只删 VPM 台账记录，不删核心工程、文件或导入历史；重复路径归一。
- VCC userProjects 只读导入与去重；不写 VCC。
- 与核心 detectedProjects/运行状态的只读合并策略。

## 施工步骤

1. 确认 v2 工程表存在（P2-A 已建），不重复迁移。
2. 实现台账仓储与快照更新。
3. 接 VCC settings 只读导入。
4. 接核心工程发现（只读），写合并/去重测试。
5. 在 README 写清楚“VPM 台账 vs 核心发现”的职责边界。

## 契约与不变量

- 移除台账不删盘、不删工程。
- VCC 目录只读；不写 LiteDB。
- 核心工程发现仍是事实来源，VPM 不另起一套 watcher。

## 测试与证据

- 添加/移除/重复/不存在；移除后文件仍在。
- VCC settings 正常/坏 JSON/缺字段；去重。
- 核心运行状态合并不回归。
- 全量测试/typecheck。

## 完成定义

- 台账只读/记录级，不改工程。
- VCC 读取有只读测试（写调用不存在）。
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
