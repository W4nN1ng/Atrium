import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildClosure } from '../../src/main/intake/closure'
import { ExpandCache } from '../../src/main/intake/expandCache'
import { planSelection, type ClosureSource } from '../../src/main/intake/match'
import { intakeBudget } from '../../src/shared/constants'

const fixtureRoot = process.env.AVCA_INTAKE_FIXTURES
const roots: string[] = []
const cases: { name: string; input: ClosureSource[]; expectedJSON: string }[] = []
async function select(name: string, relative: string, urlWarnings = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-match-real-')); roots.push(root)
  const sourcePath = path.join(fixtureRoot!, relative)
  const closure = await buildClosure(sourcePath, { ...intakeBudget(0), cache: new ExpandCache({ root: path.join(root, 'cache') }), ownerId: name, extraBackendDirs: [path.resolve('resources/bin')] })
  expect(closure.opaque).toBe(false)
  if (urlWarnings) {
    // Existing magic detection reads these shortcut headers as text. Preserve
    // the exact diagnostics; they are leaf extension warnings, not listing failures.
    expect(closure.warnings).toHaveLength(10)
    expect(closure.warnings.every(w => /\.url: extension-mismatch \(text\)$/.test(w))).toBe(true)
  } else expect(closure.warnings).toEqual([])
  const input: ClosureSource[] = [{ sourcePath, kind: 'directory', closure }]
  const result = planSelection(input, { scanRoot: sourcePath })
  cases.push({ name, input, expectedJSON: JSON.stringify(result) })
  return result
}
afterAll(() => {
  if (process.env.AVCA_MATCH_AUDIT && cases.length) fs.writeFileSync(path.join(process.env.AVCA_MATCH_AUDIT, 'match-fixture-index.json'), JSON.stringify(cases, null, 2))
  for (const root of roots) {
    const relative = path.relative(os.tmpdir(), path.resolve(root))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('avca-match-real-')) throw new Error('Unsafe fixture cleanup target')
    fs.rmSync(root, { recursive: true, force: true })
  }
})
describe.skipIf(!fixtureRoot)('M0 approved copies: closure → global selection', () => {
  it('motchiri: 10/10 covered despite garbled names, both sidecars kept', async () => {
    const result = await select('motchiri', 'A/插件道具合集-初音的VRC小店/更新/插件28件/4108136可触碰皮肤', true)
    expect(result.skip.filter(s => s.scope === 'archive')).toHaveLength(1)
    expect(result.skip.find(s => s.scope === 'archive')!.evidence.coveredCount).toBe(10)
    expect(result.extract).toHaveLength(0)
    expect(result.keep.flatMap(s => s.leaves)).toHaveLength(12)
  }, 180_000)
  it('黑曜石: all three ZIPs skipped, three loose packages kept', async () => {
    const result = await select('黑曜石', 'A/衣服/黑曜石')
    expect(result.skip.filter(s => s.scope === 'archive')).toHaveLength(3)
    expect(result.extract).toHaveLength(0)
    expect(result.keep.flatMap(s => s.leaves)).toHaveLength(3)
  }, 180_000)
  it('名流: PSD/UV ZIPs covered, 22 unitypackages and parent preview kept', async () => {
    const result = await select('名流', 'A/衣服/名流')
    expect(result.skip.filter(s => s.scope === 'archive')).toHaveLength(2)
    expect(result.extract).toHaveLength(0)
    const kept = result.keep.flatMap(s => s.leaves)
    expect(kept.filter(l => l.kind === 'unitypackage')).toHaveLength(22)
    expect(kept.some(l => l.relPath.endsWith('ATTITUDE The Royal Bunny.jpg'))).toBe(true)
    expect(kept).toHaveLength(31)
  }, 180_000)
  it('西装: RAR covers 3/misses 10 including Sio; two ZIPs covered, 13 unique leaves', async () => {
    const result = await select('西装', 'A/衣服/西装')
    expect(result.extract).toHaveLength(1)
    expect(result.extract[0]).toMatchObject({ mode: 'missing', evidence: { totalCount: 13, coveredCount: 3 } })
    expect(result.extract[0].leaves).toHaveLength(10)
    expect(result.extract[0].leaves.some(l => l.relPath.includes('Sio'))).toBe(true)
    expect(result.skip.filter(s => s.scope === 'archive')).toHaveLength(2)
    const kept = result.keep.flatMap(s => s.leaves)
    expect(kept).toHaveLength(13)
    expect(new Set(kept.map(l => `${l.key.size}:${l.key.crc32}`)).size).toBe(13)
  }, 180_000)
})
