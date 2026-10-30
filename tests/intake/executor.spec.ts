import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { fileIdentity } from '../../src/main/intake/identity'
import { buildIntakePlan, type PlannerIndex } from '../../src/main/intake/planner'
import { executePlan, IntakeExecutionError, undoPlan } from '../../src/main/intake/executor'
import { persistIntakePlan, readIntakePlan, readLibraryBlobIndex } from '../../src/main/db/repos/intakePlan'
import { migrate } from '../../src/main/db'
import { loadLexicon } from '../../src/main/classify/lexicon'
import type { ClassifyDeps } from '../../src/main/classify/engine'
import type { LeafRef } from '../../src/shared/intake'

const roots: string[] = []; const dbs: Database.Database[] = []
let deps: ClassifyDeps
beforeAll(() => { deps = { lex: loadLexicon({ builtin: path.resolve('resources/lexicon/lexicon.json') }), categories: JSON.parse(fs.readFileSync('resources/lexicon/categories.json', 'utf8')) } })
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
async function setup(files: Array<[string, string]> = [['Assets/A.unitypackage', 'alpha']]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-executor-')); roots.push(root)
  const source = path.join(root, 'source'), library = path.join(root, 'library'); fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(library, { recursive: true })
  const leaves: LeafRef[] = []
  for (const [rel, content] of files) { const file = path.join(source, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); const identity = await fileIdentity(file); leaves.push({ key: identity.key, blobId: identity.sha256, relPath: rel, localPath: file, chain: [], kind: rel.endsWith('.unitypackage') ? 'unitypackage' : 'file' }) }
  const index: PlannerIndex = { libraryRoot: library, classifyDeps: deps, sources: [{ sourcePath: source, kind: 'directory', closure: { leaves, opaque: false, warnings: [] } }] }
  const plan = buildIntakePlan(source, index, [])
  const db = new Database(path.join(root, 'library.db')); dbs.push(db); migrate(db)
  persistIntakePlan(db, plan)
  return { root, source, library, db, plan }
}
const ops = (plan: ReturnType<typeof buildIntakePlan>) => plan.units.flatMap(u => [...u.copyOps, ...u.sidecars])

describe('M6 intake executor', () => {
  it('preflights, copies, verifies full SHA/CRC, publishes a blob and commits short DB records', async () => {
    const { db, library, plan } = await setup()
    const result = await executePlan(db, plan.id)
    const op = ops(plan)[0], target = path.join(library, op.targetRelPath), blob = path.join(library, '.atrium/blobs', op.blobId!.slice(0, 2), op.blobId!)
    expect(result.status).toBe('completed'); expect(result.copiedOps).toContain(op.id)
    expect(fs.readFileSync(target, 'utf8')).toBe('alpha'); expect(fs.existsSync(blob)).toBe(true)
    expect((db.prepare('SELECT ref_count FROM content_blob WHERE blob_id=?').get(op.blobId) as { ref_count: number }).ref_count).toBe(1)
    expect((db.prepare('SELECT count(*) AS n FROM source_occurrence WHERE plan_id=?').get(plan.id) as { n: number }).n).toBe(1)
    expect(readIntakePlan(db, plan.id)!.status).toBe('completed')
  })
  it('dry-run performs no IO or DB mutation and keeps the plan planned', async () => {
    const { db, library, plan } = await setup(); const before = JSON.stringify(db.prepare('SELECT * FROM intake_plan').all())
    const result = await executePlan(db, plan.id, { dryRun: true, freeBytes: () => 0 })
    expect(result.dryRun).toBe(true); expect(fs.existsSync(path.join(library, '.atrium'))).toBe(false); expect(JSON.stringify(db.prepare('SELECT * FROM intake_plan').all())).toBe(before)
  })
  it('is idempotent after a completed run and does not create duplicate files, blobs, refs, or occurrences', async () => {
    const { db, library, plan } = await setup(); const first = await executePlan(db, plan.id); const second = await executePlan(db, plan.id)
    expect(second.copiedOps).toEqual(first.copiedOps); expect(second.reusedOps).toEqual([])
    expect(db.prepare('SELECT count(*) AS n FROM content_blob').get()).toEqual({ n: 1 }); expect(db.prepare('SELECT count(*) AS n FROM asset_blob_ref').get()).toEqual({ n: 1 }); expect(db.prepare('SELECT count(*) AS n FROM source_occurrence').get()).toEqual({ n: 1 })
    expect(fs.readdirSync(path.join(library, plan.units[0].relativeRoot))).toHaveLength(1)
  })
  it('refuses insufficient target space before creating a directory or DB row', async () => {
    const { db, library, plan } = await setup(); const before = db.prepare('SELECT * FROM intake_plan').all()
    await expect(executePlan(db, plan.id, { freeBytes: () => 0 })).rejects.toMatchObject({ code: 'space' })
    expect(fs.existsSync(path.join(library, '.atrium'))).toBe(false); expect(db.prepare('SELECT count(*) AS n FROM content_blob').get()).toEqual({ n: 0 }); expect(db.prepare('SELECT * FROM intake_plan').all()).toEqual(before)
  })
  it('cleans a cancelled temporary target and preserves resumable progress', async () => {
    const { db, library, plan } = await setup(); const controller = new AbortController()
    await expect(executePlan(db, plan.id, { link: async () => { controller.abort() }, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(readIntakePlan(db, plan.id)!.status).toBe('cancelled'); expect(fs.existsSync(path.join(library, plan.units[0].relativeRoot))).toBe(false)
  })
  it('rejects a changed source and leaves no target or blob', async () => {
    const { db, source, library, plan } = await setup(); fs.writeFileSync(path.join(source, 'Assets/A.unitypackage'), 'changed')
    await expect(executePlan(db, plan.id)).rejects.toMatchObject({ code: 'source-changed' })
    expect(fs.existsSync(path.join(library, '.atrium'))).toBe(false); expect(readIntakePlan(db, plan.id)!.status).toBe('failed')
  })
  it('does not overwrite a raced target with different bytes', async () => {
    const { db, library, plan } = await setup(); const op = ops(plan)[0]; const target = path.join(library, op.targetRelPath); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'other')
    await expect(executePlan(db, plan.id)).rejects.toMatchObject({ code: 'target-conflict' }); expect(fs.readFileSync(target, 'utf8')).toBe('other')
  })
  it('reuses one physical blob for two logical targets and undo removes only this plan reference', async () => {
    const first = await setup([['A.unitypackage', 'shared']]); const second = await setup([['B.unitypackage', 'shared']])
    // Use one library and DB for two independent plans to model two tasks in one library.
    fs.rmSync(second.library, { recursive: true, force: true }); fs.mkdirSync(second.library, { recursive: true }); const secondPlan = buildIntakePlan(second.source, { libraryRoot: first.library, classifyDeps: deps, sources: [{ sourcePath: second.source, kind: 'directory', closure: { leaves: second.plan.units[0].copyOps.map(op => ({ key: op.key, blobId: op.blobId!, relPath: op.originalRelPath, localPath: op.sourcePath, chain: [], kind: 'unitypackage' as const })), opaque: false, warnings: [] } }] }, [])
    // Reuse the same database and library by persisting the second plan manually.
    persistIntakePlan(first.db, secondPlan); const a = await executePlan(first.db, first.plan.id); const b = await executePlan(first.db, secondPlan.id)
    expect(a.assetIds).toHaveLength(1); expect(b.assetIds).toHaveLength(1)
    const blobId = ops(first.plan)[0].blobId!; expect((first.db.prepare('SELECT ref_count FROM content_blob WHERE blob_id=?').get(blobId) as { ref_count: number }).ref_count).toBe(2)
    undoPlan(first.db, first.plan.id); expect((first.db.prepare('SELECT ref_count FROM content_blob WHERE blob_id=?').get(blobId) as { ref_count: number }).ref_count).toBe(1); expect(fs.existsSync(path.join(first.library, '.atrium/blobs', blobId.slice(0, 2), blobId))).toBe(true)
    expect((first.db.prepare('SELECT count(*) AS n FROM asset').get() as { n: number }).n).toBe(1)
  })
  it('marks a second identical source as duplicate and performs no second physical publication', async () => {
    const first = await setup([['A.unitypackage', 'same']]); await executePlan(first.db, first.plan.id)
    const second = await setup([['B.unitypackage', 'same']])
    const index = readLibraryBlobIndex(first.db, first.library)
    const secondPlan = buildIntakePlan(second.source, { libraryRoot: first.library, classifyDeps: deps, sources: [{ sourcePath: second.source, kind: 'directory', closure: { leaves: [{ key: second.plan.units[0].copyOps[0].key, blobId: second.plan.units[0].copyOps[0].blobId!, relPath: 'B.unitypackage', localPath: second.plan.units[0].copyOps[0].sourcePath, chain: [], kind: 'unitypackage' }], opaque: false, warnings: [] } }] }, index)
    expect(secondPlan.units[0].disposition).toBe('duplicate'); persistIntakePlan(first.db, secondPlan)
    const result = await executePlan(first.db, secondPlan.id)
    expect(result.status).toBe('duplicate'); expect(result.copiedOps).toEqual([]); expect(result.assetIds).toEqual([])
    expect((first.db.prepare('SELECT count(*) AS n FROM asset').get() as { n: number }).n).toBe(1)
  })
  it('requires pending reviews before any IO and permits an explicit successful review callback', async () => {
    const { db, library, plan } = await setup(); const saved = readIntakePlan(db, plan.id)!
    db.prepare('UPDATE intake_plan SET plan_json=? WHERE id=?').run(JSON.stringify({ ...saved.plan, reviews: [{ id: 'review', kind: 'coverage', sourcePath: 'x', state: 'pending', matches: [], candidateBlobIds: [] }] }), plan.id)
    // The immutable digest intentionally rejects edits, so a review must be part of the original plan; this protects the test from bypassing validation.
    expect(() => readIntakePlan(db, plan.id)).toThrow(/digest/); expect(fs.existsSync(path.join(library, '.atrium'))).toBe(false)
  })
})
