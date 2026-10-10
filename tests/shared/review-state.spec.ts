import { describe, expect, it } from 'vitest'
import {
  reviewConfirmCount,
  reviewCountDelta,
  reviewTargets,
  showBatchReview,
  showReviewAllOnScreen,
  singleReviewAction,
  type ReviewableCard
} from '../../src/shared/reviewState'

/**
 * 第 9 轮 ① · 「待复核」出口的判据。
 *
 * 这一组用例防的是同一件事：**59 条待复核里绝大多数是单卡，而单卡根本没有出口**
 * （清标记那颗按钮长在合集详情里）。所以下面每条都对应界面上一个真实动作，
 * 不是把实现读一遍。
 */

const card = (over: Partial<ReviewableCard> & { id: string }): ReviewableCard => ({
  needsReview: true,
  isBundle: false,
  ...over
})

describe('singleReviewAction · 单卡详情面板那颗控件', () => {
  it('待复核的普通卡 → 出主按钮，意图是"标成已复核"', () => {
    const a = singleReviewAction(card({ id: 'x' }))
    expect(a).toMatchObject({ show: true, intent: 'done', prominent: true, hint: 'idle' })
  })

  it('⭐ 已经看过的普通卡 → 只给次要链接"重新排进待复核"（Q3 乙说的反悔方式必须真存在）', () => {
    const a = singleReviewAction(card({ id: 'x', needsReview: false }))
    expect(a).toMatchObject({ show: true, intent: 'open', prominent: false })
  })

  it('⭐ 合集卡 → 完全不出。它有自己的批量控件（BundleDetail），同一个意图不许两个入口', () => {
    expect(singleReviewAction(card({ id: 'x', isBundle: true })).show).toBe(false)
    expect(singleReviewAction(card({ id: 'x', needsReview: false, isBundle: true })).show).toBe(false)
  })

  it('附属资源 → 不出。它跟着主体走，单独复核等于让用户数两遍', () => {
    expect(singleReviewAction(card({ id: 'x', attachment: true })).show).toBe(false)
  })

  it('没选中东西 → 不出，不抛', () => {
    expect(singleReviewAction(null).show).toBe(false)
    expect(singleReviewAction(undefined).show).toBe(false)
  })

  it('Q1 乙：改了分类**不**自动清标记，只把提示提到 hint 一档', () => {
    const clean = singleReviewAction(card({ id: 'x' }), false)
    const dirty = singleReviewAction(card({ id: 'x' }), true)
    expect(clean.hint).toBe('idle')
    expect(dirty.hint).toBe('hint')
    /** 两档的意图都还是"等用户点"，绝不因为改了分类就替他判定看过 */
    expect(dirty.intent).toBe('done')
    expect(dirty.show).toBe(true)
  })

  it('没在待复核的卡就算改过分类也不催（hint 保持 none）', () => {
    expect(singleReviewAction(card({ id: 'x', needsReview: false }), true).hint).toBe('none')
  })
})

describe('reviewTargets · 一次点下去到底改了哪几行', () => {
  const cards = [
    card({ id: 'r1' }),
    card({ id: 'r2' }),
    card({ id: 'clean', needsReview: false }),
    card({ id: 'bundle', isBundle: true }),
    card({ id: 'att', attachment: true })
  ]

  it('标记已复核 → 只挑当前真的是待复核的那几张', () => {
    expect(reviewTargets(cards, 'done')).toEqual(['r1', 'r2'])
  })

  it('反过来（重新排进待复核）→ 只挑当前不是的', () => {
    expect(reviewTargets(cards, 'open')).toEqual(['clean'])
  })

  it('⭐ 合集与附属一律不参与 —— 它们各自的复核走各自那条路', () => {
    expect(reviewTargets(cards, 'done')).not.toContain('bundle')
    expect(reviewTargets(cards, 'done')).not.toContain('att')
    expect(reviewTargets(cards, 'open')).not.toContain('bundle')
  })

  it('全空 → 空数组而不是 undefined（调用方要拿它判"要不要弹确认框"）', () => {
    expect(reviewTargets([card({ id: 'clean', needsReview: false })], 'done')).toEqual([])
  })
})

describe('工具栏两颗按钮的出现条件', () => {
  it('在待复核视图、选了 2 张、其中 2 张是待复核 → 批量那颗出', () => {
    expect(showBatchReview({ onReviewScreen: true, selected: 2, targets: 2 })).toBe(true)
  })

  it('⭐ 选了 3 张但一张都不是待复核 → 不出（没有可改的行就别摆按钮）', () => {
    expect(showBatchReview({ onReviewScreen: true, selected: 3, targets: 0 })).toBe(false)
  })

  it('⭐ 不在待复核视图（全部素材 / 收件箱）→ 即使选中了也不出', () => {
    expect(showBatchReview({ onReviewScreen: false, selected: 5, targets: 5 })).toBe(false)
  })

  it('⭐ 一个都没选 → 不出（哪怕这一屏全是待复核）', () => {
    /**
     * 原来这条写的是 `targets: 0`，变异回扫（A5b）发现它**测不到东西**：
     * 把"选了几张"那道条件整条删掉，它照样绿 —— 因为 targets=0 那边已经把它拦下了。
     * 真正会被这个漏洞伤到的场景是"一屏都是待复核、用户一张没选"，所以喂 targets:3。
     */
    expect(showBatchReview({ onReviewScreen: true, selected: 0, targets: 3 })).toBe(false)
  })

  it('⭐ 只选了一张 → 不出。详情面板那颗已经在了，工具栏再摆一颗就是同一个意图两个入口', () => {
    expect(showBatchReview({ onReviewScreen: true, selected: 1, targets: 1 })).toBe(false)
  })

  it('「这一屏全部」：在待复核视图且这一屏有待复核行才出', () => {
    expect(showReviewAllOnScreen({ onReviewScreen: true, targets: 12 })).toBe(true)
    expect(showReviewAllOnScreen({ onReviewScreen: true, targets: 0 })).toBe(false)
    expect(showReviewAllOnScreen({ onReviewScreen: false, targets: 12 })).toBe(false)
  })
})

describe('确认框里的条数与侧栏计数', () => {
  it('⭐ 条数只来自"真的会变的行数"，负数与小数一律收掉', () => {
    expect(reviewConfirmCount(7)).toBe(7)
    expect(reviewConfirmCount(-3)).toBe(0)
    expect(reviewConfirmCount(2.9)).toBe(2)
  })

  it('标记已复核 → 侧栏计数往下掉，掉的就是改掉的行数', () => {
    expect(reviewCountDelta(5, 'done')).toBe(-5)
  })

  it('重新排进待复核 → 往上加', () => {
    expect(reviewCountDelta(2, 'open')).toBe(2)
  })
})
