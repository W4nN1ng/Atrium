/**
 * 「待复核」的出口判据（第 9 轮 ①，A1+A2）。
 *
 * ## 为什么这件事要有个单独的文件
 *
 * `needs_review` 是 2026-10-05（R2d）加的：入库时置信度低于自动归档线就打标，
 * 侧栏「待复核」按它计数。但**清掉它的唯一一颗按钮长在 `BundleDetail.tsx:437`** ——
 * 合集详情的成员列表里。单卡的右侧面板一个控件都没有，改分类也不清。
 * 于是对单卡来说"待复核"是个进得去、出不来的状态，而 README 和 Release 正文里
 * 都写着"没把握的进待复核**等你看一眼**"。这个文件就是把"看过之后怎么算数"写清楚。
 *
 * 本仓库零 DOM 测试，所以判据必须落在这里 —— 留在组件里等于没测。
 *
 * ## 三条口径（2026-10-10 他批的）
 *
 *  - **Q1 乙**：改了分类**不**自动清标记，只把按钮提亮并提示一句。
 *    理由在 `src/main/ipc/assets.ts` 那段注释里写着：「分类改动」和「我看过了没错」是两个意图，
 *    搅在一起会把"我随手改了个分类"当成"我确认这堆都没问题"。
 *  - **Q2 甲**：给批量出口（多选 + 这一屏全部），但必须二次确认、并且**把条数说清楚** ——
 *    条数只能来自"真的会变的行数"，不许拿 `selection.length` 凑（选到已经是"看过"的卡时那两个数不一样）。
 *  - **Q3 乙**：这一轮不进撤销账（`journal`），只做"再点一次取消标记"。
 *    它是元数据不是文件动作，进 journal 要连 `lastRevertible` 的 op 白名单一起改，风险大于收益。
 */

/** 一张卡上跟"复核"有关的最小事实 */
export interface ReviewableCard {
  id: string
  needsReview: boolean
  /** 合集卡自己不算 —— 它有专属的那颗批量按钮（`BundleDetail.tsx`），两条路别叠在一起 */
  isBundle: boolean
  /** 附属资源（介绍图 / 演示视频 / 说明文档）跟着主体走，不单独复核 */
  attachment?: boolean
}

/** 点一下要表达的两件事：我看过了没问题 / 我还没看，重新排进去 */
export type ReviewIntent = 'done' | 'open'

/**
 * 单卡详情面板上那颗控件的完整决定。
 *
 * 三种形状，故意给两种强度：
 *  - 待复核的普通卡 → `prominent`：主按钮「标记已复核」，`hint` 还会因为分类刚被改过而提亮；
 *  - 已经看过的普通卡 → 不 prominent，只给一条次要链接「重新排进待复核」——
 *    Q3 乙说"反悔的方式是再点一次"，那这条路必须真存在，但也不该在每张卡上都喊话；
 *  - 合集卡与附属 → `show:false`。前者有自己的批量控件（`BundleDetail.tsx:437`），
 *    同一个意图两个入口 = 以后必然漂走一处；后者跟着主体走，单独复核等于让用户数两遍。
 */
export function singleReviewAction(
  c: ReviewableCard | null | undefined,
  categoryDirty = false
): { show: boolean; intent: ReviewIntent; prominent: boolean; hint: 'none' | 'idle' | 'hint' } {
  const off = { show: false, intent: 'done' as ReviewIntent, prominent: false, hint: 'none' as const }
  if (!c || c.isBundle || c.attachment) return off
  const intent: ReviewIntent = c.needsReview ? 'done' : 'open'
  return {
    show: true,
    intent,
    prominent: c.needsReview,
    hint: c.needsReview ? (categoryDirty ? 'hint' : 'idle') : 'none'
  }
}

/**
 * 一次操作真正会改到的行。
 *
 * `intent='done'` 只挑当前**是**待复核的；`'open'` 只挑当前**不是**的。
 * 这个过滤不是洁癖：不过滤的话"标记已复核"会把一张本来干净的卡的 `updated_at` 也刷一遍，
 * 列表按更新时间排序就会跳，用户会以为程序动了他的东西。
 */
export function reviewTargets(cards: ReviewableCard[], intent: ReviewIntent): string[] {
  const want = intent === 'done'
  return cards.filter((c) => !c.isBundle && !c.attachment && !!c.needsReview === want).map((c) => c.id)
}

/**
 * 工具栏那颗「标记已复核（N）」要不要出现。
 *
 * `onReviewScreen` 是"当前就在待复核视图"。为什么绑视图而不绑选中数：
 * 在别的视图里选中一堆卡也长出这颗按钮，用户会以为"待复核"是个可以被批量抹掉的过滤器，
 * 而不是一个需要逐条看过的状态。
 *
 * `selected >= 2` 而不是 `> 0`：只选一张时，右侧详情面板已经有那颗了，
 * 工具栏再摆一颗就是同一个意图两个入口（和 R4 ② 那颗批量导入按钮同一口径 —— 它也是 `> 1` 才出）。
 */
export function showBatchReview(o: { onReviewScreen: boolean; selected: number; targets: number }): boolean {
  return o.onReviewScreen && o.selected >= 2 && o.targets > 0
}

/** 「这一屏全部」那颗：只在待复核视图、且这一屏确实有待复核行时才出（Q2 甲） */
export function showReviewAllOnScreen(o: { onReviewScreen: boolean; targets: number }): boolean {
  return o.onReviewScreen && o.targets > 0
}

/**
 * 二次确认里那句"要把 N 条标成已复核"的 N。
 * 单独一个函数是为了让"不许拿选中数凑"这条有地方放断言。
 */
export function reviewConfirmCount(targets: number): number {
  return Math.max(0, Math.trunc(targets))
}

/** 侧栏计数往下掉多少：只数真的被改掉的行 */
export function reviewCountDelta(targets: number, intent: ReviewIntent): number {
  const n = reviewConfirmCount(targets)
  return intent === 'done' ? -n : n
}
