# src/main/vpm/vault

## 职责

回滚仓（vault）：把事务区 `trash` 里的**旧包目录 / 旧 Assets 文件**复制到
`<dataRoot>/vault/<projectSlug>/<opId>/`，逐文件校验 SHA-256 与大小，
**全部成功之后**才删除事务区里的临时副本。

这是"不永久删除用户文件"这条产品底线的落地实现：包升级/降级/重装/卸载、旧 Assets 清理，
被替换掉的东西都先进这里，用户以后可以从这里恢复。

## 不负责什么

- 不决定"该归档什么"：条目由 `install/transaction.ts` 按计划给出。
- 不写 `vpm.db`：归档结果由事务层写 `vpm_operation_file`（action=`vault`）。
- 不做撤销：撤销是 P4-D/P4-E 的独立事务，读这里的内容再走一次安装事务。
- 不清理自己：回滚仓只增；清理必须用户明确触发（`shell.trashItem`，P8-B）。
- 不碰工程：只读 `sourceDir`（事务区），只写 `vaultRoot`。

## 公开 API

只从 `index.ts` 导出：

- `VaultStore`
  - `constructor({ dataRoot, vaultRoot? })`：`dataRoot` 必须是已存在的绝对目录；
    `vaultRoot` 默认 `<dataRoot>/vault`，必须是 dataRoot 的**严格子目录**
    （词法 + realpath 双检，拒绝 symlink）。
  - `ensureUsable()`：建目录 + 写探针文件；返回 boolean，不抛异常（预检用）。
  - `opDir(projectSlug, opId)`：`<vaultRoot>/<slug>/<opId>`；slug 必须是
    `^[a-z0-9][a-z0-9._-]{0,63}$`，opId 必须是 ULID。
  - `exists(projectSlug, opId)`。
  - `archive({ projectSlug, opId, sourceDir, entries })`：条目 `{ relativePath, kind }`，
    返回 `{ opDir, entries: [{ relativePath, kind, vaultPath, sha256, size, files }], bytes, files }`。
  - `usage()`：`{ bytes, files, operations }`，用于设置页显示占用。
- 类型：`VaultOptions`、`VaultArchiveInput`、`VaultArchiveResult`、`VaultArchivedEntry`、
  `VaultEntryInput`、`VaultEntryKind`、`VaultUsage`。

## 数据 / 写入

```text
<dataRoot>/vault/<projectSlug>/<opId>/
  packages/<包名>/...        旧包目录（原样，含 .meta）
  legacy/Assets/...          旧 Assets 文件/目录（含同名 .meta）
```

- `projectSlug` 由 `projectSlugOf()` 生成（安全短名 + 路径 hash 前 8 位），**不是**盘符路径。
- 目录的 `sha256` 是**树摘要**：按相对路径排序的 `rel\0size\0fileHash` 行的 SHA-256；
  文件的 `sha256` 就是文件本身。`size` 是总字节数，`files` 是文件数。
- 复制用 `fs.copyFileSync(..., COPYFILE_EXCL)`，写前再算一次目标 hash 比对；
  目标目录里上一次失败留下的半成品会先被清掉（只清 `<opId>` 自己）。
- 归档完成后删除 `sourceDir` 下**已被归档的条目**（应用自己的临时副本）。

## 失败模式

- 数据根不存在/不是目录、`vaultRoot` 逃出数据根或等于数据根 → `vpmVaultUnavailable`。
- slug/opId 非法、`sourceDir` 非法或是回滚仓自己 → `vpmVaultArchiveFailed`。
- 条目路径含 `..`/盘符/控制字符、条目不存在、类型不符、遇到符号链接/特殊文件 →
  `vpmVaultArchiveFailed`（**源目录原样保留**）。
- 复制/校验/清理失败 → `vpmVaultArchiveFailed`；已经复制进 vault 的部分保留（下次重试会覆盖）。
- 事务层收到归档失败：工程保持可用，`vault_pending=1`，事务区保留，可重试。

## 测试入口

- `tests/vpm/vault/store.spec.ts`：根目录约束、slug/opId 校验、目录与单文件归档、
  树摘要、失败保留源目录、路径逃逸、junction 拒绝、占用统计。
- 运行：`npx vitest run tests/vpm/vault`。

## 谁依赖我 / 我依赖谁

- 被 `install/transaction.ts` 的 `vault` 步使用；被 `src/main/vpm/index.ts` 组合根构造
  （`VpmRuntime.vault`）。
- 依赖：`shared/vpm/dataRoot`（`isSameOrInside`）、`shared/ulid`、`../fsUtil`、
  `node:fs`/`node:path`。
- 不依赖 Electron、HTTP、`vpm.db`、渲染层；不 import 其他模块的内部文件。
