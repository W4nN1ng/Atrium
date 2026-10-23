import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeVpmDb, openVpmDb, type VpmDb } from '../../../src/main/vpm/db'
import { RepoStore } from '../../../src/main/vpm/repos'
import type { PackageVersionInput } from '../../../src/main/vpm/repos'
import { CatalogService } from '../../../src/main/vpm/catalog'
import { setAppPathsForTest } from '../../../src/main/services/paths'

/**
 * P9-C：目录分页搬到 SQL 之后，**分页语义**必须和以前一模一样。
 *
 * 改的是"怎么取数"，不是"取到什么"：
 * - `total` 仍然是"匹配的包数量"（不是版本行数）；
 * - 翻页不重不漏；
 * - 用户隐藏 / 预发布过滤在分页**之前**生效（否则隐藏项占名额，第二页会少行）；
 * - 一个包同时有稳定版和预发布版时，关掉预发布只少一个版本，包本身还在。
 */

let root: string
let db: VpmDb
let store: RepoStore

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
    manifestJson: '{"vpmDependencies":{}}',
    fetchedAt: 1_000,
    ...overrides
  }
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-paging-'))
  setAppPathsForTest(root)
  db = await openVpmDb()
  store = new RepoStore(db, () => 1_000)
  store.upsertRepo({ id: 'a', url: 'https://a.test/repo.json', name: 'Repo A', sortOrder: 0 })

  const rows: PackageVersionInput[] = []
  // 30 个普通包，每个 2 个版本
  for (let index = 0; index < 30; index++) {
    const name = `com.page.pkg${String(index).padStart(2, '0')}`
    rows.push(pkg({ name, version: '1.0.0', displayName: `Page ${index}` }))
    rows.push(pkg({ name, version: '1.1.0', displayName: `Page ${index}` }))
  }
  // 只有一个预发布版本的包：关掉预发布时整个包消失
  rows.push(pkg({ name: 'com.page.betaonly', version: '2.0.0-beta.1' }))
  // 稳定 + 预发布：关掉预发布后包还在，只是少一个版本
  rows.push(pkg({ name: 'com.page.mixed', version: '1.0.0' }))
  rows.push(pkg({ name: 'com.page.mixed', version: '1.2.0-beta.1' }))
  // 用户要隐藏的包
  rows.push(pkg({ name: 'com.page.hidden', version: '1.0.0' }))
  // 仓库自己标 hidden 的包（不是用户隐藏）
  rows.push(pkg({ name: 'com.page.repohidden', version: '1.0.0', hidden: true }))
  store.replaceRepoPackages('a', rows)
})

afterEach(() => {
  closeVpmDb(db)
  fs.rmSync(root, { recursive: true, force: true })
})

function service(allowPrerelease = true, hidden: string[] = []): CatalogService {
  return new CatalogService(store, () => ({ allowPrerelease, hiddenPackageIds: hidden }))
}

describe('目录分页（P9-C：SQL 侧按包名分页）', () => {
  it('total 是包数量，翻页不重不漏', () => {
    const catalog = service()
    const first = catalog.query({ text: 'com.page', limit: 10, offset: 0 })
    const second = catalog.query({ text: 'com.page', limit: 10, offset: 10 })
    const third = catalog.query({ text: 'com.page', limit: 10, offset: 20 })
    const fourth = catalog.query({ text: 'com.page', limit: 10, offset: 30 })

    // 30 普通 + betaonly + mixed + hidden + repohidden(hidden 行默认不出现)
    expect(first.total).toBe(33)
    expect(fourth.total).toBe(33)

    const names = [...first.items, ...second.items, ...third.items, ...fourth.items].map(
      (item) => item.name
    )
    expect(names).toHaveLength(33)
    expect(new Set(names).size, `翻页有重复：${names.join(', ')}`).toBe(33)
    // 稳定排序：两页之间不能倒挂
    expect([...names].sort()).toEqual(names)
  })

  it('用户隐藏的包不占分页名额，也不计入 total', () => {
    const catalog = service(true, ['com.page.pkg00', 'com.page.pkg01'])
    const page = catalog.query({ text: 'com.page', limit: 100, offset: 0 })
    expect(page.total).toBe(31)
    expect(page.items.map((item) => item.name)).not.toContain('com.page.pkg00')

    // 关键：隐藏项如果在取回后才过滤，第一页会只剩 8 条
    const small = catalog.query({ text: 'com.page', limit: 10, offset: 0 })
    expect(small.items).toHaveLength(10)
  })

  it('关掉预发布：只有预发布版的包消失，混合包只少一个版本', () => {
    const catalog = service(false)
    const page = catalog.query({ text: 'com.page', limit: 100, offset: 0 })
    const names = page.items.map((item) => item.name)

    expect(names).not.toContain('com.page.betaonly')
    expect(names).toContain('com.page.mixed')
    const mixed = page.items.find((item) => item.name === 'com.page.mixed')
    expect(mixed?.versionCount).toBe(1)
    expect(mixed?.latestVersion).toBe('1.0.0')
    // 33 - betaonly = 32（mixed 还在，只是版本少一个）
    expect(page.total).toBe(32)
  })

  it('打开预发布：预发布版本回来，total 也跟着回去', () => {
    const page = service(true).query({ text: 'com.page', limit: 100, offset: 0 })
    expect(page.total).toBe(33)
    expect(page.items.find((item) => item.name === 'com.page.mixed')?.versionCount).toBe(2)
  })

  it('仓库标 hidden 的行默认不出现，includeHidden 才出现', () => {
    const catalog = service()
    expect(catalog.query({ text: 'com.page', limit: 100 }).items.map((item) => item.name)).not.toContain(
      'com.page.repohidden'
    )
    expect(
      catalog
        .query({ text: 'com.page', limit: 100, includeHidden: true })
        .items.map((item) => item.name)
    ).toContain('com.page.repohidden')
  })

  it('offset 超出范围返回空页但 total 不变', () => {
    const page = service().query({ text: 'com.page', limit: 10, offset: 9_000 })
    expect(page.items).toEqual([])
    expect(page.total).toBe(33)
  })

  it('详情与分页解耦：预发布包能打开，用户隐藏的包按 P8-C 的约定打不开', () => {
    const catalog = service(false, ['com.page.hidden'])
    // 预发布只影响"浏览列表"，包详情照旧 —— 已装的预发布包不能变成查无此包。
    expect(catalog.getPackage('com.page.betaonly')?.latestVersion).toBe('2.0.0-beta.1')
    // 用户显式隐藏是"我不想看见这个包"，详情也一起隐藏（P8-C 的约定）。
    expect(catalog.getPackage('com.page.hidden')).toBeNull()
    // 仓库自己标 hidden 的行不拦详情（那是仓库的标记，不是用户偏好）。
    expect(catalog.getPackage('com.page.repohidden')).not.toBeNull()
  })
})
