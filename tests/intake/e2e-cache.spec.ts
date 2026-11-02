import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { IntakeSandbox, compileIntakeWorkers, zip, opsOf, snapshotFiles, redigest } from '../helpers/intake-workers'
import { makeZip } from '../helpers/containers'
import { ExpandCache } from '../../src/main/intake/expandCache'
import { readIntakePlan } from '../../src/main/db/repos/intakePlan'
import { pruneIntakeCache } from '../../src/main/intake/lifecycle'
import { listMembers } from '../../src/main/unpack/members'

let compiled: string, workers: Awaited<ReturnType<typeof compileIntakeWorkers>>, s: IntakeSandbox
beforeAll(async () => { compiled = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-e2e-build-')); workers = await compileIntakeWorkers(compiled) })
beforeEach(() => { s = new IntakeSandbox(workers) })
afterEach(() => s.close())
afterAll(() => { fs.rmSync(compiled, { recursive: true, force: true }) })

describe('M9 #27 space preflight and durable cache ownership', () => {
  it('preflights scarce space before extraction and still reads loose files and a small container', async () => {
    s.file('loose.txt', 'loose')
    await zip(path.join(s.source, 'a-large.zip'), [['large.bin', Buffer.alloc(2 * 1024 * 1024, 1)]])
    await zip(path.join(s.source, 'z-small.zip'), [['small.txt', 'small']])
    const result = await s.fault({ type: 'closure', source: s.source, freeBytes: 1100000 })
    expect(result.warnings.join()).toContain('cache-insufficient-space')
    expect(result.leaves.some((l: any) => l.kind === 'opaque' && l.relPath === 'a-large.zip')).toBe(true)
    expect(result.leaves.some((l: any) => l.relPath === 'loose.txt')).toBe(true)
    expect(result.leaves.some((l: any) => l.relPath.endsWith('small.txt'))).toBe(true)
    expect(fs.readdirSync(path.join(s.root, 'fault-cache/staging'))).toEqual([])
    const objects = path.join(s.root, 'fault-cache/objects')
    expect(fs.readdirSync(objects)).toEqual([])
  })
  it('reclaims a committed skip container immediately after durable progress releases it', async () => {
    s.file('file.txt', 'payload'); await zip(path.join(s.source, 'copy.zip'), [['file.txt', 'payload']])
    const plan = await s.plan(), cache = new ExpandCache({ namespace: s.dbFile })
    expect(fs.readdirSync(path.join(cache.root, 'objects'))).toHaveLength(1)
    await s.commit(plan)
    expect(readIntakePlan(s.db, plan.id)!.progress.cacheKeys).toEqual([])
    expect(fs.readdirSync(path.join(cache.root, 'objects'))).toEqual([])
  })
  it('retains shared cache while another durable plan needs it, then reclaims after both commits', async () => {
    const archive = await zip(path.join(s.root, 'one.zip'), [['file.txt', 'payload']])
    const other = path.join(s.root, 'two.zip'); fs.copyFileSync(archive, other)
    const a = await s.plan(archive), b = await s.plan(other), cache = new ExpandCache({ namespace: s.dbFile })
    s.persist(a); s.persist(b)
    await s.execute(a)
    expect(fs.readdirSync(path.join(cache.root, 'objects'))).toHaveLength(1)
    await s.execute(b)
    expect(fs.readdirSync(path.join(cache.root, 'objects'))).toEqual([])
    expect(s.db.prepare('SELECT ref_count FROM content_blob').get()).toEqual({ ref_count: 2 })
  })
  it('refuses to release the cache of an unfinished or cancelled plan', async () => {
    const archive = await zip(path.join(s.root, 'pending.zip'), [['file.txt', 'payload']])
    const plan = await s.plan(archive), cache = new ExpandCache({ namespace: s.dbFile }); s.persist(plan)
    await expect(s.fault({ type: 'release', planId: plan.id })).rejects.toThrow('unfinished')
    expect(fs.readdirSync(path.join(cache.root, 'objects'))).toHaveLength(1)
    s.db.prepare("UPDATE intake_plan SET status='cancelled' WHERE id=?").run(plan.id)
    await expect(s.fault({ type: 'release', planId: plan.id })).rejects.toThrow('unfinished')
    expect(fs.readdirSync(path.join(cache.root, 'objects'))).toHaveLength(1)
  })
  it('automatically queues member batches when the complete archive exceeds cache capacity', async () => {
    s.file('loose.txt', 'loose')
    const entries: Array<[string, Buffer]> = Array.from({ length: 5 }, (_, i) => [`leaf-${i}.bin`, Buffer.alloc(65536, i + 1)])
    await zip(path.join(s.source, 'large.zip'), entries)
    await zip(path.join(s.source, 'small.zip'), [['small.txt', 'small']])
    const before = snapshotFiles(s.source)
    const plan = await s.fault({ type: 'batch-plan', source: s.source, libraryRoot: s.library, cacheMaxBytes: 80000 })
    expect(plan.blocked).toEqual([]); expect(plan.warnings.join()).toContain('member batches')
    expect(plan.warnings.join()).not.toContain('opaque')
    expect(plan.cacheKeys).toEqual([])
    expect(opsOf(plan).filter(op => op.memberSource)).toHaveLength(6)
    expect(fs.readdirSync(path.join(s.root, 'fault-cache/objects'))).toEqual([])
    await s.commit(plan)
    expect(s.db.prepare('SELECT count(*) n FROM asset_blob_ref').get()).toEqual({ n: 7 })
    for (const op of opsOf(plan)) expect(fs.statSync(path.join(s.library, op.targetRelPath)).size).toBe(op.key.size)
    expect(snapshotFiles(s.source)).toEqual(before)
  })
  it('waits for transient free space and automatically resumes without publishing a half expansion', async () => {
    const archive = await zip(path.join(s.root, 'waiting.zip'), [['a.bin', Buffer.alloc(32000, 1)], ['b.bin', Buffer.alloc(32000, 2)]])
    let waits = 0
    const plan = await s.fault({ type: 'batch-plan', source: archive, libraryRoot: s.library, cacheMaxBytes: 40000, freeBytes: 0, resumeFreeBytes: 1024 ** 3 }, { onMessage: message => { if (message.type === 'waiting-space') waits++ } })
    expect(waits).toBe(1); expect(plan.warnings.join()).not.toContain('opaque')
    await s.commit(plan); expect(opsOf(plan)).toHaveLength(2)
    expect(fs.readdirSync(path.join(s.root, 'fault-cache/staging'))).toEqual([])
  })
  it('recovers nested member recipes after every planning cache object has been reclaimed', async () => {
    const inner = await zip(path.join(s.root, 'inner.zip'), [['renamed|/one.txt', Buffer.alloc(20000, 1)], ['two.txt', Buffer.alloc(20000, 2)]])
    const outer = await zip(path.join(s.root, 'outer.zip'), [['inner.zip', fs.readFileSync(inner)], ['three.txt', Buffer.alloc(20000, 3)]])
    const plan = await s.fault({ type: 'batch-plan', source: outer, libraryRoot: s.library, cacheMaxBytes: 25000 })
    expect(opsOf(plan)).toHaveLength(3)
    expect(opsOf(plan).some(op => op.memberSource?.steps.length === 2)).toBe(true)
    expect(fs.readdirSync(path.join(s.root, 'fault-cache/objects'))).toEqual([])
    await s.commit(plan)
    expect(opsOf(plan).every(op => fs.existsSync(path.join(s.library, op.targetRelPath)))).toBe(true)
  })
  it('keeps encrypted batch recipes secret-free and asks for the password again during execution', async () => {
    s.file('a.bin', Buffer.alloc(32000, 1)); s.file('b.bin', Buffer.alloc(32000, 2))
    const password = 'batch-secret-314159'
    const archive = makeZip(s.source, path.join(s.root, 'encrypted.7z'), ['a.bin', 'b.bin'], undefined, ['-p' + password, '-mhe=on'], '7z')
    const plan = await s.fault({ type: 'batch-plan', source: archive, libraryRoot: s.library, cacheMaxBytes: 40000, password })
    expect(opsOf(plan)).toHaveLength(2); expect(JSON.stringify(plan)).not.toContain(password)
    s.persist(plan); let prompts = 0
    await s.execute(plan, { onMessage: (msg, worker) => { if (msg.type === 'need-password') { prompts++; worker.postMessage({ type: 'password', requestId: msg.requestId, password }) } } })
    expect(prompts).toBe(1)
    expect(s.db.prepare('SELECT count(*) n FROM asset_blob_ref').get()).toEqual({ n: 2 })
  })
  it('cancels a queued planning batch without leaving partial members and can retry', async () => {
    const archive = await zip(path.join(s.root, 'cancel.zip'), [['a.bin', Buffer.alloc(32000, 1)], ['b.bin', Buffer.alloc(32000, 2)]])
    await expect(s.fault({ type: 'batch-plan', source: archive, libraryRoot: s.library, cacheMaxBytes: 40000, freeBytes: 0, cancelOnWait: true })).rejects.toThrow()
    expect(fs.readdirSync(path.join(s.root, 'fault-cache/objects'))).toEqual([])
    expect(fs.readdirSync(path.join(s.root, 'fault-cache/staging'))).toEqual([])
    const plan = await s.fault({ type: 'batch-plan', source: archive, libraryRoot: s.library, cacheMaxBytes: 40000 })
    expect((await s.commit(plan)).status).toBe('completed')
  })
  it('queues execution before any publication and resumes automatically when target space returns', async () => {
    s.file('file.txt', 'payload'); const plan = await s.plan(); s.persist(plan); let waits = 0
    const result = await s.fault({ type: 'execute-space', planId: plan.id, freeBytes: 0, resumeFreeBytes: 1024 ** 3 }, { onMessage: message => {
      if (message.type === 'waiting-space') { waits++; expect(fs.readdirSync(s.library)).toEqual([]); expect(s.db.prepare('SELECT count(*) n FROM asset').get()).toEqual({ n: 0 }) }
    } })
    expect(waits).toBe(1); expect(result.status).toBe('completed')
  })
  it('cancels an execution waiting for space and resumes the same persisted plan', async () => {
    s.file('file.txt', 'payload'); const plan = await s.plan(); s.persist(plan)
    await expect(s.fault({ type: 'execute-space', planId: plan.id, freeBytes: 0, cancelOnWait: true })).rejects.toThrow('取消')
    expect(readIntakePlan(s.db, plan.id)!.status).toBe('cancelled')
    expect(fs.readdirSync(s.library)).toEqual([])
    expect((await s.execute(plan)).status).toBe('completed')
  })
  it('hydrates batch sources for byte reviews and rejects a changed original archive before publication', async () => {
    const a = Buffer.alloc(12000, 1), b = Buffer.alloc(12000, 2)
    s.file('loose/a.bin', a); s.file('loose/b.bin', b)
    const archive = await zip(path.join(s.source, 'covered.zip'), [['a.bin', a], ['b.bin', b]])
    const plan = await s.fault({ type: 'batch-plan', source: s.source, libraryRoot: s.library, cacheMaxBytes: 16000 })
    const skip = plan.skips.find((skip: any) => skip.scope === 'archive')!
    plan.reviews.push({ id: 'batch-coverage-review', kind: 'coverage', sourcePath: skip.entry, state: 'pending', candidateBlobIds: [], matches: skip.evidence.matches }); redigest(plan)
    s.persist(plan)
    const original = fs.readFileSync(archive); fs.appendFileSync(archive, 'changed')
    await expect(s.execute(plan)).rejects.toThrow('archive-changed')
    expect(fs.readdirSync(s.library)).toEqual([])
    fs.writeFileSync(archive, original)
    expect((await s.execute(plan)).status).toBe('completed')
    expect(s.db.prepare('SELECT count(*) n FROM asset_blob_ref').get()).toEqual({ n: 2 })
  })
  it('rejects forged recipes outside the scan root and recipes with mismatched identities', async () => {
    const archive = await zip(path.join(s.root, 'source.zip'), [['a.bin', Buffer.alloc(12000, 1)], ['b.bin', Buffer.alloc(12000, 2)]])
    const plan = await s.fault({ type: 'batch-plan', source: archive, libraryRoot: s.library, cacheMaxBytes: 16000 })
    const bad = structuredClone(plan)
    opsOf(bad)[0].memberSource!.archivePath = path.join(s.root, 'outside.zip'); redigest(bad)
    expect(() => s.persist(bad)).toThrow('member source')
    const changed = structuredClone(plan); opsOf(changed)[0].memberSource!.steps[0].sha256 = 'f'.repeat(64); redigest(changed)
    expect(() => s.persist(changed)).toThrow('identity mismatch')
  })
  it('restores durable database protection after a process dies and its old cache lease expires', async () => {
    const archive = await zip(path.join(s.root, 'restart.zip'), [['a.bin', Buffer.alloc(12000, 1)], ['b.bin', Buffer.alloc(12000, 2)]])
    const plan = await s.plan(archive); s.persist(plan)
    const cache = new ExpandCache({ namespace: s.dbFile, maxBytes: 30000 })
    for (const name of fs.readdirSync(path.join(cache.root, 'refs'))) {
      const file = path.join(cache.root, 'refs', name), ref = JSON.parse(fs.readFileSync(file, 'utf8'))
      ref.pid = 99999999; ref.updatedAt = 1; delete ref.durable; fs.writeFileSync(file, JSON.stringify(ref))
    }
    await pruneIntakeCache(s.db, cache)
    let produced = false
    await expect(cache.materialize('a'.repeat(64), 'pressure', [{ originalPath: 'new.bin', key: { size: 20000, crc32: 0 }, file: '00000000.bin' }], async () => { produced = true })).rejects.toThrow('space')
    expect(produced).toBe(false); expect(fs.readdirSync(path.join(cache.root, 'objects'))).toHaveLength(1)
    expect((await s.execute(plan)).status).toBe('completed')
    expect(fs.readdirSync(path.join(cache.root, 'objects'))).toEqual([])
  })
  it('batches real RAR members through the bundled decoder without retaining a full expansion', async () => {
    const archive = s.file('sample.rar', fs.readFileSync(path.resolve('tests/fixtures/rar/FolderTest.rar')))
    const listing = await listMembers(archive), files = listing.entries.filter(e => !e.isDir)
    const capacity = Math.max(...files.map(e => e.size))
    const plan = await s.fault({ type: 'batch-plan', source: archive, libraryRoot: s.library, cacheMaxBytes: capacity, freeBytes: 0, resumeFreeBytes: 1024 ** 3 })
    expect(opsOf(plan)).toHaveLength(files.length)
    expect(opsOf(plan).every(op => op.memberSource?.steps[0].format === 'rar')).toBe(true)
    expect(fs.readdirSync(path.join(s.root, 'fault-cache/objects'))).toEqual([])
    await s.commit(plan)
    expect(opsOf(plan).every(op => fs.statSync(path.join(s.library, op.targetRelPath)).size === op.key.size)).toBe(true)
  })
  it('collects an unpublished cancelled attempt while preserving a durable peer using the same cache', async () => {
    const archive = await zip(path.join(s.root, 'peer.zip'), [['file.txt', 'payload']])
    const plan = await s.plan(archive); s.persist(plan)
    const cache = new ExpandCache({ namespace: s.dbFile }), pending = 'pending:abandoned'
    await cache.retain(pending, plan.cacheKeys)
    await cache.materialize('b'.repeat(64), pending, [{ originalPath: 'abandoned.txt', key: { size: 9, crc32: 0xcbf43926 }, file: '00000000.bin' }], async dest => { fs.writeFileSync(path.join(dest, '00000000.bin'), '123456789') })
    expect(fs.readdirSync(path.join(cache.root, 'objects'))).toHaveLength(2)
    await s.fault({ type: 'release-pending', jobId: 'abandoned' })
    expect(fs.readdirSync(path.join(cache.root, 'objects'))).toEqual(plan.cacheKeys)
    expect((await s.execute(plan)).status).toBe('completed')
  })
})
