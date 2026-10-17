# One-click Cover Tasks Implementation Plan

> **For agentic workers:** Use executing-plans for root integration and dispatching-parallel-agents for the two independent modules below. Steps use checkbox tracking.

**Goal:** 一键全库更新，唯一对象自动保存，多对象集中选图，减少重复操作。

**Architecture:** 新 CoverTasks 包装现有 CoverService，负责串行发现、自动保存、候选选择、重试和条件撤销；现有拍摄服务保留原语义。App 层任务 UI 与按钮通过新增 IPC 访问该服务，与旧“更新所选封面”接口兼容。

**Tech Stack:** Electron、TypeScript、React、Zustand、Vitest、SQLite、Unity 2022.3。

**Spec:** [已批准交互的执行记录](../specs/2026-10-16-all-cover-update-design.md)。

## Global Constraints

- main e61c1e6，分支 codex/all-cover-update，工作区 tmp/cover-all；不修改真实头像。
- 只自动采用完整且无警告的唯一候选；商品图/上传图保护；强制也不解除保护。
- 全库不受分页限制，队列串行，关闭 UI 不取消，显式停止可取消晚到结果。
- 撤销恢复任务前图片和关联，保留后续手改；备份图片必须加入缓存引用保护。
- 仅在隔离数据和自建 Unity 工程验收；完整测试通过后 PR 自合与本机更新。

## Review Focus

- 手动改图与晚到候选、保存、取消、重试的竞争不能覆盖用户新选择。
- 全库范围与合集成员、附属、删除状态、分页边界一致。
- 依赖与素材源变化不能复用错误候选，候选返回与主进程归属验证一致。
- 缓存维护后仍可撤销，撤销不会复活已删除素材或覆盖后续手动图。
- 任务面板切换、关闭、卸载、重复点击和超时不会丢任务或触发重复生成。

### Task 1: Backend (independent module)

Own new src/main/covers/tasks.ts, new src/main/db/repos/coverTasks.ts, schema.ts migration, repos/covers.ts cache references; tests/covers/tasks.spec.ts and undo repo tests.

Interfaces: constructor `new CoverTasks({db, service, setup, changed?})`; methods `start(request):CoverTask`, `status(id?:string):CoverTask|null`, `choices(id,assetId,offset?:number):Promise<CoverTaskChoices>`, `apply(id,assetId,targetId):Promise<CoverTask>`, `retry(id):CoverTask`, `cancel(id):void`, `undo(id):CoverTaskUndoResult`, `dispose():void`. Shared types in src/shared/coverTasks.ts. `service` is existing CoverService, `setup(assetId)` returns PackageCoverSetup.

- [x] Tests RED for all scope >500, auto unique, ambiguous/warnings, image protections, serial/cancel/late responses, retries, source changes and exact conditional undo.
- [x] Implement GREEN and retain old cover service behavior. SQLite migrations and cache references tested.

### Task 2: Renderer (independent module)

Own new src/renderer/stores/coverTasks.ts, new components/CoverTasks.tsx, AssetGrid.tsx, App.tsx, three locale JSON files, renderer tests and new tools/verify-cover-tasks-ui.cjs. Root owns API/preload contracts.

Consume `window.a.covers.startTask(request)`, `taskStatus(id?)`, `taskChoices(id,assetId,offset?)`, `applyTaskChoice(id,assetId,targetId)`, `retryTask(id)`, `cancelTask(id)`, `undoTask(id)`. Returns shared types. App mounts task panel; toolbar always mounts task button. Scope dropdown all/filtered/selected; filtered receives current AssetFilter, not only first page IDs. Automatic covers are always re-rendered, so a redundant force option is omitted.

- [x] RED for one-click immediate start, persistent App-level task, delayed start responses, hide vs stop, choice click immediate save, retry and undo.
- [x] GREEN component/store implementation and controlled real React/Electron verification.

### Task 3: Root integration and delivery

Own shared contract, API/preload/IPC wiring, registerCoverIpc lifecycle integration, IPC tests, docs/version and real acceptance integration.

- [x] IPC and lifecycle tests RED before integration; cancellation and malformed inputs rejected by main.
- [x] Wire backend and UI contract; typecheck and focused regressions GREEN.
- [x] Independent whole-branch review and corrections; complete npm run build and isolated UI/real Unity acceptance.
- [x] Local v0.7.0 silent install, registry and all 70 built-resource hashes verified.
- [ ] Update local v0.7.0, verify registry and launch; completed feature PR, exact-head/base normal merge, primary main fast-forward.

Checklist records pre-PR state; final integration is recorded by GitHub. See [acceptance report](../../VERIFY-2026-10-16-ALL-COVERS.md).
