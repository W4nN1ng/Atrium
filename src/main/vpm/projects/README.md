# src/main/vpm/projects

## 职责（一句话）

把 P2-B 的工程快照缓存进 `vpm_project` 台账，并把核心工程发现/VCC userProjects
以只读方式合并给上层。

## 不负责什么

- 不启动/关闭 Unity，不写工程文件，不迁移 legacy，不装包。
- 不取代核心 `project` 表或工程发现 watcher；不另起扫描定时器。
- 不写 VCC `settings.json`/LiteDB；VCC 只通过注入的 source 读取。
- 不做 IPC/UI（P2-D）。

## 公开 API

只从 `index.ts` 导出：

- `ProjectFsReader`：`ProjectReaderPort` 的只读 fs 适配器；realpath 根、根内路径校验、
  不跟随符号链接。
- `ProjectLedgerStore`：`upsertSnapshot/get/list/getByPath/remove`；`vpm_project` 与
  `vpm_project_package` 的唯一 SQL 入口。
- `ProjectsService`：`list/get/scan/addExisting/refresh/importVcc/remove`。
- `ProjectCorePort` / `VccProjectSource`：核心工程与 VCC 的窄端口。
- 类型：`ProjectListItem`、`ProjectLedgerRecord`、`ProjectScanResult` 等。

## 台账 vs 核心发现

| 事实 | 来源 |
|---|---|
| 有哪些工程、是否在运行、detectedBy/bridge 状态 | 核心 `project` 表/工程 watcher |
| VPM 快照、包状态、manifest hash/mtime、last scan | `vpm_project*` 台账 |
| 当前导入目标 | 核心 `UnityConnections`（P2-E），本模块不持有 |

`list()` 以核心列表为主；台账里有、核心已没有的记录仍返回，但 `linked=false`。
`remove()` 只删台账行，不删盘、不删核心工程、不删导入历史。

## 数据 / 写入

- `vpm_project` / `vpm_project_package` 是缓存，每次 `addExisting/refresh` 可重建。
- `upsertSnapshot` 保留 `created_at`、`unity_exe_path`、`unity_args_json`、`last_op_id`
  等不由快照提供的字段。
- legacy 候选以 `is_legacy=1`、`state=legacy` 存入包表；名字冲突时加 `#<index>`。

## 失败模式

- 工程根/路径逃逸/符号链接 → `vpmProjectAccessDenied` 或 `vpmProjectInvalid`。
- 非工程/坏 ProjectVersion → `vpmProjectInvalid`；坏 manifest → snapshot warning。
- VCC 读取失败 → `ProjectVccImportResult.sourceError`；单个坏工程进 `errors`，不中断其他。
- `refresh` 找不到台账记录 → `vpmProjectInvalid`；扫描失败保留旧台账，不删行。

## 测试入口

- `tests/vpm/projects/reader.spec.ts`、`ledger.spec.ts`、`service.spec.ts`
- 运行：`npm test`（先切 Node ABI）

## 谁依赖我 / 我依赖谁

- 被 `src/main/vpm/index.ts` 组合根使用；P2-D 通过 IPC 映射。
- 依赖：`node:fs`/`node:path`（仅 reader）、`shared/vpm/domain/project`、`db`、`VpmError`。
- 不依赖 Electron、渲染层、网络；VCC 只通过 `VccProjectSource`。
