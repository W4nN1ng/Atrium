import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IntakeSandbox, compileIntakeWorkers, opsOf, snapshotFiles, requestWorker } from '../helpers/intake-workers'
import { readIntakePlan } from '../../src/main/db/repos/intakePlan'
import { seedIntakeV11, snapshotIntakeLegacy } from '../helpers/intakeV11'
import { buildRealUnitypackage, makeZip } from '../helpers/containers'
import { importUnitypackage, packagesOfAsset, preflight, type BridgeLike } from '../../src/main/import/coordinator'
import { upsertProject } from '../../src/main/db/repos/unity'
import { bridgeDirOf, writeJsonAtomic } from '../../src/main/bridge/mailbox'
import { BRIDGE_PROTOCOL_VERSION } from '../../src/shared/types'

let compiled: string, workers: Awaited<ReturnType<typeof compileIntakeWorkers>>, s: IntakeSandbox
beforeAll(async () => { compiled = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-e2e-build-')); workers = await compileIntakeWorkers(compiled) })
beforeEach(() => { s = new IntakeSandbox(workers) })
afterEach(() => s.close())
afterAll(() => { fs.rmSync(compiled, { recursive: true, force: true }) })

describe('M9 durable lifecycle through real workers', () => {
  it('#13 a terminated executor resumes its persisted plan without rewriting completed targets', async () => {
    s.file('a.txt', 'small'); s.file('z.bin', Buffer.alloc(16 * 1024 * 1024, 3))
    const plan = await s.plan(); s.persist(plan)
    await expect(s.execute(plan, { onMessage: (message, worker) => { if (message.type === 'progress' && message.completed >= 1) void worker.terminate() } })).rejects.toThrow('exited')
    const progress = readIntakePlan(s.db, plan.id)!.progress
    const completed = Object.values(progress.completedOps)
    expect(completed.length).toBeGreaterThanOrEqual(1)
    const before = completed.map(op => ({ path: op.targetPath, mtime: fs.statSync(op.targetPath).mtimeMs }))
    const result = await s.execute(plan)
    expect(result.status).toBe('completed')
    expect(completed.map(op => ({ path: op.targetPath, mtime: fs.statSync(op.targetPath).mtimeMs }))).toEqual(before)
    expect(s.db.prepare('SELECT count(*) n FROM asset_blob_ref').get()).toEqual({ n: 2 })
    expect(s.db.prepare('SELECT count(*) n FROM journal').get()).toEqual({ n: 1 })
    await s.execute(plan)
    expect(s.db.prepare('SELECT count(*) n FROM journal').get()).toEqual({ n: 1 })
  })
  it('#14 undo of one asset preserves the other asset sharing its physical blob', async () => {
    s.file('first/shared.txt', 'same'); s.file('second/shared.txt', 'same')
    const a = await s.plan(path.join(s.source, 'first')); await s.commit(a)
    const b = await s.plan(path.join(s.source, 'second'), { blobs: [] }); await s.commit(b)
    expect(s.db.prepare('SELECT ref_count FROM content_blob').get()).toEqual({ ref_count: 2 })
    const target = path.join(s.library, opsOf(b)[0].targetRelPath), before = snapshotFiles(path.dirname(target))
    await s.fault({ type: 'undo', planId: a.id })
    expect(s.db.prepare('SELECT ref_count FROM content_blob').get()).toEqual({ ref_count: 1 })
    expect(snapshotFiles(path.dirname(target))).toEqual(before)
    expect(s.db.prepare('SELECT id FROM asset').all()).toEqual([{ id: b.units[0].assetId }])
    expect(s.db.pragma('foreign_key_check')).toEqual([])
  })
  it('#17 V11 migrates on the actual worker open, preserving manual covers and shared legacy hashes', async () => {
    const file = path.join(s.root, 'legacy.db'), db = new Database(file)
    seedIntakeV11(db); const before = snapshotIntakeLegacy(db); db.close()
    const job = { type: 'migrate', dbFile: file }
    expect((await requestWorker<any>(workers.fault, job, ['result'])).result).toEqual({ version: 12, integrity: 'ok', foreignKeys: [] })
    const after = new Database(file)
    expect(after.prepare('SELECT * FROM asset ORDER BY rowid').all()).toEqual(before.asset)
    expect(after.prepare('SELECT * FROM asset_cover ORDER BY rowid').all()).toEqual(before.asset_cover)
    after.close()
    expect((await requestWorker<any>(workers.fault, job, ['result'])).result).toEqual({ version: 12, integrity: 'ok', foreignKeys: [] })
  })
  it('#23/#28 repeated intake and a named backup produce duplicate provenance with no extra asset or file', async () => {
    s.file('readme.txt', 'original'); s.file('data.fbx', 'mesh'); s.file('materials/shader.txt', 'shader')
    const plan = await s.plan(); await s.commit(plan)
    const backup = path.join(s.root, 'A_备份_20261005'); fs.mkdirSync(backup)
    for (const [from, to] of [['readme.txt', 'renamed.txt'], ['data.fbx', 'different.fbx'], ['materials/shader.txt', 'shader.txt']]) fs.copyFileSync(path.join(s.source, from), path.join(backup, to))
    const before = snapshotFiles(s.library), assets = s.db.prepare('SELECT * FROM asset').all(), refs = s.db.prepare('SELECT * FROM asset_blob_ref').all()
    const duplicate = await s.plan(backup)
    expect(duplicate.units.every(u => u.disposition === 'duplicate')).toBe(true)
    expect(duplicate.units[0].existingAssetIds).toContain(plan.units[0].assetId)
    const result = await s.commit(duplicate)
    expect(result.status).toBe('duplicate'); expect(result.copiedOps).toEqual([])
    expect(snapshotFiles(s.library)).toEqual(before)
    expect(s.db.prepare('SELECT * FROM asset').all()).toEqual(assets)
    expect(s.db.prepare('SELECT * FROM asset_blob_ref').all()).toEqual(refs)
    expect(s.db.prepare('SELECT count(*) n FROM source_occurrence WHERE plan_id=?').get(duplicate.id)).toEqual({ n: 3 })
  })
  it('#15 published unitypackage is discoverable, preflighted and recorded by the existing import coordinator', async () => {
    await buildRealUnitypackage(path.join(s.source, '123456.unitypackage'), ['Assets/Shinano/Coat/Coat.prefab'])
    const plan = await s.plan(); await s.commit(plan)
    const found = await packagesOfAsset(s.db, plan.units[0].assetId!)
    expect(found.packages).toHaveLength(1)
    const packagePath = found.packages[0].path
    if (!packagePath) throw new Error('Published package must have a physical library path')
    expect(packagePath.startsWith(s.library)).toBe(true)
    const project = path.join(s.root, 'UnityProject'); fs.mkdirSync(path.join(project, 'Packages/com.avca.bridge'), { recursive: true })
    fs.writeFileSync(path.join(project, 'Packages/com.avca.bridge/package.json'), '{"name":"com.avca.bridge"}')
    const row = upsertProject(s.db, { path: project, name: 'M9 isolated project' })
    writeJsonAtomic(path.join(bridgeDirOf(project), 'bridge.json'), { protocolVersion: BRIDGE_PROTOCOL_VERSION, pid: process.pid, projectPath: project, projectName: 'test', unityVersion: '2022.3.22f1', bridgeVersion: '1.0.0', isPlaying: false, isCompiling: false, isUpdating: false, isPlayingOrWillChangePlaymode: false, activeScene: null, busyReason: null, queueLength: 0, heartbeatUtc: Date.now() })
    const calls: { type: string; payload: any }[] = []
    // Only Unity is a protocol adapter; package discovery, parser, coordinator and history are real.
    const bridge: BridgeLike = { async execute(_project, type, payload) {
      calls.push({ type, payload }); const guids = (payload as any).guids ?? []
      return { ok: true, status: 'ok', data: type === 'resolve_guids' ? { resolved: Object.fromEntries(guids.map((g: string) => [g, null])) } : { createdGuids: [], overwrittenGuids: [], importedPaths: ['Assets/Shinano/Coat/Coat.prefab'] }, error: null, stackTrace: null, elapsedMs: 1, retries: 0, commandId: 'm9-' + calls.length }
    } }
    const pre = await preflight(s.db, bridge, project, packagePath, row.id)
    expect(pre.ok).toBe(true); expect(pre.entryCount).toBe(1)
    await importUnitypackage(s.db, bridge, project, packagePath, row.id, pre, { assetId: plan.units[0].assetId, backupOverwritten: false })
    expect(calls.some(c => c.type === 'import_unitypackage' && c.payload.path === packagePath)).toBe(true)
    expect(s.db.prepare('SELECT status,unitypackage_path,asset_id FROM import_log').get()).toEqual({ status: 'ok', unitypackage_path: packagePath, asset_id: plan.units[0].assetId })
  })
  it('#26 actual 1 GiB coverage requires and completes sampled byte review in the execution worker', async () => {
    const loose = path.join(s.source, 'loose'); fs.mkdirSync(loose)
    for (let i = 0; i < 8; i++) { const file = path.join(loose, `part-${i}.bin`), fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, 128 * 1024 * 1024); fs.writeSync(fd, Buffer.from([i + 1]), 0, 1, 0); fs.closeSync(fd) }
    const archive = makeZip(loose, path.join(s.source, 'large.zip'), fs.readdirSync(loose), undefined, ['-mx=1'])
    const plan = await s.plan()
    expect(plan.skips.find(x => x.scope === 'archive' && x.entry.endsWith('large.zip'))?.requiresByteReview).toBe(true)
    const review = plan.reviews.find(r => r.kind === 'coverage')!
    expect(review.matches).toHaveLength(5)
    s.persist(plan); expect(await s.fault({ type: 'review', planId: plan.id })).toBe(true)
    const archived = plan.occurrences.find(o => o.sourcePath.replace(/\\/g, '/') === archive.replace(/\\/g, '/') && o.relPath === review.matches[0].leafRelPath)!
    expect(archived.localPath).toBeTruthy()
    const fd = fs.openSync(archived.localPath!, 'r+'), original = Buffer.alloc(1); fs.readSync(fd, original, 0, 1, 0); fs.writeSync(fd, Buffer.from([99]), 0, 1, 0); fs.closeSync(fd)
    await expect(s.execute(plan)).rejects.toThrow('复核')
    expect(fs.readdirSync(s.library)).toEqual([])
    const restore = fs.openSync(archived.localPath!, 'r+'); fs.writeSync(restore, original, 0, 1, 0); fs.closeSync(restore)
    expect((await s.execute(plan)).status).toBe('completed')
    expect(opsOf(plan)).toHaveLength(8)
  }, 240000)
})
