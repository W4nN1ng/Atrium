import { describe, it, expect } from 'vitest'
import { validateCategories } from '../../src/main/services/categories'
import type { CategoryConfig } from '../../src/shared/types'

/**
 * R4 ④ · 分类表 `synonyms` 的校验。
 *
 * ⚠ 这里**不调 `saveCategories`**：它写的是 `resources/lexicon/categories.json`
 * （仓库里那份真的），测试调一次就把 426 条口语洗掉了。所以 `validate` 被单独导出了。
 */

const base = (): CategoryConfig => ({
  version: 1,
  categories: [
    {
      key: 'clothing',
      order: 1,
      label: { 'zh-CN': '服装', en: 'Clothing', ja: '衣装' },
      subcategories: [{ key: 'dress', label: { 'zh-CN': '连衣裙' } }]
    }
  ]
})

describe('validateCategories 对 synonyms 的处理', () => {
  it('去空格、去重、丢空串', () => {
    const cfg = base()
    cfg.categories[0].synonyms = [' 衣服 ', '衣服', '', '   ', '服 ']
    const out = validateCategories(cfg)
    expect(out.categories[0].synonyms).toEqual(['衣服', '服'])
  })

  it('没有 synonyms 字段就保持没有（不许凭空造一个空数组，那会让"改过没有"的判断变脏）', () => {
    const out = validateCategories(base())
    expect(out.categories[0].synonyms).toBeUndefined()
    expect(out.categories[0].subcategories[0].synonyms).toBeUndefined()
  })

  it('二级分类的那份也管（用户更常给二级起外号）', () => {
    const cfg = base()
    cfg.categories[0].subcategories[0].synonyms = ['洋装', '礼服']
    const out = validateCategories(cfg)
    expect(out.categories[0].subcategories[0].synonyms).toEqual(['洋装', '礼服'])
  })

  it('不是数组 → 抛（宁可报错也别静默丢掉用户写的词）', () => {
    const cfg = base() as unknown as { categories: Array<Record<string, unknown>> }
    cfg.categories[0].synonyms = '衣服,服装'
    expect(() => validateCategories(cfg)).toThrow(/必须是数组/)
  })

  it('里面混了非字符串 → 抛，并且说清是哪一条', () => {
    const cfg = base()
    cfg.categories[0].synonyms = ['衣服', 42 as unknown as string]
    expect(() => validateCategories(cfg)).toThrow(/非字符串/)
  })

  it('超长 / 超条数 → 抛（和 shared/synonymEdit.ts 的上限同一个数）', () => {
    const long = base()
    long.categories[0].synonyms = ['x'.repeat(25)]
    expect(() => validateCategories(long)).toThrow(/太长/)

    const many = base()
    many.categories[0].synonyms = Array.from({ length: 41 }, (_, i) => '词' + i)
    expect(() => validateCategories(many)).toThrow(/最多 40 条/)
  })

  it('单字**不**在这里拒（那是索引层的事，主进程拒了会让老数据存不回去）', () => {
    const cfg = base()
    cfg.categories[0].synonyms = ['服']
    expect(validateCategories(cfg).categories[0].synonyms).toEqual(['服'])
  })

  it('真分类表能原样通过校验（改坏 JSON 的人会在启动时立刻看到错误，而不是静默用旧缓存）', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../resources/lexicon/categories.json'), 'utf8'))
    const out = validateCategories(raw)
    expect(out.categories.length).toBe(raw.categories.length)
    expect(out.categories.find((c) => c.key === 'clothing')?.synonyms).toEqual(
      raw.categories.find((c: CategoryConfig['categories'][number]) => c.key === 'clothing').synonyms
    )
  })
})
