# P1-A 模块边界、依赖方向与架构闸门

> 阶段规格：`../VPM-P1.md`（只读 §4.1、§4.2、§5.1）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P0 已完成
> 覆盖对账项：I4 / I6 / I7 / I8（基础）
> 建议上下文：≤ 20k tokens

## 目标

- 把 VPM 的目标模块边界落成文档、目录说明和可执行的架构闸门，不实现仓库/网络/解析等业务。
- 建立 `shared/vpm/domain`、`main/vpm` 子模块、`renderer/vpm` 的 README 和公开入口约定。
- 新增架构测试，钉住 P0 已有的边界：只有 `main/index.ts` 静态 import `gate`；设置面板懒加载；VPM 目录不得发网络。
- 给渲染层一个唯一的 `window.a.vpm` 包装 `renderer/vpm/api.ts`，后续组件不再直接摸 preload。

## 不做什么

- 不新增 IPC 通道、不打开 vpm.db、不实现 HTTP/仓库/解析。
- 不重构 P0 的 gate/config/dataRoot，只加文档和测试。
- 不做 UI 视觉调整，不新增顶级导航。
- 不建子模块空 README；`db/`、`http/` 等 README 由各自任务落地时创建。
- 不创建 `main/vpm/index.ts` 组合根；它由 P1-D 在服务可组装时新建，避免留下空壳。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §3–§6、§10、§12
- `docs/prompts/VPM-P1.md` §4.1、§4.2、§5.1
- `src/main/vpm/gate.ts`、`src/main/vpm/config.ts`、`src/renderer/vpm/VpmSettings.tsx`
- `tests/vpm/static-imports.spec.ts`

## 文件所有权

- 新增：`src/shared/vpm/README.md`、`src/main/vpm/README.md`、`src/renderer/vpm/README.md`
- 新增：`src/renderer/vpm/api.ts`（只包 P0 四个通道）
- 新增：`tests/vpm/architecture.spec.ts`（或扩展现有 static-imports）

## 交付物

- 模块 README 模板与首版内容：职责/非职责/公开 API/数据/失败模式/测试入口。
- `renderer/vpm/api.ts`：类型化包装 status/enable/disable/pickDataRoot；组件后续只 import 它。
- 架构测试：shared 纯领域不得 import electron/node:fs；main 不得 import renderer；跨模块只走 index；网络/DB 唯一入口规则先以当前代码为准。`shared/vpm/dataRoot.ts` 的 `node:path` 是 P0 既有例外，测试只对它放行。
- `docs/VPM-TASKS.md` 中 P1-A 标为 done，并写交接段。

## 施工步骤

1. 先写 README 和目录说明，明确每个模块的职责与非职责。
2. 实现 `renderer/vpm/api.ts`，只包装已有 P0 API，不改 preload。
3. 写架构测试；对尚不存在的目录用 glob 跳过，对已有文件严格执行。
4. 跑 `npm test`、`npm run typecheck`，确认 P0 回归。
5. 在 PR 里列出后续任务需要遵守的新规则。

## 契约与不变量

- P0 的行为、IPC 名称、设置格式不变。
- 架构测试不能把未来的合法模块一刀切死；规则要写在测试注释里。
- 不新增运行时依赖。

## 测试与证据

- `tests/vpm/architecture.spec.ts` 覆盖 import 方向、静态 gate、懒加载面板、no-network。
- `renderer/vpm/api.ts` 的类型检查通过，组件不再直接调用 `window.a.vpm`。
- 全量测试与 typecheck 退出码 0。

## 完成定义

- README/API/架构测试三件套存在，且没有业务实现。
- PR 里有“后续任务必须遵守的边界”清单。
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
