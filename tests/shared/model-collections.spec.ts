import { describe, it, expect } from 'vitest'
import { keywordsFor, modelCandidates, modelKey, totalCovered } from '../../src/shared/modelCollections'
import { matchProject } from '../../src/shared/projectMatch'
import type { ModelRow } from '../../src/shared/types'

/**
 * M6 ④ · 补建集合的候选计算。
 *
 * 数据形状照他真库实测的那批来（`variant(avatar)` 31 个值，`UNIVERSAL` 一个人占 78 行，
 * 同一模型还有 `Shinano` / `SHINANO` 两种写法）。
 */
const row = (value: string, count: number): ModelRow => ({ value, count })

describe('modelKey / keywordsFor', () => {
  it('大小写、空格、符号都不该分出两个模型', () => {
    expect(modelKey('SHINANO')).toBe(modelKey('Shinano'))
    expect(modelKey('信奈 工坊')).toBe(modelKey('信奈工坊'))
    expect(modelKey('  Milky!! ')).toBe('milky')
  })

  it('关键词把"原写法 + 归一化 + 拼音/罗马字"都塞进去，短词不进', () => {
    const k = keywordsFor('Shinano')
    expect(k).toContain('Shinano')
    expect(k).toContain('shinano')
    expect(keywordsFor('信奈')).toEqual(expect.arrayContaining(['信奈', 'xin', 'nai', 'xinnai']))
    /** 单字/双字母那种会咬住一片工程的写法不许进关键词 */
    expect(keywordsFor('ab')).toEqual(['ab'])
    expect(keywordsFor('ab')).not.toContain('a')
  })
})

describe('modelCandidates', () => {
  it('合并大小写重复，计数相加，显示名取出现最多的那种写法', () => {
    const { candidates } = modelCandidates([row('Shinano', 14), row('SHINANO', 2)])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].name).toBe('Shinano')
    expect(candidates[0].count).toBe(16)
  })

  it('平票时不取全大写那种（否则显示名取决于 SQL 返回顺序，同一份库两次能建出两个名字）', () => {
    const upperFirst = modelCandidates([row('SHINANO', 1), row('Shinano', 1)])
    const lowerFirst = modelCandidates([row('Shinano', 1), row('SHINANO', 1)])
    expect(upperFirst.candidates.map((c) => c.name)).toEqual(['Shinano'])
    expect(lowerFirst.candidates.map((c) => c.name)).toEqual(['Shinano'])
  })

  it('UNIVERSAL 这类通用值不建集合，但要留痕（不解释用户会以为漏了）', () => {
    const { candidates, skipped } = modelCandidates([row('UNIVERSAL', 78), row('Shinano', 14)])
    expect(candidates.map((c) => c.name)).toEqual(['Shinano'])
    expect(skipped).toEqual([{ value: 'UNIVERSAL', key: 'universal', why: 'generic' }])
  })

  it('中文通用值同样拦掉（共通 / 汎用 / 通用 都不是模型名）', () => {
    const { candidates, skipped } = modelCandidates([row('共通', 30), row('汎用', 5), row('信奈', 3)])
    expect(candidates.map((c) => c.name)).toEqual(['信奈'])
    expect(skipped.map((s) => s.why)).toEqual(['generic', 'generic'])
  })

  it('短到不能当匹配依据的值不建（建出来会咬住一片工程）', () => {
    const { candidates, skipped } = modelCandidates([row('豆', 9), row('Moe', 4)])
    expect(candidates.map((c) => c.name)).toEqual(['Moe'])
    expect(skipped[0]).toMatchObject({ value: '豆', why: 'tooShort' })
  })

  it('已经建过的集合不重复建（按归一化键比，不按字面）', () => {
    const { candidates, skipped } = modelCandidates([row('Shinano', 14)], ['SHINANO '])
    expect(candidates).toHaveLength(0)
    expect(skipped[0]).toMatchObject({ key: 'shinano', why: 'exists' })
  })

  it('命中多的排前面；同数按名字（预览要让人一眼看到最值得建的那几个）', () => {
    const { candidates } = modelCandidates([row('Zebra', 3), row('Alpha', 3), row('Milfy', 9)])
    expect(candidates.map((c) => c.name)).toEqual(['Milfy', 'Alpha', 'Zebra'])
  })

  it('空输入 / 脏输入都不炸', () => {
    expect(modelCandidates([], []).candidates).toEqual([])
    const r = modelCandidates([row('   ', 5), { value: null, count: 3 } as unknown as ModelRow, row('Lime', 2)])
    expect(r.candidates.map((c) => c.name)).toEqual(['Lime'])
  })

  it('totalCovered 只数候选里的（被跳过的通用值那 78 条不该混进来）', () => {
    const { candidates } = modelCandidates([row('UNIVERSAL', 78), row('Shinano', 14), row('Milfy', 7)])
    expect(totalCovered(candidates)).toBe(21)
  })

  it('建出来的关键词真的能让匹配命中（补建和匹配必须闭环）', () => {
    const { candidates } = modelCandidates([row('Shinano', 14)])
    const r = matchProject(
      { dirName: 'shinano-Main2', topFolders: [], installedPackages: [], avatarDescriptors: [] },
      [{ id: 'c1', name: candidates[0].name, rule: { keywords: candidates[0].keywords, matchMode: 'any', priority: 10 } }]
    )
    expect(r.kind).toBe('hit')
  })
})
