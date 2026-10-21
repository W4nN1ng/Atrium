# src/main/vpm/catalog

## 职责

只读目录：把 `RepoStore` 的“按版本文本行”合并成包卡片/详情，提供搜索/筛选/来源/版本数/
yanked/hidden 和同版本多源 hash 冲突提示。

## 不负责什么

- 不联网、不刷新仓库、不写 DB。
- 不解析仓库 JSON（`shared/vpm/domain/repo.ts` + `reposService`）。
- 不做安装/解析/版本兼容（P3/P4）。
- 不返回渲染层 DTO；`types.ts` 是主进程内部/未来 IPC 映射用的稳定形状。

## 公开 API

- `CatalogService(store)`：
  - `query({ name?, text?, repoIds?, enabledOnly?, includeHidden?, includeYanked?, limit?, offset? })`
    → `{ items: CatalogPackageSummary[], total, limit, offset }`
  - `getPackage(name)` → `CatalogPackageDetail | null`（含所有版本、来源、冲突）
  - `resolverCatalog()` → `ResolverCatalogPackage[]`（仅主进程解析器用：依赖/Unity/
    URL/hash/仓库优先级；不暴露给渲染层）
- 摘要：`name/displayName/description/unityMin/latestVersion/versionCount/sources/
  hasConflict/conflictCount/hasYanked/hidden/keywords/aliases`。
- 详情额外：`versions[]`（每版本来源、zip URL/hash/size、yanked/hidden/deprecated）和
  `conflicts[]`（版本、不同 hash、来源名）。

## 合并规则

- 同名包跨仓库合并；同版本多源合并来源。
- 同版本出现 ≥2 个不同非空 SHA-256 → `hasConflict=true`，不静默挑一个。
- `latestVersion` 用 `shared/vpm/domain/version.ts` 的 SemVer 比较器；优先选非 yanked 的最高版本。
- 默认只查启用仓库；隐藏/yanked 由查询参数决定。`getPackage` 会包含隐藏/yanked 以显示详情。
- 文本搜索/过滤由 `RepoStore.queryCatalog` 的 SQL 完成，别名/关键词也参与。

## 失败模式

- 包名格式非法 → `getPackage` 返回 null。
- DB/SQL 错误原样抛 `vpmRepo*`/`vpmDb*`；目录层不伪造空结果。
- 超过 50,000 行时停止翻页（P1 防护；P8 需要再做真正的分页/索引优化）。

## 测试入口

- `tests/vpm/catalog/*.spec.ts`
- 运行：`npm test`

## 谁依赖我 / 我依赖谁

- 被 P1-D 组合根和 P1-E 的 IPC/UI 使用；不被渲染层直接引用。
- 依赖 `../repos` 的 `RepoStore` 和类型、`shared/vpm/domain/version`。
- 不依赖 `http/`、`cache/`、`renderer/**`。
