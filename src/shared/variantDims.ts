/**
 * R4 ⑤ · 变体维度（`dims`）的解析与展示判据。
 *
 * ## 为什么要有这个文件
 *
 * `variant` 表里一行一个 (kind, value)，界面上要的是"这张卡在哪些维度上不同、每个维度几份"。
 * 这份换算以前没地方放，只能塞进组件 —— 而本仓库渲染层零 DOM 测试，
 * 塞进组件的判据等于没有判据。所以收在这里，`AssetGrid` 只负责排版。
 *
 * ## 数据从哪来
 *
 * `summarizeGroups()`（`db/repos/product.ts`）是**全表展开 + 每组一次成员查询**，
 * 拿它喂卡片列表就是 5 万条时的 N+1。所以卡片上的 dims 走**卡片 SQL 里一条相关子查询**
 * （`asset.ts` 的 `CARD_SELECT` 里那列 `variant_dims`）：只算这一页要显示的那几十张卡，
 * 用的还是 `idx_variant_group`。`assets:groups` 那条老接口留着给"按组看全部"，
 * 但列表页不许再拿它当数据源。
 */

/**
 * 分隔符用两个控制字符而不是 `|`：`variant_value` 里带 `|` 是真有的（版本号、路径片段），
 * 拿 `|` 当分隔符会把一条拆成两条，表现是"11 个体型数出 13 个"。
 */
export const DIM_KV_SEP = '\u001f'
export const DIM_REC_SEP = '\u001e'

/** 一个维度：kind 是 `variant.variant_kind`，values 已去重。类型住在 types.ts，两边共用一份 */
import type { VariantDim } from './types'

export type { VariantDim }

/** SQL 里 `group_concat(kind||KV||value, REC)` 出来的那一串 → 维度数组 */
export function parseVariantDims(blob: string | null | undefined): VariantDim[] {
  const raw = String(blob ?? '')
  if (!raw) return []
  const byKind = new Map<string, string[]>()
  for (const rec of raw.split(DIM_REC_SEP)) {
    if (!rec) continue
    const i = rec.indexOf(DIM_KV_SEP)
    /* 拆不出 kind 的（脏数据 / 以后加了第三种分隔符）整条丢掉，不许猜一个 kind 出来 */
    if (i <= 0) continue
    const kind = rec.slice(0, i)
    const value = rec.slice(i + 1)
    if (!value) continue
    const list = byKind.get(kind) ?? []
    if (!list.includes(value)) list.push(value)
    byKind.set(kind, list)
  }
  return sortDims(Array.from(byKind.entries()).map(([kind, values]) => ({ kind, values })))
}

/** 值多的维度排前面（那才是"这份和那份到底差在哪"的主要答案），同数按 kind 稳定排 */
export function sortDims(dims: VariantDim[]): VariantDim[] {
  return dims.slice().sort((a, b) => b.values.length - a.values.length || a.kind.localeCompare(b.kind))
}

/** `variant_kind` → 文案 key。未知 kind 落到 `other`，不许显示成 `variantKind.xyz` */
export const VARIANT_KINDS = ['avatar', 'install_method', 'version', 'locale', 'quest', 'other'] as const

export function variantDimLabelKey(kind: string): string {
  return (VARIANT_KINDS as readonly string[]).includes(kind) ? 'variantKind.' + kind : 'variantKind.other'
}

/** 卡片上最多列几个维度芯片，多的折进"+N" */
const MAX_CHIPS = 3
/** 提示语里最多列几个值 */
const MAX_VALUES_IN_TITLE = 6

export interface DimChip {
  kind: string
  /** i18n key（`variantKind.*`） */
  key: string
  count: number
  values: string[]
  /** 悬浮提示里那几个值 + 还有几个没列出来 */
  title: string
  hiddenValues: number
}

export interface DimChipSet {
  chips: DimChip[]
  /** 被 MAX_CHIPS 折掉的维度数（界面要写"+N"，不能悄悄少说） */
  more: number
  /** 一个维度都没剩下时说的那句（key + 参数） */
  emptyKey: string | null
}

/**
 * 卡片/列表行上的维度芯片。
 *
 * 三条判据都有用例钉着：
 *  1. **只有一条值的维度不显示** —— 那一维上大家一样，写出来是噪音（"版本 1"）；
 *  2. **容器卡上的 `version` 维度在徽章已经数过之后不再数一遍** ——
 *     `unitCount` 就是"能单独拿出来用的件数"（多数时候就是版本数），
 *     同一个数在一张卡上说两遍，用户会以为是两回事；
 *  3. 超过 `MAX_CHIPS` 个维度要显式说"+N"，不许悄悄截断。
 */
export function dimChips(
  dims: VariantDim[],
  opts: { isBundle?: boolean; unitCount?: number; maxChips?: number } = {}
): DimChipSet {
  const cap = opts.maxChips ?? MAX_CHIPS
  /** 排序在这里做一次（而不是靠调用方传进来的顺序）：两条数据源（卡片 SQL / `summarizeGroups`）谁排都可能漂 */
  const keep = sortDims(dims).filter((d) => d.values.length >= 2)
  const shown = keep.filter((d) => !(opts.isBundle && d.kind === 'version' && (opts.unitCount ?? 0) > 1))
  const chips = shown.slice(0, cap).map((d) => {
    const listed = d.values.slice(0, MAX_VALUES_IN_TITLE)
    const hiddenValues = d.values.length - listed.length
    return {
      kind: d.kind,
      key: variantDimLabelKey(d.kind),
      count: d.values.length,
      values: d.values,
      title: listed.join('、') + (hiddenValues > 0 ? ` +${hiddenValues}` : ''),
      hiddenValues
    }
  })
  const more = Math.max(0, shown.length - chips.length)
  /**
   * 没芯片时的两句话要分清：
   *  - 本来就没有多维信息（单件素材、或只有一条值的维度）→ **什么都不显示**。
   *    给每张卡都挂一句"无差异"是噪音，用户只会觉得界面啰嗦；
   *  - 有维度但被第 2 条判据压掉了（容器卡上的 version）→ 要说，
   *    不然用户会以为"这卡没有版本信息"，而它其实就写在角上的"N 个模型变体"里。
   */
  const suppressed = keep.length > 0 && shown.length === 0
  return { chips, more, emptyKey: suppressed ? 'library.dimSuppressed' : null }
}