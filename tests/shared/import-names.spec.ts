import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_IMPORT_NAME_HISTORY,
  parseImportNameHistory,
  pushImportName,
  topLevelNames,
  type ImportNameEntry
} from '../../src/shared/importNames'

function entry(n: number): ImportNameEntry {
  return { id: `id-${n}`, at: n, assetName: `素材${n}`, projectName: 'shinano-Main4', names: [`名字${n}`] }
}

describe('导入历史：素材导进 Unity 以后叫什么', () => {
  it('取 Assets 下的一级目录名（这就是用户在 Project 里看到的文件夹）', () => {
    expect(topLevelNames(['Assets/shinano Candy/Prefab/Candy.prefab', 'Assets/shinano Candy/Candy.mat'])).toEqual([
      'shinano Candy'
    ])
  })

  it('多个一级目录全列出来，顺序稳定、不重复', () => {
    expect(topLevelNames(['Assets/B/x.png', 'Assets/A/y.png', 'Assets/B/z.png'])).toEqual(['B', 'A'])
  })

  it('直接落在 Assets 根下的文件去掉扩展名', () => {
    expect(topLevelNames(['Assets/Candy.mat'])).toEqual(['Candy'])
  })

  it('反斜杠、前导 ./ 一起兼容（老包会这么写）', () => {
    expect(topLevelNames(['./Assets\\糖果\\a.prefab'])).toEqual(['糖果'])
  })

  it('不是 Assets 下的路径不算（Packages/、ProjectSettings/ 之类）', () => {
    expect(topLevelNames(['Packages/com.x/y.json', 'ProjectSettings/x.asset', ''])).toEqual([])
  })

  it('取不到名字时返回空数组 —— 调用方据此不记录（纯代码包不该刷一行空白）', () => {
    expect(topLevelNames([])).toEqual([])
  })

  it('新的在最前面', () => {
    const list = pushImportName([entry(1)], entry(2))
    expect(list.map((item) => item.id)).toEqual(['id-2', 'id-1'])
  })

  it(`最多 ${MAX_IMPORT_NAME_HISTORY} 条，超出丢最旧的`, () => {
    let list: ImportNameEntry[] = []
    for (let i = 0; i < MAX_IMPORT_NAME_HISTORY + 20; i++) list = pushImportName(list, entry(i))
    expect(list).toHaveLength(MAX_IMPORT_NAME_HISTORY)
    expect(list[0].id).toBe(`id-${MAX_IMPORT_NAME_HISTORY + 19}`)
    expect(list[list.length - 1].id).toBe('id-20')
  })

  it('同一条不会因为重复追加出现两次', () => {
    const once = pushImportName([], entry(1))
    expect(pushImportName(once, entry(1))).toHaveLength(1)
  })

  it('库里存了脏数据也不崩，坏行直接丢', () => {
    const bad = [null, 1, 'x', {}, { id: 'a' }, { id: 'b', assetName: 'x', names: 'not-array' }, entry(3)]
    expect(parseImportNameHistory(bad).map((item) => item.id)).toEqual(['id-3'])
    expect(parseImportNameHistory({ nope: true })).toEqual([])
    expect(parseImportNameHistory(null)).toEqual([])
  })

  it('解析时也会把超过上限的截断', () => {
    const many = Array.from({ length: MAX_IMPORT_NAME_HISTORY + 5 }, (_, i) => entry(i))
    expect(parseImportNameHistory(many)).toHaveLength(MAX_IMPORT_NAME_HISTORY)
  })
})

describe('i18n：导入历史页的三语文案齐全且占位符成对', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const keys = ['count', 'clear', 'clearConfirm', 'clearHint', 'empty', 'emptyHint', 'today', 'yesterday']
  for (const loc of ['zh-CN', 'en', 'ja'] as const) {
    it(`${loc} 有 nav.importNames 与 importNames.*`, () => {
      const json = JSON.parse(fs.readFileSync(path.join(ROOT, `src/renderer/i18n/${loc}.json`), 'utf8')) as {
        nav: Record<string, unknown>
        importNames: Record<string, unknown>
      }
      expect(typeof json.nav.importNames, `${loc}.nav.importNames`).toBe('string')
      for (const key of keys) {
        const value = json.importNames[key]
        expect(typeof value, `${loc}.importNames.${key}`).toBe('string')
        /** 单花括号 i18next 会原样吐出来（这坑踩过两次） */
        const single = (value as string).match(/(?<!\{)\{[^{}]+\}(?!\})/g)
        expect(single, `${loc}.importNames.${key} 里有单花括号占位符`).toBeNull()
      }
      expect(String(json.importNames.count)).toContain('{{count}}')
    })
  }
})
