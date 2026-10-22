# src/main/vpm

## 职责

VPM 的主进程外壳：默认关闭的门面、独立设置、数据根校验、启用前快照，以及（P1 起）
仓库/工程/解析/安装/Unity/备份/互操作等应用服务和适配器。

## 不负责什么

- 不改核心 `library.db` 的 schema/迁移，不把 VPM 字段塞进核心设置。
- 不 import `src/renderer/**`；不把数据库行、文件句柄、token 直接交给渲染层。
- 不在未启用/安全模式下加载重模块、打开 `vpm.db` 或建立网络连接。

## 公开 API

当前（P0）：

- `gate.ts`：**唯一允许被核心静态 import 的文件**。导出
  `isSafeMode/getVpmStatus/enableVpm/disableVpm/pickDataRoot/registerVpmGateIpc/disposeVpm/startVpmRuntime`
  以及测试用 reset；`VpmStatus.degradedCode` 给出降级原因。
- `config.ts`：独立设置读写；只给 gate/后续 runtime 用，不是公共 API。
- `src/shared/vpm/dataRoot.ts`：纯校验，由 gate 调用。

P1-B/P1-C 当前已落地：

- `db/`：`openVpmDb/closeVpmDb`、只前进迁移、迁移前备份/校验；见 `db/README.md`。
- `repos/`：`RepoStore` 的仓库 CRUD、包索引替换与目录查询；见 `repos/README.md`。
- `http/`：唯一网络入口、HTTPS/重定向/限额/超时、联网开关；见 `http/README.md`。
- `cache/`：临时文件、包缓存、原子提交/校验/清理；见 `cache/README.md`。

P1-D 当前已落地：

- `index.ts`：组合根（由 gate 动态加载），组装 DB/http/cache/store/repos/catalog，
  需要时种子 official/curated；不注册 IPC。
- `reposService.ts`：仓库增删/刷新/种子/错误隔离；见 `reposService.README.md`。
- `catalog/`：只读目录合并/搜索/冲突；见 `catalog/README.md`。
- `unity/`：只读发现 Unity Hub/安装根，v2 编辑器仓储；见 `unity/README.md`。
- `projects/`：工程台账、fs reader、VCC userProjects 只读导入；见 `projects/README.md`。
- `planService.ts`：P3-D 计划应用服务；组合工程快照 + 目录 + resolver/plan，内存保存 planId。
- `linkage`（`shared/vpm/linkage.ts`）：核心导入目标的窄端口；`runtime.linkage` 由主进程注入。
- `ipc/`：P1 只读仓库/目录/联网开关 IPC + 刷新事件；见 `ipc/README.md`。
- `gate.ts`：enabled 时动态加载 runtime，`startVpmRuntime()` 在 app ready 调用；
  初始化失败只置 `degraded + degradedCode`，核心继续。

P4-A 当前已落地：

- `install/`：`vpm.db` v3 的操作/步骤/文件记录，合法状态迁移、单工程活动互斥、
  `.atrium-tx/<op>/journal.json` 原子双写、幂等步骤、启动恢复判定骨架；见
  `install/README.md`。P4-A 不下载、不写工程；恢复只落 `committed/needs_attention`。
- `index.ts`：`VpmRuntime.operations/recovery` 暴露给 P4-C/P4-D；启动时先
  `recovery.scanAndApply()`，再种子仓库。

P2 起：

- `projects/`、`resolver/`、`install/`、`vault/`、`unity/`、`backup/`、`interop/`、`log/`

每个文件夹模块必须有 `index.ts` 公开面和 README；跨模块只走公开面。

## 数据 / 写入

- `P.root()/vpm/settings.json`：只由 `config.ts` 原子写；坏文件改名 `.corrupt-*` 保留。
- `P.root()/vpm/backups/`：只由快照/迁移逻辑写；不自动清理。
- `vpm.db`（P1 起）：只由 `db/` 仓储写；打开时检查版本，高于当前就拒绝。
- 数据根 `cache/vault/backups/tmp`：cache 由 `cache/` 写；仓库索引写 `vpm.db`；
  其他目录按架构合同各自唯一写入者。
- **不写**核心 `library.db`、VCC 数据、Unity 工程（P0 不涉及；P4 起只走事务）。

## 失败模式

- 设置坏/字段非法 → 改名保留 + 默认值 + `configRecovered`；核心继续。
- 数据根非法/不可写/在 C/素材库/工程/安装目录 → 明确错误码，不启用。
- 快照失败 → 不写 `enabled:true`；不留下"已启用但没快照"。
- 安全模式 → 只读状态，拒绝启用/写入。
- 初始化失败 → `degraded` + `degradedCode`；核心启动不被阻塞。
- 联网关闭 → HTTP fail closed；仓库可离线浏览，刷新记录 `vpmNetworkNotConsented`。

## 测试入口

- `tests/vpm/gate.spec.ts`、`config.spec.ts`、`data-root.spec.ts`、`static-imports.spec.ts`
- `tests/vpm/runtime.spec.ts`、`repos/repos-service.spec.ts`、`catalog/*.spec.ts`
- `tests/vpm/ipc/vpm-ipc.spec.ts`、`tests/renderer/vpm-api.spec.ts`、`tests/renderer/vpm-view.spec.ts`
- `tests/vpm/unity/editors.spec.ts`、`tests/vpm/db/migrate.spec.ts`
- `tests/vpm/projects/reader.spec.ts`、`tests/vpm/projects/service.spec.ts`
- `tests/vpm/install/journal.spec.ts`、`tests/vpm/runtime.spec.ts`（P4-A 状态机/恢复接线）
- 架构边界：`tests/vpm/architecture.spec.ts`
- 运行：`npm test`；涉及 Electron 构建时再跑 `npm run build:dir`

## 谁依赖我 / 我依赖谁

- 核心只允许 `src/main/index.ts` 静态 import `vpm/gate`；其他 VPM 模块由门面动态加载。
- 依赖：`src/shared/vpm/**`、核心 `db`/`services/paths`、Electron/Node 能力。
- 不被渲染进程直接引用。
