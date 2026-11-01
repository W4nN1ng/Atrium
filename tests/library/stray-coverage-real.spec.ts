import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findStrays } from '../../src/main/library/health'
import { matchStrayContents } from '../../src/main/library/strayCoverage'
import { loadLexicon } from '../../src/main/classify/lexicon'

const fixtures = process.env.AVCA_INTAKE_FIXTURES
const roots: string[] = [], results: unknown[] = []
afterAll(() => {
  if (process.env.AVCA_HEALTH_AUDIT) fs.writeFileSync(path.join(process.env.AVCA_HEALTH_AUDIT, 'health-fixtures.json'), JSON.stringify(results, null, 2))
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
})
const samples = [
  { name: 'motchiri', relative: 'A/插件道具合集-初音的VRC小店/更新/插件28件/4108136可触碰皮肤', covered: 1 },
  { name: '黑曜石', relative: 'A/衣服/黑曜石', covered: 3 },
  { name: '名流', relative: 'A/衣服/名流', covered: 2 },
  { name: '西装', relative: 'A/衣服/西装', covered: 2 }
]
describe.skipIf(!fixtures)('M8 approved fixture health reports', () => {
  it.each(samples)('$name uses loose representatives and retains uncovered containers', async sample => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-health-real-')); roots.push(root)
    const scanRoot = path.join(fixtures!, sample.relative)
    const lex = loadLexicon({ builtin: path.resolve('resources/lexicon/lexicon.json') })
    const result = await findStrays(scanRoot, [], { lex, matchContents: items => matchStrayContents(items, { cacheRoot: path.join(root, 'cache'), extraBackendDirs: [path.resolve('resources/bin')] }) })
    const covered = [...new Map(result.items.flatMap(item => item.coveredArchives ?? []).map(a => [a.path, a])).values()]
    expect(covered).toHaveLength(sample.covered)
    for (const archive of covered) {
      expect(archive.evidence.coveredCount).toBe(archive.evidence.totalCount)
      expect(result.items.some(item => item.path === archive.path)).toBe(false)
      expect(fs.existsSync(archive.path)).toBe(true)
    }
    if (sample.name === '西装') expect(result.items.some(item => item.path.endsWith('6447797.rar'))).toBe(true)
    if (sample.name === '黑曜石') expect(result.items).toHaveLength(3)
    results.push({ sample: sample.name, ...result })
  }, 180000)
})
