import { isDeepStrictEqual } from 'node:util'
import type { Db } from '..'
import type { CoverRecord } from '../../../shared/covers'
import type { CoverTaskUndoResult } from '../../../shared/coverTasks'
import { getAsset } from './asset'
import { getCover } from './covers'

export interface CoverSnapshot { image: string | null; record: CoverRecord | null }
export function captureCoverSnapshot(db: Db, assetId: string): CoverSnapshot | null {
  const asset = getAsset(db, assetId)
  return asset ? { image: asset.cover_image, record: getCover(db, assetId) } : null
}
export function sameCoverSnapshot(a: CoverSnapshot | null, b: CoverSnapshot | null): boolean {
  return isDeepStrictEqual(a, b)
}
export function rememberCoverTaskBefore(db: Db, taskId: string, assetId: string, snapshot: CoverSnapshot): void {
  db.prepare(`INSERT OR IGNORE INTO cover_task_backup(task_id, asset_id, before_json, created_at) VALUES (?, ?, ?, ?)`)
    .run(taskId, assetId, JSON.stringify(snapshot), Date.now())
}
export function recordCoverTaskApplied(db: Db, taskId: string, assetId: string, snapshot: CoverSnapshot): void {
  db.prepare('UPDATE cover_task_backup SET applied_json=?, undone=0 WHERE task_id=? AND asset_id=?')
    .run(JSON.stringify(snapshot), taskId, assetId)
}
export function hasCoverTaskUndo(db: Db, taskId: string): boolean {
  return !!db.prepare('SELECT 1 FROM cover_task_backup WHERE task_id=? AND applied_json IS NOT NULL AND undone=0 LIMIT 1').get(taskId)
}
export function undoCoverTask(db: Db, taskId: string, changed?: (assetId: string) => void): CoverTaskUndoResult {
  const restoredIds: string[] = []
  const result = db.transaction(() => {
    let restored = 0, preserved = 0
    const rows = db.prepare('SELECT asset_id, before_json, applied_json FROM cover_task_backup WHERE task_id=? AND applied_json IS NOT NULL AND undone=0')
      .all(taskId) as Array<{ asset_id: string; before_json: string; applied_json: string }>
    for (const row of rows) {
      const current = captureCoverSnapshot(db, row.asset_id)
      const before = JSON.parse(row.before_json) as CoverSnapshot
      const applied = JSON.parse(row.applied_json) as CoverSnapshot
      if (!current || !sameCoverSnapshot(current, applied)) { preserved++ }
      else {
        db.prepare('UPDATE asset SET cover_image=?, updated_at=? WHERE id=?').run(before.image, Date.now(), row.asset_id)
        db.prepare('DELETE FROM asset_cover WHERE asset_id=?').run(row.asset_id)
        const record = before.record
        if (record) db.prepare(`INSERT INTO asset_cover(asset_id, cover_image, previous_image, source, project_id, target_json, options_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(row.asset_id, record.coverImage, record.previousImage, record.source, record.projectId,
            record.target ? JSON.stringify(record.target) : null, record.options ? JSON.stringify(record.options) : null, Date.now())
        restored++; restoredIds.push(row.asset_id)
      }
      db.prepare('UPDATE cover_task_backup SET undone=1 WHERE task_id=? AND asset_id=?').run(taskId, row.asset_id)
    }
    return { restored, preserved }
  })()
  for (const id of restoredIds) changed?.(id)
  return result
}
/** Only completed task history is retained; callers keep the current task in the newest slot. */
export function pruneCoverTaskBackups(db: Db, retain = 10): void {
  db.prepare(`DELETE FROM cover_task_backup WHERE task_id NOT IN
    (SELECT task_id FROM cover_task_backup GROUP BY task_id ORDER BY MAX(created_at) DESC, task_id DESC LIMIT ?)`)
    .run(Math.max(0, Math.floor(retain)))
}
