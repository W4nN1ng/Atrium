/**
 * R4 ④ · 查询侧的分类口语展开（搜 `衣服` → 拿到归在「服装」下的卡）。
 *
 * ## 为什么不把同义词拼进每条素材的别名
 *
 * 第一版就是那么做的（`buildAliases` 把 `synonyms` 折进 `category` 字段）。
 * 5 万素材实测：别名从 159.7 万涨到 206.4 万（+29%），一次性重建 23.3s → 28.6s，
 * 增量重建 0.469 → 0.584ms/条 —— 把 `tests/perf/scale.spec.ts` 那条 0.6 的闸吃到只剩 3%，
 * 而这台机器上同一条断言的噪声本来就有 ±50%（实测 0.584 与 0.901 都出现过）。
 * 更关键的是那 47 万条新别名**每个分类内完全一样**：一张卡的分类别名就是它所属分类那十几条词，
 * 存 5 万遍不产生任何信息 —— 真正的新知识只有"哪个口语属于哪个分类"这一份。
 *
 * 所以改成：知识存一份（下面这张表），查询时把用户输入映射到**该分类的标签原文**，
 * 而标签本来就在每条素材的 `category` 字段里（`buildAliases` 一直这么写）。
 * 召回一样、精度一样（二级口语映射到二级标签，不是映射到一级），索引一个字节都不多。
 *
 * ## 为什么表里连拼音/罗马字都展开好
 *
 * 用户输 `yifu` 时 `searchForms('yifu')` 不会倒推出汉字"衣服"（那是 M4-1 明确不收的依赖），
 * 但索引侧一直是"汉字 → 拼音"这个方向。所以键必须是**展开后的写法**，
 * 这样 `yifu` / `衣服` / `クローズ` 任一种输入都能查到「服装」。
 */
import type { CategoryConfig } from './types'
import { searchForms } from './normalize'

/** 一个口语最多映射到几个分类的标签（防止有人把"其他"写成万能词，一搜把全库捞出来） */
const MAX_NODES_PER_WORD = 6

/**
 * `分类表里的一个写法` → `该分类的标签原文（zh-CN / en / ja）`。
 *
 * 值是标签，不是 key —— key 只有 `clothing` 这一种写法，而素材里存的是三语标签全套；
 * 映射到标签才能既命中中文卡也命中英文卡，并且**二级的口语只捞二级**（不会把整个服装类拖出来）。
 */
export type CategoryExpansion = Map<string, string[]>

/** 建表。109 个节点 × 十几条词 × 全套写法，量级几千条，每次重建算一遍不心疼 */
export function buildCategoryExpansion(cfg: CategoryConfig): CategoryExpansion {
  const out: CategoryExpansion = new Map()
  const put = (form: string, labels: string[]): void => {
    const k = form.trim().toLowerCase()
    if (k.length < 2) return
    const cur = out.get(k)
    if (!cur) {
      out.set(k, labels)
      return
    }
    if (cur.length >= MAX_NODES_PER_WORD * 3) return
    for (const l of labels) if (!cur.includes(l)) cur.push(l)
  }
  const formsOf = (w: string): string[] => searchForms(w).all
  for (const c of cfg.categories) {
    const catLabels = Object.values(c.label).filter(Boolean)
    /** 一级：key + 三语标签 + 一级口语 → 都映射到这一级的标签 */
    for (const w of [c.key, ...catLabels, ...(c.synonyms ?? [])]) for (const f of formsOf(w)) put(f, catLabels)
    for (const s of c.subcategories) {
      const subLabels = Object.values(s.label).filter(Boolean)
      /** 二级：口语只映射到**二级标签**，精度和不走展开时一致 */
      for (const w of [s.key, ...subLabels, ...(s.synonyms ?? [])]) for (const f of formsOf(w)) put(f, subLabels)
    }
  }
  return out
}

/**
 * 用户输入 → 该顺带再查一遍的标签串。
 *
 * 只认**整词相等**，不做前缀：`shina` 不该被当成 `shinano` 去展开分类 ——
 * 前缀匹配是索引那一层的事，这里再叠一层只会把不相干的分类拖进来。
 */
export function expandCategoryLabels(query: string, table: CategoryExpansion): string[] {
  const out: string[] = []
  for (const form of searchForms(query).all) {
    const hit = table.get(form.trim().toLowerCase())
    if (!hit) continue
    for (const l of hit) if (!out.includes(l)) out.push(l)
  }
  return out
}
