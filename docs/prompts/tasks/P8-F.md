# P8-F 模板编辑 UI（A8 缺口）

> 阶段规格：`../VPM-P8.md`（只读 §4.1、§4.3）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 对账项：A8 · 前置：P5-A、P5-D、P8-D
> 这份卡由 P8-D 缺口分诊新建；**P8-D 本身不实现它**。

## 目标

- 设置 → 项目与包 → 模板：列出用户模板，能新建、编辑、复制、删除引用。
- 内置模板只读；复制内置模板会生成用户模板，不改内置。
- 复用 P5-A 的 `TemplateService`（create/update/duplicate/removeReference/restore），
  不重新实现模板合并/base 继承。
- 删除只取消用户模板的可见引用，**不动磁盘文件**；恢复入口沿用 `restore`。

## 不做什么

- 不改模板格式、不新增 vpm.db 迁移、不复制 ALCOM 模板资产。
- 不做 `.alcomtemplate` 全局文件关联、不写 VCC 数据。
- 不把模板编辑器塞进工程详情；入口仍在设置页。
- 不做附件上传/编辑（P5-C 已支持带附件模板，本卡只编辑 JSON 字段与附件引用）。

## 必读

- `docs/VPM-PARITY.md` A8 行
- `src/main/vpm/templates/` 的 README 与 `TemplateService`
- `src/main/vpm/ipc/unity.ts` 里现有 TemplateList/Favorite/Recent
- `src/shared/vpm/domain/template.ts`

## 文件所有权

- 新增：`src/renderer/vpm/components/settings/TemplateEditorPanel.tsx`
- 新增：`tests/vpm/ipc/templates.spec.ts`、`tests/renderer/vpm-templates.spec.ts`
- 修改：`src/shared/ipc.ts`、`src/preload/index.ts`、`src/shared/api.ts`、
  `src/renderer/vpm/api.ts`、`src/main/vpm/ipc/unity.ts`（或新建 `ipc/templates.ts`）、
  `src/renderer/vpm/VpmSettings.tsx`、三语文案。

## 交付物

- IPC：`TemplateCreate` / `TemplateUpdate` / `TemplateDuplicate` / `TemplateRemoveReference`
  （或等价通道）；参数逐字段校验，坏值整次拒绝。
- UI：模板列表（内置/用户）、新建/编辑表单（名称、描述、依赖、Unity 范围、base）、
  复制、删除引用、恢复；危险操作二次确认；一屏一个实心主按钮。
- 测试：表单校验、坏模板拒绝、内置只读、复制/删除不触碰文件、API 转发、通道清单。
- 归入 `IpcInvoke.Vpm`；preload/`shared/api`/`renderer/vpm/api` 三层包起来。

## 契约与不变量

- 模板 `id` 只由服务层生成/校验；渲染层不能写任意路径。
- 删除 = `visible=0`，文件仍在；不提供永久删除。
- 内置模板只读；复制内置模板必须得到用户模板。
- 不把模板 JSON/磁盘路径直接暴露给渲染层；DTO 只给展示与可编辑字段。

## 测试与证据

- 纯逻辑/服务测试复用 P5-A；新增 IPC/渲染 wiring。
- 通道必须在 `IpcInvoke` 登记，且 `tests/renderer/ipc-channels.spec.ts` 有清单断言。
- 全量测试/typecheck/build 通过；UI 截图（设置页模板面板）。
- 更新 `docs/VPM-TASKS.md` P8-F 状态与 `docs/VPM-PARITY.md` A8 实际状态。

## 完成定义

- A8 从“服务层完整、UI 缺失”变成“可实际新建/编辑/复制/删除引用”。
- 不触碰用户文件/内置模板；不新增数据库迁移。
- PR 含交接段；未验证项明确写出。

## 交接（写进 PR）

```text
Task: P8-F
状态: 完成 / 部分 / 阻塞
公开 API/契约变化: ...
新增/修改模块 README: ...
已验证: ...
未验证: ...
给下一个任务: ...
```
