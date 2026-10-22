import fs from 'node:fs'
import { VpmError } from '../../../shared/vpm/errors'
import type { VpmHttpPort } from '../http'
import type { CacheEntryStore } from './entries'
import type { VpmCacheStore } from './store'
import type {
  VpmCacheEviction,
  VpmCacheUsage,
  VpmCachedPackage,
  VpmPackageCacheRequest,
  VpmPackageDownloadProgress
} from './types'

const HASH = /^[a-f0-9]{64}$/
const DEFAULT_QUOTA_BYTES = 20 * 1024 * 1024 * 1024
const RESERVE_BYTES = 64 * 1024 * 1024
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 400
const PROGRESS_INTERVAL_MS = 100

export interface PackageCacheServiceOptions {
  store: VpmCacheStore
  entries: CacheEntryStore
  http: VpmHttpPort
  /** 默认 20 GiB；只约束 cache/packages，不碰 vault/backup/工程。 */
  quotaBytes?: number
  now?: () => number
  /** 测试注入；默认用 statfs。 */
  availableBytes?: (directory: string) => number
  /** 测试可调小；默认 400ms 起退避。 */
  retryDelayMs?: number
}

function normalizeSha(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new VpmError('vpmCacheHashMissing')
  }
  const sha = value.trim().toLowerCase()
  if (!HASH.test(sha)) throw new VpmError('vpmCacheHashMissing')
  return sha
}

function normalizeSize(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new VpmError('vpmCacheHashMismatch')
  }
  return value
}

function defaultAvailableBytes(directory: string): number {
  try {
    const statfs = (fs as unknown as {
      statfsSync?: (path: string) => { bavail: number; bsize: number }
    }).statfsSync
    if (!statfs) return Number.MAX_SAFE_INTEGER
    const stat = statfs(directory)
    const bytes = Number(stat.bavail) * Number(stat.bsize)
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : Number.MAX_SAFE_INTEGER
  } catch {
    // 空间探测失败不阻塞下载；真正的写入失败仍会给出 vpmCacheWriteFailed。
    return Number.MAX_SAFE_INTEGER
  }
}

function hostOf(finalUrl: string): string | null {
  try {
    const host = new URL(finalUrl).hostname.trim().toLowerCase()
    return host && host.length <= 255 ? host : null
  } catch {
    return null
  }
}

function retryable(error: unknown): boolean {
  if (!(error instanceof VpmError)) return false
  if (error.code === 'vpmHttpNetwork' || error.code === 'vpmHttpTimeout') return true
  if (error.code === 'vpmHttpStatus') {
    const status = Number(error.params?.status)
    return status >= 500 && status <= 599
  }
  return false
}

function aborted(): VpmError {
  return new VpmError('vpmHttpAborted')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted())
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      cleanup()
      reject(aborted())
    }
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(aborted())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup()
      reject(aborted())
    }
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      }
    )
  })
}

/**
 * 包下载 + 内容寻址缓存。
 *
 * 流程：缓存命中→完整重算 hash；损坏→移到 corrupt/ 保留→重下；
 * 下载→HTTP 边写边算 hash→大小/hash 校验→rename→再完整校验→写 entry。
 *
 * 不变量：
 * - 无 SHA-256 的包直接拒绝；
 * - 只清理 cache/packages；vault/backups/工程文件永不在清理范围；
 * - 同一 hash 同时只有一个下载；并发调用共享结果；
 * - 下载重试只限网络/超时/5xx，最多 2 次；4xx/hash 不匹配不重试。
 */
export class PackageCacheService {
  readonly store: VpmCacheStore
  readonly quotaBytes: number
  private readonly entries: CacheEntryStore
  private readonly http: VpmHttpPort
  private readonly now: () => number
  private readonly availableBytes: (directory: string) => number
  private readonly retryDelayMs: number
  private readonly inflight = new Map<string, Promise<VpmCachedPackage>>()

  constructor(options: PackageCacheServiceOptions) {
    const quota = options.quotaBytes ?? DEFAULT_QUOTA_BYTES
    if (!Number.isSafeInteger(quota) || quota <= 0) {
      throw new VpmError('vpmCacheWriteFailed')
    }
    this.store = options.store
    this.entries = options.entries
    this.http = options.http
    this.quotaBytes = quota
    this.now = options.now ?? Date.now
    this.availableBytes = options.availableBytes ?? defaultAvailableBytes
    const retryDelay = options.retryDelayMs ?? RETRY_DELAY_MS
    if (!Number.isFinite(retryDelay) || retryDelay < 0) {
      throw new VpmError('vpmCacheWriteFailed')
    }
    this.retryDelayMs = retryDelay
  }

  usage(): VpmCacheUsage {
    const files = this.store.listPackages()
    return {
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      files: files.length,
      quotaBytes: this.quotaBytes
    }
  }

  /** 显式按配额清理最久未用的缓存；只动 cache/packages。 */
  cleanup(protectSha256?: string): VpmCacheEviction[] {
    return this.evictTo(this.quotaBytes, protectSha256 ?? null)
  }

  async ensurePackage(input: VpmPackageCacheRequest): Promise<VpmCachedPackage> {
    if (!input || typeof input !== 'object') throw new VpmError('vpmCacheHashMissing')
    const sha = normalizeSha(input.sha256)
    const size = normalizeSize(input.size)
    if (typeof input.url !== 'string' || !input.url.trim()) {
      throw new VpmError('vpmCacheWriteFailed')
    }
    if (input.signal?.aborted) throw aborted()

    const existing = this.inflight.get(sha)
    if (existing) return awaitWithAbort(existing, input.signal)

    const pending = this.prepare(input, sha, size).finally(() => {
      if (this.inflight.get(sha) === pending) this.inflight.delete(sha)
    })
    this.inflight.set(sha, pending)
    return pending
  }

  private async prepare(
    input: VpmPackageCacheRequest,
    sha: string,
    size: number | null
  ): Promise<VpmCachedPackage> {
    const existingPath = this.store.pathForPackage(sha)
    if (fs.existsSync(existingPath)) {
      try {
        const verified = await this.store.verifyFile(existingPath, sha)
        if (size !== null && verified.size !== size) {
          throw new VpmError('vpmCacheHashMismatch')
        }
        this.entries.touch({ sha256: sha, size: verified.size, path: verified.path })
        return { sha256: sha, size: verified.size, path: verified.path, reused: true }
      } catch (error) {
        if (
          error instanceof VpmError &&
          (error.code === 'vpmCacheHashMismatch' || error.code === 'vpmCachePathInvalid')
        ) {
          // 先移出现场再重下；quarantine 失败会抛 write error，避免直接覆盖证据。
          this.store.quarantinePackage(sha)
          this.entries.remove(sha)
        } else {
          throw error
        }
      }
    } else {
      this.entries.remove(sha)
    }

    this.reserveFor(size)

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      const temp = this.store.createTempPath(`pkg-${sha.slice(0, 8)}`)
      const progress = this.progressEmitter(input, attempt)
      let result: Awaited<ReturnType<VpmHttpPort['downloadToFile']>>
      try {
        result = await this.http.downloadToFile(input.url, temp, {
          headers: input.headers,
          signal: input.signal,
          onProgress: progress.emit
        })
      } catch (error) {
        if (retryable(error) && attempt <= MAX_RETRIES) {
          await sleep(this.retryDelayMs * attempt, input.signal)
          continue
        }
        throw error
      }

      if (result.sha256 !== sha || (size !== null && result.size !== size)) {
        this.quarantineTemp(temp, sha)
        throw new VpmError('vpmCacheHashMismatch')
      }

      const entry = this.store.commitDownload({
        tempPath: temp,
        sha256: result.sha256,
        size: result.size,
        expectedSha256: sha
      })
      progress.finish(result.size)

      let verified: { path: string; size: number; sha256: string }
      try {
        verified = await this.store.verifyFile(entry.path, sha)
      } catch (error) {
        try {
          this.store.quarantinePackage(sha)
        } catch {
          /* 保留原错误：校验失败比清理失败更重要 */
        }
        this.entries.remove(sha)
        throw error
      }
      if (size !== null && verified.size !== size) {
        try {
          this.store.quarantinePackage(sha)
        } catch {
          /* 同上 */
        }
        this.entries.remove(sha)
        throw new VpmError('vpmCacheHashMismatch')
      }

      // 并发淘汰可能在 verifyFile 的异步窗口里删掉我们刚落盘的文件：
      // 绝不为一个不存在的文件写行（否则会留下"有行没文件"的孤儿记录）。
      if (!fs.existsSync(verified.path)) {
        this.entries.remove(sha)
        throw new VpmError('vpmCacheQuotaExceeded')
      }
      this.entries.upsert({
        sha256: sha,
        size: verified.size,
        path: verified.path,
        sourceHost: hostOf(result.finalUrl)
      })
      this.evictTo(this.quotaBytes, sha)
      if (this.usage().bytes > this.quotaBytes) {
        // 单个包比配额还大：不留下一个永远超配额的缓存。
        this.store.removePackage(sha)
        this.entries.remove(sha)
        throw new VpmError('vpmCacheQuotaExceeded')
      }

      return { sha256: sha, size: verified.size, path: verified.path, reused: false }
    }

    throw new VpmError('vpmHttpNetwork')
  }

  private reserveFor(size: number | null): void {
    if (size !== null && size > this.quotaBytes) {
      throw new VpmError('vpmCacheQuotaExceeded')
    }
    if (size !== null) {
      const target = Math.max(0, this.quotaBytes - size)
      if (this.usage().bytes > target) this.evictTo(target, null)
      if (this.usage().bytes + size > this.quotaBytes) {
        throw new VpmError('vpmCacheQuotaExceeded')
      }
    }
    const required = (size ?? 0) + RESERVE_BYTES
    if (this.availableBytes(this.store.cacheRoot) < required) {
      throw new VpmError('vpmCacheNoSpace')
    }
  }

  /** 按 LRU 淘汰到目标字节数；`protectSha` 是本次调用自己的包，绝不淘汰。 */
  private evictTo(targetBytes: number, protectSha: string | null): VpmCacheEviction[] {
    const entries = new Map(this.entries.list().map((entry) => [entry.sha256, entry]))
    const files = this.store.listPackages()
    const items = files.map((file) => ({
      ...file,
      lastUsedAt: entries.get(file.sha256)?.lastUsedAt ?? file.mtimeMs
    }))
    let total = items.reduce((sum, item) => sum + item.size, 0)
    const removed: VpmCacheEviction[] = []
    items.sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.sha256.localeCompare(b.sha256))
    for (const item of items) {
      if (total <= targetBytes) break
      if (item.sha256 === protectSha) continue
      this.store.removePackage(item.sha256)
      this.entries.remove(item.sha256)
      total -= item.size
      removed.push({ sha256: item.sha256, size: item.size, path: item.path })
    }
    return removed
  }

  private quarantineTemp(temp: string, sha: string): void {
    try {
      this.store.quarantine(temp, sha)
    } catch {
      // 下载内容已经不可信；保留 tmp 让 clearTmp/诊断处理，不让清理掩盖 hash 错误。
    }
  }

  private progressEmitter(
    input: VpmPackageCacheRequest,
    attempt: number
  ): {
    emit: (progress: { downloaded: number; total: number | null }) => void
    finish: (size: number) => void
  } {
    let lastAt = Number.NEGATIVE_INFINITY
    let lastBytes = -1
    const emit = (progress: { downloaded: number; total: number | null }): void => {
      if (!input.onProgress) return
      const complete = progress.total !== null && progress.downloaded >= progress.total
      const at = this.now()
      if (!complete && at - lastAt < PROGRESS_INTERVAL_MS) return
      if (!complete && progress.downloaded === lastBytes) return
      lastAt = at
      lastBytes = progress.downloaded
      try {
        input.onProgress({
          downloaded: progress.downloaded,
          total: progress.total,
          attempt
        } satisfies VpmPackageDownloadProgress)
      } catch {
        /* UI 回调异常不能中断下载 */
      }
    }
    return {
      emit,
      finish: (size: number): void => emit({ downloaded: size, total: size })
    }
  }
}
