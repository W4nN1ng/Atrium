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
  `isSafeMode/getVpmStatus/enableVpm/disableVpm/pickDataRoot/registerVpmGateIpc/disposeVpm`
  以及测试用 reset。
- `config.ts`：独立设置读写；只给 gate/后续 runtime 用，不是公共 API。
- `src/shared/vpm/dataRoot.ts`：纯校验，由 gate 调用。

P1 起（按 `docs/VPM-ARCHITECTURE.md` §4）：

- `index.ts` 组合根（P1-D 新建，动态加载）
- `ipc/`、`db/`、`repos/`、`http/`、`catalog/`、`projects/`、`resolver/`、
  `install/`、`cache/`、`vault/`、`unity/`、`backup/`、`interop/`、`log/`

每个文件夹模块必须有 `index.ts` 公开面和 README；跨模块只走公开面。

## 数据 / 写入

- `P.root()/vpm/settings.json`：只由 `config.ts` 原子写；坏文件改名 `.corrupt-*` 保留。
- `P.root()/vpm/backups/`：只由快照/迁移逻辑写；不自动清理。
- `vpm.db`（P1 起）：只由 `db/` 仓储写；打开时检查版本，高于当前就拒绝。
- 数据根 `cache/vault/backups/tmp`：P0 只创建目录；后续按架构合同各自唯一写入者。
- **不写**核心 `library.db`、VCC 数据、Unity 工程（P0 不涉及；P4 起只走事务）。

## 失败模式

- 设置坏/字段非法 → 改名保留 + 默认值 + `configRecovered`；核心继续。
- 数据根非法/不可写/在 C/素材库/工程/安装目录 → 明确错误码，不启用。
- 快照失败 → 不写 `enabled:true`；不留下"已启用但没快照"。
- 安全模式 → 只读状态，拒绝启用/写入。
- 初始化失败 → `degraded` + 原因；核心启动不被阻塞。

## 测试入口

- `tests/vpm/gate.spec.ts`、`config.spec.ts`、`data-root.spec.ts`、`static-imports.spec.ts`
- 架构边界：`tests/vpm/architecture.spec.ts`
- 运行：`npm test`；涉及 Electron 构建时再跑 `npm run build:dir`

## 谁依赖我 / 我依赖谁

- 核心只允许 `src/main/index.ts` 静态 import `vpm/gate`；其他 VPM 模块由门面动态加载。
- 依赖：`src/shared/vpm/**`、核心 `db`/`services/paths`、Electron/Node 能力。
- 不被渲染进程直接引用。
