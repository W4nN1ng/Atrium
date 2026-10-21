# P4-E 包管理 UI、批量与真 Unity E2E

> 阶段规格：`../VPM-P4.md`（只读 §9、§10、§12）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P4-D、P2-D
> 覆盖对账项：B2 / B4–B9 / B26 / B27 / B28 / I1 / I9 / K5
> 建议上下文：≤ 35k tokens

## 目标

- 把装/升/降/重装/卸载接到工程页；版本下拉、批量变更条、一键升级全部。
- 展示计划预览、风险提示、进度/取消、失败/needs_attention、撤销上一次入口。
- 真 Unity 2022.3.22f1 沙盒验证装包后的工程能打开且包正确。

## 不做什么

- 不改事务核心逻辑（除修 bug）。
- 不做备份/迁移/建工程（P5/P6）。
- 不新增常驻批量工具栏。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §6.4、§6.5、§11
- `docs/prompts/VPM-P4.md` §9、§10、§12
- `install/`、`ipc/`、`renderer/vpm/`

## 文件所有权

- 新增：`src/main/vpm/ipc/install.ts`、DTO
- 新增：`src/renderer/vpm/components/packages/*`、hooks
- 修改：工程详情/包列表容器
- 新增：`tests/vpm/ipc/install.spec.ts`、`tests/vpm/e2e/install-sandbox.*`

## 交付物

- UI：已装版本下拉、最新版本、来源、移除、批量选中后变更条、升级全部。
- 操作进度/取消/失败/needs_attention；撤销上一次（仅最后一次且工程未变）。
- 风险提示：包可能执行编辑器脚本；首次装包/添加仓库提示。
- 受保护包 `com.avca.bridge` 显示为系统包：无版本下拉/移除/升级入口，并说明桥接用途。
- 真 Unity 沙盒 E2E 记录 + 截图。

## 施工步骤

1. 先接 IPC 与 hooks，确保操作状态可拉取。
2. 做单包操作与版本下拉。
3. 做批量/升级全部与变更条。
4. 做进度/失败/撤销。
5. 真 Unity 沙盒验证并留证据。

## 契约与不变量

- Unity 运行中或素材写入进行中，装包入口禁用并说明；受保护包不出现可变更操作。
- 批量操作走同一个计划/事务，不绕开预检。
- 失败不显示成功；needs_attention 有下一步。

## 测试与证据

- IPC/渲染 wiring、批量选择、版本切换、错误状态。
- 真 Unity 2022.3.22f1：装/升/卸后工程可打开。
- 沙盒截图；全量测试/typecheck。

## 完成定义

- P4 门禁全过；真 Unity 证据在 PR。
- 包管理 UI 按钮纪律通过。
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
