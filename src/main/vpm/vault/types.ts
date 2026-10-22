/** 回滚仓（vault）的对外类型。 */

export interface VaultOptions {
  /** 已由 gate 校验过的非 C 数据根。 */
  dataRoot: string
  /** 默认 `<dataRoot>/vault`；必须是 dataRoot 的严格子目录。 */
  vaultRoot?: string
}

export type VaultEntryKind = 'file' | 'dir'

export interface VaultEntryInput {
  /** 相对 `sourceDir` 的路径；必须是工程内相对路径语义。 */
  relativePath: string
  kind: VaultEntryKind
}

export interface VaultArchiveInput {
  /** `projectSlugOf()` 产出的安全短名，不是带盘符的路径。 */
  projectSlug: string
  /** ULID。 */
  opId: string
  /** 通常是 `<project>/.atrium-tx/<op>/trash`。 */
  sourceDir: string
  entries: readonly VaultEntryInput[]
}

export interface VaultArchivedEntry {
  relativePath: string
  kind: VaultEntryKind
  vaultPath: string
  /** 文件 = 文件 SHA-256；目录 = 树摘要（相对路径 + 大小 + 文件 hash 的稳定哈希）。 */
  sha256: string
  size: number
  files: number
}

export interface VaultArchiveResult {
  opDir: string
  entries: VaultArchivedEntry[]
  bytes: number
  files: number
}

export interface VaultUsage {
  bytes: number
  files: number
  operations: number
}
