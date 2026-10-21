import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { RepoStore } from '../../../src/main/vpm/repos'
import type { PackageVersionInput, RepoInput } from '../../../src/main/vpm/repos'
import { setAppPathsForTest } from '../../../src/main/services/paths'

let root: string
let db: VpmDb
let store: RepoStore
let nowMs = 1_000

function repo(overrides: Partial<RepoInput> = {}): RepoInput {
  return {
    id: 'repo-a',
    url: 'https://example.test/a.json',
    name: 'Repo A',
    sortOrder: 0,
    ...overrides
  }
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

function pkg(overrides: Partial<PackageVersionInput> = {}): PackageVersionInput {
  return {
    name: 'com.example.foo',
    version: '1.0.0',
    displayName: 'Foo',
    description: 'A test package',
    authorJson: '{"name":"Example"}',
    keywordsJson: '["avatar"]',
    aliasesJson: '["foo-alias"]',
    unityMin: '2022.3',
    zipUrl: 'https://example.test/foo-1.0.0.zip',
    zipSha256: 'a'.repeat(64),
    zipSize: 1234,
    yanked: false,
    yankedReason: null,
    hidden: false,
    deprecated: false,
    manifestJson: '{"dependencies":{}}',
    fetchedAt: 1_000,
    ...overrides
  }
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-repos-'))
  setAppPathsForTest(root)
  nowMs = 1_000
  db = await openVpmDb()
  store = new RepoStore(db, () => nowMs)
})

afterEach(() => {
  closeVpmDb(db)
  fs.rmSync(root, { recursive: true, force: true })
})

describe('RepoStore', () => {
  it('inserts, updates and reads repositories, preserving createdAt on update', () => {
    const created = store.upsertRepo(repo({ sortOrder: 2 }))
    expect(created).toMatchObject({
      id: 'repo-a',
      name: 'Repo A',
      enabled: true,
      packageCount: 0,
      createdAt: 1_000,
      updatedAt: 1_000
    })

    nowMs = 2_000
    const updated = store.upsertRepo(repo({ name: 'Repo A2', sortOrder: 1 }))
    expect(updated.name).toBe('Repo A2')
    expect(updated.sortOrder).toBe(1)
    expect(updated.createdAt).toBe(1_000)
    expect(updated.updatedAt).toBe(2_000)

    expect(store.getRepo('repo-a')?.name).toBe('Repo A2')
    expect(store.getRepoByUrl('https://example.test/a.json')?.id).toBe('repo-a')
    expect(store.getRepo('missing')).toBeNull()
  })

  it('orders repositories by sortOrder then name', () => {
    store.upsertRepo(repo({ id: 'b', name: 'B', url: 'https://example.test/b.json', sortOrder: 1 }))
    store.upsertRepo(repo({ id: 'a', name: 'A', url: 'https://example.test/a.json', sortOrder: 2 }))
    store.upsertRepo(repo({ id: 'c', name: 'C', url: 'https://example.test/c.json', sortOrder: 1 }))

    expect(store.listRepos().map((row) => row.id)).toEqual(['b', 'c', 'a'])
  })

  it('rejects invalid input and duplicate URLs with explicit codes', () => {
    expect(codeOf(() => store.upsertRepo(repo({ name: '   ' })))).toBe('vpmRepoInvalid')
    store.upsertRepo(repo())
    expect(
      codeOf(() =>
        store.upsertRepo(repo({ id: 'repo-b', name: 'B', url: 'https://example.test/a.json' }))
      )
    ).toBe('vpmRepoConflict')
  })

  it('updates fetch state and reports a missing repository', () => {
    store.upsertRepo(repo())
    store.updateRepoFetchState('repo-a', {
      etag: 'W/"abc"',
      lastModified: 'Wed, 21 Oct 2026 06:00:00 GMT',
      lastFetchAt: 1_100,
      lastSuccessAt: 1_100,
      lastErrorCode: null
    })
    expect(store.getRepo('repo-a')).toMatchObject({
      etag: 'W/"abc"',
      lastModified: 'Wed, 21 Oct 2026 06:00:00 GMT',
      lastFetchAt: 1_100,
      lastSuccessAt: 1_100,
      lastErrorCode: null
    })

    expect(
      codeOf(() =>
        store.updateRepoFetchState('missing', {
          etag: null,
          lastModified: null,
          lastFetchAt: 1,
          lastSuccessAt: null,
          lastErrorCode: 'vpmHttpNetwork'
        })
      )
    ).toBe('vpmRepoNotFound')
  })

  it('replaces packages and queries them with filters, pagination and totals', () => {
    store.upsertRepo(repo({ name: 'Repo A' }))
    expect(
      store.replaceRepoPackages('repo-a', [
        pkg({ version: '1.0.0', displayName: 'Foo Stable' }),
        pkg({ version: '1.1.0', displayName: 'Foo Beta', hidden: true, yanked: true })
      ])
    ).toBe(2)
    expect(store.getRepo('repo-a')?.packageCount).toBe(2)

    const all = store.queryCatalog({ includeHidden: true, includeYanked: true })
    expect(all.total).toBe(2)
    expect(all.items.map((item) => item.version)).toEqual(['1.1.0', '1.0.0'])
    expect(all.items[0]).toMatchObject({ repoId: 'repo-a', repoName: 'Repo A' })

    const visible = store.queryCatalog()
    expect(visible.total).toBe(1)
    expect(visible.items.map((item) => item.version)).toEqual(['1.0.0'])
    expect(store.queryCatalog({ includeHidden: true, includeYanked: true }).total).toBe(2)
    expect(store.queryCatalog({ includeHidden: true }).total).toBe(1)
    expect(store.queryCatalog({ includeYanked: true }).total).toBe(1)

    expect(store.queryCatalog({ text: 'foo-alias' }).total).toBe(1)
    expect(store.queryCatalog({ text: 'Repo A' }).total).toBe(1)

    const page = store.queryCatalog({ includeHidden: true, includeYanked: true, limit: 1, offset: 1 })
    expect(page.items).toHaveLength(1)
    expect(page.total).toBe(2)
    expect(page.limit).toBe(1)
    expect(page.offset).toBe(1)
    expect(store.queryCatalog({ includeHidden: true, includeYanked: true, offset: 99 })).toMatchObject({
      items: [],
      total: 2
    })
  })

  it('filters disabled repositories unless enabledOnly is false', () => {
    store.upsertRepo(repo())
    store.replaceRepoPackages('repo-a', [pkg()])
    store.upsertRepo(repo({ enabled: false }))

    expect(store.queryCatalog().total).toBe(0)
    expect(store.queryCatalog({ enabledOnly: false }).total).toBe(1)
  })

  it('rolls back the whole package replacement when one row is invalid', () => {
    store.upsertRepo(repo())
    store.replaceRepoPackages('repo-a', [pkg({ version: '1.0.0' })])
    expect(store.queryCatalog().total).toBe(1)

    expect(
      codeOf(() =>
        store.replaceRepoPackages('repo-a', [
          pkg({ version: '2.0.0' }),
          pkg({ version: '2.0.0' })
        ])
      )
    ).toBe('vpmRepoInvalid')

    const after = store.queryCatalog()
    expect(after.total).toBe(1)
    expect(after.items[0]?.version).toBe('1.0.0')
  })

  it('cascades package rows when a repository is removed', () => {
    store.upsertRepo(repo())
    store.replaceRepoPackages('repo-a', [pkg()])
    expect(store.removeRepo('repo-a')).toBe(true)
    expect(store.getRepo('repo-a')).toBeNull()
    expect(store.queryCatalog({ enabledOnly: false, includeHidden: true, includeYanked: true }).total).toBe(0)
    expect(store.removeRepo('repo-a')).toBe(false)
  })

  it('rejects invalid package hashes and missing repositories', () => {
    store.upsertRepo(repo())
    expect(codeOf(() => store.replaceRepoPackages('repo-a', [pkg({ zipSha256: 'not-a-sha' })]))).toBe(
      'vpmRepoInvalid'
    )
    expect(codeOf(() => store.replaceRepoPackages('missing', [pkg()]))).toBe('vpmRepoNotFound')
  })
})
