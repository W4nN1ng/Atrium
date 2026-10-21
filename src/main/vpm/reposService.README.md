# src/main/vpm/reposService.ts

## 职责

仓库用例：列表、添加、移除、刷新单个/全部、官方/curated 种子、错误隔离。
它是 `RepoStore` + `VpmHttpPort` 之间的应用服务，不直接写 SQL、不直接发网络。

## 不负责什么

- 不实现 IPC/UI（P1-E）。
- 不做仓库编辑/排序/请求头/导入导出（P7-A/B）。
- 不做安装/解析（P3/P4）、不下载包 zip（P4）。
- 不自动高频刷新；只有显式 `refreshRepo/refreshAll`（以及 P1-E 的按需刷新）会联网。

## 公开 API

- `listRepos(): RepoDto[]`：不含 ETag/请求头，只给 UI 需要的字段。
- `addRepo({ url, name? })`：
  - URL 归一（去 fragment/尾斜杠、保留 query），必须 HTTPS；
  - 同 URL 去重 → `vpmRepoConflict`；
  - 联网关闭时只加条目、不刷新；
  - 联网开启时尝试刷新；失败保留条目 + `lastErrorCode`，不抛网络错误。
- `removeRepo(id)`：只删索引（FK 级联包行）；不删缓存/工程；找不到 → `vpmRepoNotFound`。
- `refreshRepo(id)`：返回 `{repo,status,packageCount,errorCode}`；
  - 304 → 只更新 fetch 元数据，包行不动；
  - 200 → 解析 + 单事务替换包行 + 更新 ETag/时间；失败保留旧行；
  - 同仓库并发去重；刷新失败返回 `status:'error'`，不把整个服务带崩。
- `refreshAll()`：只刷启用仓库，默认 2 并发；每仓库独立结果。
- `seedIfEmpty()`：联网开启且仓库表为空时加入 official/curated（排序 0/1）；
  **只建条目，不自动刷新**，避免启动时突然联网。
- `dispose()`：中止 in-flight HTTP，后续不再写库。

## 数据/写入

- 读/写都通过 `RepoStore`；包行替换由 `replaceRepoPackages` 事务保证。
- `addRepo` 的 `sortOrder = 当前最大 + 1`；official/curated 固定 0/1。
- 刷新成功时若仓库 JSON 有 `name`，用它覆盖条目名；其余设置（enabled/sortOrder）保留。
- 不持久化请求头/token；`RepoDto` 不暴露 ETag。
- 不同 hash 的同版本由 catalog 层标冲突，不在刷新时静默去重。

## 失败模式

- 联网关闭：`refreshRepo` 记录 `vpmNetworkNotConsented`，不发请求；`addRepo` 不自动刷新。
- 网络/超时/坏 JSON/超限：记录对应 `vpmHttp*/vpmRepo*`，保留旧包行。
- 包行替换失败：事务回滚，记录错误码。
- 找不到仓库：`vpmRepoNotFound`（单个方法）；`refreshAll` 捕获并给出 error 结果。
- dispose 后 in-flight 返回 `vpmHttpAborted`，不再写库。

## 测试入口

- `tests/vpm/repos/repos-service.spec.ts`
- `tests/vpm/catalog/*.spec.ts`（多源/hash 冲突）
- 运行：`npm test`

## 谁依赖我 / 我依赖谁

- 被 P1-D 组合根、P1-E IPC/UI 使用；不被渲染层直接引用。
- 依赖 `RepoStore`、`VpmHttpPort`、`shared/vpm/domain/repo`、`shared/ulid`、`VpmError`。
- 不依赖 `cache/`（包 zip 缓存由 P4 使用）、`renderer/**`。
