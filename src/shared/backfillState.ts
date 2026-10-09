/**
 * M6 ④ · 补建集合预览面板的"该画什么"（**纯函数**）
 *
 * 为什么单独抽出来：这个仓库渲染层**零 DOM 测试**（vitest 是 node 环境，也没装 jsdom）。
 * 他的判断是根因不在缺 DOM，而在**逻辑漏进了 JSX** —— 所以分支判断全放这里，
 * 组件只做"把 state 映射成节点"这一件事，回归保护就带上了。
 * ⑤ 的横幅走同一条路（`shared/bannerState.ts`）。
 */
import type { ModelBackfillPlan, ModelCandidate } from './types'

/** 面板的三种状态：还没算完 / 没东西可建 / 有清单可确认 */
export type BackfillPhase = 'loading' | 'empty' | 'ready'

export interface BackfillRow {
  id: string
  name: string
  count: number
  keywords: string[]
  picked: boolean
}

export interface BackfillRenderState {
  phase: BackfillPhase
  /** 标题与正文的 i18n key + 参数（渲染进程只 `t(key, params)`，不拼句子） */
  titleKey: string
  bodyKey: string | null
  bodyParams: Record<string, string | number> | null
  rows: BackfillRow[]
  /** 「全选 / 清空」这类批量动作在预览里要不要出现（一个候选时没必要） */
  showBulk: boolean
  /** 确认按钮：只有"勾了东西"才可点 */
  confirmEnabled: boolean
  confirmParams: Record<string, string | number>
  /** 被跳过的值（UNIVERSAL 这类）要不要说明一句 —— 不说明用户会以为漏了 */
  skippedNote: { key: string; params: Record<string, number> } | null
}

/** 候选的排序键（名字）：让"勾了哪几个"与点击顺序一致，而不是按数据库返回顺序 */
export function candidateId(c: ModelCandidate): string {
  return c.name
}

export function backfillRenderState(
  plan: ModelBackfillPlan | null,
  picked: string[],
  loading = false
): BackfillRenderState {
  if (loading || !plan) {
    return {
      phase: 'loading',
      titleKey: 'collections.backfillTitle',
      bodyKey: 'collections.backfillLoading',
      bodyParams: null,
      rows: [],
      showBulk: false,
      confirmEnabled: false,
      confirmParams: { count: 0 },
      skippedNote: null
    }
  }
  const chosen = new Set(picked)
  const rows: BackfillRow[] = plan.candidates.map((c) => ({
    id: candidateId(c),
    name: c.name,
    count: c.count,
    keywords: c.keywords,
    picked: chosen.has(candidateId(c))
  }))
  if (!rows.length) {
    return {
      phase: 'empty',
      titleKey: 'collections.backfillTitle',
      /** 空手而归也要说清为什么：多半是库里还没有带模型标签的素材，或者全都建过了 */
      bodyKey: plan.skipped.some((s) => s.why === 'exists')
        ? 'collections.backfillAllExist'
        : 'collections.backfillEmpty',
      bodyParams: { existing: plan.existing.length },
      rows: [],
      showBulk: false,
      confirmEnabled: false,
      confirmParams: { count: 0 },
      skippedNote: null
    }
  }
  const count = picked.length
  const generic = plan.skipped.filter((s) => s.why === 'generic').length
  return {
    phase: 'ready',
    titleKey: 'collections.backfillTitle',
    bodyKey: 'collections.backfillSummary',
    bodyParams: { count, covered: plan.candidates.filter((c) => chosen.has(candidateId(c))).reduce((a, c) => a + c.count, 0) },
    rows,
    showBulk: rows.length > 1,
    confirmEnabled: count > 0,
    confirmParams: { count },
    /** UNIVERSAL 这类值一个人能占几十行，不说一句用户会来问"我的通用素材呢" */
    skippedNote: generic ? { key: 'collections.backfillSkippedGeneric', params: { count: generic } } : null
  }
}
