import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ulid } from '../../../shared/ulid'
import { VpmError } from '../../../shared/vpm/errors'
import { isSameOrInside } from '../../../shared/vpm/dataRoot'
import type { VpmCacheCommitInput, VpmCacheEntry, VpmCacheOptions } from './types'

function pathError(): VpmError {
  return new VpmError('vpmCachePathInvalid')
}

function writeError(cause?: unknown): VpmError {
  return new VpmError('vpmCacheWriteFailed', undefined, cause)
}

function normalizeSha(value: unknown): string {
  if (typeof value !== 'string') throw new VpmError('vpmCacheHashMismatch')
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new VpmError('vpmCacheHashMismatch')
  return normalized
}

function normalizeRoot(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !path.isAbsolute(value)) {
    throw pathError()
  }
  return path.resolve(value)
}

function inside(parent: string, candidate: string): boolean {
  return isSameOrInside(parent, candidate, process.platform)
}

/**
 * VPM 包缓存。
 *
 * 目录：
 *   <cacheRoot>/packages/<sha 前两位>/<sha>.zip
 *   <cacheRoot>/tmp/<prefix>-<ulid>.part
 *
 * 路径规则：
 * - dataRoot 必须是已存在的绝对目录；cacheRoot 默认 dataRoot/cache；
 * - cacheRoot 必须是 dataRoot 的严格子目录（词法 + realpath 双重检查，防 symlink 逃逸）；
 * - 临时文件必须在 tmpRoot 内；包文件路径只由 64 位 hex hash 派生。
 */
export class VpmCacheStore {
  readonly dataRoot: string
  readonly cacheRoot: string
  readonly packagesRoot: string
  readonly tmpRoot: string

  constructor(options: VpmCacheOptions) {
    const dataRoot = normalizeRoot(options?.dataRoot)
    let dataReal: string
    try {
      dataReal = fs.realpathSync(dataRoot)
      if (!fs.statSync(dataReal).isDirectory()) throw new Error('not a directory')
    } catch (error) {
      throw pathError()
    }

    const cacheLexical = path.resolve(options.cacheRoot ?? path.join(dataReal, 'cache'))
    if (cacheLexical === dataReal || !inside(dataReal, cacheLexical)) throw pathError()

    let cacheReal: string
    try {
      fs.mkdirSync(cacheLexical, { recursive: true })
      cacheReal = fs.realpathSync(cacheLexical)
      if (!fs.statSync(cacheReal).isDirectory()) throw new Error('not a directory')
    } catch (error) {
      throw pathError()
    }
    if (cacheReal === dataReal || !inside(dataReal, cacheReal)) throw pathError()

    this.dataRoot = dataReal
    this.cacheRoot = cacheReal
    this.packagesRoot = path.join(cacheReal, 'packages')
    this.tmpRoot = path.join(cacheReal, 'tmp')
  }

  createTempPath(prefix = 'download'): string {
    if (typeof prefix !== 'string' || !/^[a-z0-9-]{1,32}$/i.test(prefix)) throw pathError()
    try {
      fs.mkdirSync(this.tmpRoot, { recursive: true })
    } catch (error) {
      throw writeError(error)
    }
    return path.join(this.tmpRoot, `${prefix}-${ulid()}.part`)
  }

  pathForPackage(sha256: string): string {
    const sha = normalizeSha(sha256)
    const file = path.join(this.packagesRoot, sha.slice(0, 2), `${sha}.zip`)
    if (!inside(this.packagesRoot, file)) throw pathError()
    return file
  }

  hasPackage(sha256: string): boolean {
    try {
      return fs.statSync(this.pathForPackage(sha256)).isFile()
    } catch {
      return false
    }
  }

  /**
   * 把 HTTP 下载的临时文件提交为正式缓存。
   *
   * HTTP 已经边写边算 hash；这里校验期望 hash 和文件大小，然后同卷 rename。
   * 失败会删除临时文件；正式缓存文件是可再生的，替换旧文件不违反“不删用户文件”。
   */
  commitDownload(input: VpmCacheCommitInput): VpmCacheEntry {
    try {
      return this.commitDownloadInner(input)
    } catch (error) {
      if (input && typeof input.tempPath === 'string') this.removeTemp(input.tempPath)
      throw error
    }
  }

  private commitDownloadInner(input: VpmCacheCommitInput): VpmCacheEntry {
    if (!input || typeof input !== 'object') throw writeError()
    const sha = normalizeSha(input.sha256)
    const expected = input.expectedSha256 == null ? null : normalizeSha(input.expectedSha256)
    if (typeof input.size !== 'number' || !Number.isFinite(input.size) || input.size < 0) {
      throw writeError()
    }
    if (expected && expected !== sha) {
      this.removeTemp(input.tempPath)
      throw new VpmError('vpmCacheHashMismatch')
    }
    if (typeof input.tempPath !== 'string' || !path.isAbsolute(input.tempPath)) throw writeError()

    let tempReal: string
    try {
      tempReal = fs.realpathSync(input.tempPath)
      if (!inside(this.tmpRoot, tempReal)) throw pathError()
      const stat = fs.statSync(tempReal)
      if (!stat.isFile() || stat.size !== input.size) throw new VpmError('vpmCacheHashMismatch')
    } catch (error) {
      if (error instanceof VpmError) {
        this.removeTemp(input.tempPath)
        throw error
      }
      this.removeTemp(input.tempPath)
      throw writeError(error)
    }

    const finalPath = this.pathForPackage(sha)
    try {
      fs.mkdirSync(path.dirname(finalPath), { recursive: true })
      fs.rmSync(finalPath, { force: true })
      fs.renameSync(tempReal, finalPath)
      return { path: finalPath, size: input.size, sha256: sha }
    } catch (error) {
      this.removeTemp(tempReal)
      throw writeError(error)
    }
  }

  /** 显式校验已有缓存文件；用于发现磁盘损坏/外部改写。 */
  async verifyFile(file: string, expectedSha256: string): Promise<VpmCacheEntry> {
    const expected = normalizeSha(expectedSha256)
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw pathError()
    let real: string
    try {
      real = fs.realpathSync(file)
      if (!inside(this.cacheRoot, real)) throw pathError()
      if (!fs.statSync(real).isFile()) throw pathError()
    } catch (error) {
      if (error instanceof VpmError) throw error
      throw pathError()
    }

    return new Promise<VpmCacheEntry>((resolve, reject) => {
      const hash = createHash('sha256')
      let size = 0
      const stream = fs.createReadStream(real)
      stream.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        hash.update(buffer)
      })
      stream.on('error', (error) => reject(writeError(error)))
      stream.on('end', () => {
        const digest = hash.digest('hex')
        if (digest !== expected) {
          reject(new VpmError('vpmCacheHashMismatch'))
          return
        }
        resolve({ path: real, size, sha256: digest })
      })
    })
  }

  removePackage(sha256: string): boolean {
    const file = this.pathForPackage(sha256)
    if (!fs.existsSync(file)) return false
    fs.rmSync(file, { force: true })
    return true
  }

  /** 只清 tmp，不动正式缓存；启动/失败恢复用。 */
  clearTmp(): void {
    this.clearDirectory(this.tmpRoot)
  }

  /** 显式清空包缓存；只动 cacheRoot/packages，不动数据根其他目录。 */
  clearPackages(): void {
    this.clearDirectory(this.packagesRoot)
  }

  private clearDirectory(dir: string): void {
    try {
      if (!fs.existsSync(dir)) return
      if (!inside(this.cacheRoot, dir)) throw pathError()
      for (const name of fs.readdirSync(dir)) fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    } catch (error) {
      if (error instanceof VpmError) throw error
      throw writeError(error)
    }
  }

  private removeTemp(file: string): void {
    try {
      if (typeof file !== 'string' || !path.isAbsolute(file)) return
      const resolved = path.resolve(file)
      // 只删本 cache 的 tmp/ 下的文件；调用方传错路径时绝不动 cache 外的用户文件。
      if (!inside(this.tmpRoot, resolved)) return
      fs.rmSync(resolved, { force: true })
    } catch {
      /* 临时文件清理失败不掩盖主错误 */
    }
  }
}
