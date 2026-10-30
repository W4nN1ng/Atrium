import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildIntakePlan, type PlannerIndex } from '../../src/main/intake/planner'
import { persistIntakePlan, readIntakePlan, readLibraryBlobIndex } from '../../src/main/db/repos/intakePlan'
import { migrate } from '../../src/main/db'
import { seedIntakeV11, snapshotIntakeLegacy } from '../helpers/intakeV11'
import { loadLexicon } from '../../src/main/classify/lexicon'
import type { ClassifyDeps } from '../../src/main/classify/engine'
const databases: Database.Database[] = []
function unchangedTables(db: Database.Database) { const { intake_plan: _plans, ...rest } = snapshotIntakeLegacy(db); return rest }
let deps: ClassifyDeps
beforeAll(() => { deps = { lex: loadLexicon({ builtin: path.resolve('resources/lexicon/lexicon.json') }), categories: JSON.parse(fs.readFileSync('resources/lexicon/categories.json', 'utf8')) } })
afterEach(() => { for (const db of databases.splice(0)) db.close() })
function setup() {
  const db = new Database(':memory:'); databases.push(db); seedIntakeV11(db); migrate(db)
  const sha = 'a'.repeat(64)
  const index: PlannerIndex = { libraryRoot: 'E:/library', classifyDeps: deps, sources: [{ sourcePath: 'E:/source/item', kind: 'directory', closure: { opaque: false, warnings: [], cacheKeys: ['b'.repeat(64)], leaves: [{ key: { size: 10, crc32: 1 }, blobId: sha, relPath: 'a.unitypackage', chain: [], localPath: 'E:/source/item/a.unitypackage' }] } }] }
  const plan = buildIntakePlan('E:/source/item', index, [])
  return { db, plan, index, sha }
}
describe('intake plan repository', () => {
  it('serializes the exact immutable plan and persists cache references without touching assets/covers', () => {
    const { db, plan } = setup(), before = unchangedTables(db)
    expect(persistIntakePlan(db, plan, 100)).toMatchObject({ inserted: true, status: 'planned' })
    expect(readIntakePlan(db, plan.id)?.plan).toEqual(JSON.parse(JSON.stringify(plan)))
    expect(readIntakePlan(db, plan.id)?.progress.cacheKeys).toEqual(plan.cacheKeys)
    expect(unchangedTables(db)).toEqual(before)
    expect((db.prepare('SELECT count(*) AS n FROM content_blob').get() as { n: number }).n).toBe(0)
  })
  it('does not reset completed operations or running status when the same plan is saved again', () => {
    const { db, plan } = setup(); persistIntakePlan(db, plan, 100)
    const op = plan.units[0].copyOps[0]
    const progress = { completedOps: { [op.id]: { blobId: 'a'.repeat(64), targetPath: `E:/library/${op.targetRelPath}`, idempotencyKey: op.idempotencyKey } }, failedOps: {}, cacheKeys: plan.cacheKeys }
    db.prepare("UPDATE intake_plan SET status='running',progress_json=?,updated_at=200 WHERE id=?").run(JSON.stringify(progress), plan.id)
    expect(persistIntakePlan(db, plan, 300)).toMatchObject({ inserted: false, status: 'running' })
    expect(readIntakePlan(db, plan.id)?.progress).toEqual(progress)
    expect((db.prepare('SELECT updated_at FROM intake_plan WHERE id=?').get(plan.id) as { updated_at: number }).updated_at).toBe(200)
  })
  it('persists existing-asset coverage as duplicate without creating an asset', () => {
    const { db, index, sha } = setup()
    const assetId = (db.prepare('SELECT id FROM asset ORDER BY id LIMIT 1').get() as { id: string }).id
    db.prepare('INSERT INTO content_blob(blob_id,size,crc32,storage_path) VALUES(?,?,?,?)').run(sha, 10, 1, `E:/library/.atrium/blobs/${sha}`)
    db.prepare('INSERT INTO asset_blob_ref(id,asset_id,blob_id,rel_path,path_key) VALUES(?,?,?,?,?)').run('r', assetId, sha, 'a.unitypackage', 'a.unitypackage')
    const before = unchangedTables(db), blobs = readLibraryBlobIndex(db, 'E:/library')
    expect(blobs[0].refs).toEqual([{ assetId, relPath: 'a.unitypackage' }])
    const plan = buildIntakePlan('E:/source/item', index, blobs)
    expect(persistIntakePlan(db, plan)).toMatchObject({ status: 'duplicate' })
    expect(unchangedTables(db)).toEqual(before)
  })
  it('does not admit edited JSON under the original immutable plan ID', () => {
    const { db, plan } = setup(); persistIntakePlan(db, plan)
    const edited = JSON.parse(JSON.stringify(plan)); edited.units[0].copyOps[0].targetRelPath = '../outside'
    expect(() => persistIntakePlan(db, edited)).toThrow(/digest/)
    expect(readIntakePlan(db, plan.id)?.plan.id).toBe(plan.id)
  })
  it('rejects unknown versions and corrupt progress without rewriting their rows', () => {
    const { db, plan } = setup(); persistIntakePlan(db, plan)
    const unknown = { ...plan, schemaVersion: 999 }
    db.prepare('UPDATE intake_plan SET plan_json=? WHERE id=?').run(JSON.stringify(unknown), plan.id)
    expect(() => readIntakePlan(db, plan.id)).toThrow(/version/)
    db.prepare('UPDATE intake_plan SET plan_json=?,progress_json=? WHERE id=?').run(JSON.stringify(plan), '{}', plan.id)
    expect(() => readIntakePlan(db, plan.id)).toThrow(/progress/)
    expect((db.prepare('SELECT progress_json FROM intake_plan WHERE id=?').get(plan.id) as { progress_json: string }).progress_json).toBe('{}')
  })
  it('persists pending identity review as awaiting_confirm, never duplicate', () => {
    const { db, index, sha } = setup(); index.sources[0].closure.leaves[0] = { ...index.sources[0].closure.leaves[0], blobId: undefined }
    const plan = buildIntakePlan('E:/source/item', index, [{ blobId: sha, key: { size: 10, crc32: 1 }, storagePath: 'E:/library/.atrium/blob', refs: [{ assetId: 'legacy-a', relPath: 'a' }] }])
    expect(persistIntakePlan(db, plan)).toMatchObject({ status: 'awaiting_confirm' })
    expect(readIntakePlan(db, plan.id)?.plan.reviews).toHaveLength(1)
  })
  it('refuses completed progress for an unknown operation instead of silently skipping work', () => {
    const { db, plan } = setup(); persistIntakePlan(db, plan)
    const progress = { completedOps: { unknown: { blobId: 'a'.repeat(64), targetPath: 'E:/library/item/a.unitypackage', idempotencyKey: 'b'.repeat(64) } }, failedOps: {}, cacheKeys: plan.cacheKeys }
    db.prepare('UPDATE intake_plan SET progress_json=? WHERE id=?').run(JSON.stringify(progress), plan.id)
    expect(() => readIntakePlan(db, plan.id)).toThrow(/completed/)
  })
})
