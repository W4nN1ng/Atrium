import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildClosure } from '../../src/main/intake/closure'
import { ExpandCache } from '../../src/main/intake/expandCache'
import { buildIntakePlan, type PlannerIndex } from '../../src/main/intake/planner'
import { validateIntakePlan } from '../../src/main/db/repos/intakePlan'
import { loadLexicon } from '../../src/main/classify/lexicon'
import { intakeBudget } from '../../src/shared/constants'
import type { ClassifyDeps } from '../../src/main/classify/engine'
const fixtureRoot = process.env.AVCA_INTAKE_FIXTURES
const roots: string[] = []
const cases: unknown[] = []
let deps: ClassifyDeps
beforeAll(() => { deps = { lex: loadLexicon({ builtin: path.resolve('resources/lexicon/lexicon.json') }), categories: JSON.parse(fs.readFileSync('resources/lexicon/categories.json', 'utf8')) } })
afterAll(() => {
  if (process.env.AVCA_PLAN_AUDIT && cases.length) fs.writeFileSync(path.join(process.env.AVCA_PLAN_AUDIT, 'planner-fixture-index.json'), JSON.stringify(cases, null, 2))
  for (const root of roots) {
    const relative = path.relative(os.tmpdir(), path.resolve(root))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('avca-plan-real-')) throw new Error('Unsafe fixture cleanup target')
    fs.rmSync(root, { recursive: true, force: true })
  }
})
const samples = [
  { name: 'motchiri', relative: 'A/插件道具合集-初音的VRC小店/更新/插件28件/4108136可触碰皮肤', leaves: 12, sidecars: 2, skips: 1, occurrences: 22 },
  { name: '黑曜石', relative: 'A/衣服/黑曜石', leaves: 3, sidecars: 0, skips: 3, occurrences: 6 },
  { name: '名流', relative: 'A/衣服/名流', leaves: 31, sidecars: 1, skips: 2, occurrences: 39 },
  { name: '西装', relative: 'A/衣服/西装', leaves: 13, sidecars: 0, skips: 2, occurrences: 18 }
]
describe.skipIf(!fixtureRoot)('M0 approved copies: normalized durable plans', () => {
  it.each(samples)('$name preserves the complete normalized tree and provenance', async sample => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-plan-real-')); roots.push(root)
    const scanRoot = path.join(fixtureRoot!, sample.relative)
    const closure = await buildClosure(scanRoot, { ...intakeBudget(0), cache: new ExpandCache({ root: path.join(root, 'cache') }), ownerId: sample.name, extraBackendDirs: [path.resolve('resources/bin')] })
    const index: PlannerIndex = { libraryRoot: 'E:/avca-planner-library', classifyDeps: deps, sources: [{ sourcePath: scanRoot, kind: 'directory', closure }] }
    const plan = buildIntakePlan(scanRoot, index, [])
    validateIntakePlan(plan)
    expect(plan.blocked).toEqual([])
    expect(plan.units).toHaveLength(1)
    const ops = plan.units.flatMap(u => [...u.copyOps, ...u.sidecars])
    expect(ops).toHaveLength(sample.leaves)
    expect(plan.units[0].sidecars).toHaveLength(sample.sidecars)
    expect(plan.skips.filter(s => s.scope === 'archive')).toHaveLength(sample.skips)
    expect(plan.occurrences).toHaveLength(sample.occurrences)
    expect(ops.some(o => /\.(zip|rar|7z)$/i.test(o.targetRelPath))).toBe(false)
    expect(plan.units[0].classification.units).toHaveLength(1)
    expect(JSON.stringify(buildIntakePlan(scanRoot, index, []))).toBe(JSON.stringify(plan))
    const reversed = { ...index, sources: index.sources.map(s => ({ ...s, closure: { ...s.closure, leaves: [...s.closure.leaves].reverse() } })) }
    expect(JSON.stringify(buildIntakePlan(scanRoot, reversed, []))).toBe(JSON.stringify(plan))
    if (sample.name === '西装') {
      expect(plan.extracts).toHaveLength(1); expect(plan.extracts[0].members).toHaveLength(10)
      expect(plan.extracts[0].members.some(p => p.includes('Sio'))).toBe(true)
      expect(plan.occurrences.filter(o => o.kind === 'extracted')).toHaveLength(10)
    } else expect(plan.extracts).toEqual([])
    if (sample.name === '名流') expect(ops.filter(o => o.targetRelPath.endsWith('.unitypackage'))).toHaveLength(22)
    expect({ units: plan.units.map(u => ({ name: u.displayName, targets: [...u.copyOps, ...u.sidecars].map(o => o.targetRelPath).sort(), covers: u.coverCandidates })),
      archiveSkips: plan.skips.filter(s => s.scope === 'archive').map(s => ({ reason: s.reason, matched: s.evidence.coveredCount, total: s.evidence.totalCount })),
      occurrenceCount: plan.occurrences.length }).toMatchSnapshot()
    cases.push({ name: sample.name, scanRoot, index: { ...index, classifyDeps: undefined }, expectedJSON: JSON.stringify(plan) })
  }, 180_000)
})
