/**
 * 学习机制（第 2 份 §5.4）—— 用户修正一次，同类素材下次就该自动分对。
 *
 * 落库那半在 db/repos/journal.ts（recordCorrection / learningFor / tokensLearnedHard），
 * 这里只补"策略"：喂哪些 token、以及把表读成引擎要的 Map。
 */
import type { Db } from '../db'
import { recordCorrection, tokensLearnedHard, listLearning } from '../db/repos/journal'
import type { LearningRow } from './engine'
import type { Corpus } from '../fingerprint/corpus'
import type { Lexicon } from './lexicon'

/** 提示阈值：同一 token 被修正到同一分类 ≥3 次才开口（§5.4） */
export const ANNOUNCE_AFTER = 3

export interface LearnInput {
  corpus: Corpus
  /** 传了才会把"包内路径里命中词典的词"也收进来（§5.4 的①） */
  lex?: Lexicon
  newCategory: string
  newSubcategory: string | null
  oldCategory?: string | null
  oldSubcategory?: string | null
}

/**
 * 不该学的 token。
 *
 * 规格写的是"文件名/目录名切出的全部 token"，照做会出事：'Grimoir_SHINANO_v1.zip'
 * 里的 v1 / zip 也会被学成规则，之后**任何**带 v1 的素材都被带到同一个分类去
 * （单测实测：一个毫不相干的 Unrelated_Pack_v1 被判成了表情类）。
 * 所以版本号、纯数字、扩展名、以及"set/pack/素材"这种到处都有的泛词一律不学。
 */
const STOP_TOKENS = new Set([
  'zip','rar','7z','tar','gz','unitypackage','psd','png','jpg','jpeg','tga','bmp','gif','webp',
  'ver','version','v','rev','upd','final','beta','new','old','set','pack','bundle','data',
  'asset','assets','素材','文件','文件夹','其他','其它','合集','套装','完整版','汉化版',
  'the','and','for','with','x','o'
])
const JUNK_TOKEN_RE = /^v?\d/i
const NO_LETTER_RE = /^[^\p{L}぀-ヿ㐀-䶿一-鿿]+$/u

export function isLearnable(term: string): boolean {
  const t = term.trim().toLowerCase()
  if (t.length < 2) return false
  if (STOP_TOKENS.has(t)) return false
  if (JUNK_TOKEN_RE.test(t)) return false
  if (NO_LETTER_RE.test(t)) return false
  // 混了数字的短词（'pcs2'、'v27'）多半是版本号尾巴，不稳
  if (/\d/.test(t) && t.length <= 4) return false
  return true
}

/**
 * 该学哪些 token —— 按 §5.4 的原话严格来：
 *   ① 语料里在词典中命中过的 token（任何来源）
 *   ② 文件名 / 目录名切出来的全部 token
 * 包内路径（entry）里没命中词典的碎片**不学**：那是 'bin'、'0001'、'tex' 之类的垃圾，
 * 学进去等于给全库埋规则（实测 'a.bin' 被学走之后，一个不相干的 c.bin 素材也被带偏）。
 * readme 里的普通词同样不学：一句"这个插件很好用"里的字不该变成规则。
 */
export function tokensToLearn(corpus: Corpus, lex?: Lexicon): string[] {
  const out = new Set<string>()
  for (const t of corpus.tokens) {
    if (!isLearnable(t.term)) continue
    if (t.where === 'readme') continue
    if (t.where === 'dir' || t.where === 'file') {
      out.add(t.term)
      continue
    }
    if (lex?.lookup(t.term)) out.add(t.term)
  }
  return Array.from(out)
}

export function learnFromCorrection(
  db: Db,
  input: LearnInput
): { touched: number; learnedRules: number; announce: boolean } {
  const tokens = tokensToLearn(input.corpus, input.lex)
  const r = recordCorrection(db, {
    tokens,
    newCategory: input.newCategory,
    newSubcategory: input.newSubcategory,
    oldCategory: input.oldCategory,
    oldSubcategory: input.oldSubcategory
  })
  const hard = tokensLearnedHard(db).filter((row) => row.hits >= ANNOUNCE_AFTER)
  return { touched: r.touched, learnedRules: r.learnedRules, announce: hard.length > 0 }
}

/** 引擎要的索引：token → 行数组 */
export function learningMap(db: Db, limit = 5000): Map<string, LearningRow[]> {
  const map = new Map<string, LearningRow[]>()
  for (const row of listLearning(db, limit)) {
    const list = map.get(row.token) ?? []
    list.push({ token: row.token, category: row.category, subcategory: row.subcategory ?? null, weight: row.weight, hits: row.hits ?? 0 })
    map.set(row.token, list)
  }
  return map
}

/** 设置页"查看/编辑/删除已学规则"用 */
export function listLearnedRules(db: Db, limit = 500): LearningRow[] {
  return listLearning(db, limit).map((r) => ({
    token: r.token,
    category: r.category,
    subcategory: r.subcategory ?? null,
    weight: r.weight,
    hits: r.hits ?? 0
  }))
}

/** 待确认队列顶部那句提示的数据（文案在渲染进程拼，这里只给数字） */
export function learnedHint(db: Db): { rules: number; token: string; category: string; subcategory: string | null } | null {
  const hard = tokensLearnedHard(db).filter((r) => r.hits >= ANNOUNCE_AFTER)
  if (!hard.length) return null
  const top = hard.sort((a, b) => b.hits - a.hits)[0]
  return {
    rules: hard.length,
    token: top.token,
    category: top.category,
    subcategory: top.subcategory ?? null
  }
}
