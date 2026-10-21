# src/main/vpm/repos

## 职责

仓库与包索引的 SQLite 仓储：仓库 CRUD、替换某仓库的包版本、目录查询。
它是 `vpm.db` 的业务读写入口，不负责联网/解析/UI。

## 不负责什么

- 不下载、不解析仓库 JSON（P1-C/P1-D）。
- 不决定仓库优先级、不合并同名包（P1-D 的目录服务）。
- 不把行对象直接交给 IPC/渲染层；上层要映射成 DTO。

## 公开 API

只从 `index.ts` 导出：

- `RepoStore`：
  - `listRepos()`：按 `sort_order`/名称排序，带 `packageCount`。
  - `getRepo(id)` / `getRepoByUrl(url)`：找不到返回 null。
  - `upsertRepo(input)`：插入或按 id 更新；URL 唯一冲突 → `vpmRepoConflict`。
  - `updateRepoFetchState(id, state)`：整组替换 ETag/Last-Modified/最后抓取/最后成功/错误码；
    调用方要把想保留的旧值一起传，清空用 `null`。缺失仓库 → `vpmRepoNotFound`。
  - `removeRepo(id)`：删仓库，FK 级联删包索引；返回是否删到。
  - `replaceRepoPackages(repoId, packages)`：单事务删旧插新；失败保留旧行。
  - `queryCatalog(query)`：按文本/仓库/启用/隐藏/yanked/分页查询包版本行。
- 类型：`RepoRow`、`RepoInput`、`RepoFetchState`、`PackageVersionInput`、
  `CatalogQuery`、`CatalogPackageRow`、`CatalogPage`。

`queryCatalog` 返回**按版本的行**，不是聚合后的包卡片；同名包/来源合并由 P1-D 的 catalog 服务做。

## 数据 / 写入

- 表：`vpm_repo`、`vpm_repo_package`（v1，见 `db/migrations.ts`）。
- 替换包索引：`DELETE` + 逐行 `INSERT` 在同一个 `better-sqlite3` 事务里；
  任一行失败（如重复主键）整批回滚，旧索引不变。
- 删除仓库：只删索引，缓存/工程/文件不动；`foreign_keys=ON` 负责级联包行。
- 不选 `headers_enc`，不把请求头/token 带出仓储。

## 失败模式

- 输入字段为空/超长/非法 hash/非法分页 → `vpmRepoInvalid`（带 field）。
- 同 URL 插入不同 id → `vpmRepoConflict`。
- 对不存在的仓库更新抓取状态/替换包 → `vpmRepoNotFound`。
- 包行批量写入失败 → `vpmRepoInvalid`（cause 只进日志），事务已回滚。

## 测试入口

- `tests/vpm/repos/store.spec.ts`（增删改查、分页、过滤、重复 URL、事务回滚、级联）
- 依赖的真实库由 `tests/vpm/db/migrate.spec.ts` 覆盖。
- 运行：`npm test`

## 谁依赖我 / 我依赖谁

- 被 P1-D 的 `reposService`/`catalog` 使用；不被渲染层直接引用。
- 依赖 `../db` 的 `VpmDb` 句柄、`shared/ulid`、`shared/vpm/errors`。
- 不 import `http/`、`catalog/`、`renderer/**`。
