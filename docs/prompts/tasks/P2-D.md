# P2-D 只读工程页 UI 与 IPC

> 阶段规格：`../VPM-P2.md`（只读 §7、§8）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P2-C
> 覆盖对账项：A1 / A2 / A3 / A14 / A18 / A20 / B17 / B28
> 建议上下文：≤ 30k tokens

## 目标

- 在现有“项目”页展示 VPM 台账：Unity 版本、已装包、legacy 警告、运行状态。
- 提供打开工程文件夹、添加已有工程、从台账移除（不删盘）。
- 只读：没有装/卸/升级按钮；明确提示下一阶段。

## 不做什么

- 不做包安装、解析计划、备份/复制。
- 不新增顶级导航。
- 不移除核心已有的工程操作。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §11
- `docs/prompts/VPM-P2.md` §7、§8
- `src/renderer/pages/` 现有项目页、`src/renderer/vpm/api.ts`
- `src/main/vpm/ipc/` 现有模式

## 文件所有权

- 新增：`src/main/vpm/ipc/projects.ts`、`src/shared/vpm/dto/project.ts`
- 新增：`src/renderer/vpm/components/projects/*`、`hooks/useProjects*`
- 修改：现有项目页容器（只加 VPM 区，不重写）
- 新增：`tests/vpm/ipc/projects.spec.ts`、`tests/renderer/vpm-projects.spec.ts`

## 交付物

- IPC：ProjectsList/ProjectDetail/ProjectAdd/ProjectRemove/ProjectRescan/ProjectOpenFolder。
- 工程列表/详情/legacy 警告/运行状态；打开文件夹；添加/移除确认。
- 空状态与错误码；三语文案。
- 沙盒截图（只读状态）。

## 施工步骤

1. 定 DTO 与 IPC，主进程校验路径。
2. 实现 hooks 与列表/详情组件。
3. 接现有项目页，保持原操作不变。
4. 补空/错/legacy/运行中状态。
5. 沙盒截图 + 测试。

## 契约与不变量

- P2 的 UI 不触发任何工程写入。
- 不显示不可用的安装按钮。
- 核心项目页原有功能不回归。

## 测试与证据

- IPC 通道/校验/错误码。
- 渲染 wiring：空、正常、legacy、运行中、打开文件夹调用。
- 现有项目页回归测试。
- 沙盒截图 + 全量测试/typecheck。

## 完成定义

- 工程页能看到 VPM 台账并打开文件夹。
- 没有安装/卸载入口；文案明确说明原因。
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
