import type { VpmDb } from '../db'
import { VpmError } from '../../../shared/vpm/errors'
import type { VpmCacheEntryInput, VpmCacheEntryRow } from './types'

const HASH = /^[a-f0-9]{64}$/

interface CacheEntryDbRow {
  sha256: string
  size: number
  path: string
  source_host: string | null
  last_used_at: number
}

function invalid(): VpmError {
  return new VpmError('vpmCacheHashMismatch')
}

function normalizeSha(value: unknown): string {
  if (typeof value !== 'string') throw invalid()
  const normalized = value.trim().toLowerCase()
  if (!HASH.test(normalized)) throw invalid()
  return normalized
}

function mapRow(row: CacheEntryDbRow): VpmCacheEntryRow {
  return {
    sha256: row.sha256,
    size: Number(row.size),
    path: row.path,
    sourceHost: row.source_host,
    lastUsedAt: Number(row.last_used_at)
  }
}

function normalizePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new VpmError('vpmCacheWriteFailed')
  }
  return value
}

function normalizeSourceHost(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null
  const host = value.trim().toLowerCase()
  if (!host || host.length > 255 || host.includes('\0')) return null
  return host
}

/**
 * `vpm_cache_entry` 的唯一 SQL 入口。
 *
 * 行是缓存文件的索引，不是真相：文件丢了可以重建行；清理时只信任从
 * `VpmCacheStore` 派生的路径，不直接使用行里的 path 删除东西。
 */
export class CacheEntryStore {
  constructor(
    private readonly db: VpmDb,
    private readonly now: () => number = Date.now
  ) {}

  get(sha256: string): VpmCacheEntryRow | null {
    let sha: string
    try {
      sha = normalizeSha(sha256)
    } catch {
      return null
    }
    const row = this.db
      .prepare('SELECT * FROM vpm_cache_entry WHERE sha256 = ?')
      .get(sha) as CacheEntryDbRow | undefined
    return row ? mapRow(row) : null
  }

  list(): VpmCacheEntryRow[] {
    const rows = this.db
      .prepare('SELECT * FROM vpm_cache_entry ORDER BY last_used_at ASC, sha256 ASC')
      .all() as CacheEntryDbRow[]
    return rows.map(mapRow)
  }

  upsert(input: VpmCacheEntryInput): VpmCacheEntryRow {
    if (!input || typeof input !== 'object') throw new VpmError('vpmCacheWriteFailed')
    const sha = normalizeSha(input.sha256)
    if (typeof input.size !== 'number' || !Number.isSafeInteger(input.size) || input.size < 0) {
      throw new VpmError('vpmCacheWriteFailed')
    }
    const file = normalizePath(input.path)
    const sourceHost = normalizeSourceHost(input.sourceHost)
    const at = this.now()
    this.db
      .prepare(
        `INSERT INTO vpm_cache_entry (sha256, size, path, source_host, last_used_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sha256) DO UPDATE SET
           size = excluded.size,
           path = excluded.path,
           source_host = COALESCE(excluded.source_host, vpm_cache_entry.source_host),
           last_used_at = excluded.last_used_at`
      )
      .run(sha, input.size, file, sourceHost, at)
    const saved = this.get(sha)
    if (!saved) throw new VpmError('vpmCacheWriteFailed')
    return saved
  }

  /** 缓存命中：只刷新 last_used；行不存在时用已知 size/path 重建。 */
  touch(input: { sha256: string; size: number; path: string }): VpmCacheEntryRow {
    const sha = normalizeSha(input.sha256)
    if (typeof input.size !== 'number' || !Number.isSafeInteger(input.size) || input.size < 0) {
      throw new VpmError('vpmCacheWriteFailed')
    }
    const file = normalizePath(input.path)
    const at = this.now()
    const changed = this.db
      .prepare(
        'UPDATE vpm_cache_entry SET size = ?, path = ?, last_used_at = ? WHERE sha256 = ?'
      )
      .run(input.size, file, at, sha)
    if (changed.changes === 0) {
      return this.upsert({ sha256: sha, size: input.size, path: file, sourceHost: null })
    }
    const saved = this.get(sha)
    if (!saved) throw new VpmError('vpmCacheWriteFailed')
    return saved
  }

  remove(sha256: string): boolean {
    let sha: string
    try {
      sha = normalizeSha(sha256)
    } catch {
      return false
    }
    return this.db.prepare('DELETE FROM vpm_cache_entry WHERE sha256 = ?').run(sha).changes > 0
  }
}
