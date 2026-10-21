# P1-E 只读包目录 UI、IPC 与三语

> 阶段规格：`../VPM-P1.md`（只读 §9）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P1-D
> 覆盖对账项：B1 / B2 / B3 / B13 / B14
> 建议上下文：≤ 30k tokens
>
> **2026-10-21 用户裁定**：VPM 默认联网，**不再弹首次联网同意模态**；
> 仓库区放一个默认开启的“联网”开关，关闭后 fail closed、只看缓存。

## 目标

- 把仓库列表、添加仓库、刷新、联网开关、包目录/详情接到设置页。
- 默认联网：首次启用/启动即可刷新，不弹同意模态；开关关闭后只读缓存。
- 只读：没有安装按钮；明确显示“安装将在下一阶段”。
- IPC 参数在主进程重新校验；长任务有 operationId/进度事件与拉取式状态。
- 三语文案齐全，错误码到文案的映射可测。

## 不做什么

- 不实现安装/解析/工程集成。
- 不提前做仓库编辑/排序/请求头（P7）。
- 不新增顶级导航；入口仍在设置→项目与包。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §6.5、§11
- `docs/prompts/VPM-P1.md` §9
- `src/shared/ipc.ts`、`src/preload/index.ts`、`src/shared/api.ts`
- `src/renderer/vpm/api.ts`、`src/renderer/pages/Settings.tsx`

## 文件所有权

- 修改/新增：`src/main/vpm/ipc/`、`src/shared/vpm/dto/`、`src/shared/ipc.ts`、`src/shared/api.ts`、`src/preload/index.ts`
- 新增：`src/renderer/vpm/hooks/`、`components/repos*`、`components/catalog*`
- 修改：`src/renderer/vpm/VpmSettings.tsx`、三份 i18n
- 新增：`tests/vpm/ipc/*.spec.ts`、`tests/renderer/vpm-*.spec.ts`

## 交付物

- IPC：ReposList/RepoAdd/RepoRemove/RepoRefresh/RepoRefreshAll/NetworkConsent/NetworkStatus/CatalogQuery/PackageDetail/PackageVersions。
  `NetworkConsent` 在此阶段表示“切换联网开关”，不再是首次同意。
- 设置页仓库区（含默认开启的联网开关）+ 浏览抽屉 + 离线/错误状态。
- 外链只允许 http(s)，点击前确认；描述按纯文本渲染。
- 测试：通道白名单、DTO 校验、i18n、禁用/安全模式、联网开关关闭时零请求。

## 施工步骤

1. 先定 DTO 与 IPC 通道，主进程序列化错误码。
2. 实现 preload/api 与 hooks。
3. 做仓库区和包抽屉，保持一个主按钮。
4. 补三语与空/错/离线状态。
5. 沙盒启动截图，确认安装按钮不存在。

## 契约与不变量

- 组件不直接调用 `window.a.vpm`，只走 `renderer/vpm/api.ts`。
- 不把请求头/token/绝对缓存路径返回渲染层。
- P1 不写工程、不装包。

## 测试与证据

- IPC 全覆盖 + 死通道检查。
- i18n 三语无缺失/无承诺文案。
- 渲染 wiring：仓库列表/搜索/详情/联网关闭零请求/错误码。
- 沙盒截图 + 全量测试/typecheck。

## 完成定义

- 设置页默认联网、可添加仓库/刷新/浏览包，但没有任何安装入口。
- 关闭联网开关或断网时显示上次成功时间与错误，不清空目录。
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
