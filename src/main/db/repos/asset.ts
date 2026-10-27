import type { Db } from '../index'
import { ulid } from '../../../shared/ulid'
import { sortVersionsDesc } from '../../../shared/version'
import { parseVariantDims } from '../../../shared/variantDims'
import type {
  AssetCard,
  AssetFilter,
  AssetRow,
  CategoryConfig,
  LocaleKey
} from '../../../shared/types'

export const ASSET_COLUMNS = [
  'id', 'name', 'raw_name', 'category', 'subcategory', 'confidence', 'status',
  'library_path', 'source_path', 'storage_mode', 'kind', 'content_type', 'size_bytes',
  'hash_xxh64', 'cover_image', 'source_url', 'source_platform', 'source_item_id',
  'source_item_id_confidence', 'author', 'version', 'locale_tag', 'group_id',
  'bundle_id', 'parent_asset_id', 'is_bundle',
  'attachment_kind', 'container_kind', 'variant_raw',
  'notes', 'created_at', 'updated_at'
] as const

type Col = (typeof ASSET_COLUMNS)[number]

function coerce(v: unknown): string | number | null | Uint8Array {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v as string | number | Uint8Array
}

export function makeAssetRow(
  input: Pick<AssetRow, 'name' | 'raw_name' | 'category'> & Partial<AssetRow>
): AssetRow {
  const now = Date.now()
  return {
    id: input.id ?? ulid(),
    name: input.name,
    raw_name: input.raw_name,
    category: input.category,
    subcategory: input.subcategory ?? null,
    confidence: input.confidence ?? 0,
    status: input.status ?? 'inbox',
    library_path: input.library_path ?? null,
    source_path: input.source_path ?? null,
    storage_mode: input.storage_mode ?? 'archived',
    kind: input.kind ?? null,
    content_type: input.content_type ?? null,
    size_bytes: input.size_bytes ?? null,
    hash_xxh64: input.hash_xxh64 ?? null,
    cover_image: input.cover_image ?? null,
    source_url: input.source_url ?? null,
    source_platform: input.source_platform ?? null,
    source_item_id: input.source_item_id ?? null,
    source_item_id_confidence: input.source_item_id_confidence ?? null,
    author: input.author ?? null,
    version: input.version ?? null,
    locale_tag: input.locale_tag ?? null,
    group_id: input.group_id ?? null,
    bundle_id: input.bundle_id ?? null,
    parent_asset_id: input.parent_asset_id ?? null,
    is_bundle: input.is_bundle ?? 0,
    attachment_kind: input.attachment_kind ?? null,
    container_kind: input.container_kind ?? null,
    variant_raw: input.variant_raw ?? null,
    notes: input.notes ?? null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now
  }
}

export function upsertAsset(db: Db, row: AssetRow): void {
  const placeholders = ASSET_COLUMNS.map(() => '?').join(', ')
  const updates = ASSET_COLUMNS.filter((c) => c !== 'id')
    .map((c) => `${c}=excluded.${c}`)
    .join(', ')
  db.prepare(
    `INSERT INTO asset (${ASSET_COLUMNS.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updates}`
  ).run(...ASSET_COLUMNS.map((c) => coerce(row[c] as unknown)))
}

export function getAsset(db: Db, id: string): AssetRow | null {
  const row = db.prepare(`SELECT * FROM asset WHERE id = ?`).get(id) as AssetRow | undefined
  return row ?? null
}

export function findAssetByHash(db: Db, hash: string): AssetRow | null {
  const row = db
    .prepare(`SELECT * FROM asset WHERE hash_xxh64 = ? ORDER BY created_at LIMIT 1`)
    .get(hash) as AssetRow | undefined
  return row ?? null
}

const PATCHABLE: readonly Col[] = [
  'name', 'raw_name', 'category', 'subcategory', 'confidence', 'status', 'library_path',
  'source_path', 'storage_mode', 'kind', 'content_type', 'size_bytes', 'hash_xxh64',
  'cover_image', 'source_url', 'source_platform', 'source_item_id',
  'source_item_id_confidence', 'author', 'version', 'locale_tag', 'group_id', 'bundle_id',
  'parent_asset_id', 'is_bundle',
  'attachment_kind', 'container_kind', 'variant_raw', 'notes'
]

export function patchAsset(db: Db, id: string, patch: Partial<AssetRow>): AssetRow | null {
  const keys = PATCHABLE.filter((k) => Object.prototype.hasOwnProperty.call(patch, k))
  if (keys.length) {
    db.prepare(
      `UPDATE asset SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`
    ).run(...keys.map((k) => coerce(patch[k] as unknown)), Date.now(), id)
  }
  return getAsset(db, id)
}

export function deleteAssetRow(db: Db, id: string): void {
  db.transaction(() => {
    /**
     * 合集先删子项再删自己：开了 foreign_keys=ON，
     * 反过来会直接抛约束错误，撤销整批时就卡在那儿。
     */
    const kids = db
      .prepare(`SELECT id FROM asset WHERE parent_asset_id = ?`)
      .all(id) as Array<{ id: string }>
    for (const k of kids) deleteAssetRow(db, k.id)
    db.prepare(`DELETE FROM asset_tag WHERE asset_id = ?`).run(id)
    db.prepare(`DELETE FROM collection_asset WHERE asset_id = ?`).run(id)
    db.prepare(`DELETE FROM variant WHERE asset_id = ?`).run(id)
    db.prepare(`DELETE FROM package_entry WHERE asset_id = ?`).run(id)
    db.prepare(`DELETE FROM dependency WHERE asset_id = ?`).run(id)
    db.prepare(`DELETE FROM search_alias WHERE asset_id = ?`).run(id)
    db.prepare(`DELETE FROM asset WHERE id = ?`).run(id)
  })()
}

/** 合集下的子项（Item），按名字排 */
export function listChildren(db: Db, bundleId: string): AssetRow[] {
  return db
    .prepare(`SELECT * FROM asset WHERE parent_asset_id = ? ORDER BY name`)
    .all(bundleId) as AssetRow[]
}

/**
 * 挂在某件素材下面的附属资源（增量改动单 2 §A2）。
 * 详情页按 kind 分区显示：图库 / 媒体区 / 说明区 / 链接区 / 源文件区 / 音频区。
 * 图片按名字排 —— 第一张当封面，顺序得稳定，不然每次打开封面都换一张。
 */
export function listAttachments(db: Db, assetId: string, kind?: string | null): AssetRow[] {
  return (
    kind
      ? db
          .prepare(`SELECT * FROM asset WHERE parent_asset_id = ? AND attachment_kind = ? ORDER BY name`)
          .all(assetId, kind)
      : db
          .prepare(`SELECT * FROM asset WHERE parent_asset_id = ? AND attachment_kind IS NOT NULL ORDER BY name`)
          .all(assetId)
  ) as AssetRow[]
}

/** 附属资源不算子项：合集"含 N 项"里的 N 只数真素材（§A2：附属不参与合集判定） */
export function listChildItems(db: Db, bundleId: string): AssetRow[] {
  return db
    .prepare(`SELECT * FROM asset WHERE parent_asset_id = ? AND attachment_kind IS NULL ORDER BY name`)
    .all(bundleId) as AssetRow[]
}

/**
 * 某个子项的版本行，**最新的排最前**（改动单 §2.3）。
 * 按名字排会翻车：'...v1.10.zip' 排在 '...v1.9.zip' 后面。
 */
export function listVersions(db: Db, itemId: string): AssetRow[] {
  const rows = db.prepare(`SELECT * FROM asset WHERE parent_asset_id = ?`).all(itemId) as AssetRow[]
  return sortVersionsDesc(rows, (r) => r.version)
}

/** 合集"含 N 项"里的那个 N：**只数真素材**，附属资源不参与（§A2 核心规则） */
export function countChildren(db: Db, bundleId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM asset WHERE parent_asset_id = ? AND attachment_kind IS NULL`)
    .get(bundleId) as { n: number } | undefined
  return row ? Number(row.n) : 0
}

export function isBundleRow(row: Pick<AssetRow, 'is_bundle'> | null | undefined): boolean {
  return Number(row?.is_bundle ?? 0) === 1
}

export function listAssetsByGroup(db: Db, groupId: string): AssetRow[] {
  return db
    .prepare(`SELECT * FROM asset WHERE group_id = ? ORDER BY name`)
    .all(groupId) as AssetRow[]
}

export function listAllAssetIds(db: Db): string[] {
  return (db.prepare(`SELECT id FROM asset`).all() as Array<{ id: string }>).map((r) => r.id)
}

export function labelOf(
  config: CategoryConfig,
  catKey: string,
  subKey: string | null,
  locale: LocaleKey
): { categoryLabel: string; subcategoryLabel: string } {
  const cat = config.categories.find((c) => c.key === catKey)
  const categoryLabel = cat ? cat.label[locale] ?? cat.label['zh-CN'] : catKey
  const sub = cat?.subcategories.find((s) => s.key === subKey)
  const subcategoryLabel = sub ? sub.label[locale] ?? sub.label['zh-CN'] : subKey ?? ''
  return { categoryLabel, subcategoryLabel }
}

interface CardQueryRow {
  id: string
  name: string
  raw_name: string
  category: string
  subcategory: string | null
  confidence: number
  status: AssetRow['status']
  kind: AssetRow['kind']
  cover_image: string | null
  group_id: string | null
  size_bytes: number | null
  updated_at: number
  variant_count: number
  /** R4 ⑤：`kind + 分隔符 + value` 拼起来的那一串，解析在 shared/variantDims.ts */
  variant_dims: string | null
  child_count: number
  unit_count: number
  attachment_count: number
  parent_name: string | null
  is_bundle: number
  container_kind: string | null
  attachment_kind: string | null
  variant_raw: string | null
  parent_asset_id: string | null
  bundle_name: string | null
  tags: string | null
}

const SEARCH_CLAUSE = `(a.name LIKE ? OR a.raw_name LIKE ? OR a.notes LIKE ? OR a.author LIKE ?
  OR a.source_item_id LIKE ?
  OR EXISTS (SELECT 1 FROM search_alias sa WHERE sa.asset_id = a.id AND sa.alias LIKE ?))`

function buildWhere(filter: AssetFilter): { sql: string; params: Array<string | number> } {
  const where: string[] = []
  const params: Array<string | number> = []
  /**
   * 附属资源**永远不出现在列表里**（增量改动单 2 §A2 核心规则 + 不要做的事 #1）。
   * 它们不是"藏起来的卡片"，是根本不该进第一层 —— 只有详情页按 parent 取的时候才捞。
   * 所以这条是无条件的，连 scope='all'（搜索/维护）也不例外：
   * 搜索搜到一张介绍图当结果，对用户没有任何意义。
   */
  if (!filter.attachmentsOnly) where.push('a.attachment_kind IS NULL')
  else {
    where.push('a.attachment_kind IS NOT NULL')
    if (filter.attachmentKind) {
      where.push('a.attachment_kind = ?')
      params.push(filter.attachmentKind)
    }
  }
  if (filter.status) {
    where.push('a.status = ?')
    params.push(filter.status)
  }
  if (filter.category) {
    where.push('a.category = ?')
    params.push(filter.category)
  }
  if (filter.subcategory) {
    where.push('a.subcategory = ?')
    params.push(filter.subcategory)
  }
  if (filter.groupId) {
    where.push('a.group_id = ?')
    params.push(filter.groupId)
  }
  /**
   * 三级模型的取数范围（改动单 §2.2 / §3）。
   * 默认 'top'：库列表只出顶层素材和合集卡，合集里的子项不单独冒出来 ——
   * 否则"初音的VRC小店"又变回十几个顶层卡片，正是这次要修掉的东西。
   */
  if (filter.parentId) {
    where.push('a.parent_asset_id = ?')
    params.push(filter.parentId)
  } else if (filter.scope === 'all') {
    // 什么都不加：搜索/维护要能连子项一起捞到
  } else {
    where.push('a.parent_asset_id IS NULL')
  }
  if (filter.bundlesOnly) {
    where.push('a.is_bundle = 1')
  }
  if (filter.collectionId) {
    where.push(
      'EXISTS (SELECT 1 FROM collection_asset ca WHERE ca.asset_id = a.id AND ca.collection_id = ?)'
    )
    params.push(filter.collectionId)
  }
  if (filter.ids?.length) {
    // 单个 JSON 参数保留完整候选集，也不会撞上 SQLite 的绑定参数数量上限。
    where.push('a.id IN (SELECT value FROM json_each(?))')
    params.push(JSON.stringify(filter.ids))
  }
  const q = (filter.search ?? '').trim()
  // 索引已经按归一化写法匹配过了，别再叠一层 LIKE 把 shinano→しなの 这种命中滤掉
  if (q && !filter.ids?.length) {
    where.push(SEARCH_CLAUSE)
    const like = `%${q}%`
    for (let i = 0; i < 6; i++) params.push(like)
  }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params }
}

/** Return all matching material rows, with list filters but without UI paging or group collapse. */
export function queryAssetIds(db: Db, filter: AssetFilter): string[] {
  const { sql, params } = buildWhere(filter)
  return (db.prepare(`SELECT a.id FROM asset a ${sql} ORDER BY a.updated_at DESC, a.id`).all(...params) as Array<{ id: string }>)
    .map(row => row.id)
}

const CARD_SELECT = `
  SELECT a.id, a.name, a.raw_name, a.category, a.subcategory, a.confidence, a.status, a.kind,
         a.cover_image, a.group_id, a.size_bytes, a.updated_at,
         a.is_bundle, a.parent_asset_id,
         a.container_kind, a.attachment_kind, a.variant_raw,
         (SELECT COUNT(*) FROM asset m WHERE a.group_id IS NOT NULL AND m.group_id = a.group_id) AS variant_count,
         /* R4 ⑤ 变体分列：同组 (kind,value) 全集，一条相关子查询算完，见 variantDims.ts 头注 */
         (SELECT group_concat(v.variant_kind || char(31) || v.variant_value, char(30))
            FROM variant v WHERE v.group_id = a.group_id) AS variant_dims,
         (SELECT COUNT(*) FROM asset c WHERE c.parent_asset_id = a.id AND c.attachment_kind IS NULL) AS child_count,
         /**
          * 容器里"能单独拿出来用"的件数：子项自己有版本行时数版本，没有就数它自己。
          * 归并型容器（20 个 Libero = 1 个子项 + 20 个版本行）靠它才显示得出"20 个模型变体"，
          * 直接拿 child_count 会显示成 1。合集型仍用 child_count（"含 17 项"就是 17 个子项）。
          */
         (SELECT COALESCE(SUM(
            CASE WHEN (SELECT COUNT(*) FROM asset g WHERE g.parent_asset_id = c.id AND g.attachment_kind IS NULL) > 0
                 THEN (SELECT COUNT(*) FROM asset g WHERE g.parent_asset_id = c.id AND g.attachment_kind IS NULL)
                 ELSE 1 END), 0)
            FROM asset c WHERE c.parent_asset_id = a.id AND c.attachment_kind IS NULL) AS unit_count,
         (SELECT COUNT(*) FROM asset c WHERE c.parent_asset_id = a.id AND c.attachment_kind IS NOT NULL) AS attachment_count,
         (SELECT p.name FROM asset p WHERE p.id = a.parent_asset_id) AS parent_name,
         (SELECT b.name FROM bundle b WHERE b.id = a.bundle_id) AS bundle_name,
         (SELECT GROUP_CONCAT(t.name, '|') FROM asset_tag at2
            JOIN tag t ON t.id = at2.tag_id WHERE at2.asset_id = a.id) AS tags,
         ROW_NUMBER() OVER (PARTITION BY COALESCE(a.group_id, a.id) ORDER BY a.id) AS rn
  FROM asset a`

/**
 * M1/M2 阶段用 LIKE + search_alias；M4 换成 MiniSearch 内存索引。
 * grouped 视图下每个 group 只出一张代表卡（ULID 最小 = 最早创建的变体）。
 */
export function queryCards(
  db: Db,
  filter: AssetFilter,
  config: CategoryConfig,
  locale: LocaleKey
): { cards: AssetCard[]; total: number } {
  const grouped = (filter.view ?? 'grouped') === 'grouped'
  const { sql: whereSql, params } = buildWhere(filter)
  const limit = filter.limit ?? 500
  const offset = filter.offset ?? 0

  const rows = (
    grouped
      ? db
          .prepare(
            `SELECT * FROM (${CARD_SELECT} ${whereSql}) WHERE rn = 1
             ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`
          )
          .all(...params, limit, offset)
      : db
          .prepare(`${CARD_SELECT} ${whereSql} ORDER BY a.updated_at DESC, a.id LIMIT ? OFFSET ?`)
          .all(...params, limit, offset)
  ) as CardQueryRow[]

  const countRow = db
    .prepare(
      grouped
        ? `SELECT COUNT(*) AS n FROM (SELECT COALESCE(a.group_id, a.id) AS g FROM asset a ${whereSql} GROUP BY g)`
        : `SELECT COUNT(*) AS n FROM asset a ${whereSql}`
    )
    .get(...params) as { n: number } | undefined

  const cards = rows.map((r) => {
    const { categoryLabel, subcategoryLabel } = labelOf(config, r.category, r.subcategory, locale)
    return {
      id: r.id,
      groupId: r.group_id,
      name: r.name,
      rawName: r.raw_name,
      category: r.category,
      categoryLabel,
      subcategory: r.subcategory,
      subcategoryLabel,
      status: r.status,
      confidence: r.confidence,
      kind: r.kind,
      variantCount: Number(r.variant_count || 0),
      /** 维度换算只在这一处做（`shared/variantDims.ts`），界面不许再拆一遍字符串 */
      dims: parseVariantDims(r.variant_dims),
      coverImage: r.cover_image,
      bundleName: r.bundle_name,
      isBundle: Number(r.is_bundle || 0) === 1,
      childCount: Number(r.child_count || 0),
      unitCount: Number(r.unit_count || 0),
      attachmentCount: Number(r.attachment_count || 0),
      containerKind: (r.container_kind as AssetCard['containerKind']) ?? null,
      variantRaw: r.variant_raw,
      parentName: r.parent_name,
      tags: r.tags ? String(r.tags).split('|').filter(Boolean) : [],
      sizeBytes: r.size_bytes,
      updatedAt: r.updated_at
    }
  })

  return { cards, total: countRow ? Number(countRow.n) : 0 }
}
