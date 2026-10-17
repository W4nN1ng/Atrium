import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset, getAsset } from '../../src/main/db/repos/asset'
import { getCover, saveCover, referencedCoverKeys } from '../../src/main/db/repos/covers'
import { captureCoverSnapshot, rememberCoverTaskBefore, recordCoverTaskApplied, undoCoverTask, pruneCoverTaskBackups } from '../../src/main/db/repos/coverTasks'
const options = { direction: 'front' as const, background: 'light' as const }
const target = { id: 'object', name: 'First', path: 'Assets/First.prefab', persistent: true, isScene: false, sourceGuid: 'a'.repeat(32) }
let db: Db
beforeEach(() => { db = new Database(':memory:'); migrate(db); upsertAsset(db, makeAssetRow({ id: 'one', name: 'one', raw_name: 'one', category: 'props', cover_image: 'athumb://product.jpg' })) })
afterEach(() => db.close())
const update = (url: string) => saveCover(db, { assetId: 'one', coverImage: url, source: 'package', projectId: 'dependency', target, options })
function apply(task = 'task') { rememberCoverTaskBefore(db, task, 'one', captureCoverSnapshot(db, 'one')!); update('athumb://new.jpg'); recordCoverTaskApplied(db, task, 'one', captureCoverSnapshot(db, 'one')!) }
describe('conditional cover-task undo', () => {
  it('restores the exact immediately previous image, target, options and original-image association', () => {
    update('athumb://previous.jpg'); const before = getCover(db, 'one')
    apply(); expect(undoCoverTask(db, 'task')).toEqual({ restored: 1, preserved: 0 })
    expect(getCover(db, 'one')).toEqual(before); expect(getAsset(db, 'one')?.cover_image).toBe('athumb://previous.jpg')
  })
  it('restores a missing association without synthesizing one and is idempotent', () => {
    apply(); expect(undoCoverTask(db, 'task')).toEqual({ restored: 1, preserved: 0 })
    expect(getCover(db, 'one')).toBeNull(); expect(getAsset(db, 'one')?.cover_image).toBe('athumb://product.jpg')
    expect(undoCoverTask(db, 'task')).toEqual({ restored: 0, preserved: 0 })
  })
  it('preserves later association edits even when the image URL matches, and never recreates deleted assets', () => {
    apply(); saveCover(db, { assetId: 'one', coverImage: 'athumb://new.jpg', source: 'package', projectId: 'changed', target, options })
    expect(undoCoverTask(db, 'task')).toEqual({ restored: 0, preserved: 1 })
    db.prepare('DELETE FROM asset WHERE id=?').run('one')
    expect(undoCoverTask(db, 'task').restored).toBe(0); expect(getAsset(db, 'one')).toBeNull()
  })
  it('protects all backup images including full record originals, even when excluding the current asset', () => {
    update('athumb://previous.jpg'); apply()
    expect(referencedCoverKeys(db, 'one')).toEqual(new Set(['previous', 'product', 'new']))
  })
  it('retains the first snapshot over repeated saves and bounds retained task backups', () => {
    apply('old'); const first = captureCoverSnapshot(db, 'one')!
    rememberCoverTaskBefore(db, 'old', 'one', first); update('athumb://second.jpg'); recordCoverTaskApplied(db, 'old', 'one', captureCoverSnapshot(db, 'one')!)
    expect(undoCoverTask(db, 'old').restored).toBe(1); expect(getCover(db, 'one')).toBeNull()
    for (let n = 0; n < 12; n++) { apply('task-' + n); db.prepare('UPDATE cover_task_backup SET created_at=? WHERE task_id=?').run(n, 'task-' + n) }
    pruneCoverTaskBackups(db, 10)
    expect(db.prepare('SELECT COUNT(DISTINCT task_id) AS n FROM cover_task_backup').get()).toEqual({ n: 10 })
    expect(undoCoverTask(db, 'task-0')).toEqual({ restored: 0, preserved: 0 })
  })
})
