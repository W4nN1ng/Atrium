import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fileIdentity } from './identity'
import type { ContentKey } from '../../shared/intake'

export const EXPAND_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const EXPAND_CACHE_MAX_BYTES = 8 * 1024 ** 3
export interface CacheMember { originalPath: string; key: ContentKey; file: string; sha256?: string }
interface Manifest { version: 1; key: string; members: CacheMember[]; touched: number }
export interface CachedExpansion { key: string; members: (CacheMember & { localPath: string })[] }
interface CacheOptions { root?: string; namespace?: string; maxBytes?: number; ttlMs?: number; freeBytes?: () => number; now?: () => number }
const keyPattern = /^[a-f0-9]{64}$/
const memberPattern = /^\d{8}\.bin$/
function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}

/** Separate from staging. Only this marker-owned subtree of OS temp may be mutated. */
export class ExpandCache {
  readonly root: string
  private readonly maxBytes: number
  private readonly ttl: number
  private readonly now: () => number
  private readonly freeBytes: () => number
  constructor(opts: CacheOptions = {}) {
    const defaultDb = path.join(process.env.AVCA_APP_HOME || path.join(process.env.APPDATA || os.homedir(), 'A'), 'library.db')
    const namespace = path.resolve(opts.namespace ?? defaultDb)
    const namespaceKey = digest(process.platform === 'win32' ? namespace.toLowerCase() : namespace)
    this.root = path.resolve(opts.root ?? path.join(os.tmpdir(), 'atrium-intake-cache-v1', namespaceKey))
    const temp = fs.realpathSync(os.tmpdir())
    const rel = path.relative(temp, this.root)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Cache must be a dedicated OS temp subtree')
    // Check existing ancestors before mkdir as well as before each later mutation.
    let cur = temp
    for (const piece of rel.split(path.sep)) {
      cur = path.join(cur, piece)
      if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) throw new Error('Cache reparse point')
    }
    fs.mkdirSync(this.root, { recursive: true })
    const marker = path.join(this.root, '.atrium-cache')
    if (!fs.existsSync(marker)) {
      if (fs.readdirSync(this.root).length && !fs.existsSync(marker)) throw new Error('Cache directory is not owned by Atrium')
      try { fs.writeFileSync(marker, 'atrium-expand-cache-v1', { flag: 'wx' }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    if (fs.readFileSync(marker, 'utf8') !== 'atrium-expand-cache-v1') throw new Error('Invalid cache marker')
    this.maxBytes = opts.maxBytes ?? EXPAND_CACHE_MAX_BYTES; this.ttl = opts.ttlMs ?? EXPAND_CACHE_TTL_MS
    this.now = opts.now ?? Date.now
    this.freeBytes = opts.freeBytes ?? (() => { const info = fs.statfsSync(this.root); return info.bavail * info.bsize })
    for (const dir of ['objects', 'refs', 'staging']) fs.mkdirSync(this.checked(dir), { recursive: true })
  }
  private checked(relative: string): string {
    const full = path.resolve(this.root, relative), rel = path.relative(this.root, full)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Unsafe cache target')
    let cur = this.root
    if (fs.lstatSync(cur).isSymbolicLink()) throw new Error('Cache reparse point')
    for (const part of rel.split(path.sep)) {
      cur = path.join(cur, part)
      if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) throw new Error('Cache reparse point')
    }
    return full
  }
  private remove(relative: string): void { fs.rmSync(this.checked(relative), { recursive: true, force: true }) }
  private atomic(relative: string, value: unknown): void {
    const tmp = `${relative}.${randomUUID()}.tmp`
    fs.writeFileSync(this.checked(tmp), JSON.stringify(value), { flag: 'wx' })
    fs.renameSync(this.checked(tmp), this.checked(relative))
  }
  private async locked<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const lock = this.checked('.lock'), started = Date.now()
    for (;;) {
      signal?.throwIfAborted()
      try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' }); break }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        try {
          const owner = JSON.parse(fs.readFileSync(lock, 'utf8')) as { pid: number }
          if (Number.isInteger(owner.pid) && owner.pid > 0 && !alive(owner.pid)) { this.remove('.lock'); continue }
        } catch { /* In-progress/invalid lock: fail closed, never steal a live writer's lock. */ }
        if (Date.now() - started > 30_000) throw new Error('cache-lock-timeout')
        await delay(25, undefined, { signal })
      }
    }
    try { return await work() } finally { this.remove('.lock') }
  }
  private retainLocked(ownerId: string, key: string): void {
    if (!keyPattern.test(key) || !ownerId) throw new Error('Invalid cache reference')
    const relative = `refs/${digest(ownerId)}.json`, file = this.checked(relative)
    const prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as { keys: string[] } : { keys: [] }
    this.atomic(relative, { ownerId, pid: process.pid, updatedAt: this.now(), keys: [...new Set([...prior.keys, key])].sort() })
  }
  async retain(ownerId: string, keys: string[]): Promise<void> {
    await this.locked(async () => { for (const key of keys) this.retainLocked(ownerId, key) })
  }
  async release(ownerId: string): Promise<void> { await this.locked(async () => this.remove(`refs/${digest(ownerId)}.json`)) }
  private manifest(key: string): Manifest | null {
    if (!keyPattern.test(key)) throw new Error('Invalid container cache key')
    const file = this.checked(`objects/${key}/entry.json`)
    if (!fs.existsSync(file)) return null
    const m = JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest
    if (m.version !== 1 || m.key !== key || !Array.isArray(m.members) || !Number.isFinite(m.touched)) throw new Error('Invalid cache manifest')
    const files = new Set<string>()
    for (const member of m.members) {
      if (!memberPattern.test(member.file) || files.has(member.file) || typeof member.originalPath !== 'string' ||
        !Number.isSafeInteger(member.key.size) || member.key.size < 0 || !Number.isInteger(member.key.crc32) ||
        member.key.crc32 < 0 || member.key.crc32 > 0xffffffff || !keyPattern.test(member.sha256 ?? '')) throw new Error('Invalid cached member')
      files.add(member.file)
    }
    return m
  }
  private async locateLocked(key: string, signal?: AbortSignal): Promise<CachedExpansion | null> {
    const m = this.manifest(key)
    if (!m) return null
    const members = []
    for (const member of m.members) {
      const localPath = this.checked(`objects/${key}/${member.file}`)
      const actual = await fileIdentity(localPath, signal)
      if (actual.sha256 !== member.sha256 || actual.key.size !== member.key.size || actual.key.crc32 !== member.key.crc32) throw new Error('cache-integrity-failed')
      members.push({ ...member, localPath })
    }
    this.atomic(`objects/${key}/entry.json`, { ...m, touched: this.now() })
    return { key, members }
  }
  async locate(key: string, ownerId: string, signal?: AbortSignal): Promise<CachedExpansion | null> {
    return this.locked(async () => { this.retainLocked(ownerId, key); return this.locateLocked(key, signal) }, signal)
  }
  private protectedKeys(activeKeys: readonly string[]): Set<string> {
    const keys = new Set(activeKeys)
    for (const name of fs.readdirSync(this.checked('refs'))) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error('Unknown cache reference file')
      const ref = JSON.parse(fs.readFileSync(this.checked(`refs/${name}`), 'utf8')) as { keys: string[]; updatedAt: number; pid: number }
      if (!Array.isArray(ref.keys) || ref.keys.some(k => !keyPattern.test(k)) || !Number.isFinite(ref.updatedAt) || !Number.isInteger(ref.pid) || ref.pid <= 0) throw new Error('Invalid cache references; cleanup stopped')
      if (alive(ref.pid) || this.now() - ref.updatedAt < this.ttl || ref.keys.some(k => keys.has(k))) {
        for (const key of ref.keys) keys.add(key)
      } else this.remove(`refs/${name}`)
    }
    return keys
  }
  private pruneLocked(activeKeys: readonly string[], required: number): number {
    const protectedKeys = this.protectedKeys(activeKeys)
    const objects = fs.readdirSync(this.checked('objects')).map(key => {
      const m = this.manifest(key)
      if (!m) throw new Error('Incomplete cache object; cleanup stopped')
      return { key, touched: m.touched, size: m.members.reduce((n, e) => n + e.key.size, 0) }
    }).sort((a, b) => a.touched - b.touched || a.key.localeCompare(b.key))
    let used = objects.reduce((n, o) => n + o.size, 0)
    for (const object of objects) {
      if (!protectedKeys.has(object.key) && (this.now() - object.touched >= this.ttl || used + required > this.maxBytes)) {
        this.remove(`objects/${object.key}`); used -= object.size
      }
    }
    // A previous terminated writer may leave an unpublished temporary directory. No writer runs while this lock is held.
    for (const name of fs.readdirSync(this.checked('staging'))) this.remove(`staging/${name}`)
    return used
  }
  async prune(activeKeys: readonly string[] = []): Promise<void> { await this.locked(async () => { this.pruneLocked(activeKeys, 0) }) }
  async materialize(key: string, ownerId: string, members: CacheMember[],
    produce: (dest: string) => Promise<void>, signal?: AbortSignal): Promise<CachedExpansion> {
    return this.locked(async () => {
      this.retainLocked(ownerId, key) // Durable reference precedes every byte of extraction.
      const existing = await this.locateLocked(key, signal)
      if (existing) {
        if (JSON.stringify(existing.members.map(m => [m.originalPath, m.key, m.file])) !== JSON.stringify(members.map(m => [m.originalPath, m.key, m.file]))) throw new Error('cache-listing-conflict')
        return existing
      }
      const bytes = members.reduce((n, e) => n + e.key.size, 0)
      const used = this.pruneLocked([], bytes)
      if (!Number.isSafeInteger(bytes) || bytes < 0 || used + bytes > this.maxBytes || this.freeBytes() < Math.ceil(bytes * 1.2) + members.length * 8192 + 1024 * 1024) throw new Error('cache-insufficient-space')
      const stage = `staging/${randomUUID()}`; fs.mkdirSync(this.checked(stage))
      try {
        // Producer receives only a marker-owned, exclusive directory; members use numeric filenames.
        await produce(this.checked(stage)); signal?.throwIfAborted()
        const verified: CacheMember[] = []
        for (const member of members) {
          if (!memberPattern.test(member.file)) throw new Error('Unsafe cache member filename')
          const actual = await fileIdentity(this.checked(`${stage}/${member.file}`), signal)
          if (actual.key.size !== member.key.size || actual.key.crc32 !== member.key.crc32) throw new Error('member-integrity-failed')
          verified.push({ ...member, sha256: actual.sha256 })
        }
        if (fs.readdirSync(this.checked(stage)).length !== members.length) throw new Error('Unexpected extracted cache members')
        this.atomic(`${stage}/entry.json`, { version: 1, key, touched: this.now(), members: verified })
        fs.renameSync(this.checked(stage), this.checked(`objects/${key}`))
        return { key, members: verified.map(m => ({ ...m, localPath: this.checked(`objects/${key}/${m.file}`) })) }
      } finally { this.remove(stage) }
    }, signal)
  }
}
