/**
 * R4 ④ · 分类口语同义词的编辑判据（设置 → 分类）。
 *
 * 和 `rearchiveDialog.ts` 同一个理由：本仓库渲染层零 DOM 测试，
 * "这个词能不能加、加了会不会白加"这种判断必须能被用例钉住，不能留在组件里。
 *
 * ## 最要紧的一条是 `tooShort`
 *
 * `search/aliases.ts:pushUnique` 丢掉长度 < 2 的别名（单字命中面太宽，一搜就把整库捞出来）。
 * 所以用户在界面里加一个「包」，**存是存下了、检索里根本没有它** ——
 * 那是最坏的一种"看着有其实没有"。这里提前把它挑出来，界面必须当场说，不许默默收下。
 */
import type { CategoryConfig } from './types'

/** 和 aliases.ts 的 `pushUnique` 保持同一个下限，两边不许漂 */
export const MIN_SYNONYM_LEN = 2
/** 和 services/categories.ts 的 validate 上限一致：超了主进程会抛，界面先挡住 */
export const MAX_SYNONYMS = 40
export const MAX_SYNONYM_LEN = 24

export interface SynonymAddResult {
  list: string[]
  /** 没加进去的原因（key + 参数），加了就是 null */
  rejected: { key: string; params?: Record<string, string | number> } | null
}

/** 加一条口语。去重、去空格、拒绝单字与超长、拒绝超出上限 —— 每一条都要有名字 */
export function addSynonym(list: string[] | undefined, raw: string): SynonymAddResult {
  const cur = Array.isArray(list) ? list.slice() : []
  const word = String(raw ?? '').trim()
  if (!word) return { list: cur, rejected: { key: 'settings.synonym.empty' } }
  if (word.length < MIN_SYNONYM_LEN)
    return { list: cur, rejected: { key: 'settings.synonym.tooShort', params: { min: MIN_SYNONYM_LEN } } }
  if (word.length > MAX_SYNONYM_LEN)
    return { list: cur, rejected: { key: 'settings.synonym.tooLong', params: { max: MAX_SYNONYM_LEN, word } } }
  /** 大小写与全角空格差异算同一条：`Texture` 和 `texture` 在检索里本来就是同一个词 */
  const norm = word.toLowerCase()
  if (cur.some((x) => x.toLowerCase() === norm))
    return { list: cur, rejected: { key: 'settings.synonym.dup', params: { word } } }
  if (cur.length >= MAX_SYNONYMS)
    return { list: cur, rejected: { key: 'settings.synonym.tooMany', params: { max: MAX_SYNONYMS } } }
  cur.push(word)
  return { list: cur, rejected: null }
}

export function removeSynonym(list: string[] | undefined, word: string): string[] {
  return (Array.isArray(list) ? list : []).filter((x) => x !== word)
}

/** 已经存在的词里有没有"白加"的（单字），界面要把这一行标出来而不是等用户去搜 */
export function deadSynonyms(list: string[] | undefined): string[] {
  return (Array.isArray(list) ? list : []).filter((x) => String(x).trim().length < MIN_SYNONYM_LEN)
}

/**
 * 草稿和已存盘的表有没有差别。
 *
 * 只比 `synonyms`：这一版面板只改这一项，标签/二级分类的编辑在别的地方。
 * 比整个对象会让"保存"按钮在用户什么都没动时也亮着 —— 而保存会重建索引，不是免费的。
 */
export function synonymsDirty(a: CategoryConfig | null, b: CategoryConfig | null): boolean {
  if (!a || !b) return false
  const flat = (cfg: CategoryConfig): string[] => {
    const out: string[] = []
    for (const c of cfg.categories) {
      out.push(c.key + '=' + (c.synonyms ?? []).join('|'))
      for (const s of c.subcategories) out.push(c.key + '/' + s.key + '=' + (s.synonyms ?? []).join('|'))
    }
    return out
  }
  const x = flat(a)
  const y = flat(b)
  return x.length !== y.length || x.some((v, i) => v !== y[i])
}
