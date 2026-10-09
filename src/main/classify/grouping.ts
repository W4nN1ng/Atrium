/**
 * 资产归并（第 2 份 §3.2 / §3.3）—— 决定"哪些素材其实是同一个产品"。
 *
 * 四条判定，满足任一即归并：
 * ① groupKey 相同 且 一级分类相同
 * ② source_url 相同
 * ③ source_item_id（Booth id）相同
 * ④ groupKey 相同 且 除变体 token 外文件名完全一致
 *
 * 关键约束（用户点过名的）：Grimoir_Gimmick / Grimoir_Hat **不许**和 11 个模型版并成一张卡。
 * 这里靠 groupKey 天然区分：剥掉 avatar/version 之后剩 'grimoir gimmick' ≠ 'grimoir'，
 * 所以永远不沾边 —— 不靠任何"看着像就算"的模糊匹配。
 */
import type { VariantKind } from '../../shared/types'
import type { NameTokens, VariantDim } from './groupKey'
import { sameIgnoringVariants } from './groupKey'
import { normalizeDirKey } from '../../shared/pathkey'

export interface GroupableAsset {
  id: string
  rawName: string
  category: string
  sourceUrl: string | null
  sourceItemId: string | null
  groupKey: string
  tokens: NameTokens
  /**
   * 物理所在目录（§B2 安全保护第 3 条要用）。
   * 不传就不做歧义判定 —— 判"同一目录下 ≥3 个不同前缀"没有目录无从判起。
   */
  dir?: string | null
}

export interface VariantAssignment {
  assetId: string
  kind: VariantKind
  value: string
}

export interface GroupPlan {
  groupId: string
  groupKey: string
  category: string
  name: string
  memberIds: string[]
  variants: VariantAssignment[]
}

/** 并查集 */
class Disjoint {
  private parent = new Map<string, string>()
  find(x: string): string {
    let p = this.parent.get(x) ?? x
    if (p !== x) {
      p = this.find(p)
      this.parent.set(x, p)
    }
    return p
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}

function variantValueOf(t: NameTokens, dim: VariantDim): string {
  switch (dim) {
    case 'avatar':
      return t.avatar ?? ''
    case 'install_method':
      return t.installMethod ?? ''
    case 'version':
      return t.version ?? ''
    case 'locale':
      return t.locale ?? ''
    default:
      return ''
  }
}

const KINDS: VariantDim[] = ['avatar', 'install_method', 'version', 'locale', 'other']

/** 歧义判定的粒度：目录 + 归并键。没有目录信息的条目永不歧义（判不了） */
function ambKey(it: GroupableAsset): string {
  return (it.dir ?? '') + '\u0000' + it.groupKey
}

/**
 * 找出"这个 key 在这个目录里已经没有区分力"的组合。
 * 判据是 §B2 安全保护第 3 条：≥3 个条目、且括号外的前缀有 ≥3 种。
 */
export function ambiguousKeys(items: GroupableAsset[]): Set<string> {
  const byAmb = new Map<string, Set<string>>()
  for (const it of items) {
    if (!it.dir) continue
    if (!it.tokens.slotPrefixes.length) continue
    const k = ambKey(it)
    let set = byAmb.get(k)
    if (!set) {
      set = new Set()
      byAmb.set(k, set)
    }
    set.add(it.tokens.slotPrefixes[0])
  }
  const out = new Set<string>()
  for (const [k, prefixes] of byAmb) {
    if (prefixes.size < 3) continue
    const n = items.filter((it) => it.dir && ambKey(it) === k).length
    if (n >= 3) out.add(k)
  }
  return out
}

/**
 * 归并 + 变体标注。
 * 返回的 plan 只包含"确实多于一个成员"的组；单成员的组不进 plan（§3.3 自动解散）。
 */
export function planGroups(items: GroupableAsset[]): GroupPlan[] {
  const dsu = new Disjoint()
  for (const it of items) dsu.find(it.id)

  /**
   * §B2 安全保护第 3 条：**同一目录下 ≥3 个不同前缀塌成同一个 groupKey → 判歧义，不自动合并。**
   *
   * 括号内容整个从 key 里摘掉之后，key 的区分力全靠括号外那截前缀。
   * 一个目录里三件不同东西的前缀都被摘没了、剩下的 key 还一样，那这个 key 就是巧合，
   * 不是"同一产品的多个变体"。这种情况改成走 §B5 的建议流程，让用户点头才并。
   *
   * Libero 那 20 个不受影响：它们的前缀全是 `libero`，只有一个不同前缀。
   */
  const ambiguous = ambiguousKeys(items)

  const byKeyCat = new Map<string, string[]>()
  const byUrl = new Map<string, string[]>()
  const byItem = new Map<string, string[]>()

  /**
   * #40：**归并的前提是同一父容器（同目录），跨目录的 groupKey 相同不构成归并理由。**
   *
   * 真库实测到的事故形状：`贴图/脸部/4900077` 和 `贴图/lime/4900077` ——
   * 两个毫不相干的商品，名字都是 Booth id，归并键自然一模一样，于是被挂进同一组，
   * 界面上就是一张卡写着"2 变体"。这类组真库里有 13 个 / 27 行。
   *
   * 所以按 groupKey 的那两条判据（① 和 ④）都加一道目录：目录未知（老数据、
   * 没传 dir）时保持原行为，因为"判不了"不该变成"合不起"。
   * 但 ②source_url / ③source_item_id **不加**这道闸 —— 那是商品自己的身份证号，
   * 同一件商品在库里存了两份是用户真实会做的事，跨目录也要认。
   */
  const shelf = (it: GroupableAsset): string => normalizeDirKey(it.dir) ?? ''

  for (const it of items) {
    if (ambiguous.has(ambKey(it))) continue
    push(byKeyCat, `${shelf(it)}\u0000${it.groupKey}\u0000${it.category}`, it.id)
    if (it.sourceUrl) push(byUrl, it.sourceUrl, it.id)
    if (it.sourceItemId) push(byItem, it.sourceItemId, it.id)
  }

  // ①②③
  for (const m of [byKeyCat, byUrl, byItem]) {
    for (const ids of m.values()) {
      for (let i = 1; i < ids.length; i++) dsu.union(ids[0], ids[i])
    }
  }
  // ④ groupKey 相同且除变体外名字一致（①已经覆盖了 groupKey 相同的情况，
  //    这条留给"同 key 但一级不同"的边缘情形，按规格仍要并 —— 但同样要同目录）
  const byKey = new Map<string, GroupableAsset[]>()
  for (const it of items) {
    if (ambiguous.has(ambKey(it))) continue
    push(byKey, shelf(it) + '\u0000' + it.groupKey, it.id, it)
  }
  for (const list of byKey.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (sameIgnoringVariants(list[i].tokens, list[j].tokens)) dsu.union(list[i].id, list[j].id)
      }
    }
  }

  const clusters = new Map<string, GroupableAsset[]>()
  for (const it of items) {
    const root = dsu.find(it.id)
    const list = clusters.get(root) ?? []
    list.push(it)
    clusters.set(root, list)
  }

  const plans: GroupPlan[] = []
  for (const [root, members] of clusters) {
    if (members.length < 2) continue
    const variants: VariantAssignment[] = []
    for (const m of members) {
      // 找一个"能把它和兄弟区分开"的维度
      let assigned: VariantAssignment | null = null
      for (const dim of KINDS) {
        const value = variantValueOf(m.tokens, dim)
        if (!value) continue
        const sameOnDim = members.every((o) => variantValueOf(o.tokens, dim) === value)
        if (sameOnDim) continue
        assigned = { assetId: m.id, kind: dim as VariantKind, value }
        break
      }
      variants.push(assigned ?? { assetId: m.id, kind: 'other', value: m.rawName })
    }
    plans.push({
      groupId: root,
      groupKey: members[0].groupKey,
      category: members[0].category,
      name: members[0].tokens.core.join(' ') || members[0].groupKey,
      memberIds: members.map((m) => m.id),
      variants
    })
  }
  return plans.sort((a, b) => b.memberIds.length - a.memberIds.length)
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void
function push<K, V, X>(map: Map<K, X[]>, key: K, value: V, asWhat: X): void
function push(map: Map<unknown, unknown[]>, key: unknown, value: unknown, asWhat?: unknown): void {
  const list = (map.get(key) as unknown[] | undefined) ?? []
  list.push(asWhat === undefined ? value : asWhat)
  map.set(key, list)
}

/** 归并后 UI 显示用的摘要 */
export function groupSummary(plan: GroupPlan): { badge: string; byKind: Record<string, string[]> } {
  const byKind: Record<string, string[]> = {}
  for (const v of plan.variants) {
    byKind[v.kind] = byKind[v.kind] ?? []
    if (!byKind[v.kind].includes(v.value)) byKind[v.kind].push(v.value)
  }
  return { badge: plan.memberIds.length + ' 变体', byKind }
}
