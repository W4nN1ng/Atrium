import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { RepoStore } from '../../../src/main/vpm/repos'
import type { PackageVersionInput } from '../../../src/main/vpm/repos'
import { CatalogService } from '../../../src/main/vpm/catalog'
import { setAppPathsForTest } from '../../../src/main/services/paths'

let root: string
let db: VpmDb
let store: RepoStore
let catalog: CatalogService

function pkg(overrides: Partial<PackageVersionInput> = {}): PackageVersionInput {
  return {
    name: 'com.foo',
    version: '1.0.0',
    displayName: 'Foo',
    description: 'desc',
    authorJson: '{"name":"Example"}',
    keywordsJson: '["avatar"]',
    aliasesJson: '["foo-alias"]',
    unityMin: '2022.3',
    zipUrl: 'https://example.test/foo.zip',
    zipSha256: 'a'.repeat(64),
    zipSize: 10,
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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-catalog-'))
  setAppPathsForTest(root)
  db = await openVpmDb()
  store = new RepoStore(db, () => 1_000)
  catalog = new CatalogService(store)
  store.upsertRepo({ id: 'a', url: 'https://a.test/repo.json', name: 'Repo A', sortOrder: 0 })
  store.upsertRepo({ id: 'b', url: 'https://b.test/repo.json', name: 'Repo B', sortOrder: 1 })
  store.upsertRepo({
    id: 'c',
    url: 'https://c.test/repo.json',
    name: 'Repo C',
    sortOrder: 2,
    enabled: false
  })

  store.replaceRepoPackages('a', [
    pkg({ version: '1.9.0', displayName: 'Foo A', zipSha256: 'a'.repeat(64) }),
    pkg({ version: '1.10.0', displayName: 'Foo Latest', zipSha256: 'b'.repeat(64), unityMin: '2022.3' }),
    pkg({ name: 'com.bar', version: '2.0.0', displayName: 'Bar', zipSha256: 'c'.repeat(64), aliasesJson: '["bar-alias"]' }),
    pkg({ name: 'com.hidden', version: '1.0.0', hidden: true, zipSha256: 'e'.repeat(64) }),
    pkg({ name: 'com.baz', version: '1.0.0', yanked: true, yankedReason: 'broken', zipSha256: 'f'.repeat(64) })
  ])
  store.replaceRepoPackages('b', [
    pkg({ version: '1.9.0', displayName: 'Foo B', zipSha256: 'd'.repeat(64) }),
    pkg({ version: '1.10.0', displayName: 'Foo Latest B', zipSha256: 'b'.repeat(64) })
  ])
  store.replaceRepoPackages('c', [pkg({ name: 'com.disabled', version: '1.0.0' })])
})

afterEach(() => {
  closeVpmDb(db)
  fs.rmSync(root, { recursive: true, force: true })
})

describe('CatalogService', () => {
  it('merges packages across repositories and picks the semantic latest version', () => {
    const page = catalog.query()
    expect(page.total).toBe(2)
    expect(page.items.map((item) => item.name)).toEqual(['com.bar', 'com.foo'])

    const foo = page.items.find((item) => item.name === 'com.foo')!
    expect(foo).toMatchObject({
      latestVersion: '1.10.0',
      versionCount: 2,
      hasConflict: true,
      conflictCount: 1,
      hasYanked: false,
      hidden: false
    })
    expect(foo.sources).toEqual([
      { repoId: 'a', repoName: 'Repo A' },
      { repoId: 'b', repoName: 'Repo B' }
    ])
    expect(foo.aliases).toContain('foo-alias')
    expect(foo.keywords).toContain('avatar')
  })

  it('flags same-version different hashes instead of choosing one', () => {
    const detail = catalog.getPackage('com.foo')!
    expect(detail.versions[0].version).toBe('1.10.0')
    expect(detail.versions[1].version).toBe('1.9.0')
    expect(detail.conflicts).toEqual([
      {
        version: '1.9.0',
        hashes: ['a'.repeat(64), 'd'.repeat(64)],
        sources: ['Repo A', 'Repo B']
      }
    ])
    expect(detail.versions[1].sources).toHaveLength(2)
  })

  it('filters hidden/yanked/disabled and supports exact name/pagination', () => {
    expect(catalog.query().total).toBe(2)
    expect(catalog.query({ includeHidden: true }).total).toBe(3)
    expect(catalog.query({ includeYanked: true }).total).toBe(3)
    expect(catalog.query({ enabledOnly: false }).total).toBe(3)
    expect(catalog.query({ name: 'com.foo' }).total).toBe(1)

    const page = catalog.query({ limit: 1, offset: 1 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0].name).toBe('com.foo')

    const hidden = catalog.getPackage('com.hidden')!
    expect(hidden.hidden).toBe(true)
    const yanked = catalog.getPackage('com.baz')!
    expect(yanked.hasYanked).toBe(true)
    expect(yanked.versions[0]).toMatchObject({ yanked: true, yankedReason: 'broken' })
  })

  it('searches by alias, keyword and repository name', () => {
    expect(catalog.query({ text: 'foo-alias' }).items.map((item) => item.name)).toEqual(['com.foo'])
    expect(catalog.query({ text: 'bar-alias' }).items.map((item) => item.name)).toEqual(['com.bar'])
    expect(catalog.query({ text: 'Repo B' }).items.map((item) => item.name)).toEqual(['com.foo'])
  })

  it('returns null for invalid or unknown package names', () => {
    expect(catalog.getPackage('bad name')).toBeNull()
    expect(catalog.getPackage('com.missing')).toBeNull()
  })

  it('includes disabled repository packages only when requested', () => {
    const page = catalog.query({ enabledOnly: false })
    expect(page.items.some((item) => item.name === 'com.disabled')).toBe(true)
  })
})
