import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CategoryConfig } from '../../src/shared/types'
import { setAppPathsForTest } from '../../src/main/services/paths'
import { P } from '../../src/main/services/paths'
import {
  categoryDelta,
  loadCategories,
  saveCategories,
  setBuiltinCategoriesFileForTest,
  validateCategories
} from '../../src/main/services/categories'

/**
 * 第 3 轮 · 用户改的分类口语存在哪。
 *
 * 第 2 轮打包版活体实测到的：`saveCategories` 以前写的是
 * `resources\lexicon\categories.json`（打包版 = **安装目录里那份内置表**）。
 * 装成 per-user 目录所以写得动、当场也生效 —— 但 `electron-builder` 每次发布都会
 * 重写整个 `win-unpacked`，用户加的口语词下一次升级就整份没了。
 *
 * 所以这一组用例钉的全是"升级之后你还剩什么"：
 *  - 内置表**一个字节都不许被写**（这是本轮的验收线）；
 *  - 用户的加减存成增量，叠在内置表上；
 *  - 内置表以后新增口语，用户的改动不会把它盖掉（存整份拷贝就会）；
 *  - 界面上改到结构（标签 / 子项）要**明确报错**，不许悄悄丢掉那部分改动。
 */

let root = ''
let builtinFile = ''

const cfg = (): CategoryConfig =>
  JSON.parse(
    JSON.stringify({
      categories: [
        {
          key: 'clothing',
          label: { 'zh-CN': '服装', en: 'Outfit', ja: '服装' },
          synonyms: ['衣服', 'yifu'],
          subcategories: [
            { key: 'top', label: { 'zh-CN': '上衣', en: 'Top', ja: 'トップス' }, synonyms: ['T恤'] },
            { key: 'dress', label: { 'zh-CN': '礼服' } }
          ]
        },
        { key: 'hair', label: { 'zh-CN': '头发' }, subcategories: [] }
      ]
    })
  ) as CategoryConfig

function writeBuiltin(c: CategoryConfig): void {
  fs.writeFileSync(builtinFile, JSON.stringify(c, null, 2) + '\n', 'utf8')
}
const synOf = (c: CategoryConfig, key: string, sub?: string): string[] => {
  const cat = c.categories.find((x) => x.key === key)!
  const node = sub ? cat.subcategories.find((s) => s.key === sub)! : cat
  return node.synonyms ?? []
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-catsyn-'))
  /** 运行时目录与内置表都指到临时：这条测试一次都不该碰仓库里那份真表 */
  setAppPathsForTest(path.join(root, 'apphome'))
  builtinFile = path.join(root, 'builtin-categories.json')
  writeBuiltin(cfg())
  setBuiltinCategoriesFileForTest(builtinFile)
})

afterEach(() => {
  setBuiltinCategoriesFileForTest(null)
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* Windows 句柄没放干净就留给系统 */
  }
})

describe('用户的口语改动不再写进内置表', () => {
  it('⭐ 保存之后内置表一个字节都没变（第 2 轮那个洞的钉子）', () => {
    const before = fs.readFileSync(builtinFile)
    const next = cfg()
    next.categories[0].synonyms = ['衣服', 'yifu', '猫猫头']
    saveCategories(next)
    expect(fs.readFileSync(builtinFile).equals(before), '内置表被写了 —— 用户的东西存在安装目录里，升级即丢').toBe(true)
  })

  it('⭐ 用户的改动落在运行时目录的 categories.user.json', () => {
    const next = cfg()
    next.categories[0].synonyms = ['衣服', 'yifu', '猫猫头']
    saveCategories(next)
    const file = P.categoriesUser()
    expect(file.startsWith(P.root()), `增量文件必须在运行时目录下，实际 ${file}`).toBe(true)
    expect(fs.existsSync(file), '没写出增量文件').toBe(true)
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { schema: number; synonyms: Record<string, unknown> }
    expect(j.schema).toBe(1)
    expect(j.synonyms.clothing).toMatchObject({ add: ['猫猫头'] })
  })

  it('改回原样 → 增量文件被删掉（留着空文件会让人以为改过什么）', () => {
    const a = cfg()
    a.categories[0].synonyms = ['衣服', 'yifu', '猫猫头']
    saveCategories(a)
    expect(fs.existsSync(P.categoriesUser())).toBe(true)
    saveCategories(cfg())
    expect(fs.existsSync(P.categoriesUser()), '改动撤销了就该没有这个文件').toBe(false)
    expect(synOf(loadCategories(), 'clothing')).toEqual(['衣服', 'yifu'])
  })
})

describe('增量怎么叠加在内置表上', () => {
  it('加词生效、删内置词也生效，两份都能看见', () => {
    const a = cfg()
    a.categories[0].synonyms = ['yifu', '猫猫头'] // 删掉内置的「衣服」，加一个自己的
    saveCategories(a)
    const got = synOf(loadCategories(), 'clothing')
    expect(got).toEqual(['yifu', '猫猫头'])
    expect(categoryDelta().clothing).toEqual({ add: ['猫猫头'], remove: ['衣服'] })
  })

  it('⭐ 升级模拟：内置表以后新增了口语，用户的加减照样在', () => {
    const a = cfg()
    a.categories[0].synonyms = ['衣服', 'yifu', '猫猫头']
    saveCategories(a)
    /** 新版本发布：内置表多了「ウェア」，还多了一个二级分类 */
    const upgraded = cfg()
    upgraded.categories[0].synonyms = ['衣服', 'yifu', 'ウェア']
    upgraded.categories[0].subcategories.push({ key: 'shoes', label: { 'zh-CN': '鞋' } })
    writeBuiltin(upgraded)
    const got = synOf(loadCategories(), 'clothing')
    expect(got).toContain('猫猫头')
    expect(got).toContain('ウェア')
    expect(loadCategories().categories[0].subcategories.map((s) => s.key)).toEqual(['top', 'dress', 'shoes'])
    /**
     * 存"整份拷贝"就过不了这一条：用户那份是升级前的副本，
     * 内置表新增的「ウェア」和新二级分类永远不会出现在他的表里。
     */
  })

  it('二级分类的口语各记各的，不会串到一级', () => {
    const a = cfg()
    a.categories[0].subcategories[0].synonyms = ['T恤', '短袖']
    saveCategories(a)
    expect(synOf(loadCategories(), 'clothing', 'top')).toEqual(['T恤', '短袖'])
    expect(synOf(loadCategories(), 'clothing')).toEqual(['衣服', 'yifu'])
    expect(categoryDelta()['clothing/top']).toMatchObject({ add: ['短袖'] })
    expect(categoryDelta().clothing).toBeUndefined()
  })

  it('大小写不同的同一个词不许存成两条', () => {
    const a = cfg()
    a.categories[0].synonyms = ['衣服', 'yifu', 'YIFU']
    saveCategories(a)
    expect(synOf(loadCategories(), 'clothing')).toEqual(['衣服', 'yifu'])
    expect(categoryDelta().clothing).toBeUndefined()
  })
})

describe('不许悄悄丢掉用户以为改成了的东西', () => {
  it('⭐ 改标签要报错（界面上只允许改口语）', () => {
    const a = cfg()
    a.categories[0].label['zh-CN'] = '衣裳'
    expect(() => saveCategories(a)).toThrow(/只允许改「口语」/)
  })

  it('加一个二级分类要报错，而不是保存成功然后什么都没发生', () => {
    const a = cfg()
    a.categories[0].subcategories.push({ key: 'hat', label: { 'zh-CN': '帽子' } })
    expect(() => saveCategories(a)).toThrow(/只允许改「口语」/)
  })

  it('报错之后增量文件没被写坏（下一次读还是老样子）', () => {
    const a = cfg()
    a.categories[0].synonyms = ['衣服', 'yifu', '猫猫头']
    saveCategories(a)
    const snapshot = fs.readFileSync(P.categoriesUser(), 'utf8')
    const bad = cfg()
    bad.categories[1].label['zh-CN'] = '发型'
    expect(() => saveCategories(bad)).toThrow(/只允许改/)
    expect(fs.readFileSync(P.categoriesUser(), 'utf8')).toBe(snapshot)
    expect(synOf(loadCategories(), 'clothing')).toEqual(['衣服', 'yifu', '猫猫头'])
  })
})

describe('增量文件坏了不许把分类表拖挂', () => {
  it('不是 JSON → 当成"没有用户改动"，内置表照样读得出', () => {
    fs.mkdirSync(path.dirname(P.categoriesUser()), { recursive: true })
    fs.writeFileSync(P.categoriesUser(), '{ 这不是 JSON', 'utf8')
    const got = loadCategories(true)
    expect(synOf(got, 'clothing')).toEqual(['衣服', 'yifu'])
  })

  it('形状不对（值是字符串 / 节点不存在）→ 忽略掉，不抛', () => {
    fs.mkdirSync(path.dirname(P.categoriesUser()), { recursive: true })
    fs.writeFileSync(
      P.categoriesUser(),
      JSON.stringify({ schema: 1, updatedAt: 0, synonyms: { clothing: '不是对象', 'ghost/sub': { add: ['x'] } } }),
      'utf8'
    )
    const got = loadCategories(true)
    expect(synOf(got, 'clothing')).toEqual(['衣服', 'yifu'])
    expect(got.categories.length).toBe(2)
  })
})

describe('仓库里那份真内置表', () => {
  it('仍然能通过校验（改坏它的人会在启动时立刻看到错误，而不是静默用旧缓存）', () => {
    setBuiltinCategoriesFileForTest(null)
    const real = loadCategories(true)
    expect(real.categories.length).toBeGreaterThan(10)
    expect(() => validateCategories(JSON.parse(JSON.stringify(real)))).not.toThrow()
    /** 重新指回临时那份，别让后面的用例踩到真表 */
    setBuiltinCategoriesFileForTest(builtinFile)
  })

  it('真内置表没被这批测试写过（mtime 与内容都还是仓库的）', () => {
    setBuiltinCategoriesFileForTest(null)
    const file = path.resolve(process.cwd(), 'resources/lexicon/categories.json')
    const src = JSON.parse(fs.readFileSync(file, 'utf8')) as CategoryConfig
    expect(src.categories.some((c) => (c.synonyms ?? []).includes('猫猫头'))).toBe(false)
    expect(src.categories.find((c) => c.key === 'clothing')?.label['zh-CN']).toBe('服装')
    setBuiltinCategoriesFileForTest(builtinFile)
  })
})
