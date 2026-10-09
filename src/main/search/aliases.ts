/**
 * 检索别名生成（第 1 份 F5：入库时把可搜索字段归一化，生成检索别名）
 *
 * 索引要覆盖：名称 / 标签 / 分类 / 备注 / 包内路径 / 作者，
 * 而且每个字段都要出"原文 + 拼音 + 罗马字"三种写法，否则 `yifu` 搜不到 `衣服`。
 */
import type { CategoryConfig, LocaleKey } from '../../shared/types'
import { searchForms } from '../../shared/normalize'

/** 一条别名最多留多长：包内路径能到几百字符，全塞进去索引会炸 */
const MAX_ALIAS_LEN = 120
/** 每个字段最多几条别名，防单素材膨胀 */
const MAX_PER_FIELD = 24

export interface AliasSource {
  name: string
  rawName?: string | null
  categoryKey?: string | null
  subcategoryKey?: string | null
  /** 分类的三语标签，搜"插件"和搜"plugin"都要命中 */
  categoryLabels?: Partial<Record<LocaleKey, string>>
  subcategoryLabels?: Partial<Record<LocaleKey, string>>
  tags?: string[]
  targetAvatars?: string[]
  author?: string | null
  notes?: string | null
  sourceItemId?: string | null
  version?: string | null
  localeTag?: string | null
  /** 包内 / 目录内路径（package_entry.unity_path 或侧车清单） */
  paths?: string[]
  groupName?: string | null
  bundleName?: string | null
}

export interface AliasField {
  field: string
  values: string[]
}

function formsOf(input: string | null | undefined): string[] {
  if (!input) return []
  const s = String(input).trim()
  if (!s) return []
  return searchForms(s).all
}

function pushUnique(into: Set<string>, values: string[]): void {
  for (const v of values) {
    const t = v.trim()
    if (t.length >= 2 && t.length <= MAX_ALIAS_LEN) into.add(t)
  }
}

/**
 * 返回按字段分组的别名。
 * 分字段存是为了"点掉某个字段的命中"这种调试体验，也方便维护页展示来源。
 */
export function buildAliases(src: AliasSource): AliasField[] {
  const byField = new Map<string, Set<string>>()
  const add = (field: string, values: string[]): void => {
    const set = byField.get(field) ?? new Set<string>()
    pushUnique(set, values)
    byField.set(field, set)
  }

  add('name', formsOf(src.name))
  add('raw_name', formsOf(src.rawName))
  add('author', formsOf(src.author))
  add('notes', formsOf(src.notes))
  add('group', formsOf(src.groupName))
  add('bundle', formsOf(src.bundleName))
  if (src.sourceItemId) add('item_id', [src.sourceItemId, ...formsOf(src.sourceItemId)])
  if (src.version) add('version', formsOf(src.version))
  if (src.localeTag) add('locale', formsOf(src.localeTag))

  // 分类：key 本身 + 三语标签，都要能搜
  const catWords: string[] = []
  if (src.categoryKey) catWords.push(src.categoryKey)
  if (src.subcategoryKey) catWords.push(src.subcategoryKey)
  for (const labels of [src.categoryLabels, src.subcategoryLabels]) {
    if (!labels) continue
    for (const v of Object.values(labels)) if (v) catWords.push(v)
  }
  /**
   * ⚠ 分类表里的 `synonyms`（R4 ④）**故意不往这里拼**。
   *
   * 拼进来实测过：5 万素材的别名从 159.7 万涨到 206.4 万、增量重建 0.469 → 0.584ms/条，
   * 而每个分类内这些别名是完全重复的 —— 花 47 万条索引换一份"哪个口语属于哪个分类"的知识，不值。
   * 那份知识只存一遍，在 `shared/categoryExpand.ts` 的查询展开表里：
   * 搜"衣服"时先映射到「服装」这组标签，再走这里已经建好的标签别名。
   *
   * 代价要说清楚：`search_alias` 表里看不到口语，所以"这张卡为什么被搜到"的调试视图
   * 只会显示标签。真出问题去查展开表（`buildCategoryExpansion`）而不是这里。
   */
  const catSet = new Set<string>()
  for (const w of catWords) pushUnique(catSet, formsOf(w))
  add('category', Array.from(catSet))

  const tagSet = new Set<string>()
  for (const t of [...(src.tags ?? []), ...(src.targetAvatars ?? [])]) pushUnique(tagSet, formsOf(t))
  add('tags', Array.from(tagSet))

  // 包内路径：只取每段的 basename 与目录名，别把整条长路径塞进去
  const pathSet = new Set<string>()
  for (const p of src.paths ?? []) {
    for (const seg of String(p).split(/[\\/]/)) {
      const clean = seg.replace(/\.[A-Za-z0-9]{1,12}$/, '')
      if (clean.length < 3) continue
      for (const f of formsOf(clean)) {
        pushUnique(pathSet, [f])
        if (pathSet.size >= MAX_PER_FIELD) break
      }
      if (pathSet.size >= MAX_PER_FIELD) break
    }
    if (pathSet.size >= MAX_PER_FIELD) break
  }
  add('paths', Array.from(pathSet))

  const out: AliasField[] = []
  for (const [field, set] of byField) {
    const values = Array.from(set).slice(0, MAX_PER_FIELD)
    if (values.length) out.push({ field, values })
  }
  return out
}

/** 拍平成"一条素材的全部别名"，给内存索引用 */
export function flattenAliases(fields: AliasField[]): string[] {
  const out = new Set<string>()
  for (const f of fields) for (const v of f.values) out.add(v)
  return Array.from(out)
}

/**
 * 给一个 CategoryConfig 取某分类/某二级的三语标签。
 *
 * 名字里以前有过 `Synonyms` —— R4 ④ 试过把口语一起塞进每条素材的别名，
 * 实测吃掉了 47 万条索引（见上面 `buildAliases` 里那段注释），改成了查询侧展开。
 * 所以这个函数**只给标签**，别再把 synonyms 接进来。
 */
export function labelTriple(
  cfg: CategoryConfig,
  categoryKey: string | null | undefined,
  subcategoryKey: string | null | undefined
): {
  categoryLabels?: Partial<Record<LocaleKey, string>>
  subcategoryLabels?: Partial<Record<LocaleKey, string>>
} {
  const c = cfg.categories.find((x) => x.key === categoryKey)
  if (!c) return {}
  const s = subcategoryKey ? c.subcategories.find((x) => x.key === subcategoryKey) : undefined
  return {
    categoryLabels: c.label,
    subcategoryLabels: s?.label
  }
}
