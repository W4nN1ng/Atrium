/**
 * M6 ④ · 「按库里出现过的模型补建集合」的候选计算（**纯函数**）
 *
 * ## 为什么这一条是 M6 的第一入口
 *
 * 他自己核出来的隐患 A：真库 `collection` 表 **0 行**，而 Q2 裁定是"命中才建"。
 * 两个凑一起就是循环依赖 —— 没有集合 → 匹配不到 → 不会命中 → 永远不建集合 →
 * 自动切换在真库上**无从演示也无从验收**。所以补建必须排在横幅之前能用。
 *
 * ## 为什么不照规格"给词典每个模型都建一个"
 *
 * 实测：内置词典 avatar 维 **90 条**，而他真库出现过的模型去重后只有约 **20 个**
 * （`UNIVERSAL` 一个人就占了 78 行，它根本不是模型名）。90 个空集合会把侧栏淹掉。
 * 数据源因此换成**库里真实出现过的** `variant(variant_kind='avatar')`。
 *
 * ## 三条口径
 *
 *  1. **大小写归一**：`Shinano` / `SHINANO` 是同一个模型，合并计数，显示名取出现最多的那种写法；
 *  2. **通用值不算模型**（`UNIVERSAL` / `共通` / `汎用` / `all purpose`…）；
 *  3. **关键词要能匹配上工程指纹**：除了显示名，还把归一化形式与拼音/罗马字一起塞进 `keywords`，
 *     否则"集合建好了但永远匹配不上"就是白建。归一化一律走 `normalize.ts` 的 `fold`。
 */
import { fold, searchForms } from './normalize'
import type { ModelCandidate, ModelRow, SkippedModel } from './types'
import { splitTokens, stripToKey, usableToken } from './projectMatch'




/**
 * 这些值不是模型名。`UNIVERSAL` 在他库里 78 行，是"所有体型通用"的意思 ——
 * 建成集合的话，任何工程都能匹配上它，那比不建更糟。
 */
const GENERIC = new Set([
  'universal',
  'all',
  'allpurpose',
  'common',
  'generic',
  'shared',
  '共通',
  '汎用',
  '通用',
  '全部',
  '所有体型'
])

/** 归一化键：小写 + 全角折半角 + 去符号（和匹配那边同一把尺子，走同一个 `stripToKey`） */
export function modelKey(value: string): string {
  return stripToKey(String(value ?? ''))
}

/**
 * 一个模型值 → 该塞进 keywords 的几种写法。
 *
 * 显示名原样进（用户看得懂），再加归一化键 + 拼音/罗马字那几种摊平形式，
 * 这样工程叫 `信奈工坊` 而库里写的是 `Shinano` 时也照样命中。
 */
export function keywordsFor(displayName: string): string[] {
  const out: string[] = []
  const push = (s: string): void => {
    const v = String(s ?? '').trim()
    if (v && !out.includes(v)) out.push(v)
  }
  push(displayName)
  const k = modelKey(displayName)
  if (k) push(k)
  for (const form of searchForms(displayName).all) {
    for (const piece of splitTokens(form)) {
      const p = piece.trim().toLowerCase()
      /** 短词不进关键词：`a` / `av` 这种会咬住一片工程（M5-B 的 tokenHits 同一条纪律） */
      if (p && usableToken(p)) push(p)
    }
  }
  return out
}

/**
 * 同一个模型的多种写法里，该拿哪一个当集合名。
 *
 * 先比出现次数（多的是用户真正在用的写法）；**平票时不取"库里第一条"** ——
 * 那样结果取决于 SQL 的返回顺序，同一份库跑两次可能叫两个名字，
 * 而"已经建过就没有"的判据也依赖这个名字（实测平票时选到了 `SHINANO`，
 * 于是 `Shinano` 那条永远算"没建过"）。
 * 平票的次序：正常大小写 > 全大写 > 字典序。全大写基本只会是顺手敲的重复写法。
 */
export function betterDisplayName(candidate: string, candidateCount: number, current: string, currentCount: number): boolean {
  if (candidateCount !== currentCount) return candidateCount > currentCount
  const candidateShouts = /^[A-Z0-9 ._-]+$/.test(candidate)
  const currentShouts = /^[A-Z0-9 ._-]+$/.test(current)
  if (candidateShouts !== currentShouts) return !candidateShouts
  return candidate < current
}

/**
 * 算出该补建哪些集合。
 *
 * @param rows 库里 `variant(variant_kind='avatar')` 的去重值与计数
 * @param existingNames 已经存在的集合名（按归一化键比，不按字面 —— `Shinano` 已建过就不再建）
 */
export function modelCandidates(rows: ModelRow[], existingNames: string[] = []): {
  candidates: ModelCandidate[]
  skipped: SkippedModel[]
} {
  const existing = new Set(existingNames.map(modelKey).filter(Boolean))
  /** 同一个 key 的多种写法合并：计数相加，显示名取计数最大的那种 */
  const grouped = new Map<string, { best: string; bestCount: number; total: number }>()
  const skipped: SkippedModel[] = []

  for (const row of rows ?? []) {
    const value = String(row?.value ?? '').trim()
    if (!value) continue
    const key = modelKey(value)
    const count = Number(row.count) || 0
    if (!key) {
      skipped.push({ value, key, why: 'tooShort' })
      continue
    }
    if (GENERIC.has(key)) {
      skipped.push({ value, key, why: 'generic' })
      continue
    }
    /** 短到没资格当关键词的值（`豆` 这种单字）也不建：建出来会咬住一片工程 */
    if (!usableToken(key)) {
      skipped.push({ value, key, why: 'tooShort' })
      continue
    }
    if (existing.has(key)) {
      skipped.push({ value, key, why: 'exists' })
      continue
    }
    const g = grouped.get(key)
    if (!g) grouped.set(key, { best: value, bestCount: count, total: count })
    else {
      g.total += count
      if (betterDisplayName(value, count, g.best, g.bestCount)) {
        g.best = value
        g.bestCount = count
      }
    }
  }

  const candidates = Array.from(grouped.entries())
    .map(([key, g]) => ({ name: g.best, key, keywords: keywordsFor(g.best), count: g.total }))
    /** 命中多的排前面：用户扫一眼就能看到"最值得建的那几个" */
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return { candidates, skipped }
}

/** 预览那一句「将建 N 个集合，覆盖 M 条素材」里的 M */
export function totalCovered(candidates: ModelCandidate[]): number {
  return candidates.reduce((a, c) => a + c.count, 0)
}
