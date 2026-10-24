import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import {
  CacheEntryStore,
  PackageCacheService,
  VpmCacheStore
} from '../../../src/main/vpm/cache'
import { createVpmHttpClient } from '../../../src/main/vpm/http'
import { FakeTransport, reply } from '../http/fake-transport'

let root: string
let dataRoot: string
let db: VpmDb | null
let cache: VpmCacheStore
let entries: CacheEntryStore
let transport: FakeTransport
let http: ReturnType<typeof createVpmHttpClient>
let clock: number

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function makeService(options: {
  quotaBytes?: number
  availableBytes?: (directory: string) => number
} = {}): PackageCacheService {
  return new PackageCacheService({
    store: cache,
    entries,
    http,
    quotaBytes: options.quotaBytes,
    now: () => ++clock,
    availableBytes: options.availableBytes ?? (() => Number.MAX_SAFE_INTEGER),
    retryDelayMs: 0
  })
}

function rejectCode(promise: Promise<unknown>, code: string): Promise<void> {
  return expect(promise).rejects.toMatchObject({ code })
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-download-'))
  dataRoot = path.join(root, 'data')
  fs.mkdirSync(dataRoot)
  db = await openVpmDb({ file: path.join(root, 'vpm.db'), backupsDir: path.join(root, 'backups') })
  cache = new VpmCacheStore({ dataRoot })
  clock = 1_000
  entries = new CacheEntryStore(db, () => ++clock)
  transport = new FakeTransport()
  http = createVpmHttpClient({
    transport,
    isNetworkAllowed: () => true,
    userAgent: 'Atrium/test',
    limits: {
      maxDownloadBytes: 1024 * 1024,
      connectTimeoutMs: 2_000,
      idleTimeoutMs: 2_000,
      totalTimeoutMs: 10_000,
      maxJsonBytes: 1024,
      maxRedirects: 3
    }
  })
})

afterEach(() => {
  closeVpmDb(db)
  db = null
  fs.rmSync(root, { recursive: true, force: true })
})

describe('PackageCacheService', () => {
  it('downloads once, verifies the full hash, records the entry and reuses the cache', async () => {
    const data = Buffer.from('hello cached package')
    const sha = sha256(data)
    transport.handler = () =>
      reply(200, data, {
        'content-type': 'application/zip',
        'content-length': String(data.length)
      })
    const service = makeService()

    const first = await service.ensurePackage({
      url: 'https://cdn.example.test/pkg.zip',
      sha256: sha,
      size: data.length
    })
    expect(first).toMatchObject({
      sha256: sha,
      size: data.length,
      path: cache.pathForPackage(sha),
      reused: false
    })
    expect(fs.readFileSync(first.path)).toEqual(data)
    expect(entries.get(sha)).toMatchObject({
      sha256: sha,
      size: data.length,
      sourceHost: 'cdn.example.test'
    })
    expect(service.usage()).toEqual({
      bytes: data.length,
      files: 1,
      quotaBytes: 20 * 1024 * 1024 * 1024
    })

    const lastUsed = entries.get(sha)?.lastUsedAt
    const second = await service.ensurePackage({
      url: 'https://cdn.example.test/pkg.zip',
      sha256: sha,
      size: data.length
    })
    expect(second.reused).toBe(true)
    expect(second.path).toBe(first.path)
    expect(transport.calls).toHaveLength(1)
    expect(entries.get(sha)?.lastUsedAt).toBeGreaterThan(lastUsed as number)
  })

  it('quarantines a corrupt cache file, removes its row and downloads again', async () => {
    const data = Buffer.from('correct package bytes')
    const sha = sha256(data)
    transport.handler = () =>
      reply(200, data, { 'content-length': String(data.length) })
    const service = makeService()

    const first = await service.ensurePackage({
      url: 'https://cdn.example.test/pkg.zip',
      sha256: sha,
      size: data.length
    })
    const corrupt = Buffer.alloc(data.length, 0x58)
    fs.writeFileSync(first.path, corrupt)

    const second = await service.ensurePackage({
      url: 'https://cdn.example.test/pkg.zip',
      sha256: sha,
      size: data.length
    })
    expect(second.reused).toBe(false)
    expect(fs.readFileSync(second.path)).toEqual(data)
    expect(transport.calls).toHaveLength(2)
    const quarantined = fs.readdirSync(cache.corruptRoot)
    expect(quarantined).toHaveLength(1)
    expect(fs.readFileSync(path.join(cache.corruptRoot, quarantined[0]))).toEqual(corrupt)
    expect(entries.get(sha)?.size).toBe(data.length)
  })

  it('rejects a wrong download hash without retrying, preserves the bad bytes and leaves no cache entry', async () => {
    const expected = Buffer.from('expected')
    const wrong = Buffer.from('wrong!!')
    transport.handler = () => reply(200, wrong)
    const service = makeService()

    await rejectCode(
      service.ensurePackage({
        url: 'https://cdn.example.test/pkg.zip',
        sha256: sha256(expected),
        size: expected.length
      }),
      'vpmCacheHashMismatch'
    )
    expect(transport.calls).toHaveLength(1)
    expect(cache.listPackages()).toHaveLength(0)
    expect(entries.list()).toHaveLength(0)
    expect(fs.readdirSync(cache.corruptRoot)).toHaveLength(1)
    expect(fs.readdirSync(cache.tmpRoot)).toHaveLength(0)
  })

  it('rejects a size mismatch and requires a SHA-256 before touching the network', async () => {
    const data = Buffer.from('size mismatch')
    transport.handler = () => reply(200, data)
    const service = makeService()

    await rejectCode(
      service.ensurePackage({
        url: 'https://cdn.example.test/pkg.zip',
        sha256: sha256(data),
        size: data.length + 1
      }),
      'vpmCacheHashMismatch'
    )
    expect(transport.calls).toHaveLength(1)
    expect(cache.listPackages()).toHaveLength(0)

    const before = transport.calls.length
    await rejectCode(
      service.ensurePackage({ url: 'https://cdn.example.test/nohash.zip', sha256: '' }),
      'vpmCacheHashMissing'
    )
    await rejectCode(
      service.ensurePackage({ url: 'https://cdn.example.test/nohash.zip', sha256: 'abc' }),
      'vpmCacheHashMissing'
    )
    expect(transport.calls).toHaveLength(before)
  })

  it('retries only network/timeout/5xx up to two times and never retries 4xx', async () => {
    const data = Buffer.from('retry me')
    const sha = sha256(data)
    let calls = 0
    transport.handler = () => {
      calls++
      return calls <= 2 ? reply(503, 'busy') : reply(200, data)
    }
    const service = makeService()
    const result = await service.ensurePackage({
      url: 'https://cdn.example.test/retry.zip',
      sha256: sha,
      size: data.length
    })
    expect(result.reused).toBe(false)
    expect(calls).toBe(3)

    transport.handler = () => reply(404, 'missing')
    const before = transport.calls.length
    await rejectCode(
      service.ensurePackage({
        url: 'https://cdn.example.test/404.zip',
        sha256: sha256('missing'),
        size: 7
      }),
      'vpmHttpStatus'
    )
    expect(transport.calls.length - before).toBe(1)

    let networkCalls = 0
    transport.handler = () => {
      networkCalls++
      throw new Error('offline')
    }
    await rejectCode(
      service.ensurePackage({
        url: 'https://cdn.example.test/offline.zip',
        sha256: sha256('offline'),
        size: 7
      }),
      'vpmHttpNetwork'
    )
    expect(networkCalls).toBe(3)
  })

  it('supports abort and cleans the partial temp file', async () => {
    const body = new PassThrough()
    transport.handler = () => ({ status: 200, headers: {}, body })
    const service = makeService()
    const controller = new AbortController()
    const sha = sha256('aborted package')

    const promise = service.ensurePackage({
      url: 'https://cdn.example.test/abort.zip',
      sha256: sha,
      size: 16,
      signal: controller.signal
    })
    await new Promise((resolve) => setTimeout(resolve, 15))
    controller.abort()

    await rejectCode(promise, 'vpmHttpAborted')
    expect(fs.existsSync(cache.pathForPackage(sha))).toBe(false)
    expect(fs.readdirSync(cache.tmpRoot)).toHaveLength(0)
    body.destroy()
  })

  it('evicts the least recently used package when quota is exceeded and protects the current one', async () => {
    const a = Buffer.alloc(60, 0x41)
    const b = Buffer.alloc(60, 0x42)
    const shaA = sha256(a)
    const shaB = sha256(b)
    transport.handler = (input) => reply(200, input.url.endsWith('a.zip') ? a : b)
    const service = makeService({ quotaBytes: 100 })

    await service.ensurePackage({ url: 'https://example.test/a.zip', sha256: shaA, size: a.length })
    expect(fs.existsSync(cache.pathForPackage(shaA))).toBe(true)
    await service.ensurePackage({ url: 'https://example.test/b.zip', sha256: shaB, size: b.length })

    expect(fs.existsSync(cache.pathForPackage(shaA))).toBe(false)
    expect(fs.existsSync(cache.pathForPackage(shaB))).toBe(true)
    expect(entries.get(shaA)).toBeNull()
    expect(entries.get(shaB)).not.toBeNull()
    expect(service.usage()).toMatchObject({ bytes: 60, files: 1, quotaBytes: 100 })
  })

  it('rejects packages larger than the quota before downloading', async () => {
    const data = Buffer.alloc(200, 0x43)
    const service = makeService({ quotaBytes: 100 })
    await rejectCode(
      service.ensurePackage({
        url: 'https://example.test/too-big.zip',
        sha256: sha256(data),
        size: data.length
      }),
      'vpmCacheQuotaExceeded'
    )
    expect(transport.calls).toHaveLength(0)
    expect(cache.listPackages()).toHaveLength(0)
  })

  it('rejects unknown-size downloads that cannot fit even after eviction', async () => {
    const data = Buffer.alloc(200, 0x44)
    const sha = sha256(data)
    transport.handler = () => reply(200, data)
    const service = makeService({ quotaBytes: 100 })
    await rejectCode(
      service.ensurePackage({
        url: 'https://example.test/unknown.zip',
        sha256: sha,
        size: null
      }),
      'vpmCacheQuotaExceeded'
    )
    expect(transport.calls).toHaveLength(1)
    expect(fs.existsSync(cache.pathForPackage(sha))).toBe(false)
    expect(entries.get(sha)).toBeNull()
  })

  it('fails before download when the cache volume has no free space', async () => {
    const service = makeService({ availableBytes: () => 0 })
    await rejectCode(
      service.ensurePackage({
        url: 'https://example.test/nospace.zip',
        sha256: sha256('x'),
        size: 1
      }),
      'vpmCacheNoSpace'
    )
    expect(transport.calls).toHaveLength(0)
  })

  it('shares one in-flight download for the same hash and reports throttled progress', async () => {
    const data = Buffer.from('shared package')
    const sha = sha256(data)
    transport.handler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return reply(200, data, { 'content-length': String(data.length) })
    }
    const service = makeService()
    const progress: Array<{ downloaded: number; total: number | null; attempt: number }> = []
    const [one, two] = await Promise.all([
      service.ensurePackage({
        url: 'https://example.test/shared.zip',
        sha256: sha,
        size: data.length,
        onProgress: (item) => progress.push(item)
      }),
      service.ensurePackage({
        url: 'https://example.test/shared.zip',
        sha256: sha,
        size: data.length
      })
    ])
    expect(transport.calls).toHaveLength(1)
    expect(one.path).toBe(two.path)
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.at(-1)).toMatchObject({
      downloaded: data.length,
      total: data.length,
      attempt: 1
    })
  })

  it('rebuilds a cache entry row on hit and redownloads when the file disappeared', async () => {
    const data = Buffer.from('row rebuild')
    const sha = sha256(data)
    transport.handler = () => reply(200, data)
    const service = makeService()

    const first = await service.ensurePackage({
      url: 'https://example.test/row.zip',
      sha256: sha,
      size: data.length
    })
    db?.prepare('DELETE FROM vpm_cache_entry').run()
    expect(entries.get(sha)).toBeNull()

    const hit = await service.ensurePackage({
      url: 'https://example.test/row.zip',
      sha256: sha,
      size: data.length
    })
    expect(hit.reused).toBe(true)
    expect(entries.get(sha)).not.toBeNull()
    expect(transport.calls).toHaveLength(1)

    fs.rmSync(first.path)
    const again = await service.ensurePackage({
      url: 'https://example.test/row.zip',
      sha256: sha,
      size: data.length
    })
    expect(again.reused).toBe(false)
    expect(transport.calls).toHaveLength(2)
    expect(entries.get(sha)).not.toBeNull()
  })
})
