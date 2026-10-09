/**
 * 素材检索内存索引（第 1 份 F5 + §7：搜索 ≤100ms，5 万素材启动 ≤2s → 索引进后台）
 *
 * 用 MiniSearch 而不是 SQL LIKE：LIKE 只能 `substring`，
 * 而"输 shinano 找 しなの"要求的是**词形归一化后的倒排索引**。
 * 归一化在 search/aliases.ts 做，这里只负责索引与查询。
 */
import MiniSearchNS from 'minisearch'
import type { Db } from '../db'
import type { CategoryConfig } from '../../shared/types'
import { buildAliases, flattenAliases, labelTriple, type AliasSource } from './aliases'
import { buildCategoryExpansion, expandCategoryLabels, type CategoryExpansion } from '../../shared/categoryExpand'
import { setSearchAliases } from '../db/repos/meta'
import { searchForms } from '../../shared/normalize'

/**
 * minisearch@7 的 CJS 产物是 `module.exports = MiniSearch`（不带 __esModule），
 * 但不同打包器 interop 结果不一样 —— p-queue 那次就是栽在这上面，这里两种都兜住。
 */
const MiniSearch = ((MiniSearchNS as unknown as { default?: typeof MiniSearchNS }).default ??
  MiniSearchNS) as typeof MiniSearchNS

export interface IndexDoc {
  id: string
  name: string
  rawName: string
  category: string
  tags: string
  author: string
  notes: string
  paths: string
  aliases: string
}

export interface SearchHit {
  id: string
  score: number
}

interface Fields {
  [k: string]: number
}

const BOOST: Fields = {
  name: 4,
  aliases: 2.5,
  tags: 2,
  author: 2,
  category: 1.5,
  rawName: 1.2,
  paths: 1,
  notes: 0.8
}

/** 字母数字 + CJK（中英日）算词内字符，其它都算分隔符 */
const SEP_RE = /[^0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3041-\u30ff\u31f0-\u31ff\uac00-\ud7af]+/

const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3041-\\u30ff\\u31f0-\\u31ff\\uac00-\\ud7af'
/** 中日韩字后面紧跟拉丁字母或数字 */
const CJK_THEN_LAT = new RegExp('([' + CJK + '])([0-9A-Za-z])', 'g')
/** 拉丁字母或数字后面紧跟中日韩字 */
const LAT_THEN_CJK = new RegExp('([0-9A-Za-z])([' + CJK + '])', 'g')

/**
 * 建索引和查询共用同一套切词。
 *
 * MiniSearch 默认只在空白处切，"Shinano_FaceAnimation" 会成为一个整词，
 * 于是搜 face 能出（前缀匹配）、搜 animation 出不来 —— 实测踩过，
 * 而"animation / physbone / toon"这种后半截词恰恰是找素材最常用的。
 * 所以补三种切点：
 *   1. 大小写交界：FaceAnimation → Face + Animation
 *   2. 拉丁与中日韩交界：束縛チャイナFULLSET → 束縛チャイナ + FULLSET
 *      （不切的话搜 fullset 只能靠前缀匹配碰运气，别名一多就漏）
 *   3. 数字边界故意**不**切，否则 V1.0 被拆成 V + 1 + 0，搜 "v1.0" 就断了。
 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(SEP_RE)) {
    if (!part) continue
    const spaced = part
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(CJK_THEN_LAT, '$1 $2')
      .replace(LAT_THEN_CJK, '$1 $2')
    for (const piece of spaced.split(' ')) if (piece) out.push(piece)
  }
  return out
}

/** 每次重建都换新实例：MiniSearch 没有"清空"接口，new 一个最干净 */
function freshMiniSearch(): InstanceType<typeof MiniSearch> {
  return new MiniSearch({
    fields: Object.keys(BOOST),
    storeFields: ['name'],
    tokenize,
    searchOptions: {
      tokenize,
      prefix: true,
      // 拉丁词才容错：CJK 上 fuzzy 会把"表情"匹配到"脸情"这种没意义的东西
      fuzzy: (token: string) => (/^[\x20-\x7e]+$/.test(token) && token.length >= 5 ? 0.2 : false),
      boost: BOOST
    }
  })
}

/** 拉丁词才容错：CJK 上 fuzzy 会把"表情"匹配到"脸情"这种没意义的东西 */
export function fuzzyFor(token: string): number | false {
  return /^[\x20-\x7e]+$/.test(token) && token.length >= 5 ? 0.2 : false
}

export class AssetSearchIndex {
  private ms: InstanceType<typeof MiniSearch>
  private _ready = false
  private _builtAt = 0
  /**
   * 分类口语 → 标签 的查询展开表（R4 ④）。空表 = 不展开，行为和以前一模一样。
   * 由 `setCategoryExpansion(cfg)` 在建索引/换分类表时刷新。
   */
  private expansion: CategoryExpansion = new Map()
  readonly fuzzyFor = fuzzyFor

  constructor() {
    this.ms = freshMiniSearch()
  }

  /** 换分类表（含用户新加的口语）之后必须调，否则口语要等重启才生效 */
  setCategoryExpansion(cfg: CategoryConfig): void {
    this.expansion = buildCategoryExpansion(cfg)
  }

  get expansionSize(): number {
    return this.expansion.size
  }

  get ready(): boolean {
    return this._ready
  }

  get builtAt(): number {
    return this._builtAt
  }

  get size(): number {
    return this.ms.documentCount
  }

  /** 全量重建：换一批文档就整个丢掉重搭，比逐条 diff 简单且不容易留脏数据 */
  rebuild(docs: IndexDoc[]): void {
    this.ms = freshMiniSearch()
    if (docs.length) this.ms.addAll(docs as unknown as Array<Record<string, unknown> & { id: string }>)
    this._ready = true
    this._builtAt = Date.now()
  }

  /** 开始一轮分片重建：先丢掉旧索引，之后靠 addDocs 一块块喂 */
  beginBuild(): void {
    this.ms = freshMiniSearch()
    this._ready = false
  }

  /** 分片建索引时用：往当前索引里追加一批，不清空已有的 */
  addDocs(docs: IndexDoc[]): void {
    if (!docs.length) return
    this.ms.addAll(docs as unknown as Array<Record<string, unknown> & { id: string }>)
  }

  markReady(): void {
    this._ready = true
    this._builtAt = Date.now()
  }

  upsert(doc: IndexDoc): void {
    if (!this._ready) return
    try {
      if (this.ms.has(doc.id)) this.ms.discard(doc.id)
      this.ms.add(doc as unknown as Record<string, unknown> & { id: string })
    } catch {
      // 索引脏了不该影响业务查询，下一次 rebuild 会修好
    }
  }

  remove(id: string): void {
    if (!this._ready) return
    try {
      if (this.ms.has(id)) this.ms.discard(id)
    } catch {
      /* 同上 */
    }
  }

  search(query: string, limit = 500): SearchHit[] {
    if (!this._ready) return []
    const q = query.trim()
    if (!q) return []
    // 查询串也走一遍归一化：输 yifu 要变成能命中 衣服 的形式
    const forms = searchForms(q).all
    const seen = new Map<string, number>()
    const eat = (hits: Array<{ id: string | number; score: number }>): void => {
      for (const h of hits) {
        const id = String(h.id)
        seen.set(id, Math.max(seen.get(id) ?? 0, h.score))
      }
    }
    /**
     * 两趟：先严格（精确 + 前缀），一无所获才容错。
     *
     * MiniSearch 的 fuzzy 是"把整个词典按编辑距离扫一遍"，5 万素材 / 上百万别名时
     * 实测一次要 180ms —— 而用户绝大多数输入本来就能严格命中（'shinan' 靠前缀就能找到
     * shinano），白等一趟模糊匹配不值。所以只在严格趟什么都没捞到时才补，
     * 而且只对长得像打错的拉丁词补（CJK 上 fuzzy 会匹配出"脸情"这种没意义的东西）。
     */
    for (const form of forms) {
      try {
        eat(this.ms.search(form, { prefix: true, fuzzy: false }) as Array<{ id: string | number; score: number }>)
      } catch {
        /* 单个写法查失败不影响别的写法 */
      }
    }
    /**
     * 分类口语展开（R4 ④）：搜"衣服"要能把归在「服装」下的卡带出来。
     *
     * 走的是"输入 → 分类标签 → 再查一遍标签"，不是"把同义词塞进每条素材的别名" ——
     * 后者实测吃掉了 47 万条索引，而标签本来就在 `category` 字段里，一次不用多存。
     * 用整词相等、不开前缀：这是"换一组词再查"，不是"猜用户想打什么"。
     */
    if (this.expansion.size) {
      for (const label of expandCategoryLabels(q, this.expansion)) {
        if (forms.includes(label)) continue
        try {
          eat(this.ms.search(label, { prefix: false, fuzzy: false }) as Array<{ id: string | number; score: number }>)
        } catch {
          /* 某个标签查失败不影响别的 */
        }
      }
    }
    if (!seen.size) {
      /**
       * 容错趟只对**整串都是 ASCII 的输入**开。
       *
       * fuzzy 是给"拉丁词打错一个字母"准备的（shinan→shinano）。汉字输入会被
       * `searchForms` 展开成拼音，而那些拼音**不是用户可能打错的东西**，是另一个词：
       * 「冰箱」→ `xiang` → 容错成 `xing` → 命中"发型/长形"这类完全不相干的卡。
       * 用户真打错英文时输入本来就是 ASCII，这条限制不影响那一类。
       */
      const latinOnly = /^[\x20-\x7e]+$/.test(q)
      if (!latinOnly) return []
      for (const form of forms) {
        if (!/^[\x20-\x7e]+$/.test(form) || form.trim().length < 5) continue
        try {
          eat(this.ms.search(form, { prefix: false, fuzzy: this.fuzzyFor }) as Array<{ id: string | number; score: number }>)
        } catch {
          /* 同上 */
        }
      }
    }
    return Array.from(seen.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => ({ id, score }))
  }
}

// ---------------------------------------------------------------- 从库里拉数据

interface AssetRowLite {
  id: string
  name: string
  raw_name: string | null
  category: string
  subcategory: string | null
  author: string | null
  notes: string | null
  source_item_id: string | null
  version: string | null
  locale_tag: string | null
  group_id: string | null
  bundle_id: string | null
}

/** 单条素材的别名（入库时也要调，保证新东西立刻可搜） */
export function aliasesFor(
  db: Db,
  cfg: CategoryConfig,
  row: AssetRowLite
): { fields: ReturnType<typeof buildAliases>; flat: string[]; doc: IndexDoc } {
  const tags = (
    db
      .prepare(
        `SELECT t.name FROM asset_tag at2 JOIN tag t ON t.id = at2.tag_id WHERE at2.asset_id = ?`
      )
      .all(row.id) as Array<{ name: string }>
  ).map((r) => r.name)
  const paths = (
    db.prepare(`SELECT unity_path FROM package_entry WHERE asset_id = ? LIMIT 400`).all(row.id) as Array<{
      unity_path: string
    }>
  ).map((r) => r.unity_path)
  const groupName = row.group_id
    ? ((db.prepare(`SELECT name FROM asset_group WHERE id = ?`).get(row.group_id) as { name: string } | undefined)?.name ?? null)
    : null
  const bundleName = row.bundle_id
    ? ((db.prepare(`SELECT name FROM bundle WHERE id = ?`).get(row.bundle_id) as { name: string } | undefined)?.name ?? null)
    : null

  const source: AliasSource = {
    name: row.name,
    rawName: row.raw_name,
    categoryKey: row.category,
    subcategoryKey: row.subcategory,
    ...labelTriple(cfg, row.category, row.subcategory),
    tags,
    author: row.author,
    notes: row.notes,
    sourceItemId: row.source_item_id,
    version: row.version,
    localeTag: row.locale_tag,
    paths,
    groupName,
    bundleName
  }
  const fields = buildAliases(source)
  const flat = flattenAliases(fields)
  const pathsJoined = paths.join(' ')
  const tagsJoined = tags.join(' ')
  const categoryJoined = [row.category, row.subcategory, ...(fields.find((f) => f.field === 'category')?.values ?? [])]
    .filter(Boolean)
    .join(' ')
  /**
   * aliases 字段只装"别处没有的写法"。
   *
   * 原来 flat 是所有字段的并集，而 name / rawName / category / tags 这些字段本身也进索引，
   * 于是同一个词被索引 2–3 遍：5 万素材实测 119 万条别名，一次前缀查询要翻 5 万条倒排表，
   * p95 直接 300ms。去掉重复之后术语量掉一大截，查询才回到 100ms 以内。
   */
  const mirrored = new Set(
    [row.name, row.raw_name ?? '', tagsJoined, categoryJoined, row.author ?? '', row.notes ?? '', pathsJoined]
      .join(' ')
      .split(/\s+/)
      .map((s) => s.toLowerCase())
      .filter(Boolean)
  )
  const extra = flat.filter((v) => {
    const s = v.toLowerCase()
    return !mirrored.has(s) && !mirrored.has(v)
  })
  const doc: IndexDoc = {
    id: row.id,
    name: row.name,
    rawName: row.raw_name ?? '',
    category: categoryJoined,
    tags: tagsJoined,
    author: row.author ?? '',
    notes: row.notes ?? '',
    paths: pathsJoined,
    aliases: extra.join(' ')
  }
  return { fields, flat, doc }
}

export interface RebuildReport {
  docs: number
  aliases: number
  ms: number
  /** 分三段计时：别名生成 / 写库 / 建内存索引 —— 慢在哪一段要能一眼看出来 */
  aliasMs?: number
  dbMs?: number
  msMs?: number
}

/** 全库重建索引 + 回填 search_alias 表 */
export function rebuildIndex(db: Db, cfg: CategoryConfig, index: AssetSearchIndex): RebuildReport {
  /** 分类口语的查询展开表跟着分类表走（R4 ④）；重建入口都在这儿，所以两处都刷一次 */
  index.setCategoryExpansion(cfg)
  const t0 = Date.now()
  const rows = db
    .prepare(
      `SELECT id, name, raw_name, category, subcategory, author, notes, source_item_id, version, locale_tag, group_id, bundle_id FROM asset`
    )
    .all() as AssetRowLite[]
  const docs: IndexDoc[] = []
  const pending: Array<[string, string, string]> = []
  for (const row of rows) {
    const { fields, doc } = aliasesFor(db, cfg, row)
    for (const f of fields) {
      for (const v of new Set(f.values.filter(Boolean))) pending.push([row.id, f.field, v])
    }
    docs.push(doc)
  }
  const tAlias = Date.now()
  /**
   * 别名整表换掉、一次事务灌回来。
   *
   * 原来这里是逐 (素材, 字段) 调 setSearchAliases —— 每次自带一个事务，
   * 5 万素材 × 10 个字段 = 50 万次独立提交，实测把重建从 2 秒拖到 80 秒。
   * 全量重建的场景里"先清后灌"不但等价，还只剩一次 fsync。
   */
  db.transaction(() => {
    db.prepare(`DELETE FROM search_alias`).run()
    const ins = db.prepare(`INSERT OR IGNORE INTO search_alias (asset_id, field, alias) VALUES (?, ?, ?)`)
    for (const [id, field, alias] of pending) ins.run(id, field, alias)
  })()
  const tDb = Date.now()
  index.rebuild(docs)
  return { docs: docs.length, aliases: pending.length, ms: Date.now() - t0, aliasMs: tAlias - t0, dbMs: tDb - tAlias, msMs: Date.now() - tDb }
}

/** 进程内单例：主进程一份，查询不用每次重建 */
export const assetIndex = new AssetSearchIndex()

export interface ChunkedReport {
  docs: number
  aliases: number
  ms: number
  chunks: number
  /** 喂完第一片就开放搜索的时间 —— 这才是"启动到能搜"的真实数字 */
  firstChunkMs: number
}

const sleep0 = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/**
 * 分片后台重建（§7 那句"UI 先渲染，索引进后台"的实现）。
 *
 * 5 万素材全量建索引实测 18 秒：一次跑完会把主进程按死 18 秒，
 * 窗口开着但所有 IPC 都不响应 —— 那比"没有索引"更糟。
 * 所以一片一片做，每片之间让出事件循环：界面照常能点，
 * 搜索在第一片完成后就可用（命中当时已灌进去的那部分），越用越全。
 */
export async function rebuildIndexChunked(
  db: Db,
  cfg: CategoryConfig,
  index: AssetSearchIndex,
  opts: { chunk?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<ChunkedReport> {
  /** 启动那条分片路径也要刷展开表，否则第一次开程序时口语不生效 */
  index.setCategoryExpansion(cfg)
  const t0 = Date.now()
  const chunkSize = opts.chunk ?? 800
  const rows = db
    .prepare(
      `SELECT id, name, raw_name, category, subcategory, author, notes, source_item_id, version, locale_tag, group_id, bundle_id FROM asset ORDER BY updated_at DESC`
    )
    .all() as AssetRowLite[]
  index.beginBuild()
  db.prepare(`DELETE FROM search_alias`).run()
  const ins = db.prepare(`INSERT OR IGNORE INTO search_alias (asset_id, field, alias) VALUES (?, ?, ?)`)
  let done = 0
  let aliases = 0
  let chunks = 0
  let firstChunkMs = 0
  for (let start = 0; start < rows.length; start += chunkSize) {
    const slice = rows.slice(start, start + chunkSize)
    const docs: IndexDoc[] = []
    const write = db.transaction(() => {
      for (const row of slice) {
        const { fields, doc } = aliasesFor(db, cfg, row)
        for (const f of fields) {
          for (const v of new Set(f.values.filter(Boolean))) {
            ins.run(row.id, f.field, v)
            aliases++
          }
        }
        docs.push(doc)
      }
    })
    write()
    index.addDocs(docs)
    if (!index.ready) index.markReady()
    done += slice.length
    chunks++
    if (chunks === 1) firstChunkMs = Date.now() - t0
    opts.onProgress?.(done, rows.length)
    await sleep0()
  }
  index.markReady()
  return { docs: done, aliases, ms: Date.now() - t0, chunks, firstChunkMs }
}

/**
 * 单条素材改完（改名 / 改分类 / 入库 / 撤销）后同步索引。
 * 不做这件事的话，搜新名字搜不到、搜旧名字还能搜到 —— 比不索引更糟。
 */
export function reindexAsset(db: Db, assetId: string): void {
  if (!assetIndex.ready) return
  try {
    const row = db
      .prepare(
        `SELECT id, name, raw_name, category, subcategory, author, notes, source_item_id, version, locale_tag, group_id, bundle_id
         FROM asset WHERE id = ?`
      )
      .get(assetId) as AssetRowLite | undefined
    if (!row) {
      assetIndex.remove(assetId)
      return
    }
    const { fields, doc } = aliasesFor(db, loadCategoriesForIndex(), row)
    for (const f of fields) setSearchAliases(db, assetId, f.field, f.values)
    assetIndex.upsert(doc)
  } catch {
    /* 索引同步失败不影响业务，下一次全量重建会修好 */
  }
}

/**
 * 分类表由调用方缓存；这里给一个懒加载口子，
 * 免得 search 反过来依赖 services/categories（那条依赖会绕回 electron）。
 */
let cfgForIndex: CategoryConfig | null = null
export function setCategoryConfig(cfg: CategoryConfig): void {
  cfgForIndex = cfg
}
function loadCategoriesForIndex(): CategoryConfig {
  if (!cfgForIndex) throw new Error('search: 分类表还没注入，先调 setCategoryConfig()')
  return cfgForIndex
}
