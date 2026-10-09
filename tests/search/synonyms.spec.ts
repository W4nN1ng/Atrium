import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CategoryConfig } from '../../src/shared/types'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { buildAliases, labelTriple } from '../../src/main/search/aliases'
import { buildCategoryExpansion, expandCategoryLabels } from '../../src/shared/categoryExpand'
import { rebuildIndex, AssetSearchIndex, fuzzyFor } from '../../src/main/search'

/**
 * R4 ④ · 分类口语同义词真的进了检索。
 *
 * 验收口径就是 `docs/SEARCH.md` §4 那条：**给分类表加 synonyms，而不是在检索层硬编码词表**。
 * 所以这里两头都查：
 *  - 别名词表本身（`buildAliases` 把它折进 `category` 字段，不另开字段）；
 *  - 真索引 + 真查询（`yifu` 能不能命中一张归在「服装」下、名字里没有"衣服"两个字的卡）。
 * 第二条才是用户会撞上的那件事，第一条只是它的因。
 */

const cfg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../resources/lexicon/categories.json'), 'utf8')
) as CategoryConfig

const catWords = (fields: ReturnType<typeof buildAliases>): string[] => fields.find((f) => f.field === 'category')?.values ?? []

describe('每条素材的别名里**不含**口语（口语走查询展开，见 categoryExpand）', () => {
  it('category 字段只有 key + 三语标签，没有 synonyms', () => {
    const fields = buildAliases({
      name: 'Manuka 礼服',
      rawName: 'manuka_dress.zip',
      categoryKey: 'clothing',
      subcategoryKey: 'dress',
      ...labelTriple(cfg, 'clothing', 'dress')
    })
    const words = catWords(fields)
    expect(words).toContain('服装')
    expect(words).toContain('连衣裙')
    /**
     * 这条断言看着像"功能没做"，其实是这轮改设计的证据：
     * 把口语拼进每条素材实测多吃 47 万条别名、增量重建 0.469 → 0.584ms/条，
     * 而同一分类内它们完全重复。谁哪天手滑接回去，这条要红给他看。
     */
    expect(words).not.toContain('衣服')
    expect(words).not.toContain('礼服')
  })

  it('没写口语的分类也不许冒出空串', () => {
    const fields = buildAliases({
      name: 'x',
      rawName: 'x',
      categoryKey: 'shader',
      subcategoryKey: null,
      ...labelTriple(cfg, 'shader', null)
    })
    expect(catWords(fields).every((w) => w.trim().length >= 2)).toBe(true)
  })

  it('未知分类 → 只剩 key，不炸', () => {
    const t = labelTriple(cfg, 'nope', null)
    expect(t.categoryLabels).toBeUndefined()
    const fields = buildAliases({ name: 'x', categoryKey: 'nope', ...t })
    expect(catWords(fields)).toContain('nope')
  })
})

describe('查询展开表（口语 → 该分类的标签）', () => {
  const table = buildCategoryExpansion(cfg)

  it('一级口语映射到一级标签三语', () => {
    expect(expandCategoryLabels('衣服', table)).toContain('服装')
    expect(expandCategoryLabels('衣服', table)).toContain('Clothing')
  })

  it('拼音输入也认（yifu 和 衣服 是同一条口语的两种写法）', () => {
    expect(expandCategoryLabels('yifu', table)).toContain('服装')
  })

  it('二级口语只映射到二级标签 —— 搜「礼服」不该把整个服装类拖出来', () => {
    const hits = expandCategoryLabels('礼服', table)
    expect(hits).toContain('连衣裙')
    expect(hits).not.toContain('服装')
  })

  it('表里不含口语本身之外的乱映射：一个没写过的词不展开', () => {
    expect(expandCategoryLabels('冰箱', table)).toEqual([])
  })

  it('展开表规模有限（它是"每个分类一份知识"，不是"每条素材一份"）', () => {
    /** 109 个节点 × 十几条词 × 全套写法；真涨到几万条就说明有人把素材字段也塞进来了 */
    expect(table.size).toBeLessThan(20000)
    expect(table.size).toBeGreaterThan(1000)
  })
})

let dir = ''
let db: Db
const index = new AssetSearchIndex()
const IDS: Record<string, string> = {}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-syn-'))
  db = openDatabase(path.join(dir, 'library.db'))
  const seeds: Array<[string, string, string, string | null]> = [
    /** 名字里**故意不带**任何口语词：能搜到就只能是同义词的功劳 */
    ['Manuka Full Set', '6117553 manuka.zip', 'clothing', 'dress'],
    ['Shinano Long Hair', 'shinano_hair.unitypackage', 'hair', 'long'],
    ['LilToon', 'lilToon_1.5.1.unitypackage', 'shader', 'general']
  ]
  seeds.forEach(([name, raw, cat, sub], i) => {
    const row = makeAssetRow({ id: '01SYN' + i, name, raw_name: raw, category: cat, subcategory: sub, status: 'classified' })
    upsertAsset(db, row)
    IDS[name] = row.id
  })
  rebuildIndex(db, cfg, index)
}, 60000)

afterAll(() => {
  closeDatabase()
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

const hitIds = (q: string): string[] => index.search(q).map((h) => h.id)

describe('真索引 + 真查询（用户会撞上的那件事）', () => {
  it('搜「衣服」命中归在「服装」下的那张卡', () => {
    expect(hitIds('衣服')).toContain(IDS['Manuka Full Set'])
  })

  it('搜假名口语「ウェア」也命中（这条才是展开表的凭据：它和任何标签都不撞）', () => {
    /**
     * 「衣服」那条其实**不唯一**：它的拼音拆成 `yi`/`fu` 之后，
     * 前缀匹配会顺手命中「衣装」的拼音 `yizhuang`，所以把展开关掉它照样绿。
     * `ウェア` 和 clothing 的三语标签（服装 / Clothing / 衣装）没有任何写法重叠，
     * 只有走展开表才可能命中 —— 这条才是钉住 R4 ④ 的那颗钉子。
     */
    expect(hitIds('ウェア')).toContain(IDS['Manuka Full Set'])
  })

  it('搜拼音 yifu 也命中（searchForms 把口语一起展开了，所以只写一条中文就够）', () => {
    expect(hitIds('yifu')).toContain(IDS['Manuka Full Set'])
  })

  it('二级口语也算：搜「礼服」命中 dress 那张，搜「长发」命中 hair 那张', () => {
    expect(hitIds('礼服')).toContain(IDS['Manuka Full Set'])
    expect(hitIds('长发')).toContain(IDS['Shinano Long Hair'])
  })

  it('搜「冰箱」不许捞出发型卡（拼音 xiang 被容错成 xing 的那次事故）', () => {
    /**
     * R4 ④ 之前不会撞上：口语进来之后 hair 多了「发型」这条别名，
     * 于是「冰箱」→ 拼音 `xiang` → 容错趟匹配到 `xing`。
     * 修法是**容错趟只对整串 ASCII 的输入开**（拼音不是"打错的拉丁词"，是另一个词）。
     *
     * ⚠ 但这条用例**钉不住那道闸** —— `tools/verify-red-r4.cjs` 的 D1 把 `fuzzyFor` 的
     * ASCII 判定整个撤掉，它照样绿：`xiang` 与 `xing` 差 3 个编辑距离，0.2 的容错本来就够不着。
     * 所以这道闸单独有下一条用例钉；这条只保证"那个症状"不再出现。
     */
    expect(hitIds('冰箱')).toEqual([])
    expect(hitIds('zzzzqqqq')).toEqual([])
  })

  it('容错闸门本身：只给"整串 ASCII 且 ≥5 个字符"的词开（`fuzzyFor`）', () => {
    expect(fuzzyFor('shinan')).toBe(0.2)
    expect(fuzzyFor('shinano')).toBe(0.2)
    /** 短拉丁词不开：两个字符的容错等于前缀匹配，会把一切搅浑 */
    expect(fuzzyFor('ab')).toBe(false)
    /**
     * 关键是这一组：必须是**长度 ≥5 的非 ASCII 输入**。
     * 只写「冰箱」两字的话，撤掉 ASCII 判定也照样因为长度被挡下 —— 那就是假绿。
     */
    for (const wide of ['发型长头发', '服装配饰类', 'ウェア用品']) {
      expect(fuzzyFor(wide), `${wide} 不是"打错的拉丁词"，不该进容错趟`).toBe(false)
    }
  })

  it('拉丁词打错一个字母还是要容错（那是 fuzzy 存在的唯一理由）', () => {
    expect(hitIds('shinan')).toContain(IDS['Shinano Long Hair'])
    expect(hitIds('shinano')).toContain(IDS['Shinano Long Hair'])
  })

  it('别的分类不会被牵连：搜「衣服」不会把 shader 那张带出来', () => {
    expect(hitIds('衣服')).not.toContain(IDS['LilToon'])
  })
})
