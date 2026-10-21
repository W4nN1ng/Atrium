# src/renderer/vpm

## 职责

VPM 在渲染层的界面与数据访问：设置页的“项目与包”面板、（P2/P4 起）工程页的
项目/包管理组件，以及唯一的 `window.a.vpm` 包装。

## 不负责什么

- 不做版本解析/事务/路径校验等业务规则；这些在主进程。
- 不直接调用 `window.a.vpm`（只在 `api.ts` 里）；展示组件不碰 IPC。
- 不静态 import `src/main/**`、Electron、Node 内置模块。
- 不新增顶级导航；入口挂在现有设置/项目页。

## 公开 API

当前（P0）：

- `VpmSettings.tsx`：设置页懒加载的 VPM 面板。
- `api.ts`：唯一的 `window.a.vpm` 包装；P0 开关 + P1 仓库/目录 + P2 工程台账。
- `components/projects/VpmProjectsSection.tsx` + `hooks/useProjects.ts`：工程页懒加载的
  只读台账区（列表/详情/添加/移除/重扫/打开文件夹）。
- `components/plan/VpmPlanSheet.tsx` + `hooks/useVpmPlan.ts`：只读变更计划预览；
  展示动作/来源/冲突/缺失/下载，应用按钮禁用。

P1 起（按 `docs/VPM-ARCHITECTURE.md` §4/§11）：

- `hooks/`：查询/变更、loading/error、取消。
- `components/`：纯展示组件。
- `pages/`：集成到现有项目页/设置页的容器。

## 数据 / 写入

不持久化任何数据。只持有主进程返回的 DTO/视图状态；VPM 设置、快照、工程文件
都归主进程写。刷新以主进程状态为准，不在渲染层拼"乐观成功"。

## 失败模式

- IPC 错误 → `errorText` 翻译 `i18n:vpm.errors.*`；页面显示可重试的原因。
- 安全模式/降级/配置恢复 → 显示 banner，不假装功能可用。
- 加载失败 → 保留当前视图并提供重试；不静默清空。

## 测试入口

- `tests/renderer/i18n.spec.ts`（VPM 文案/页签）
- `tests/renderer/vpm-api.spec.ts`（包装转发）
- `tests/vpm/architecture.spec.ts`（禁止组件直接调 IPC/静态 import 主进程）
- 运行：`npm test`；涉及界面时用沙盒启动并截图。

## 谁依赖我 / 我依赖谁

- 被 `Settings.tsx` / `Project.tsx` 通过 `lazy(() => import(...))` 加载；不进入首屏 chunk。
- 依赖：`src/shared/vpm` 的类型/错误码、`renderer/components/ui`、`renderer/lib/msg`。
- 不依赖 `src/main/**`。
