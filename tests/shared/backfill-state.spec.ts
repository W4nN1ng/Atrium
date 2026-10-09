import { describe, it, expect } from 'vitest'
import { backfillRenderState } from '../../src/shared/backfillState'
import type { ModelBackfillPlan } from '../../src/shared/types'

/**
 * M6 ④ · 预览面板的"该画什么"。
 *
 * 这一份文件存在的理由就是他那句话：渲染层零 DOM 测试的根因不是缺 jsdom，
 * 而是逻辑漏进了 JSX。所以面板的所有分支都在这里算完，组件只剩映射。
 */

const plan = (over: Partial<ModelBackfillPlan> = {}): ModelBackfillPlan => ({
  candidates: [
    { name: 'Shinano', key: 'shinano', keywords: ['Shinano', 'shinano'], count: 14 },
    { name: 'Milfy', key: 'milfy', keywords: ['Milfy'], count: 7 }
  ],
  skipped: [],
  covered: 21,
  existing: [],
  ...over
})

describe('三种状态', () => {
  it('loading / plan 还没回来 → 只有标题和"正在数"，确认不可点', () => {
    const v = backfillRenderState(null, [], true)
    expect(v.phase).toBe('loading')
    expect(v.bodyKey).toBe('collections.backfillLoading')
    expect(v.confirmEnabled).toBe(false)
    expect(v.rows).toEqual([])
  })

  it('ready → 每行带勾选状态，正文写"将建 N 个、覆盖 M 条"', () => {
    const p = plan()
    const v = backfillRenderState(p, ['Shinano'], false)
    expect(v.phase).toBe('ready')
    expect(v.rows.map((r) => [r.name, r.picked])).toEqual([
      ['Shinano', true],
      ['Milfy', false]
    ])
    expect(v.bodyParams).toEqual({ count: 1, covered: 14 })
    expect(v.confirmEnabled).toBe(true)
  })

  it('一个候选时不给"全选/清空"（两个按钮点了没意义）', () => {
    const one = plan({ candidates: [plan().candidates[0]], covered: 14 })
    expect(backfillRenderState(one, ['Shinano'], false).showBulk).toBe(false)
    expect(backfillRenderState(plan(), ['Shinano'], false).showBulk).toBe(true)
  })

  it('一个都没勾 → 确认不可点（避免"点了个空"）', () => {
    const v = backfillRenderState(plan(), [], false)
    expect(v.confirmEnabled).toBe(false)
    expect(v.bodyParams).toMatchObject({ count: 0 })
  })
})

describe('空手而归必须说清为什么', () => {
  it('全都建过了 → 说"已经建过"，而不是"库里没有模型"', () => {
    const v = backfillRenderState(
      plan({ candidates: [], skipped: [{ value: 'Shinano', key: 'shinano', why: 'exists' }], covered: 0, existing: ['Shinano'] }),
      [],
      false
    )
    expect(v.phase).toBe('empty')
    expect(v.bodyKey).toBe('collections.backfillAllExist')
    expect(v.bodyParams).toEqual({ existing: 1 })
  })

  it('库里确实没有带模型信息的素材 → 指一条下一步（先入库/重新分析）', () => {
    const v = backfillRenderState(plan({ candidates: [], covered: 0 }), [], false)
    expect(v.bodyKey).toBe('collections.backfillEmpty')
  })

  it('跳过了通用值时单独提醒一句 —— 不说用户会以为漏了自己的素材', () => {
    const v = backfillRenderState(
      plan({ skipped: [{ value: 'UNIVERSAL', key: 'universal', why: 'generic' }] }),
      ['Shinano'],
      false
    )
    expect(v.skippedNote).toEqual({ key: 'collections.backfillSkippedGeneric', params: { count: 1 } })
  })
})
