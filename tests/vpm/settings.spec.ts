import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setAppPathsForTest } from '../../src/main/services/paths'
import {
  defaultVpmSettings,
  parseUnityArgs,
  patchVpmSettings,
  readVpmSettings,
  writeVpmSettings
} from '../../src/main/vpm/config'
import { parsePreferencesPatch } from '../../src/main/vpm/ipc/settings'
import { CatalogService } from '../../src/main/vpm/catalog'
import type { CatalogPackageRow, CatalogQuery, RepoStore } from '../../src/main/vpm/repos'

let root: string

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-prefs-')))
  setAppPathsForTest(root)
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('patchVpmSettings', () => {
  it('只改传入的字段，其余保持原值', () => {
    writeVpmSettings({ ...defaultVpmSettings(), enabled: true, dataRoot: 'E:\\AtriumVPM', cacheQuotaGb: 12 })

    const next = patchVpmSettings({ allowPrerelease: true, hiddenPackageIds: ['com.example.a'] })

    expect(next.allowPrerelease).toBe(true)
    expect(next.hiddenPackageIds).toEqual(['com.example.a'])
    // 没传的字段不动
    expect(next.cacheQuotaGb).toBe(12)
    expect(next.enabled).toBe(true)
    expect(next.dataRoot).toBe('E:\\AtriumVPM')
    // 真的落盘了
    expect(readVpmSettings().settings.hiddenPackageIds).toEqual(['com.example.a'])
  })

  it('坏值整次拒绝，磁盘上的文件保持原样', () => {
    writeVpmSettings({ ...defaultVpmSettings(), cacheQuotaGb: 7 })
    expect(() => patchVpmSettings({ cacheQuotaGb: 0 })).toThrow()
    expect(readVpmSettings().settings.cacheQuotaGb).toBe(7)
  })

  it('配额上限之外的值被拒绝', () => {
    expect(() => patchVpmSettings({ vaultQuotaGb: 5000 })).toThrow()
  })
})

describe('parsePreferencesPatch', () => {
  it('去重并 trim 隐藏包 id', () => {
    expect(parsePreferencesPatch({ hiddenPackageIds: [' a ', 'a', 'b'] })).toEqual({
      hiddenPackageIds: ['a', 'b']
    })
  })

  it('非白名单字段被忽略', () => {
    expect(parsePreferencesPatch({ allowPrerelease: true, dataRoot: 'E:\\evil' })).toEqual({
      allowPrerelease: true
    })
  })

  it.each([
    ['数组不是数组', { hiddenPackageIds: 'x' }],
    ['id 不是字符串', { hiddenPackageIds: [1] }],
    ['id 是空串', { hiddenPackageIds: ['   '] }],
    ['配额是字符串', { cacheQuotaGb: '20' }],
    ['参数含空字节', { defaultUnityArgs: 'a\0b' }],
    ['开关不是布尔', { checkUpdates: 'yes' }],
    ['整体不是对象', 'nope']
  ])('拒绝 %s', (_label, input) => {
    expect(() => parsePreferencesPatch(input)).toThrow()
  })
})

describe('parseUnityArgs', () => {
  it('按空白切分并丢掉空串', () => {
    expect(parseUnityArgs('-screen-fullscreen 0\n-vrmode  1')).toEqual([
      '-screen-fullscreen',
      '0',
      '-vrmode',
      '1'
    ])
  })

  it('空设置给空数组', () => {
    expect(parseUnityArgs('')).toEqual([])
    expect(parseUnityArgs('   ')).toEqual([])
  })
})

/** 最小 RepoStore 桩：只要 queryCatalog / listRepos。 */
/**
 * 最小 RepoStore 桩：只要 listRepos / queryCatalog / queryCatalogNames。
 *
 * P9-C 起目录是"先按名字分页、再按名字取行"，桩必须两个方法都实现，
 * 否则 `CatalogService.query` 会在 `queryCatalogNames` 上拿到 undefined。
 */
function storeOf(rows: CatalogPackageRow[]): RepoStore {
  const filtered = (query: CatalogQuery): CatalogPackageRow[] => {
    let items = rows
    if (query.name) items = items.filter((row) => row.name === query.name)
    if (Array.isArray(query.names)) {
      const wanted = new Set(query.names)
      items = items.filter((row) => wanted.has(row.name))
    }
    if (Array.isArray(query.excludeNames)) {
      const excluded = new Set(query.excludeNames)
      items = items.filter((row) => !excluded.has(row.name))
    }
    if (query.excludePrerelease === true) {
      items = items.filter((row) => !row.version.includes('-'))
    }
    if (query.text) {
      const text = query.text.toLowerCase()
      items = items.filter((row) => row.name.toLowerCase().includes(text))
    }
    return items
  }
  return {
    listRepos: () => [],
    queryCatalog: (query: CatalogQuery) => {
      const items = filtered(query)
      const offset = query.offset ?? 0
      const limit = query.limit ?? 100
      return { items: items.slice(offset, offset + limit), total: items.length, limit, offset }
    },
    queryCatalogNames: (query: CatalogQuery) => {
      const names = [...new Set(filtered(query).map((row) => row.name))].sort()
      const offset = query.offset ?? 0
      const limit = query.limit ?? 100
      return { names: names.slice(offset, offset + limit), total: names.length, limit, offset }
    }
  } as unknown as RepoStore
}

function row(name: string, version: string): CatalogPackageRow {
  return {
    repoId: 'repo-a',
    repoName: 'Repo A',
    name,
    version,
    displayName: name,
    description: null,
    unityMin: null,
    zipUrl: `https://example.test/${name}-${version}.zip`,
    zipSha256: null,
    zipSize: null,
    yanked: false,
    yankedReason: null,
    hidden: false,
    deprecated: false,
    manifestJson: '{}',
    keywordsJson: null,
    aliasesJson: null
  } as unknown as CatalogPackageRow
}

describe('CatalogService 用户偏好', () => {
  const rows = [
    row('com.example.stable', '1.0.0'),
    row('com.example.beta', '1.1.0-beta.1'),
    row('com.example.hidden', '2.0.0')
  ]

  it('默认全显示', () => {
    const service = new CatalogService(storeOf(rows))
    expect(service.query().items.map((item) => item.name).sort()).toEqual([
      'com.example.beta',
      'com.example.hidden',
      'com.example.stable'
    ])
    expect(service.defaultAllowPrerelease()).toBe(true)
  })

  it('关掉预发布后列表里没有 -beta，但包详情仍能打开', () => {
    const service = new CatalogService(storeOf(rows), () => ({
      allowPrerelease: false,
      hiddenPackageIds: []
    }))
    expect(service.query().items.map((item) => item.name)).not.toContain('com.example.beta')
    // 已装的预发布包不能变成"查无此包"
    expect(service.getPackage('com.example.beta')).not.toBeNull()
    expect(service.defaultAllowPrerelease()).toBe(false)
  })

  it('隐藏的包列表和详情都看不到，但解析目录里还在', () => {
    const service = new CatalogService(storeOf(rows), () => ({
      allowPrerelease: true,
      hiddenPackageIds: ['com.example.hidden']
    }))
    expect(service.query().items.map((item) => item.name)).not.toContain('com.example.hidden')
    expect(service.getPackage('com.example.hidden')).toBeNull()
    // 依赖解析不受影响：隐藏是"我不想看见"，不是"这个包不存在"
    expect(service.resolverCatalog().map((item) => item.name)).toContain('com.example.hidden')
  })
})
