import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  DIM_KV_SEP,
  DIM_REC_SEP,
  dimChips,
  parseVariantDims,
  sortDims,
  variantDimLabelKey,
  VARIANT_KINDS
} from '../../src/shared/variantDims'

/**
 * R4 ⑤ · 变体分列的判据。
 *
 * 卡片上那一行"适配模型 ×11"看着简单，背后是三条会出错的判断：
 * 哪些维度值得显示、容器卡上怎么不重复数同一个数、维度太多时怎么不悄悄少说。
 * 全部住在这里，所以能在这里钉住 —— 组件里那份是排版，不是判据。
 */

const rec = (kind: string, value: string): string => kind + DIM_KV_SEP + value

describe('parseVariantDims', () => {
  it('空 / null / 只有分隔符 → 空数组', () => {
    expect(parseVariantDims(null)).toEqual([])
    expect(parseVariantDims(undefined)).toEqual([])
    expect(parseVariantDims('')).toEqual([])
    expect(parseVariantDims(DIM_REC_SEP + DIM_REC_SEP)).toEqual([])
  })

  it('同 kind 多值合成一条，值去重、顺序保留', () => {
    const blob = [rec('avatar', 'SHINANO'), rec('avatar', 'MANUKA'), rec('avatar', 'SHINANO')].join(DIM_REC_SEP)
    expect(parseVariantDims(blob)).toEqual([{ kind: 'avatar', values: ['SHINANO', 'MANUKA'] }])
  })

  it('值里带 `|`、中文、空格、等号都不许拆坏（这就是分隔符用控制字符的原因）', () => {
    const blob = [rec('version', '1.0 | 汉化版 = final'), rec('locale', 'zh-CN')].join(DIM_REC_SEP)
    const dims = parseVariantDims(blob)
    expect(dims.find((d) => d.kind === 'version')?.values).toEqual(['1.0 | 汉化版 = final'])
  })

  it('脏记录整条丢掉，不许猜一个 kind 出来', () => {
    const blob = ['nope', rec('avatar', 'AIRI'), DIM_KV_SEP + 'onlyvalue', rec('locale', '')].join(DIM_REC_SEP)
    expect(parseVariantDims(blob)).toEqual([{ kind: 'avatar', values: ['AIRI'] }])
  })

  it('值多的维度排前面，同数按 kind 稳定排（两边各排一遍迟早漂）', () => {
    const blob = [rec('locale', 'zh'), rec('locale', 'ja'), rec('avatar', 'A'), rec('avatar', 'B'), rec('avatar', 'C'), rec('version', '1.0'), rec('version', '1.1')].join(DIM_REC_SEP)
    expect(parseVariantDims(blob).map((d) => d.kind)).toEqual(['avatar', 'locale', 'version'])
    expect(sortDims([{ kind: 'b', values: ['1'] }, { kind: 'a', values: ['1'] }]).map((d) => d.kind)).toEqual(['a', 'b'])
  })
})

describe('variantDimLabelKey', () => {
  it('六个已知 kind 各有 key', () => {
    for (const k of VARIANT_KINDS) expect(variantDimLabelKey(k)).toBe('variantKind.' + k)
  })

  it('词典以后长出没见过的 dim，落到 other 而不是显示成 `variantKind.xyz`', () => {
    expect(variantDimLabelKey('body_type')).toBe('variantKind.other')
    expect(variantDimLabelKey('')).toBe('variantKind.other')
  })
})

describe('dimChips 的三条判据', () => {
  it('① 只有一条值的维度不显示 —— 那一维上大家一样，写出来是噪音', () => {
    const set = dimChips([
      { kind: 'avatar', values: ['SHINANO', 'MANUKA'] },
      { kind: 'version', values: ['1.0'] }
    ])
    expect(set.chips.map((c) => c.kind)).toEqual(['avatar'])
    expect(set.more).toBe(0)
    expect(set.emptyKey).toBe(null)
  })

  it('② 容器卡上的 version 在徽章数过之后不再数一遍', () => {
    const dims = [
      { kind: 'version', values: ['1.0', '1.1', '1.2'] },
      { kind: 'avatar', values: ['A', 'B'] }
    ]
    expect(dimChips(dims, { isBundle: true, unitCount: 3 }).chips.map((c) => c.kind)).toEqual(['avatar'])
    /** 非容器卡不抑制：那张卡的徽章写的是"3 变体"（份数），版本号是新增信息。
     *  顺序是 `sortDims` 给的（值多的在前），调用方传进来的顺序不算数。 */
    expect(dimChips(dims).chips.map((c) => c.kind)).toEqual(['version', 'avatar'])
    /** unitCount ≤1 时徽章没在数版本，所以 version 维度要显示出来 */
    expect(dimChips(dims, { isBundle: true, unitCount: 1 }).chips.map((c) => c.kind)).toEqual(['version', 'avatar'])
  })

  it('全被抑制时要说一句"件数已写在角上"，不许让人以为这卡没有版本信息', () => {
    const set = dimChips([{ kind: 'version', values: ['1.0', '1.1'] }], { isBundle: true, unitCount: 2 })
    expect(set.chips).toEqual([])
    expect(set.emptyKey).toBe('library.dimSuppressed')
  })

  it('本来就没有多维信息时什么都不显示（给每张卡挂一句"无差异"是噪音）', () => {
    expect(dimChips([]).emptyKey).toBe(null)
    expect(dimChips([{ kind: 'avatar', values: ['ONE'] }]).emptyKey).toBe(null)
  })

  it('③ 超过 3 个维度要显式说 +N，不许悄悄截断', () => {
    const dims = ['avatar', 'version', 'locale', 'install_method', 'quest'].map((k) => ({ kind: k, values: ['a', 'b'] }))
    const set = dimChips(dims)
    expect(set.chips).toHaveLength(3)
    expect(set.more).toBe(2)
  })

  it('提示语里最多列 6 个值，剩下的写成 +N（tooltip 不许长到看不见别的）', () => {
    const many = Array.from({ length: 11 }, (_, i) => 'M' + i)
    const set = dimChips([{ kind: 'avatar', values: many }])
    expect(set.chips[0].count).toBe(11)
    expect(set.chips[0].title).toBe(many.slice(0, 6).join('、') + ' +5')
    expect(set.chips[0].hiddenValues).toBe(5)
  })
})

describe('文案 key 三语齐全', () => {
  const ROOT = path.resolve(__dirname, '../..')
  const flat = (o: unknown, p = ''): string[] => {
    if (!o || typeof o !== 'object') return [p]
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? p + '.' + k : k))
  }
  const KEYS = [
    ...VARIANT_KINDS.map((k) => 'variantKind.' + k),
    'library.dimChip',
    'library.dimMoreHint',
    'library.dimSuppressed',
    'library.variants'
  ]

  it('dimChips / variantDimLabelKey 能吐出来的每个 key 三语都有', () => {
    for (const loc of ['zh-CN', 'en', 'ja']) {
      const set = new Set(flat(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/i18n', `${loc}.json`), 'utf8'))))
      const missing = KEYS.filter((k) => !set.has(k))
      expect(missing, `${loc} 缺：${missing.join(', ')}`).toEqual([])
    }
  })

  it('`dimChip` 那句必须同时带 label 和 count 两个占位符（少一个界面上就是半句话）', () => {
    for (const loc of ['zh-CN', 'en', 'ja']) {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/i18n', `${loc}.json`), 'utf8')) as {
        library: { dimChip: string }
      }
      expect(j.library.dimChip).toMatch(/\{\{label\}\}/)
      expect(j.library.dimChip).toMatch(/\{\{count\}\}/)
    }
  })
})
