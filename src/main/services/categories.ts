import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import type { CategoryConfig, CategoryDef, LocaleKey, SubcategoryDef } from '../../shared/types'
import { lexiconFile, P } from './paths'

/**
 * 分类表是外部 JSON（第 1 份 §12 坑 9：不许写死枚举），设置页可改口语。
 *
 * ## 内置表只读，用户的改动存增量（第 2 轮活体逼出来的）
 *
 * 以前 `saveCategories` 直接写 `lexiconFile('categories.json')` —— 打包版那是
 * **安装目录里**的 `resources\lexicon\categories.json`。装成 per-user 目录所以写得动、
 * 也当场生效（活体里就是这么验的），但 `electron-builder` 每次发布都会重写整个
 * `win-unpacked`，**用户自己加的口语词下一次升级就没了**。
 * 这和 `userLexicon.ts` 头部写死的规矩是同一类问题：用户的东西必须落在 `P.root()`。
 *
 * ## 为什么存增量而不是整份拷贝
 *
 * 存整份的话，升级时内置表新增的分类/口语永远进不来（用户那份是旧的副本，还盖在上面）。
 * 存 `{ add, remove }` 的增量，内置表怎么变都照样生效，用户的加减叠在上面。
 * 界面上只允许改 `synonyms` 一个字段（`SynonymEditor`），所以结构变了要**明确报错**，
 * 而不是悄悄丢掉那部分改动。
 */

/** 一个节点最多带几条口语（R4 ④）：再多就是误输入，宁可报错也别默默丢 */
const MAX_SYNONYMS = 40
const MAX_SYNONYM_LEN = 24
/** 增量文件的格式版本，将来要加字段靠它判 */
const USER_SCHEMA = 1

/**
 * `synonyms` 的清洗与校验。
 *
 * 分类表是用户能在设置页改、也能手改 JSON 的东西，所以这里两头都要管：
 *  - 形状不对（不是数组 / 里面不是字符串）→ **抛**，别静默吞掉；
 *  - 空格、重复、超长 → 就地清掉；
 *  - 条数超上限 → 抛。宁可让他看见一条错误，也不要"我明明写了却搜不到"。
 */
function normSynonyms(value: unknown, where: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new Error(`${where} 的 synonyms 必须是数组`)
  const out: string[] = []
  for (const raw of value) {
    if (typeof raw !== 'string') throw new Error(`${where} 的 synonyms 里混进了非字符串（${String(raw)}）`)
    const s = raw.trim()
    if (!s) continue
    if (s.length > MAX_SYNONYM_LEN) throw new Error(`${where} 的口语「${s}」太长（> ${MAX_SYNONYM_LEN} 个字符）`)
    if (!out.includes(s)) out.push(s)
  }
  if (out.length > MAX_SYNONYMS) throw new Error(`${where} 的口语有 ${out.length} 条，最多 ${MAX_SYNONYMS} 条`)
  return out
}

/**
 * 校验 + 清洗一份分类表。
 *
 * 导出来是给回归用例直接调的：它**会就地改掉传进来的对象**（`synonyms` 清洗结果写回原处），
 * 所以调用方要么给副本，要么明确知道自己在改自己的对象 —— `saveCategories` 就是先 deepcopy 再喂它。
 * （以前这里写的是"`saveCategories` 会覆盖仓库里那份真表"；第 3 轮改成只写增量之后那句已过时，
 *  但"测试不许碰 `resources/lexicon/categories.json`"这条纪律留着，`categories-delta.spec.ts` 钉着它。）
 */
export function validateCategories(raw: unknown): CategoryConfig {
  if (!raw || typeof raw !== 'object') throw new Error('categories.json 不是对象')
  const cfg = raw as CategoryConfig
  if (!Array.isArray(cfg.categories)) throw new Error('categories.json 缺少 categories 数组')
  for (const c of cfg.categories) {
    if (!c.key) throw new Error('分类缺少 key')
    if (!c.label || typeof c.label['zh-CN'] !== 'string') throw new Error(`分类 ${c.key} 缺少 zh-CN 标签`)
    if (!Array.isArray(c.subcategories)) throw new Error(`分类 ${c.key} 缺少 subcategories`)
    c.synonyms = normSynonyms(c.synonyms, `分类 ${c.key}`)
    for (const s of c.subcategories) {
      if (!s.key) throw new Error(`分类 ${c.key} 下有子项缺 key`)
      if (!s.label || typeof s.label['zh-CN'] !== 'string')
        throw new Error(`分类 ${c.key}/${s.key} 缺少 zh-CN 标签`)
      s.synonyms = normSynonyms(s.synonyms, `分类 ${c.key}/${s.key}`)
    }
  }
  return cfg
}

/** 一个分类节点（`cat` 或 `cat/sub`）上的用户改动 */
export interface SynDelta {
  add: string[]
  remove: string[]
}
interface CategoriesUserFile {
  schema: number
  updatedAt: number
  synonyms: Record<string, SynDelta>
}

let builtinCache: CategoryConfig | null = null
let builtinMtime = -1
let mergedCache: CategoryConfig | null = null
let mergedStamp = ''
/** 只给测试用的内置表位置覆盖（生产走 `lexiconFile`） */
let builtinOverride: string | null = null

/**
 * **只给测试用**：把"内置表"指到一份临时文件。
 *
 * 不加这个接缝就没法测"升级之后用户的增量还在不在" —— 那需要改内置表本身，
 * 而仓库里那份 `resources/lexicon/categories.json` 是**真的内置表**，测试不许动它
 * （`saveCategories` 以前会写它，正是本轮要修的那个洞）。
 * 和 `paths.setAppPathsForTest` 同一个路子。
 */
export function setBuiltinCategoriesFileForTest(file: string | null): void {
  builtinOverride = file
  builtinCache = null
  builtinMtime = -1
  mergedCache = null
  mergedStamp = ''
}

/** 内置表那份**只读**。它可能在安装目录里，写它就是"升级即丢" */
function builtinCategories(): CategoryConfig {
  const file = builtinOverride ?? lexiconFile('categories.json')
  const mtime = fs.existsSync(file) ? Number(fs.statSync(file).mtimeMs) : -1
  if (builtinCache && mtime === builtinMtime && mtime !== -1) return builtinCache
  if (mtime === -1) throw new Error(`找不到内置分类表：${file}`)
  builtinCache = validateCategories(JSON.parse(fs.readFileSync(file, 'utf8')) as unknown)
  builtinMtime = mtime
  return builtinCache
}

function userFileMtime(): number {
  return fs.existsSync(P.categoriesUser()) ? Number(fs.statSync(P.categoriesUser()).mtimeMs) : 0
}

/** 读增量。文件坏 / 形状不对 → 当成"没有用户改动"，不许让分类表整个读不出来 */
function readDelta(): Record<string, SynDelta> {
  let raw: string
  try {
    raw = fs.readFileSync(P.categoriesUser(), 'utf8')
  } catch {
    return {}
  }
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : []
  try {
    const j = JSON.parse(raw) as CategoriesUserFile
    const out: Record<string, SynDelta> = {}
    for (const [k, v] of Object.entries(j?.synonyms ?? {})) {
      if (!k || !v || typeof v !== 'object') continue
      out[k] = { add: strings(v.add), remove: strings(v.remove) }
    }
    return out
  } catch (e) {
    log.warn(`categories.user.json 读不了，这次按"没有用户改动"处理：${e instanceof Error ? e.message : String(e)}`)
    return {}
  }
}

/** 节点 key 的两种写法：一级 `clothing`、二级 `clothing/top` */
function nodeKey(catKey: string, subKey?: string): string {
  return subKey ? `${catKey}/${subKey}` : catKey
}

function applyDelta(base: CategoryConfig, delta: Record<string, SynDelta>): CategoryConfig {
  const cfg = JSON.parse(JSON.stringify(base)) as CategoryConfig
  for (const c of cfg.categories) {
    c.synonyms = mergeOne(c.synonyms ?? [], delta[nodeKey(c.key)])
    for (const s of c.subcategories) {
      s.synonyms = mergeOne(s.synonyms ?? [], delta[nodeKey(c.key, s.key)])
    }
  }
  return cfg
}

/** 内置在前、用户加的在后；被删掉的从两份里都去掉；去重去空 */
function mergeOne(built: string[], d?: SynDelta): string[] | undefined {
  const remove = new Set((d?.remove ?? []).map((x) => x.toLowerCase()))
  const out = built.filter((x) => !remove.has(x.toLowerCase()))
  for (const a of d?.add ?? []) {
    if (!out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a)
  }
  return out.length ? out : undefined
}

/** 结构（key / 标签 / 子项列表）比对：把 synonyms 摘掉再比，改了结构要报错而不是丢改动 */
function structuralDrift(base: CategoryConfig, next: CategoryConfig): string | null {
  const strip = (cfg: CategoryConfig): string => {
    const c = JSON.parse(JSON.stringify(cfg)) as CategoryConfig
    for (const cat of c.categories) {
      delete cat.synonyms
      for (const s of cat.subcategories) delete s.synonyms
    }
    return JSON.stringify(c)
  }
  return strip(base) === strip(next) ? null : '分类结构或标签和内置表不一致'
}

function diffSynonyms(base: CategoryConfig, next: CategoryConfig): Record<string, SynDelta> {
  const out: Record<string, SynDelta> = {}
  const walk = (bk: string, built: string[], now: string[]): void => {
    const b = built ?? []
    const n = now ?? []
    const add = n.filter((x) => !b.some((y) => y.toLowerCase() === x.toLowerCase()))
    const remove = b.filter((x) => !n.some((y) => y.toLowerCase() === x.toLowerCase()))
    if (add.length || remove.length) out[bk] = { add, remove }
  }
  for (const c of next.categories) {
    const bc = base.categories.find((x) => x.key === c.key)
    walk(nodeKey(c.key), bc?.synonyms ?? [], c.synonyms ?? [])
    for (const s of c.subcategories) {
      walk(nodeKey(c.key, s.key), bc?.subcategories.find((y) => y.key === s.key)?.synonyms ?? [], s.synonyms ?? [])
    }
  }
  return out
}

function writeDelta(delta: Record<string, SynDelta>): void {
  const file = P.categoriesUser()
  if (!Object.keys(delta).length) {
    /** 一条改动都没有就把文件删掉：留着空文件会让人以为"我改过什么" */
    try {
      fs.rmSync(file, { force: true })
    } catch {
      /* 删不掉也不影响正确性（读出来是空增量） */
    }
    return
  }
  const j: CategoriesUserFile = { schema: USER_SCHEMA, updatedAt: Date.now(), synonyms: delta }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n', 'utf8')
}

export function loadCategories(refresh = false): CategoryConfig {
  const base = builtinCategories()
  const stamp = `${builtinMtime}|${userFileMtime()}`
  if (!refresh && mergedCache && mergedStamp === stamp) return mergedCache
  mergedCache = applyDelta(base, readDelta())
  mergedStamp = stamp
  return mergedCache
}

/** 用户改过哪几个节点（设置页要能看见"这些口语是我加的"，也方便反悔） */
export function categoryDelta(): Record<string, SynDelta> {
  return readDelta()
}

export function saveCategories(cfg: CategoryConfig): CategoryConfig {
  const next = validateCategories(JSON.parse(JSON.stringify(cfg)) as unknown)
  const base = builtinCategories()
  const drift = structuralDrift(base, next)
  if (drift) throw new Error(`${drift} —— 界面上只允许改「口语」，内置表不动才能保住你的改动`)
  writeDelta(diffSynonyms(base, next))
  return loadCategories(true)
}

export function categoryKeys(cfg = loadCategories()): string[] {
  return cfg.categories.map((c) => c.key)
}

export function getCategory(cfg: CategoryConfig, key: string): CategoryDef | null {
  return cfg.categories.find((c) => c.key === key) ?? null
}

export function getSubcategory(
  cfg: CategoryConfig,
  catKey: string,
  subKey: string | null | undefined
): SubcategoryDef | null {
  if (!subKey) return null
  return getCategory(cfg, catKey)?.subcategories.find((s) => s.key === subKey) ?? null
}

export function isValidPair(cfg: CategoryConfig, catKey: string, subKey: string | null): boolean {
  const cat = getCategory(cfg, catKey)
  if (!cat) return false
  if (subKey === null) return true
  return cat.subcategories.some((s) => s.key === subKey)
}

export function label(cfg: CategoryConfig, key: string, locale: LocaleKey): string {
  const cat = getCategory(cfg, key)
  if (!cat) return key
  return cat.label[locale] ?? cat.label['zh-CN'] ?? key
}

/** 磁盘目录名用库创建时的语言（第 1 份 F11），之后切 UI 语言不动磁盘 */
export function dirNames(cfg: CategoryConfig, libraryLocale: LocaleKey): Map<string, string> {
  const m = new Map<string, string>()
  for (const c of cfg.categories) {
    m.set(c.key, c.label[libraryLocale] ?? c.label['zh-CN'])
    for (const s of c.subcategories) {
      m.set(`${c.key}/${s.key}`, s.label[libraryLocale] ?? s.label['zh-CN'])
    }
  }
  return m
}
