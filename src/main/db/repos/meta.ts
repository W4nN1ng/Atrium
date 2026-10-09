import type { Db } from '../index'
import { ulid } from '../../../shared/ulid'
import type { AssetTagRow, CollectionRow, CollectionRule, TagKind, TagRow } from '../../../shared/types'

// ---------------------------------------------------------------- 标签

export function ensureTag(db: Db, name: string, kind: TagKind = 'user', color?: string | null): TagRow {
  const existing = db.prepare(`SELECT * FROM tag WHERE name = ?`).get(name) as TagRow | undefined
  if (existing) return existing
  const row: TagRow = { id: ulid(), name, color: color ?? null, kind }
  db.prepare(`INSERT INTO tag (id, name, color, kind) VALUES (?, ?, ?, ?)`).run(
    row.id,
    row.name,
    row.color,
    row.kind
  )
  return row
}

export function tagNamesOf(db: Db, assetId: string): string[] {
  return (
    db
      .prepare(
        `SELECT t.name AS name FROM asset_tag at2 JOIN tag t ON t.id = at2.tag_id WHERE at2.asset_id = ?`
      )
      .all(assetId) as Array<{ name: string }>
  ).map((r) => r.name)
}

export function tagsOf(db: Db, assetId: string): TagRow[] {
  return db
    .prepare(
      `SELECT t.* FROM asset_tag at2 JOIN tag t ON t.id = at2.tag_id WHERE at2.asset_id = ? ORDER BY t.kind, t.name`
    )
    .all(assetId) as TagRow[]
}

export function setAssetTags(
  db: Db,
  assetId: string,
  names: string[],
  kind: TagKind = 'user',
  source: 'auto' | 'learned' | 'user' = 'auto'
): void {
  db.transaction(() => {
    const keep = names.map((n) => ensureTag(db, n, kind).id)
    // 只清"这一类"标签：按 (asset, source) 整批删的话，
    // 后写的 topic 标签会把先写的 avatar 标签一起抹掉（实测踩过：适配体型全丢）
    db.prepare(
      `DELETE FROM asset_tag
        WHERE asset_id = ? AND source = ?
          AND tag_id IN (SELECT id FROM tag WHERE kind = ?)`
    ).run(assetId, source, kind)
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO asset_tag (asset_id, tag_id, source) VALUES (?, ?, ?)`
    )
    for (const tagId of keep) stmt.run(assetId, tagId, source)
  })()
}

/**
 * 只加标签、不清别的来源的（setAssetTags 会按 source 整批替换，
 * 一个素材的"适配体型"和"话题标签"得分开写，否则后写的会把先写的抹掉）。
 */
export function addAssetTags(
  db: Db,
  assetId: string,
  names: string[],
  kind: TagKind = 'user',
  source: 'auto' | 'learned' | 'user' = 'auto'
): void {
  if (!names.length) return
  db.transaction(() => {
    const stmt = db.prepare(`INSERT OR IGNORE INTO asset_tag (asset_id, tag_id, source) VALUES (?, ?, ?)`)
    for (const n of names) stmt.run(assetId, ensureTag(db, n, kind).id, source)
  })()
}

export function removeAssetTag(db: Db, assetId: string, tagName: string): void {
  db.prepare(
    `DELETE FROM asset_tag WHERE asset_id = ? AND tag_id = (SELECT id FROM tag WHERE name = ?)`
  ).run(assetId, tagName)
}

export function allTags(db: Db): Array<TagRow & { usage: number }> {
  return db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM asset_tag at2 WHERE at2.tag_id = t.id) AS usage
       FROM tag t ORDER BY usage DESC, t.name`
    )
    .all() as Array<TagRow & { usage: number }>
}

export function findAssetsByTag(db: Db, tagName: string): AssetTagRow[] {
  return db
    .prepare(
      `SELECT at2.* FROM asset_tag at2 JOIN tag t ON t.id = at2.tag_id WHERE t.name = ?`
    )
    .all(tagName) as AssetTagRow[]
}

// ---------------------------------------------------------------- 集合（虚拟分区）

/**
 * `CollectionRule` 的定义在 `src/shared/types.ts`（2026-10-06 挪过去的，
 * 因为 M6 的 `shared/projectMatch.ts` 也要读它）。这里只 import 来用。
 */

export function listCollections(db: Db): CollectionRow[] {
  return db.prepare(`SELECT * FROM collection ORDER BY sort_order, name`).all() as CollectionRow[]
}

export function createCollection(
  db: Db,
  input: { name: string; icon?: string | null; rule?: CollectionRule | null; isAuto?: boolean; priority?: number }
): CollectionRow {
  const maxOrder = Number(
    (db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS n FROM collection`).get() as { n: number }).n
  )
  const row: CollectionRow = {
    id: ulid(),
    name: input.name,
    icon: input.icon ?? null,
    sort_order: maxOrder + 10,
    rule_json: input.rule ? JSON.stringify(input.rule) : null,
    is_auto: input.isAuto ? 1 : 0,
    priority: input.priority ?? 0
  }
  db.prepare(
    `INSERT INTO collection (id, name, icon, sort_order, rule_json, is_auto, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.name, row.icon, row.sort_order, row.rule_json, row.is_auto, row.priority)
  return row
}

export function updateCollection(db: Db, id: string, patch: Partial<CollectionRow>): CollectionRow | null {
  const keys = Object.keys(patch).filter((k) =>
    ['name', 'icon', 'sort_order', 'rule_json', 'is_auto', 'priority'].includes(k)
  ) as Array<keyof CollectionRow>
  if (keys.length) {
    db.prepare(
      `UPDATE collection SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`
    ).run(...keys.map((k) => patch[k] as string | number | null), id)
  }
  const row = db.prepare(`SELECT * FROM collection WHERE id = ?`).get(id) as CollectionRow | undefined
  return row ?? null
}

export function removeCollection(db: Db, id: string): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM collection_asset WHERE collection_id = ?`).run(id)
    db.prepare(`DELETE FROM collection WHERE id = ?`).run(id)
  })()
}

export function addAssetsToCollection(db: Db, collectionId: string, assetIds: string[]): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO collection_asset (collection_id, asset_id, added_at) VALUES (?, ?, ?)`
  )
  let n = 0
  db.transaction(() => {
    for (const id of assetIds) {
      stmt.run(collectionId, id, Date.now())
      n++
    }
  })()
  return n
}

export function removeAssetFromCollection(db: Db, collectionId: string, assetId: string): void {
  db.prepare(`DELETE FROM collection_asset WHERE collection_id = ? AND asset_id = ?`).run(
    collectionId,
    assetId
  )
}

export function collectionsOfAsset(db: Db, assetId: string): CollectionRow[] {
  return db
    .prepare(
      `SELECT c.* FROM collection c
        JOIN collection_asset ca ON ca.collection_id = c.id
       WHERE ca.asset_id = ? ORDER BY c.sort_order`
    )
    .all(assetId) as CollectionRow[]
}

export function collectionCount(db: Db, collectionId: string): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM collection_asset WHERE collection_id = ?`).get(collectionId) as {
      n: number
    }).n
  )
}

export function parseRule(row: CollectionRow): CollectionRule | null {
  if (!row.rule_json) return null
  try {
    return JSON.parse(row.rule_json) as CollectionRule
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- 检索别名（第 1 份 F5：拼音/假名互搜）

export function setSearchAliases(db: Db, assetId: string, field: string, aliases: string[]): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM search_alias WHERE asset_id = ? AND field = ?`).run(assetId, field)
    const stmt = db.prepare(`INSERT OR IGNORE INTO search_alias (asset_id, field, alias) VALUES (?, ?, ?)`)
    for (const a of new Set(aliases.filter(Boolean))) stmt.run(assetId, field, a)
  })()
}

export function aliasesOf(db: Db, assetId: string): string[] {
  return (
    db.prepare(`SELECT alias FROM search_alias WHERE asset_id = ?`).all(assetId) as Array<{ alias: string }>
  ).map((r) => r.alias)
}
