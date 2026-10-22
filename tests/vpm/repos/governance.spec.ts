import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { RepoStore } from '../../../src/main/vpm/repos'
import { ReposService, parseRepoImport } from '../../../src/main/vpm/reposService'

let root: string
let db: VpmDb
let store: RepoStore
let service: ReposService

function codeOf(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: { code?: string }) => error.code ?? 'unknown'
  )
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-repos-'))
  db = await openVpmDb({ file: path.join(root, 'vpm.db'), backupsDir: path.join(root, 'backups') })
  store = new RepoStore(db)
  service = new ReposService({
    store,
    // 不联网：治理逻辑不需要真的抓取
    http: {} as never,
    hasConsent: () => false,
    now: () => 1_700_000_000_000
  })
})

afterEach(() => {
  closeVpmDb(db)
  fs.rmSync(root, { recursive: true, force: true })
})

describe('repo governance', () => {
  it('edits name and enabled state without touching the url', async () => {
    const repo = await service.addRepo({ url: 'https://example.test/repo.json' })
    const renamed = await service.updateRepo(repo.id, { name: 'My Repo' })
    expect(renamed.name).toBe('My Repo')
    expect(renamed.url).toBe(repo.url)

    const disabled = await service.updateRepo(repo.id, { enabled: false })
    expect(disabled.enabled).toBe(false)
  })

  it('clears fetch state on url change but keeps the old package rows', async () => {
    const repo = await service.addRepo({ url: 'https://example.test/repo.json' })
    store.replaceRepoPackages(repo.id, [
      {
        name: 'com.example.a',
        version: '1.0.0',
        displayName: null,
        description: null,
        authorJson: null,
        keywordsJson: null,
        aliasesJson: null,
        unityMin: null,
        zipUrl: null,
        zipSha256: null,
        zipSize: null,
        yanked: false,
        yankedReason: null,
        hidden: false,
        deprecated: false,
        manifestJson: JSON.stringify({ name: 'com.example.a', version: '1.0.0' }),
        fetchedAt: 1
      }
    ])
    store.updateRepoFetchState(repo.id, {
      lastFetchAt: 1,
      lastSuccessAt: 1,
      lastErrorCode: null,
      etag: 'abc',
      lastModified: null
    })

    const updated = await service.updateRepo(repo.id, { url: 'https://example.test/other.json' })
    expect(updated.url).toBe('https://example.test/other.json')
    expect(updated.lastSuccessAt).toBeNull()
    // 旧包还在（抓取成功才会被替换）
    expect(service.listRepos().find((item) => item.id === repo.id)?.packageCount).toBe(1)
  })

  it('refuses a url that another repo already uses', async () => {
    await service.addRepo({ url: 'https://example.test/a.json' })
    const b = await service.addRepo({ url: 'https://example.test/b.json' })
    expect(
      await codeOf(service.updateRepo(b.id, { url: 'https://example.test/a.json' }))
    ).toBe('vpmRepoConflict')
  })

  it('reorders repos and appends the ones not listed', async () => {
    const a = await service.addRepo({ url: 'https://example.test/a.json' })
    const b = await service.addRepo({ url: 'https://example.test/b.json' })
    const c = await service.addRepo({ url: 'https://example.test/c.json' })

    const ordered = service.reorderRepos([c.id, a.id, 'missing-id'])
    expect(ordered.map((repo) => repo.id)).toEqual([c.id, a.id, b.id])
    // 落库了：再读一次还是这个顺序
    expect(service.listRepos().map((repo) => repo.id)).toEqual([c.id, a.id, b.id])
  })

  it('exports and re-imports without duplicating', async () => {
    await service.addRepo({ url: 'https://example.test/a.json', name: 'A' })
    const exported = service.exportRepos()
    const parsed = JSON.parse(exported) as { format: string; repos: Array<{ url: string }> }
    expect(parsed.format).toBe('atrium.repos')
    expect(parsed.repos).toHaveLength(1)

    const again = await service.importRepos(exported)
    expect(again.added).toEqual([])
    expect(again.skipped).toEqual([{ url: 'https://example.test/a.json', reason: 'duplicate' }])
  })

  it('imports a plain url list, skipping bad lines', async () => {
    const result = await service.importRepos(
      ['# comment', 'https://example.test/a.json', '', 'not-a-url', 'https://example.test/a.json'].join(
        '\n'
      )
    )
    expect(result.added).toHaveLength(1)
    expect(result.skipped).toEqual([
      { url: 'not-a-url', reason: 'invalid' },
      { url: 'https://example.test/a.json', reason: 'duplicate' }
    ])
  })

  it('parses both import formats', () => {
    expect(parseRepoImport('https://a.test/x.json\n# c\nhttps://b.test/y.json')).toEqual([
      { url: 'https://a.test/x.json' },
      { url: 'https://b.test/y.json' }
    ])
    expect(
      parseRepoImport(JSON.stringify({ repos: [{ url: 'https://a.test/x.json', name: ' A ' }] }))
    ).toEqual([{ url: 'https://a.test/x.json', name: 'A' }])
    expect(parseRepoImport('')).toEqual([])
    expect(parseRepoImport('{ broken')).toEqual([])
  })
})
