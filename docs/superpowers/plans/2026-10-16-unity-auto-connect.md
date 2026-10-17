# Unity Automatic Connection Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for root integration and superpowers:dispatching-parallel-agents for the two independent, contract-bound modules. Steps use checkbox tracking.

**Goal:** 打开工程自动准备连接，点击导入自动确定目标，并保持所有既有任务的工程身份稳定。

**Architecture:** 主进程连接控制器接收工程运行快照，负责自动安装、就绪判断、目标选择及等待。IPC 适配器提供连接快照／目标解析／可取消的准备等待；renderer 只发起用户操作并展示状态。现有导入协调器保持资源写入、冲突及撤回职责。

**Tech Stack:** Electron 33、TypeScript、React、Zustand、Vitest、Unity 2022.3 文件桥接。

**Spec:** [设计与已批准范围](../specs/2026-10-16-unity-auto-connect-design.md)。

## Global Constraints

- 基于 main c606d0d，独立分支 codex/unity-auto-connect；封面不修改。
- 连接只在运行中的 Unity 2022.3 用户工程自动准备，排除内部预览工程及不安全路径。
- 没有工程不写入；多个工程不任取第一个；已提交任务目标固定。
- 准备等待180秒可取消，忙碌沿用现有队列；保留冲突／备份语义。
- 自动连接新默认开启，停用后不循环重装；只在隔离目录验证。
- 测试通过后正常PR合并，并 npm run build、覆盖安装及注册表版本核验。

## Review Focus

- 启动前已开工程及非 VCC 清单中的运行工程同样被识别。
- 关闭工程／失效心跳／改选目标不能改变已提交任务的工程。
- 多卡、合集成员和后续内部批次不能重新读取全局目标。
- 安装失败、目录链接和旧的自动安装答案不会产生循环写入或误报就绪。
- 用户取消准备和 UI 卸载／重入不能让晚到结果触发导入。

## Contract

`src/shared/unityConnection.ts` 定义连接 phase、每工程连接状态、快照与目标解析结果。Controller `UnityConnections` 提供 `update(ProjectInfo[]):void`, `snapshot():UnityConnectionSnapshot`, `select(id:string|null):void`, `retry(id:string):void`, `prepare(id:string,{signal?,timeoutMs?}?):Promise<ProjectConnection>`, `dispose():void`。

Renderer 增加 `connection`、`targetPicker:{open,projectIds}`、`chooseImportTarget(id|null)`、`retryUnityConnection(id)`、`cancelImportPreparation()`。主进程提供 `connection()`, `resolveTarget()`, `prepareTarget(projectId,requestId)`, `cancelTargetPreparation(requestId)`, `retryConnection(projectId)`。

### Task 1: Main connection controller

Files: new `src/main/project/connections.ts`, `tests/project/connections.spec.ts`。仅依赖注入的 config、install、statusOf、watch、changed；模块自己验证项目路径和支持版本。

- [x] Tests first: closed and owned preview never install; one running auto target; multiple need choice; explicit choice retained only while running; existing compatible bridge reused; true readiness; deduplicated install, error and retry; disable/uninstall suppression; bounded/cancellable wait and close.
- [x] Observe meaningful RED, implement the contract, run focused tests GREEN.

### Task 2: Main IPC and import identity integration

Files: shared contracts/settings, `src/main/index.ts`, project watcher, bridge IPC, renderer store and corresponding wiring/store tests.

- [x] Test running-project discovery and controller callback before adding watcher integration.
- [x] Test IPC resolve/prepare/cancel, no import during automatic connection, explicit target identity before wiring production.
- [x] Test renderer single/multi/member/batch preparation and target capture, including late response cancellation and new global selection, then implement.
- [x] Run existing bridge/watcher/store regression suites; retire obsolete prompt expectations where the approved production behavior replaces them, retain legacy IPC compatibility tests.

### Task 3: Normal UI and isolated acceptance

Files: chrome, Project, Settings, wizard, App, new ImportTargetPicker, ImportFlow, action labels, three locales, new UI verifier. No store or backend edits by the UI owner.

- [x] Controlled component fixture RED: no install prompt, one project target label, selection when ambiguous, connecting/ready/failure with retry and cancellation.
- [x] Implement simple normal path, keep advanced repair/disable, show running projects in choice, wait for root store contract.
- [x] GREEN component verification; real compiled Electron/IPC/SQLite and owned Unity fixture: fresh install/heartbeat/import, cancellation, close and restart. Busy/multiple-project scenarios verified with controlled fixtures; real-editor limits are recorded in the verification document.

### Task 4: Review, verification and delivery

- [x] Independent whole-branch review and corrections with regression tests; typecheck and full npm test.
- [x] Electron build, worker dependency check, isolated production acceptance; unchanged cover regressions as appropriate.
- [x] Product version and release notes for local installer; npm run build on final tree.
- [x] Silent local install and registry v0.6.0/payload verification; first-install packaging limitation recorded.
- [ ] Commit completed feature, push, create/attach PR, verify exact head/base and required checks, normal self-merge.
- [ ] Clean primary checkout fast-forward and normal installed-app launch.

Checklist records the state before the PR is committed. Final merge status is recorded by GitHub; acceptance details are in [the verification report](../../VERIFY-2026-10-16-UNITY-CONNECTION.md).
