# src/main/vpm/cache

## 职责

VPM 包缓存：临时文件、正式包文件、路径校验、原子提交、内容寻址、配额淘汰、
显式校验/清理，以及"下载 + 校验 + 落盘"的编排。

它只管理 `<dataRoot>/cache`，不决定下载什么/装什么。

## 不负责什么

- 不发网络（HTTP 在 `http/`；本模块只驱动它并接收临时文件）。
- 不解析仓库/包元数据、不决定版本、不做依赖解析。
- 不装包、不改 manifest、不移动工程文件（P4-C 事务的事）。
- 不删数据根里的 `vault/`、`backups/`、`templates/`、工程文件；**只清理 `cache/`**。
- 不做后台自动配额回收（`cleanup()` 要显式调用；P8 再接用量/清理 UI）。
- 不解压（解压在 `../install/archive.ts`）。

## 目录/数据

```text
<dataRoot>/cache/
  packages/<sha 前两位>/<sha>.zip     内容寻址的正式包文件
  tmp/<prefix>-<ulid>.part            下载临时文件
  corrupt/<name>-<ulid><ext>          隔离的损坏文件（保留字节）
```

- `dataRoot` 必须已存在且是绝对目录；`cacheRoot` 默认 `<dataRoot>/cache`，
  必须是 dataRoot 的**严格子目录**。词法和 `realpath` 都检查，防 symlink 逃逸。
- 包文件路径只由 64 位 hex SHA-256 派生；临时文件必须在 `tmp/` 内。
- 缓存是可再生数据，允许替换/清理；不适用"永不删用户文件"（但绝不碰 cache 外）。

## 公开 API

只从 `index.ts` 导出。三个类，职责分开：

### `VpmCacheStore` —— 文件与路径（`store.ts`）

- `new VpmCacheStore({ dataRoot, cacheRoot? })`：校验并建立 cache 目录。
- 只读根：`dataRoot`、`cacheRoot`、`packagesRoot`、`tmpRoot`、`corruptRoot`。
- `createTempPath(prefix?)`：返回 `tmp/` 下的唯一 `.part` 路径。
- `pathForPackage(sha256)` / `hasPackage(sha256)` / `removePackage(sha256)`。
- `commitDownload({ tempPath, sha256, size, expectedSha256? })`：校验期望 hash、文件大小、
  临时文件路径；同卷 `rename` 到正式路径（**可覆盖同 hash 的旧文件**）；失败删临时文件。
- `verifyFile(file, expectedSha256)`：流式重算 hash，发现磁盘损坏/外部改写。
- `quarantine(file, sha256)` / `quarantinePackage(sha256)`：把不可信文件移进 `corrupt/`
  并**保留字节**；失败返回 `null`（不抛），避免清理动作掩盖真正的 hash 错误。
- `listPackages()`：列出 `packages/<两位前缀>/` 下的合法包文件（含 `size`/`mtimeMs`）。
- `clearTmp()`：只清 `tmp/`；`clearPackages()`：显式清 `packages/`。

### `CacheEntryStore` —— `vpm_cache_entry` 表（`entries.ts`）

`vpm_cache_entry` 的**唯一 SQL 入口**（表结构由 `../db/migrations.ts` 拥有，P4-A 建的 v3）。

- `get(sha256)` / `list()`（按 `last_used_at` 升序，供 LRU）/ `remove(sha256)`。
- `upsert({ sha256, size, path, sourceHost? })`：写行；`source_host` 用 `COALESCE` 保留旧值。
- `touch({ sha256, size, path })`：命中时只刷 `last_used_at`；行不存在则用已知
  size/path 重建。

> **行不是真相。** 文件丢了可以重建行；反向不成立。
> 清理时只信任从 `VpmCacheStore` 派生的路径，**不直接用行里的 `path` 去删东西**。

### `PackageCacheService` —— 下载与缓存编排（`service.ts`）

- `new PackageCacheService({ store, entries, http, quotaBytes?, now?, availableBytes?, retryDelayMs? })`
  - `quotaBytes` 默认 **20 GiB**，只约束 `cache/packages`，不碰 vault/backup/工程。
  - `availableBytes` 默认用 `statfsSync`；探测失败不阻塞下载（真写失败仍报 `vpmCacheWriteFailed`）。
- `ensurePackage({ url, sha256, size?, headers?, signal?, onProgress? })` → `VpmCachedPackage`
  （`{ sha256, size, path, reused }`）。
- `usage()` → `{ bytes, files, quotaBytes }`。
- `cleanup(protectSha256?)` → `VpmCacheEviction[]`：显式按配额 LRU 淘汰。

## 流程与不变量

```text
ensurePackage
  ├─ 无 SHA-256 / 非法 hex        → vpmCacheHashMissing（不触网）
  ├─ 同 hash 已有下载在飞         → 共享同一个 Promise（不重复下载）
  ├─ 缓存命中
  │    ├─ 完整重算 hash + 大小     → 刷新 entry → reused: true
  │    └─ 损坏                    → 隔离到 corrupt/ + 删行 → 重下
  ├─ reserveFor(size)
  │    ├─ size > 配额             → vpmCacheQuotaExceeded（不下载）
  │    ├─ 先淘汰到配额内           → 仍放不下则 vpmCacheQuotaExceeded
  │    └─ 磁盘可用 < size+64MiB   → vpmCacheNoSpace（不下载）
  └─ 下载（最多 3 次尝试 = 首次 + 2 次重试）
       ├─ HTTP 流式写 .part，边写边算 SHA-256
       ├─ 只重试 vpmHttpNetwork / vpmHttpTimeout / 5xx；4xx 与 hash 不匹配不重试
       ├─ hash/大小不匹配 → 隔离临时文件 → vpmCacheHashMismatch
       ├─ commitDownload：校验 + 同卷 rename → packages/<ab>/<sha>.zip
       ├─ 再对落盘文件完整校验一次（防 rename 后被改写）
       ├─ 淘汰 + 复核配额；单包比配额还大 → 删掉并报 vpmCacheQuotaExceeded
       └─ upsert entry（含 sourceHost）→ reused: false
```

硬不变量：

1. **无 SHA-256 的包一律拒绝**，不作为可安装对象。
2. 缓存/临时目录**不落 C**；路径必须严格在 `dataRoot/cache` 内（词法 + realpath）。
3. 临时文件必须先在 `tmp/`，提交才 rename；`tmp/` 外的临时文件**拒绝且不删**。
4. 清理只动 `cache/packages`；`vault/`、`backups/`、工程文件永不在清理范围。
5. 同 hash 同时只有一个下载；并发调用共享结果。
6. 进度回调**节流 ≥100ms**，且回调抛异常不能中断下载。

## 失败码

缓存/下载（`vpmCache*`）：

- `vpmCachePathInvalid`：dataRoot 不存在/相对路径，cacheRoot 不在 dataRoot 内或逃逸。
- `vpmCacheWriteFailed`：建目录/写文件/rename/清理失败；配额或重试参数非法。
- `vpmCacheHashMismatch`：期望 hash 不一致、大小不一致、文件校验失败。
- `vpmCacheHashMissing`：请求缺 `sha256` 或不是 64 位 hex。
- `vpmCacheQuotaExceeded`：单包超过配额，或淘汰后仍装不下。
- `vpmCacheNoSpace`：缓存卷可用空间不足。

网络相关（由 `http/` 抛、本模块透传或据此决定重试）：

- `vpmHttpNetwork` / `vpmHttpTimeout`（**可重试**）、`vpmHttpStatus`（仅 5xx 可重试）、
  `vpmHttpAborted`（取消，不重试）。

## 测试入口

- `tests/vpm/cache/store.spec.ts`：路径边界、原子提交、hash/大小不匹配、隔离保字节、
  `clearTmp`/`clearPackages` 各自边界、合法包列举。
- `tests/vpm/cache/download.spec.ts`：命中/损坏重下、无 hash 与大小不符拒绝、
  重试策略（含 4xx 不重试）、abort 清理、LRU 淘汰保护当前包、超配额拒绝、
  磁盘满、并发去重与进度节流、行重建与文件消失后重下。
- `tests/vpm/http/client.spec.ts`：与 HTTP 的联调（`downloadToFile`）。
- 运行：`npx vitest run tests/vpm/cache`（或全量 `npx vitest run`）。

## 谁依赖我 / 我依赖谁

- 被 `src/main/vpm/index.ts` 组合根构造；**P4-C 的安装事务消费 `ensurePackage()` 的
  `{ sha256, size, path }`**，解压交给 `../install/archive.ts`。
- P1-D 的仓库刷新/下载走同一套 HTTP + cache。
- 依赖 `shared/ulid`、`shared/vpm/dataRoot`、`shared/vpm/errors`、`../db`（句柄类型）、
  Node `fs/crypto/path`。
- 不依赖 `repos/`、`renderer/**`、Electron（`http/` 是注入的端口）。
- **缓存写入的唯一写入者**：其他模块不要自己写 `cache/` 或 `vpm_cache_entry`。
