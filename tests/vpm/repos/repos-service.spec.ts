import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { RepoStore } from '../../../src/main/vpm/repos'
import type { PackageVersionInput } from '../../../src/main/vpm/repos'
import { ReposService, normalizeRepoUrl } from '../../../src/main/vpm/reposService'
import { createVpmHttpClient } from '../../../src/main/vpm/http'
import { VpmError } from '../../../src/shared/vpm/errors'
import { setAppPathsForTest } from '../../../src/main/services/paths'
import { FakeTransport, reply } from '../http/fake-transport'

let root: string
let db: VpmDb
let store: RepoStore
let transport: FakeTransport
let service: ReposService
let nowMs = 1_000
let consent = true

function repoBody(name: string, versions: Array<{ pkg?: string; version: string; hash?: string }> = []): string {
  const packages: Record<string, { versions: Record<string, unknown> }> = {}
  for (const item of versions.length ? versions : [{ version: '1.0.0' }]) {
    const pkg = item.pkg ?? 'com.example.foo'
    packages[pkg] ??= { versions: {} }
    packages[pkg].versions[item.version] = {
      displayName: `${pkg} ${item.version}`,
      description: 'test package',
      unity: '2022.3',
      url: `https://example.test/${pkg}-${item.version}.zip`,
      zipSHA256: item.hash ?? 'a'.repeat(64)
    }
  }
  return JSON.stringify({ name, packages })
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

function pkg(version = '1.0.0'): PackageVersionInput {
  return {
    name: 'com.example.old',
    version,
    displayName: 'old',
    description: null,
    authorJson: null,
    keywordsJson: null,
    aliasesJson: null,
    unityMin: null,
    zipUrl: 'https://example.test/old.zip',
    zipSha256: 'b'.repeat(64),
    zipSize: 1,
    yanked: false,
    yankedReason: null,
    hidden: false,
    deprecated: false,
    manifestJson: '{}',
    fetchedAt: 1_000
  }
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-repos-service-'))
  setAppPathsForTest(root)
  db = await openVpmDb()
  nowMs = 1_000
  consent = true
  store = new RepoStore(db, () => nowMs)
  transport = new FakeTransport()
  const http = createVpmHttpClient({
    transport,
    isNetworkAllowed: () => consent,
    userAgent: 'Atrium/test'
  })
  service = new ReposService({
    store,
    http,
    hasConsent: () => consent,
    now: () => nowMs,
    concurrency: 2
  })
})

afterEach(() => {
  service.dispose()
  closeVpmDb(db)
  fs.rmSync(root, { recursive: true, force: true })
})

describe('ReposService', () => {
  it('seeds official/curated only when consented and the table is empty', async () => {
    consent = false
    await service.seedIfEmpty()
    expect(service.listRepos()).toHaveLength(0)

    consent = true
    await service.seedIfEmpty()
    expect(service.listRepos()).toMatchObject([
      { id: 'vrchat-official', name: 'Official', sortOrder: 0, url: expect.stringContaining('official') },
      { id: 'vrchat-curated', name: 'Curated', sortOrder: 1, url: expect.stringContaining('curated') }
    ])
    expect(transport.calls).toHaveLength(0)

    await service.seedIfEmpty()
    expect(service.listRepos()).toHaveLength(2)
  })

  it('normalizes URLs, dedupes them, and does not refresh without consent', async () => {
    consent = false
    expect(normalizeRepoUrl('https://EXAMPLE.test/repo.json/#frag')).toBe(
      'https://example.test/repo.json'
    )
    const first = await service.addRepo({ url: 'https://EXAMPLE.test/repo.json/#frag' })
    expect(first).toMatchObject({ name: 'example.test', sortOrder: 0, packageCount: 0 })
    expect(transport.calls).toHaveLength(0)

    await expect(
      service.addRepo({ url: 'https://example.test/repo.json/', name: 'Duplicate' })
    ).rejects.toMatchObject({ code: 'vpmRepoConflict' })
    const second = await service.addRepo({ url: 'https://second.test/repo.json', name: 'Second' })
    expect(second.sortOrder).toBe(1)
  })

  it('refreshes after add when consented, updates packages and accepts a JSON name', async () => {
    transport.handler = () =>
      reply(200, repoBody('Upstream Name', [{ version: '1.0.0' }, { version: '2.0.0' }]), {
        etag: '"v1"',
        'last-modified': 'Wed, 21 Oct 2026 06:00:00 GMT'
      })
    const repo = await service.addRepo({ url: 'https://example.test/repo.json', name: 'Mine' })
    expect(transport.calls).toHaveLength(1)
    expect(repo).toMatchObject({
      name: 'Upstream Name',
      packageCount: 2,
      lastErrorCode: null
    })
    expect(store.queryCatalog({ name: 'com.example.foo', includeHidden: true })).toMatchObject({
      total: 2
    })
  })

  it('keeps packages on 304 and updates fetch metadata', async () => {
    store.upsertRepo({ id: 'r', url: 'https://example.test/repo.json', name: 'Repo' })
    store.replaceRepoPackages('r', [pkg()])
    transport.handler = () => reply(304, undefined, { etag: '"v2"' })
    const result = await service.refreshRepo('r')
    expect(result).toMatchObject({ status: 'not-modified', packageCount: 1, errorCode: null })
    expect(store.queryCatalog({ name: 'com.example.old', includeHidden: true }).total).toBe(1)
    expect(store.getRepo('r')).toMatchObject({ etag: '"v2"', lastSuccessAt: 1_000 })
  })

  it('preserves old packages when parsing or network fails', async () => {
    store.upsertRepo({ id: 'r', url: 'https://example.test/repo.json', name: 'Repo' })
    store.replaceRepoPackages('r', [pkg()])

    transport.handler = () => reply(200, 'not json')
    let result = await service.refreshRepo('r')
    expect(result).toMatchObject({ status: 'error', errorCode: 'vpmHttpInvalidJson', packageCount: 1 })
    expect(store.queryCatalog({ name: 'com.example.old', includeHidden: true }).total).toBe(1)

    transport.handler = () => reply(200, JSON.stringify({ packages: [] }))
    result = await service.refreshRepo('r')
    expect(result).toMatchObject({ status: 'error', errorCode: 'vpmRepoInvalid' })
    expect(store.queryCatalog({ name: 'com.example.old', includeHidden: true }).total).toBe(1)

    transport.handler = () => Promise.reject(new VpmError('vpmHttpTimeout'))
    result = await service.refreshRepo('r')
    expect(result).toMatchObject({ status: 'error', errorCode: 'vpmHttpTimeout' })
    expect(store.queryCatalog({ name: 'com.example.old', includeHidden: true }).total).toBe(1)
  })

  it('does not call the transport when consent is absent, but records the error', async () => {
    store.upsertRepo({ id: 'r', url: 'https://example.test/repo.json', name: 'Repo' })
    consent = false
    const result = await service.refreshRepo('r')
    expect(result).toMatchObject({ status: 'error', errorCode: 'vpmNetworkNotConsented' })
    expect(transport.calls).toHaveLength(0)
    expect(store.getRepo('r')?.lastErrorCode).toBe('vpmNetworkNotConsented')
  })

  it('sends conditional headers from the stored repo', async () => {
    store.upsertRepo({ id: 'r', url: 'https://example.test/repo.json', name: 'Repo' })
    store.updateRepoFetchState('r', {
      etag: '"old"',
      lastModified: 'Tue, 20 Oct 2026 06:00:00 GMT',
      lastFetchAt: 1,
      lastSuccessAt: 1,
      lastErrorCode: null
    })
    transport.handler = () => reply(304, undefined, {})
    await service.refreshRepo('r')
    expect(transport.calls[0].headers['If-None-Match']).toBe('"old"')
    expect(transport.calls[0].headers['If-Modified-Since']).toBe('Tue, 20 Oct 2026 06:00:00 GMT')
  })

  it('refreshes only enabled repos independently and caps concurrency at 2', async () => {
    store.upsertRepo({ id: 'a', url: 'https://a.test/repo.json', name: 'A', sortOrder: 0 })
    store.upsertRepo({ id: 'b', url: 'https://b.test/repo.json', name: 'B', sortOrder: 1 })
    store.upsertRepo({
      id: 'c',
      url: 'https://c.test/repo.json',
      name: 'C',
      sortOrder: 2,
      enabled: false
    })
    let active = 0
    let maxActive = 0
    transport.handler = async (input) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active--
      return reply(200, repoBody(input.url.includes('a.test') ? 'A new' : 'B new'))
    }

    const results = await service.refreshAll()
    expect(results).toHaveLength(2)
    expect(results.every((result) => result.status === 'updated')).toBe(true)
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(transport.calls).toHaveLength(2)
    expect(service.listRepos().find((repo) => repo.id === 'c')?.lastFetchAt).toBeNull()
  })

  it('keeps one bad repository from affecting the others in refreshAll', async () => {
    store.upsertRepo({ id: 'bad', url: 'https://bad.test/repo.json', name: 'Bad', sortOrder: 0 })
    store.upsertRepo({ id: 'good', url: 'https://good.test/repo.json', name: 'Good', sortOrder: 1 })
    transport.handler = (input) => {
      if (input.url.includes('bad.test')) return Promise.reject(new VpmError('vpmHttpNetwork'))
      return reply(200, repoBody('Good new'))
    }

    const results = await service.refreshAll()
    expect(results.map((result) => result.status)).toEqual(['error', 'updated'])
    expect(results[0].errorCode).toBe('vpmHttpNetwork')
    expect(store.queryCatalog({ repoIds: ['good'], includeHidden: true }).total).toBe(1)
    expect(store.queryCatalog({ repoIds: ['bad'], includeHidden: true }).total).toBe(0)
  })

  it('removes only the repository/index and reports missing repositories', async () => {
    store.upsertRepo({ id: 'r', url: 'https://example.test/repo.json', name: 'Repo' })
    store.replaceRepoPackages('r', [pkg()])
    service.removeRepo('r')
    expect(service.listRepos()).toHaveLength(0)
    expect(store.queryCatalog({ enabledOnly: false, includeHidden: true, includeYanked: true }).total).toBe(0)
    expect(codeOf(() => service.removeRepo('r'))).toBe('vpmRepoNotFound')
  })
})
