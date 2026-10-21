# P2-E 当前工程与导入目标联动

> 阶段规格：`../VPM-P2.md`（只读 §6.1、§7）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P2-D
> 覆盖对账项：K1 / K3 / K6
> 建议上下文：≤ 25k tokens

## 目标

- 在核心 `UnityConnections` 上增加“启动绑定”状态，让 Atrium 启动/打开工程时**立即**成为导入目标，
  不必等桥接就绪。
- 固定目标优先级：用户显式选择 > Atrium 启动绑定 > 仅一个运行工程时自动。
- VPM 工程页只展示目标，不另存一份“当前工程”；真正启动 Unity 在 P5-D，本卡只做核心状态与测试。

## 不做什么

- 不启动 Unity、不创建工程、不写工程文件。
- 不持久化目标到设置/数据库；重启后按现有规则重新解析。
- 不改变双击素材的导入实现，也不改导入冲突/备份规则。
- 不做工程活动闸门（P4-F）。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6.4.1、§7.3
- `docs/prompts/VPM-P2.md` §6.1、§7
- `src/main/project/connections.ts`、`src/main/bridge/ipc.ts`、`src/shared/unityConnection.ts`
- `src/renderer/stores/ui.ts` 的 `ensureImportTarget` 与现有目标选择器

## 文件所有权

- 修改：`src/main/project/connections.ts`、`src/main/bridge/ipc.ts`、`src/main/index.ts`
- 修改：`src/shared/unityConnection.ts`
- 新增：`src/shared/vpm/linkage.ts`（纯类型，不碰 IO）
- 修改：`src/renderer/vpm/components/projects/*`（目标徽标/选择器）、`src/renderer/stores/ui.ts`（只接线）
- 新增/修改：`tests/project/connections.spec.ts`、`tests/project/connections-ipc.spec.ts`、
  `tests/renderer/unity-target-preparation.spec.ts`、`tests/vpm/linkage.spec.ts`

## 交付物

- `ProjectLinkagePort` 的目标部分：`currentTarget/bindLaunchTarget/clearLaunchTarget`。
- `UnityConnections` 内部记录启动绑定，快照返回 `targetMode=launch` 和启动中/等待状态。
- 显式 `select()` 清除启动绑定；工程移除、启动失败、启动过又关闭时清除。
- 双击素材在目标启动中时等待（沿用 180s/取消规则），不弹“没有目标”，不改投其他工程。
- 工程页/顶栏显示“当前导入目标”徽标；多实例时说明为什么选它。

## 施工步骤

1. 先写状态机测试：绑定未启动工程 → 成为目标；启动完成 → 保持；关闭 → 清除。
2. 加显式选择覆盖、移除工程、启动失败清理、多个运行工程时优先级。
3. 接 `bridge/ipc.ts` 的目标解析和 `ensureImportTarget`；导入计划仍固定 projectId。
4. 接工程页徽标/选择器；不新增顶级导航。
5. 跑定向 `tests/project`、`tests/renderer/unity-target-preparation.spec.ts`、全量测试。

## 契约与不变量

- 当前目标只有一个来源：核心 `UnityConnections` 快照；VPM 台账/渲染层不得缓存第二份。
- 启动绑定不是工程写入，也不要求 Unity 已运行。
- 绑定工程被移除/启动失败/启动后关闭 → 清除，不能留下陈旧目标。
- 显式选择优先于启动绑定；绑定优先于“单工程自动”。
- 目标切换不会改变已提交导入任务的 projectId；后续批次仍用它。
- 不跨重启持久化；避免把已关闭/已移动的工程当目标。

## 测试与证据

- 单元：未运行绑定、启动中等待、启动完成保持、关闭清除、移除清除、启动失败清除。
- 优先级：显式选择 > 启动绑定 > 单工程自动；多工程无绑定时仍 ambiguous。
- 导入：目标启动中双击进入等待；取消不卸载桥接；不会转到另一个运行工程。
- 渲染 wiring：徽标/选择器读同一快照；没有第二份 target 状态。
- 全量测试/typecheck。

## 完成定义

- 核心目标状态与优先级有测试，"打开工程即目标"的 API 可供 P5-D 直接调用。
- 没有启动 Unity/工程写入/数据库迁移。
- 更新 `docs/VPM-TASKS.md`：该任务标为 done（或按实际状态标 blocked/review）。
- PR 含交接段；未验证项明确写出。

## 交接（写进 PR）

```text
Task: P2-E
状态: 完成 / 部分 / 阻塞
公开 API/契约变化: ProjectLinkagePort 目标方法；UnityConnectionSnapshot.targetMode/附加状态
新增/修改模块 README: project/README 或 VPM-ARCHITECTURE 联动段
已验证: ...
未验证: 真 Unity 启动/双击导入（P5-E）
给下一个任务: P5-D 启动前调用 bindLaunchTarget；失败 clear；P4-F 再扩展 activity
```

共同质量闸门、沙盒规则、停止规则见 `../_COMMON.md`。
