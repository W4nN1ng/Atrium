import type { Db } from '..'
import type { CoverRecord, PreviewOptions, PreviewTarget } from '../../../shared/covers'
import { thumbKeyFromCover } from '../../library/thumbRules'

interface Row {
  asset_id: string; cover_image: string; previous_image: string | null
  source: 'unity' | 'image' | 'package'; project_id: string | null; target_json: string | null; options_json: string | null
}
function json<T>(value: string | null): T | null {
  if (!value) return null
  try { return JSON.parse(value) as T } catch { return null }
}
export function getCover(db: Db, assetId: string): CoverRecord | null {
  const r = db.prepare('SELECT * FROM asset_cover WHERE asset_id = ?').get(assetId) as Row | undefined
  return r ? {
    assetId: r.asset_id, coverImage: r.cover_image, previousImage: r.previous_image,
    source: r.source, projectId: r.project_id,
    target: json<PreviewTarget>(r.target_json), options: json<PreviewOptions>(r.options_json)
  } : null
}
export function saveCover(db: Db, cover: Omit<CoverRecord, 'previousImage'>, originalImage?: string | null): void {
  if (!thumbKeyFromCover(cover.coverImage)) throw new Error('covers.invalidImage')
  db.transaction(() => {
    const row = db.prepare('SELECT cover_image FROM asset WHERE id = ?').get(cover.assetId) as { cover_image: string | null } | undefined
    if (!row) throw new Error('covers.assetMissing')
    const previous = getCover(db, cover.assetId)
    db.prepare(`INSERT INTO asset_cover(asset_id, cover_image, previous_image, source, project_id, target_json, options_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET cover_image=excluded.cover_image, source=excluded.source,
      project_id=excluded.project_id, target_json=excluded.target_json, options_json=excluded.options_json, updated_at=excluded.updated_at`)
      .run(cover.assetId, cover.coverImage, previous ? previous.previousImage : originalImage === undefined ? row.cover_image : originalImage,
        cover.source, cover.projectId, cover.target ? JSON.stringify(cover.target) : null,
        cover.options ? JSON.stringify(cover.options) : null, Date.now())
    db.prepare('UPDATE asset SET cover_image = ?, updated_at = ? WHERE id = ?').run(cover.coverImage, Date.now(), cover.assetId)
  })()
}
export function restoreCover(db: Db, assetId: string): string | null {
  return db.transaction(() => {
    const cover = getCover(db, assetId)
    if (!cover) return null
    db.prepare('UPDATE asset SET cover_image = ?, updated_at = ? WHERE id = ?').run(cover.previousImage, Date.now(), assetId)
    db.prepare('DELETE FROM asset_cover WHERE asset_id = ?').run(assetId)
    return cover.previousImage
  })()
}

/** Both current and restorable originals must survive cache maintenance. */
export function referencedCoverKeys(db: Db, exceptAssetId?: string): Set<string> {
  const keys = new Set<string>()
  const covers = db.prepare('SELECT asset_id, cover_image, previous_image FROM asset_cover').all() as Array<Pick<Row, 'asset_id' | 'cover_image' | 'previous_image'>>
  for (const cover of covers) {
    if (cover.asset_id === exceptAssetId) continue
    for (const url of [cover.cover_image, cover.previous_image]) {
      const key = thumbKeyFromCover(url)
      if (key) keys.add(key)
    }
  }
  // Excluding a current asset must never exclude its task undo material.
  const backups = db.prepare('SELECT before_json, applied_json FROM cover_task_backup WHERE undone=0').all() as Array<{ before_json: string; applied_json: string | null }>
  for (const backup of backups) for (const raw of [backup.before_json, backup.applied_json]) {
    const snapshot = json<{ image: string | null; record: CoverRecord | null }>(raw)
    for (const url of [snapshot?.image, snapshot?.record?.coverImage, snapshot?.record?.previousImage]) {
      const key = thumbKeyFromCover(url ?? null)
      if (key) keys.add(key)
    }
  }
  return keys
}
