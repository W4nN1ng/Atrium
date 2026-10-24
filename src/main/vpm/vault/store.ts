import fs from 'node:fs'
import path from 'node:path'
import { isValidUlid } from '../../../shared/ulid'
import { isSameOrInside } from '../../../shared/vpm/dataRoot'
import { VpmError } from '../../../shared/vpm/errors'
import {
  copyTreeWithDigest,
  directoryUsage,
  hashFile,
  lstatOrNull,
  removeTree
} from '../fsUtil'
import type {
  VaultArchiveInput,
  VaultArchiveResult,
  VaultArchivedEntry,
  VaultEntryInput,
  VaultEntryKind,
  VaultOptions,
  VaultUsage
} from './types'

const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const MAX_ENTRIES = 50_000
const PROBE_NAME = '.atrium-vault-probe'

function unavailable(cause?: unknown): VpmError {
  return new VpmError('vpmVaultUnavailable', undefined, cause)
}

function archiveFailed(params?: Record<string, string | number>, cause?: unknown): VpmError {
  return new VpmError('vpmVaultArchiveFailed', params, cause)
}

function inside(parent: string, candidate: string): boolean {
  return isSameOrInside(parent, candidate, process.platform)
}

/** 相对路径归一：拒绝盘符、UNC、`..`、控制字符与空段。 */
function normalizeRelative(value: unknown): string {
  if (typeof value !== 'string') throw archiveFailed({ reason: 'path' })
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!normalized || normalized.length > 1024) throw archiveFailed({ reason: 'path' })
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw archiveFailed({ reason: 'path' })
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw archiveFailed({ reason: 'path' })
  for (const part of normalized.split('/')) {
    if (!part || part === '.' || part === '..') throw archiveFailed({ reason: 'path' })
  }
  return normalized
}

function realDirectory(value: unknown, factory: (cause?: unknown) => VpmError): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw factory()
  }
  let real: string
  try {
    real = fs.realpathSync.native(path.resolve(value))
    const stat = fs.lstatSync(real)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('not a directory')
  } catch (error) {
    throw factory(error)
  }
  return real
}

/**
 * 回滚仓：把事务区 `trash` 里的旧包/旧 Assets **复制**到
 * `<dataRoot>/vault/<projectSlug>/<opId>/`，逐文件校验后才删除事务区的临时副本。
 *
 * 不变量：
 * - 只增不永久删：复制/校验任何一步失败都保留源目录，不清现场；
 * - vault 里的内容是用户文件副本，`clear()` 只能由用户明确触发（P4-E/P8）；
 * - 不跟随符号链接；不把 `..`/盘符/UNC 写进 vault；
 * - 同一 opId 重试时复用已有目录（覆盖自己上次的半成品），不覆盖其他操作。
 */
export class VaultStore {
  readonly dataRoot: string
  readonly vaultRoot: string

  constructor(options: VaultOptions) {
    const dataRoot = realDirectory(options?.dataRoot, unavailable)
    const lexical = path.resolve(options.vaultRoot ?? path.join(dataRoot, 'vault'))
    if (lexical === dataRoot || !inside(dataRoot, lexical)) throw unavailable()

    let vaultRoot: string
    try {
      fs.mkdirSync(lexical, { recursive: true })
      vaultRoot = fs.realpathSync.native(lexical)
      const stat = fs.lstatSync(vaultRoot)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('not a directory')
    } catch (error) {
      throw unavailable(error)
    }
    if (vaultRoot === dataRoot || !inside(dataRoot, vaultRoot)) throw unavailable()

    this.dataRoot = dataRoot
    this.vaultRoot = vaultRoot
  }

  /** 预检用：能建目录、能写探针文件。不抛异常，返回 false 由调用方拒绝。 */
  ensureUsable(): boolean {
    const probe = path.join(this.vaultRoot, PROBE_NAME)
    try {
      fs.writeFileSync(probe, 'ok', { flag: 'w', mode: 0o600 })
      fs.unlinkSync(probe)
      return true
    } catch {
      try {
        fs.rmSync(probe, { force: true })
      } catch {
        /* 探针清理失败不影响判定 */
      }
      return false
    }
  }

  opDir(projectSlug: string, opId: string): string {
    if (typeof projectSlug !== 'string' || !SLUG.test(projectSlug)) throw unavailable()
    if (typeof opId !== 'string' || !isValidUlid(opId)) throw unavailable()
    const dir = path.join(this.vaultRoot, projectSlug.toLowerCase(), opId)
    if (!inside(this.vaultRoot, dir) || dir === this.vaultRoot) throw unavailable()
    return dir
  }

  exists(projectSlug: string, opId: string): boolean {
    try {
      return lstatOrNull(this.opDir(projectSlug, opId))?.isDirectory() === true
    } catch {
      return false
    }
  }

  /**
   * 归档一组事务区条目。
   *
   * 只有全部条目都复制并通过 hash/大小校验后，才删除 `sourceDir` 下的源条目。
   * 任一条目失败 → 抛 `vpmVaultArchiveFailed`，源目录保持原样。
   */
  async archive(input: VaultArchiveInput): Promise<VaultArchiveResult> {
    const opDir = this.ensureOpDir(input.projectSlug, input.opId)
    const sourceRoot = realDirectory(input.sourceDir, () => archiveFailed({ reason: 'source' }))
    if (inside(sourceRoot, this.vaultRoot)) throw archiveFailed({ reason: 'source' })

    const entries = this.normalizeEntries(input.entries)
    const archived: VaultArchivedEntry[] = []
    let bytes = 0
    let files = 0

    for (const entry of entries) {
      const source = path.join(sourceRoot, entry.relativePath)
      if (!inside(sourceRoot, source) || source === sourceRoot) {
        throw archiveFailed({ reason: 'path' })
      }
      const stat = lstatOrNull(source)
      if (!stat) throw archiveFailed({ reason: 'missing', path: entry.relativePath })
      if (stat.isSymbolicLink()) throw archiveFailed({ reason: 'symlink', path: entry.relativePath })
      if (entry.kind === 'dir' && !stat.isDirectory()) {
        throw archiveFailed({ reason: 'kind', path: entry.relativePath })
      }
      if (entry.kind === 'file' && !stat.isFile()) {
        throw archiveFailed({ reason: 'kind', path: entry.relativePath })
      }

      const target = path.join(opDir, entry.relativePath)
      if (!inside(opDir, target) || target === opDir) throw archiveFailed({ reason: 'path' })
      // 上次失败留下的半成品：只清自己这次要覆盖的目标。
      if (lstatOrNull(target)) removeTree(target)

      try {
        if (entry.kind === 'dir') {
          const digest = await copyTreeWithDigest(source, target)
          archived.push({
            relativePath: entry.relativePath,
            kind: 'dir',
            vaultPath: target,
            sha256: digest.sha256,
            size: digest.size,
            files: digest.files
          })
          bytes += digest.size
          files += digest.files
        } else {
          const hashed = await hashFile(source)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
          const copied = await hashFile(target)
          if (copied.sha256 !== hashed.sha256 || copied.size !== hashed.size) {
            throw archiveFailed({ reason: 'verify', path: entry.relativePath })
          }
          archived.push({
            relativePath: entry.relativePath,
            kind: 'file',
            vaultPath: target,
            sha256: hashed.sha256,
            size: hashed.size,
            files: 1
          })
          bytes += hashed.size
          files++
        }
      } catch (error) {
        if (error instanceof VpmError && error.code === 'vpmVaultArchiveFailed') throw error
        throw archiveFailed({ reason: 'copy', path: entry.relativePath }, error)
      }
    }

    // 全部校验通过后才动源目录；这里是删除应用自己的临时副本，不是删用户文件。
    for (const entry of entries) {
      const source = path.join(sourceRoot, entry.relativePath)
      try {
        if (entry.kind === 'dir') removeTree(source)
        else fs.unlinkSync(source)
      } catch (error) {
        throw archiveFailed({ reason: 'cleanup', path: entry.relativePath }, error)
      }
    }

    return { opDir, entries: archived, bytes, files }
  }

  usage(): VaultUsage {
    let operations = 0
    try {
      for (const slug of fs.readdirSync(this.vaultRoot, { withFileTypes: true })) {
        if (!slug.isDirectory() || slug.isSymbolicLink()) continue
        const slugDir = path.join(this.vaultRoot, slug.name)
        if (!inside(this.vaultRoot, slugDir)) continue
        for (const op of fs.readdirSync(slugDir, { withFileTypes: true })) {
          if (op.isDirectory() && !op.isSymbolicLink()) operations++
        }
      }
    } catch {
      /* 统计失败不影响调用方 */
    }
    const usage = directoryUsage(this.vaultRoot)
    return { bytes: usage.bytes, files: usage.files, operations }
  }

  private ensureOpDir(projectSlug: string, opId: string): string {
    const dir = this.opDir(projectSlug, opId)
    try {
      fs.mkdirSync(dir, { recursive: true })
      const real = fs.realpathSync.native(dir)
      const stat = fs.lstatSync(real)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('not a directory')
      if (real === this.vaultRoot || !inside(this.vaultRoot, real)) throw new Error('escaped')
      return real
    } catch (error) {
      throw unavailable(error)
    }
  }

  private normalizeEntries(input: readonly VaultEntryInput[]): VaultEntryInput[] {
    if (!Array.isArray(input) || input.length > MAX_ENTRIES) {
      throw archiveFailed({ reason: 'entries' })
    }
    const seen = new Set<string>()
    const out: VaultEntryInput[] = []
    for (const raw of input) {
      const relativePath = normalizeRelative(raw?.relativePath)
      const kind: VaultEntryKind = raw?.kind === 'dir' ? 'dir' : 'file'
      if (seen.has(relativePath)) continue
      seen.add(relativePath)
      out.push({ relativePath, kind })
    }
    return out
  }
}
