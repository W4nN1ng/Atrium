import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yauzl from 'yauzl'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IntakeSandbox, compileIntakeWorkers, opsOf, snapshotFiles } from '../helpers/intake-workers'

const fixtureRoot = process.env.AVCA_INTAKE_FIXTURES
let compiled: string, workers: Awaited<ReturnType<typeof compileIntakeWorkers>>
const results: unknown[] = []
beforeAll(async () => { if (fixtureRoot) { compiled = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-e2e-real-build-')); workers = await compileIntakeWorkers(compiled) } })
afterAll(() => {
  if (process.env.AVCA_E2E_AUDIT) fs.writeFileSync(path.join(process.env.AVCA_E2E_AUDIT, 'm9-real-results.json'), JSON.stringify(results, null, 2))
  if (compiled) fs.rmSync(compiled, { recursive: true, force: true })
})
const samples = [
  { name: 'motchiri', matrix: '#2/#3', relative: 'A/插件道具合集-初音的VRC小店/更新/插件28件/4108136可触碰皮肤', files: 12, packages: 1, skips: 1, occurrences: 22, covers: 2 },
  { name: '黑曜石', matrix: '#1', relative: 'A/衣服/黑曜石', files: 3, packages: 3, skips: 3, occurrences: 6, covers: 0 },
  { name: '名流', matrix: '#6', relative: 'A/衣服/名流', files: 31, packages: 22, skips: 2, occurrences: 39, covers: 1 },
  { name: '西装', matrix: '#4/#5', relative: 'A/衣服/西装', files: 13, packages: 13, skips: 2, occurrences: 18, covers: 0 }
]
describe.skipIf(!fixtureRoot)('M9 approved fixtures through real production plan and execute workers', () => {
  it.each(samples)('$matrix $name preserves complete output and provenance', async sample => {
    const s = new IntakeSandbox(workers), source = path.join(fixtureRoot!, sample.relative)
    try {
      const before = snapshotFiles(source), plan = await s.plan(source), ops = opsOf(plan)
      expect(plan.blocked).toEqual([]); expect(ops).toHaveLength(sample.files)
      expect(ops.filter(o => /\.unitypackage$/i.test(o.targetRelPath))).toHaveLength(sample.packages)
      expect(ops.filter(o => /\.(zip|rar|7z)$/i.test(o.targetRelPath))).toEqual([])
      expect(plan.skips.filter(x => x.scope === 'archive')).toHaveLength(sample.skips)
      expect(plan.units.flatMap(u => u.coverCandidates).length).toBeGreaterThanOrEqual(sample.covers)
      const result = await s.commit(plan)
      expect(result.status).toBe('completed')
      expect(s.db.prepare('SELECT count(*) n FROM asset_blob_ref').get()).toEqual({ n: sample.files })
      expect(s.db.prepare('SELECT count(*) n FROM source_occurrence').get()).toEqual({ n: sample.occurrences })
      for (const op of ops) expect(fs.statSync(path.join(s.library, op.targetRelPath)).size).toBe(op.key.size)
      expect(s.db.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(s.db.pragma('foreign_key_check')).toEqual([])
      if (sample.name === '西装') {
        expect(plan.extracts.flatMap(e => e.members)).toHaveLength(10)
        expect(ops.some(o => o.targetRelPath.includes('Sio'))).toBe(true)
      }
      expect(snapshotFiles(source)).toEqual(before)
      results.push({ sample: sample.name, matrix: sample.matrix, files: ops.length, packages: sample.packages, occurrences: sample.occurrences, sourceUnchanged: true, status: result.status })
    } finally { s.close() }
  }, 240000)
  it('#18 real ERP byte names decode before safe publication and all 29 payloads survive', async () => {
    const base = path.join(fixtureRoot!, 'A/插件道具合集-初音的VRC小店/ERP用12件/整合版DPS/前置合集(也可以单独用)')
    let count = 0, legacyPipe = false, restoredJapanese = false
    for (const rel of ['2664180/Massager_ver1.08.zip', '2664180/Massager_ver1.09.zip', '2892014/ONAHO_ver1.01.zip', '2892014/ONAHO_ver1.02.zip']) {
      const s = new IntakeSandbox(workers)
      try {
        const archive = path.join(base, rel)
        const names = await new Promise<string[]>((resolve, reject) => yauzl.open(archive, { lazyEntries: true, decodeStrings: false }, (error, zip) => {
          if (error || !zip) { reject(error); return }
          const names: string[] = []; zip.on('error', reject); zip.on('entry', entry => { names.push(Buffer.from(entry.fileName).toString('latin1')); zip.readEntry() }); zip.on('end', () => resolve(names)); zip.readEntry()
        }))
        legacyPipe ||= names.some(name => name.includes('|'))
        const plan = await s.plan(archive); await s.commit(plan)
        const ops = opsOf(plan); count += ops.length
        restoredJapanese ||= plan.occurrences.some(o => o.relPath.includes('こちらを先に'))
        expect(ops.every(o => !/[|?*]/.test(o.targetRelPath))).toBe(true)
        expect(ops.every(o => fs.existsSync(path.join(s.library, o.targetRelPath)))).toBe(true)
      } finally { s.close() }
    }
    expect(count).toBe(29); expect(legacyPipe).toBe(true); expect(restoredJapanese).toBe(true)
    results.push({ matrix: '#18', ERPFiles: count, legacyPipeBytes: legacyPipe, restoredJapanese })
  }, 240000)
})
