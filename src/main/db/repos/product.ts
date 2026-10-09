import type { Db } from '../index'
import { ulid } from '../../../shared/ulid'
import { sortDims } from '../../../shared/variantDims'
import type {
  AssetGroupRow,
  AssetRow,
  BundleRow,
  VariantDim,
  VariantKind,
  VariantRow
} from '../../../shared/types'

/**
 * 产品组 / 变体 / 合集 —— 第 2 份 §3 归并、§4 拆分的落库处。
 * M1 只提供正确的读写与"孤儿变体解散"，算法在 M3 接上。
 */

/**
 * 取（或建）一个归并组。
 *
 * **dirKey 就是 #40 的闸门。** 用户裁定原文：
 * 「归并的前提是同一父容器（同目录），跨目录的 groupKey 相同不构成归并理由」。
 * 传了 dirKey 就只在**同目录**的组里复用；传 undefined 保持老的全局复用（只给
 * 确实拿不到路径的调用方用 —— 和 checkIngestPath 的 registeredDirs 一个套路：
 * 没查过库就不放行，查过就必须传）。
 *
 * dir_key 为 NULL 的历史组（V4 迁移里目录不一致的那些）不会被任何带 dirKey 的
 * 请求吸附 —— 它们是跨目录误并的存量，等健康检查拆，不该继续吃新成员。
 */
export function ensureGroup(
  db: Db,
  input: { groupKey: string; name: string; category: string; subcategory?: string | null; dirKey?: string | null }
): AssetGroupRow {
  /**
   * 三种口径要分清，混了就等于把 #40 白修：
   *  - undefined → 调用方压根没查过目录：保持老的全局复用
   *  - 字符串    → 只和同目录的组复用
   *  - 显式 null → 这条素材确实没有目录（路径只剩盘符那类）：只和同样 NULL 的组复用。
   *    注意不能写成 `dir_key = ?` 传 null —— SQL 里 `= NULL` 永远不成立，
   *    那样每次调用都新建一个组，组表会被灌水。
   */
  const sel =
    input.dirKey === undefined
      ? db.prepare(`SELECT * FROM asset_group WHERE group_key = ? AND category = ?`)
      : input.dirKey === null
        ? db.prepare(`SELECT * FROM asset_group WHERE group_key = ? AND category = ? AND dir_key IS NULL`)
        : db.prepare(`SELECT * FROM asset_group WHERE group_key = ? AND category = ? AND dir_key = ?`)
  // IS NULL 那一支没有第三个占位符，参数个数必须跟着变（传多了 better-sqlite3 直接抛）
  const args = input.dirKey === undefined || input.dirKey === null ? [input.groupKey, input.category] : [input.groupKey, input.category, input.dirKey]
  const found = sel.get(...args) as AssetGroupRow | undefined
  if (found) return found
  const now = Date.now()
  const row: AssetGroupRow = {
    id: ulid(),
    group_key: input.groupKey,
    name: input.name,
    category: input.category,
    subcategory: input.subcategory ?? null,
    created_at: now,
    updated_at: now,
    /** 回读要带 dir_key：调用方拿这个对象判"是不是吸附到历史 NULL 组上"（真库副本测试就是这么抓的） */
    dir_key: input.dirKey ?? null
  }
  db.prepare(
    `INSERT INTO asset_group (id, group_key, name, category, subcategory, created_at, updated_at, dir_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.group_key, row.name, row.category, row.subcategory, now, now, input.dirKey ?? null)
  return row
}

export function getGroup(db: Db, id: string): AssetGroupRow | null {
  const row = db.prepare(`SELECT * FROM asset_group WHERE id = ?`).get(id) as AssetGroupRow | undefined
  return row ?? null
}

export function renameGroup(db: Db, id: string, name: string): void {
  db.prepare(`UPDATE asset_group SET name = ?, updated_at = ? WHERE id = ?`).run(name, Date.now(), id)
}

export function listGroups(db: Db): AssetGroupRow[] {
  return db.prepare(`SELECT * FROM asset_group ORDER BY name`).all() as AssetGroupRow[]
}

export function addVariant(
  db: Db,
  input: { groupId: string; assetId: string; kind: VariantKind; value: string }
): VariantRow {
  const existing = db
    .prepare(
      `SELECT * FROM variant WHERE group_id = ? AND variant_kind = ? AND variant_value = ?`
    )
    .get(input.groupId, input.kind, input.value) as VariantRow | undefined
  if (existing) return existing
  const row: VariantRow = {
    id: ulid(),
    group_id: input.groupId,
    asset_id: input.assetId,
    variant_kind: input.kind,
    variant_value: input.value
  }
  db.prepare(
    `INSERT INTO variant (id, group_id, asset_id, variant_kind, variant_value)
     VALUES (?, ?, ?, ?, ?)`
  ).run(row.id, row.group_id, row.asset_id, row.variant_kind, row.variant_value)
  return row
}

export function listVariants(db: Db, groupId: string): VariantRow[] {
  return db
    .prepare(`SELECT * FROM variant WHERE group_id = ? ORDER BY variant_kind, variant_value`)
    .all(groupId) as VariantRow[]
}

export function countVariants(db: Db, groupId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM variant WHERE group_id = ?`)
    .get(groupId) as { n: number }
  return Number(row.n)
}

/** 归并是可逆的：把 asset 从组里摘出来，组内只剩 1 个成员时自动解散（第 1 份 F9 孤儿变体） */
export function detachAssetFromGroup(db: Db, assetId: string): { dissolved: boolean } {
  const asset = db.prepare(`SELECT group_id AS g FROM asset WHERE id = ?`).get(assetId) as
    | { g: string | null }
    | undefined
  if (!asset || !asset.g) return { dissolved: false }
  const groupId = asset.g
  db.transaction(() => {
    db.prepare(`DELETE FROM variant WHERE asset_id = ?`).run(assetId)
    db.prepare(`UPDATE asset SET group_id = NULL, updated_at = ? WHERE id = ?`).run(Date.now(), assetId)
  })()
  const remain = (
    db.prepare(`SELECT COUNT(*) AS n FROM asset WHERE group_id = ?`).get(groupId) as { n: number }
  ).n
  if (Number(remain) <= 1) {
    db.transaction(() => {
      const kids = db
        .prepare(`SELECT id FROM asset WHERE group_id = ?`)
        .all(groupId) as Array<{ id: string }>
      for (const k of kids) {
        db.prepare(`UPDATE asset SET group_id = NULL, updated_at = ? WHERE id = ?`).run(
          Date.now(),
          k.id
        )
      }
      db.prepare(`DELETE FROM variant WHERE group_id = ?`).run(groupId)
      db.prepare(`DELETE FROM asset_group WHERE id = ?`).run(groupId)
    })()
    return { dissolved: true }
  }
  return { dissolved: false }
}

export function mergeIntoGroup(
  db: Db,
  groupId: string,
  assetIds: string[],
  variants: Array<{ assetId: string; kind: VariantKind; value: string }>
): void {
  db.transaction(() => {
    for (const id of assetIds) {
      db.prepare(`UPDATE asset SET group_id = ?, updated_at = ? WHERE id = ?`).run(
        groupId,
        Date.now(),
        id
      )
    }
    for (const v of variants) {
      addVariant(db, { groupId, assetId: v.assetId, kind: v.kind, value: v.value })
    }
  })()
}

export interface GroupSummaryRow {
  groupId: string
  key: string
  name: string
  category: string
  subcategory: string | null
  variantCount: number
  /** 这个组里各素材是"按什么维度不一样"的：聚合视图的徽章要用 */
  dims: VariantDim[]
  assetIds: string[]
}

export function summarizeGroups(db: Db): GroupSummaryRow[] {
  const groups = listGroups(db)
  return groups.map((g) => {
    const assets = db
      .prepare(`SELECT id FROM asset WHERE group_id = ? ORDER BY id`)
      .all(g.id) as Array<{ id: string }>
    const variants = listVariants(db, g.id)
    const byKind = new Map<string, string[]>()
    for (const v of variants) {
      const list = byKind.get(v.variant_kind) ?? []
      if (!list.includes(v.variant_value)) list.push(v.variant_value)
      byKind.set(v.variant_kind, list)
    }
    return {
      groupId: g.id,
      key: g.group_key,
      name: g.name,
      category: g.category,
      subcategory: g.subcategory,
      /**
       * 徽章上"N 变体"数的是**我手上这个产品有几份**（组内素材数），不是 variant 行数。
       * 一个 zip 里带 11 个体型的目录时 variant 行会有 11 条，但那是一件事，不是 11 个变体
       * —— 实测：束縛チャイナFULLSET 一张卡上标过"12 变体"。
       * 真正的差异维度走 dims，供聚合视图分列展示。
       */
      variantCount: assets.length,
      /** 排序走 `sortDims`：卡片列表（SQL 那条路）和这里必须是同一个顺序，两边各排一遍迟早漂 */
      dims: sortDims(Array.from(byKind.entries()).map(([kind, values]) => ({ kind, values }))),
      assetIds: assets.map((a) => a.id)
    }
  })
}

// ---------------------------------------------------------------- 合集（bundle）

export function ensureBundle(
  db: Db,
  input: { name: string; sourcePath?: string | null; coverImage?: string | null }
): BundleRow {
  const now = Date.now()
  const existing = input.sourcePath
    ? (db.prepare(`SELECT * FROM bundle WHERE source_path = ?`).get(input.sourcePath) as
        | BundleRow
        | undefined)
    : undefined
  if (existing) {
    db.prepare(`UPDATE bundle SET name = ?, cover_image = ?, created_at = created_at WHERE id = ?`).run(
      input.name,
      input.coverImage ?? existing.cover_image,
      existing.id
    )
    const row = db.prepare(`SELECT * FROM bundle WHERE id = ?`).get(existing.id) as BundleRow
    return row
  }
  const row: BundleRow = {
    id: ulid(),
    name: input.name,
    source_path: input.sourcePath ?? null,
    cover_image: input.coverImage ?? null,
    asset_count: 0,
    created_at: now
  }
  db.prepare(
    `INSERT INTO bundle (id, name, source_path, cover_image, asset_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.name, row.source_path, row.cover_image, row.asset_count, now)
  return row
}

export function getBundle(db: Db, id: string): BundleRow | null {
  const row = db.prepare(`SELECT * FROM bundle WHERE id = ?`).get(id) as BundleRow | undefined
  return row ?? null
}

export function refreshBundleCount(db: Db, bundleId: string): number {
  const n = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM asset WHERE bundle_id = ?`).get(bundleId) as { n: number }).n
  )
  db.prepare(`UPDATE bundle SET asset_count = ? WHERE id = ?`).run(n, bundleId)
  return n
}

export function listBundles(db: Db): BundleRow[] {
  return db.prepare(`SELECT * FROM bundle ORDER BY name`).all() as BundleRow[]
}

/** 归并/拆分都只动表，绝不动磁盘上的文件 */
export function assetsOfBundle(db: Db, bundleId: string): AssetRow[] {
  return db.prepare(`SELECT * FROM asset WHERE bundle_id = ? ORDER BY name`).all(bundleId) as AssetRow[]
}
