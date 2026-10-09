import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { addSynonym, deadSynonyms, removeSynonym, synonymsDirty, MAX_SYNONYMS, MIN_SYNONYM_LEN } from '../../src/shared/synonymEdit'
import type { CategoryConfig } from '../../src/shared/types'

const ROOT = path.resolve(__dirname, '../..')

/**
 * R4 ④ · 分类口语同义词的编辑判据。
 *
 * 最要紧的是 `tooShort` 那条：`search/aliases.ts:pushUnique` 丢掉长度 < 2 的别名，
 * 所以「包」这种词**存得进去、检索里根本没有**。界面不在当场拒绝，
 * 用户就会得到一个"我明明写了它却搜不到"的悬案 —— 这类"看着有其实没有"是这份代码的老毛病。
 */

describe('addSynonym', () => {
  it('正常加一条：原数组不许被改动', () => {
    const src = ['衣服']
    const r = addSynonym(src, ' 服装 ')
    expect(r.list).toEqual(['衣服', '服装'])
    expect(r.rejected).toBe(null)
    expect(src).toEqual(['衣服'])
  })

  it('空词 / 全空格 → 拒绝', () => {
    expect(addSynonym([], '').rejected?.key).toBe('settings.synonym.empty')
    expect(addSynonym(['a'], '   ').rejected?.key).toBe('settings.synonym.empty')
  })

  it('单字词 → 当场拒绝，并且带上下限参数（和 aliases.ts 同一个数）', () => {
    const r = addSynonym([], '包')
    expect(r.rejected?.key).toBe('settings.synonym.tooShort')
    expect(r.rejected?.params?.min).toBe(MIN_SYNONYM_LEN)
    expect(r.list).toEqual([])
  })

  it('超长 → 拒绝（主进程 validate 也会抛，界面先挡住才看得见人话）', () => {
    const r = addSynonym([], 'x'.repeat(25))
    expect(r.rejected?.key).toBe('settings.synonym.tooLong')
  })

  it('重复：大小写与全角空格差异算同一条', () => {
    expect(addSynonym(['Texture'], 'texture').rejected?.key).toBe('settings.synonym.dup')
    expect(addSynonym(['texture'], 'Texture').rejected?.key).toBe('settings.synonym.dup')
    expect(addSynonym(['texture'], ' texture ').rejected?.key).toBe('settings.synonym.dup')
    /** 但简繁/假名异体不算重复，那是两个不同的可搜写法 */
    expect(addSynonym(['贴图'], 'テクスチャ').rejected).toBe(null)
  })

  it('到上限就挡住（和 services/categories.ts 的 validate 同一个数，不许两边漂）', () => {
    const full = Array.from({ length: MAX_SYNONYMS }, (_, i) => '词' + i)
    expect(addSynonym(full, '再来一个').rejected?.key).toBe('settings.synonym.tooMany')
  })

  it('undefined（这个分类一条口语都没有）也当空数组处理', () => {
    expect(addSynonym(undefined, '衣服').list).toEqual(['衣服'])
  })
})

describe('removeSynonym / deadSynonyms', () => {
  it('删一条，其余顺序不变', () => {
    expect(removeSynonym(['衣服', '服', '衣装'], '服')).toEqual(['衣服', '衣装'])
  })

  it('把已经存盘的白加词挑出来（老数据里可能有：这功能上线前没人管过单字）', () => {
    /** `' k'` 去掉空格就剩一个字符，和 `k` 一样进不了索引 —— 判据按"实际会被丢掉"算 */
    expect(deadSynonyms(['包', '衣服', ' k'])).toEqual(['包', ' k'])
  })
})

describe('synonymsDirty', () => {
  const cfg = (): CategoryConfig => ({
    version: 1,
    categories: [
      {
        key: 'clothing',
        order: 1,
        label: { 'zh-CN': '服装' },
        subcategories: [{ key: 'dress', label: { 'zh-CN': '连衣裙' }, synonyms: ['洋装'] }]
      }
    ]
  })

  it('一模一样 → 不脏（保存会重建索引，不能让它白跑）', () => {
    expect(synonymsDirty(cfg(), cfg())).toBe(false)
  })

  it('加一条 / 删一条 / 换顺序 都算脏', () => {
    const a = cfg()
    const b = cfg()
    b.categories[0].subcategories[0].synonyms = ['洋装', '礼服']
    expect(synonymsDirty(b, a)).toBe(true)
    const c = cfg()
    c.categories[0].subcategories[0].synonyms = []
    expect(synonymsDirty(c, a)).toBe(true)
    const d = cfg()
    d.categories[0].synonyms = ['衣服']
    expect(synonymsDirty(d, a)).toBe(true)
  })

  it('只改标签不算脏（这一版面板只管口语，别让保存按钮在没改东西时亮着）', () => {
    const a = cfg()
    const b = cfg()
    b.categories[0].label = { 'zh-CN': '衣裳' }
    expect(synonymsDirty(a, b)).toBe(false)
  })

  it('任何一边是 null → 不脏（还没加载出来，别报错也别让人以为丢了改动）', () => {
    expect(synonymsDirty(null, cfg())).toBe(false)
    expect(synonymsDirty(cfg(), null)).toBe(false)
  })
})

describe('真分类表（resources/lexicon/categories.json）', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/lexicon/categories.json'), 'utf8')) as CategoryConfig
  const all = raw.categories.flatMap((c) => [
    { where: c.key, list: c.synonyms ?? [] },
    ...c.subcategories.map((s) => ({ where: c.key + '/' + s.key, list: s.synonyms ?? [] }))
  ])

  it('一级分类全部带口语，二级覆盖到绝大多数', () => {
    const catMissing = raw.categories.filter((c) => !(c.synonyms ?? []).length).map((c) => c.key)
    expect(catMissing, '这些一级分类没有口语：' + catMissing.join(',')).toEqual([])
    const withSubs = all.filter((x) => x.where.includes('/') && x.list.length).length
    const totalSubs = raw.categories.reduce((a, c) => a + c.subcategories.length, 0)
    expect(withSubs, `二级口语只覆盖 ${withSubs}/${totalSubs}`).toBeGreaterThan(totalSubs * 0.9)
  })

  it('没有任何一条是单字（存进去也不会进索引 = 白加）', () => {
    const bad = all.flatMap((x) => x.list.filter((w) => w.trim().length < MIN_SYNONYM_LEN).map((w) => x.where + ':' + w))
    expect(bad, '这些口语是单字：' + bad.join(', ')).toEqual([])
  })

  it('同一个节点内不重复（忽略大小写），也不超上限', () => {
    for (const x of all) {
      const seen = new Set<string>()
      for (const w of x.list) {
        const k = w.toLowerCase()
        expect(seen.has(k), `${x.where} 里「${w}」重复了`).toBe(false)
        seen.add(k)
      }
      expect(x.list.length, `${x.where} 口语太多`).toBeLessThanOrEqual(MAX_SYNONYMS)
    }
  })

  it('至少覆盖到"衣服 → 服装"这一组（就是用户库里真实存在的那种叫法）', () => {
    const clothing = raw.categories.find((c) => c.key === 'clothing')
    expect(clothing?.synonyms).toContain('衣服')
  })
})

describe('拒绝理由的文案三语齐全', () => {
  /**
   * `addSynonym` 回的是 key，界面用 `t(key)` 动态取 ——
   * 静态扫描抓不到动态 key（i18n.spec 只扫字面量），所以这里逐个点名。
   * 漏一条的表现是弹出一个 `settings.synonym.tooShort` 这种 key 名。
   */
  const KEYS = [
    'settings.synonym.empty',
    'settings.synonym.tooShort',
    'settings.synonym.tooLong',
    'settings.synonym.dup',
    'settings.synonym.tooMany',
    'settings.synonymsTitle',
    'settings.synonymsHint',
    'settings.synonymsKanjiHint',
    'settings.synonymsAddPh',
    'settings.synonymsAdd',
    'settings.synonymsSaved',
    'settings.synonymsRevert',
    'settings.synonymsUnsaved',
    'settings.synonymsNone',
    'settings.synonymDeadWarn'
  ]

  const flat = (o: unknown, p = ''): string[] => {
    if (!o || typeof o !== 'object') return [p]
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? p + '.' + k : k))
  }

  for (const loc of ['zh-CN', 'en', 'ja']) {
    it(`${loc} 全都有`, () => {
      const set = new Set(flat(JSON.parse(fs.readFileSync(path.join(ROOT, `src/renderer/i18n/${loc}.json`), 'utf8'))))
      const missing = KEYS.filter((k) => !set.has(k))
      expect(missing, `${loc} 缺：${missing.join(', ')}`).toEqual([])
    })
  }
})
