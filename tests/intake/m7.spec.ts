import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db'
import { loadLexicon } from '../../src/main/classify/lexicon'
import { buildClosure } from '../../src/main/intake/closure'
import { intakeBudget } from '../../src/shared/constants'
import { buildIntakePlan } from '../../src/main/intake/planner'
import { persistIntakePlan, readIntakePlan, readLibraryBlobIndex } from '../../src/main/db/repos/intakePlan'
import { executePlan, undoPlan } from '../../src/main/intake/executor'
import { classifyPublishedUnit } from '../../src/main/intake/classification'
import { verifyCoverageReview } from '../../src/main/intake/review'

const deps = { lex: loadLexicon({ builtin: path.resolve('resources/lexicon/lexicon.json') }), categories: JSON.parse(fs.readFileSync('resources/lexicon/categories.json', 'utf8')) }
const roots: string[] = [], dbs: Database.Database[] = []
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-m7-')); roots.push(root)
  const source = path.join(root, '衣服', '西装', '未净化 单元'), library = path.join(root, 'Atrium素材库')
  fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(library)
  fs.writeFileSync(path.join(source, 'readme.txt'), '衣服 outfit costume clothing 衣装 https://booth.pm/ja/items/1234567')
  fs.writeFileSync(path.join(source, 'data.fbx'), 'mesh data')
  const closure = await buildClosure(source, { ...intakeBudget(100), cacheNamespace: root })
  const plan = buildIntakePlan(source, { libraryRoot: library, sources: [{ sourcePath: source, kind: 'directory', closure }], classifyDeps: deps }, [])
  const db = new Database(path.join(root, 'db.sqlite')); dbs.push(db); db.pragma('foreign_keys=ON'); migrate(db)
  return { root, source, library, closure, plan, db }
}
const finalizeUnit: NonNullable<Parameters<typeof executePlan>[2]>['finalizeUnit'] = async (p, u) => (await classifyPublishedUnit(p, u, deps)).classification

describe('M7 normalized execution and R21', () => {
  it('cannot execute an unpersisted plan', async () => {
    const { db, plan, library } = await setup()
    await expect(executePlan(db, plan.id, { finalizeUnit })).rejects.toThrow('找不到计划')
    expect(fs.readdirSync(library)).toEqual([])
  })
  it('classifies published files with readme, normalized entries, raw unit name and SOURCE parent chain', async () => {
    const { db, plan, source } = await setup(); persistIntakePlan(db, plan)
    await executePlan(db, plan.id, { finalizeUnit })
    const { ingest, classification } = await classifyPublishedUnit(plan, plan.units[0], deps)
    expect(ingest.rawName).toBe('未净化 单元')
    expect(ingest.stagingPath).toBe(plan.units[0].libraryPath)
    expect(ingest.sourceDirChain).toEqual(path.dirname(source).split(/[\\/]/).filter(s => s && !/^[a-z]:$/i.test(s)).slice(-4))
    expect(ingest.sourceDirChain).not.toContain('Atrium素材库')
    expect(ingest.metadata.readmeText).toContain('衣服 outfit')
    expect(ingest.metadata.boothItemId).toBe('1234567')
    expect(ingest.entries.map(e => e.relPath).sort()).toEqual(['data.fbx', 'readme.txt'])
    const asset = db.prepare('SELECT category,subcategory,raw_name,storage_mode FROM asset').get() as Record<string, string>
    expect(asset.category).toBe(classification.units[0].category); expect(asset.subcategory).toBe(classification.units[0].subcategory ?? null)
    expect(asset.raw_name).toBe('未净化 单元'); expect(asset.storage_mode).toBe('indexed')
    expect(fs.readFileSync(path.join(source, 'data.fbx'), 'utf8')).toBe('mesh data')
  })
  it('uses the post-publication classification even when planner classification differs', async () => {
    const { db, plan } = await setup()
    plan.units[0].classification.units[0].category = 'deliberately-wrong'
    plan.id = ''; plan.id = 'plan-' + createHash('sha256').update(JSON.stringify(plan)).digest('hex'); persistIntakePlan(db, plan)
    await executePlan(db, plan.id, { finalizeUnit })
    expect((db.prepare('SELECT category FROM asset').get() as { category: string }).category).not.toBe('deliberately-wrong')
  })
  it('completed retries preserve manual fields and produce one journal', async () => {
    const { db, plan } = await setup(); persistIntakePlan(db, plan); await executePlan(db, plan.id, { finalizeUnit })
    db.prepare("UPDATE asset SET name='manual',cover_image='manual.png',category='tool'").run()
    await executePlan(db, plan.id, { finalizeUnit })
    expect(db.prepare('SELECT name,cover_image,category FROM asset').get()).toEqual({ name: 'manual', cover_image: 'manual.png', category: 'tool' })
    expect(db.prepare('SELECT count(*) n FROM journal').get()).toEqual({ n: 1 })
  })
  it('duplicate intake records provenance against actual existing refs without inventing target paths', async () => {
    const { db, plan, source, library, closure } = await setup(); persistIntakePlan(db, plan); await executePlan(db, plan.id, { finalizeUnit })
    const before = db.prepare('SELECT * FROM asset_blob_ref ORDER BY id').all()
    const duplicate = buildIntakePlan(source, { libraryRoot: library, sources: [{ sourcePath: source, kind: 'directory', closure }], classifyDeps: deps, existingTargetPaths: fs.readdirSync(library) }, readLibraryBlobIndex(db, library))
    persistIntakePlan(db, duplicate); const result = await executePlan(db, duplicate.id, { finalizeUnit })
    expect(result.status).toBe('duplicate'); expect(db.prepare('SELECT * FROM asset_blob_ref ORDER BY id').all()).toEqual(before)
    expect(db.prepare('SELECT count(*) n FROM source_occurrence WHERE plan_id=?').get(duplicate.id)).toEqual({ n: duplicate.occurrences.length })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    undoPlan(db, duplicate.id)
    expect(db.prepare('SELECT count(*) n FROM source_occurrence WHERE plan_id=?').get(plan.id)).toEqual({ n: plan.occurrences.length })
    expect(fs.existsSync(path.join(plan.units[0].libraryPath, 'data.fbx'))).toBe(true)
    expect(readIntakePlan(db, duplicate.id)!.status).toBe('cancelled')
  })
  it('failed final classification rolls back records, preserves external files, and resumes', async () => {
    const { db, plan } = await setup(); persistIntakePlan(db, plan)
    await expect(executePlan(db, plan.id, { finalizeUnit: async (_p, u) => {
      fs.writeFileSync(path.join(u.libraryPath, 'user-added.txt'), 'keep'); throw new Error('classifier failed')
    } })).rejects.toThrow('classifier failed')
    expect(db.prepare('SELECT count(*) n FROM asset').get()).toEqual({ n: 0 })
    expect(fs.readFileSync(path.join(plan.units[0].libraryPath, 'user-added.txt'), 'utf8')).toBe('keep')
    expect(Object.keys(readIntakePlan(db, plan.id)!.progress.completedOps)).toHaveLength(0)
    await executePlan(db, plan.id, { finalizeUnit }); expect(readIntakePlan(db, plan.id)!.status).toBe('completed')
  })
  it('R17 compares bytes and refuses missing, mismatched or non-coverage evidence', async () => {
    const { plan, source } = await setup(); const left = plan.occurrences[0]
    const copy = path.join(source, 'review-copy'); fs.copyFileSync(left.localPath!, copy)
    plan.occurrences.push({ ...left, id: 'review-right', sourcePath: copy, relPath: 'review-copy', localPath: copy })
    const review = { id: 'r', kind: 'coverage' as const, state: 'pending' as const, sourcePath: left.sourcePath, candidateBlobIds: [],
      matches: [{ key: left.key, leafRelPath: left.relPath, coveringPath: copy, coveringRelPath: 'review-copy', assetId: null }] }
    expect(await verifyCoverageReview(plan, review)).toBe(true)
    fs.writeFileSync(copy, Buffer.alloc(left.key.size, 33)); expect(await verifyCoverageReview(plan, review)).toBe(false)
    expect(await verifyCoverageReview(plan, { ...review, matches: [] })).toBe(false)
    expect(await verifyCoverageReview(plan, { ...review, kind: 'content-collision' })).toBe(false)
  })
})
