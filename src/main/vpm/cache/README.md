# src/main/vpm/cache

## 职责

VPM 包缓存：临时文件、正式包文件、路径校验、原子提交、显式校验/清理。
它只管理 `<dataRoot>/cache`，不决定下载什么/装什么。

## 不负责什么

- 不发网络（HTTP 在 `http/`）。
- 不解析仓库/包元数据、不决定版本。
- 不删数据根里的 `vault/`、`backups/`、工程文件；只清理 `cache/`。
- 不自动做配额回收（P8 再接用量/清理 UI）。

## 目录/数据

```text
<dataRoot>/cache/
  packages/<sha 前两位>/<sha>.zip
  tmp/<prefix>-<ulid>.part
```

- `dataRoot` 必须已存在且是绝对目录；`cacheRoot` 默认 `<dataRoot>/cache`，
  必须是 dataRoot 的**严格子目录**。词法和 `realpath` 都检查，防 symlink 逃逸。
- 包文件路径只由 64 位 hex SHA-256 派生；临时文件必须在 `tmp/` 内。
- 缓存是可再生数据，允许替换/清理；不适用“永不删用户文件”（但绝不碰 cache 外）。

## 公开 API

- `new VpmCacheStore({ dataRoot, cacheRoot? })`：校验并建立 cache 目录。
- `createTempPath(prefix?)`：返回 tmp/ 下的唯一 `.part` 路径。
- `pathForPackage(sha256)` / `hasPackage(sha256)` / `removePackage(sha256)`。
- `commitDownload({ tempPath, sha256, size, expectedSha256? })`：
  - 校验期望 hash、文件大小、临时文件路径；
  - 同卷 `rename` 到正式路径；替换旧缓存文件；
  - 失败删除临时文件，抛 `vpmCache*`。
- `verifyFile(file, expectedSha256)`：流式重新算 hash，发现磁盘损坏/外部改写。
- `clearTmp()`：只清 tmp；`clearPackages()`：显式清 packages。

## 失败码

- `vpmCachePathInvalid`：dataRoot 不存在/相对路径，cacheRoot 不在 dataRoot 内或逃逸。
- `vpmCacheWriteFailed`：建目录/写文件/rename/清理目录失败。
- `vpmCacheHashMismatch`：期望 hash 不一致、大小不一致、文件校验失败。

## 测试入口

- `tests/vpm/cache/store.spec.ts`
- 与 HTTP 的联调写在 `tests/vpm/http/client.spec.ts` 或本文件。
- 运行：`npm test`

## 谁依赖我 / 我依赖谁

- 被 P1-D 的下载/刷新、P4 的安装事务使用；不被渲染层直接引用。
- 依赖 `shared/ulid`、`shared/vpm/dataRoot`、`shared/vpm/errors`、Node `fs/crypto/path`。
- 不依赖 `http/`（HTTP 只把临时文件写进来）、`repos/`、`renderer/**`。
