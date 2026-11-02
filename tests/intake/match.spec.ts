import { describe, expect, it } from 'vitest'
import { computeCoverage, planSelection, type ClosureSource } from '../../src/main/intake/match'
import type { ClosurePayload, LeafRef } from '../../src/shared/intake'

const leaf = (crc32: number, relPath = `${crc32}.unitypackage`, size = 10, localPath: string | null = null): LeafRef => ({ key: { size, crc32 }, relPath, chain: [], localPath, kind: 'unitypackage' })
const closure = (leaves: LeafRef[], opaque = false): ClosurePayload => ({ leaves, opaque, warnings: [] })
const source = (sourcePath: string, kind: ClosureSource['kind'], leaves: LeafRef[], opaque = false): ClosureSource => ({ sourcePath, kind, closure: closure(leaves, opaque) })
const zip = (name: string, ...keys: number[]) => source(name, 'archive', keys.map(k => leaf(k)))
const dir = (name: string, ...keys: number[]) => source(name, 'directory', keys.map(k => leaf(k)))
const count = (result: ReturnType<typeof planSelection>) => result.keep.flatMap(s => s.leaves).length

describe('content coverage evidence', () => {
  it('matches size/full CRC only, despite garbled names and different directory shells', () => {
    const evidence = computeCoverage(closure([leaf(1, '_Éαû╛Åæ.url', 148)]), [source('root/散', 'directory', [leaf(1, 'double/shell/_愢柧彂.url', 148)])])
    expect(evidence.coveredCount).toBe(1); expect(evidence.missingLeaves).toEqual([])
    expect(evidence.matches[0]).toMatchObject({ coveringPath: 'root/散', coveringRelPath: 'double/shell/_愢柧彂.url', leafRelPath: '_Éαû╛Åæ.url' })
  })
  it('retains multiplicities: two archived appearances versus one loose file is partial', () => {
    const evidence = computeCoverage(closure([leaf(1, 'one'), leaf(1, 'two')]), [dir('root/scatter', 1)])
    expect(evidence).toMatchObject({ totalCount: 2, coveredCount: 1, missingLeaves: [{ size: 10, crc32: 1 }] })
  })
  it('combines disjoint directories and records both covering paths', () => {
    const evidence = computeCoverage(closure([leaf(1), leaf(2)]), [dir('root/Y', 2), dir('root/X', 1)])
    expect(evidence.coveredCount).toBe(2)
    expect(evidence.matches.map(m => m.coveringPath)).toEqual(['root/X', 'root/Y'])
  })
  it('does not count the same loose file twice through overlapping directory views', () => {
    const physical = 'root/sub/a'
    const evidence = computeCoverage(closure([leaf(1, 'one'), leaf(1, 'two')]), [source('root', 'directory', [leaf(1, 'sub/a', 10, physical)]), source('root/sub', 'directory', [leaf(1, 'a', 10, physical)])])
    expect(evidence.coveredCount).toBe(1)
  })
  it('never uses an archive member in its containing directory as loose coverage', () => {
    const member = { ...leaf(1), chain: [{ sourcePath: 'root/a.zip', memberPath: null, format: 'zip' as const, key: { size: 50, crc32: 2 } }] }
    expect(computeCoverage(closure([leaf(1)]), [source('root', 'directory', [member])]).coveredCount).toBe(0)
  })
  it('refuses opaque targets and opaque archive evidence', () => {
    expect(computeCoverage(closure([leaf(1)], true), [dir('root/scatter', 1)]).coveredCount).toBe(0)
    expect(computeCoverage(closure([leaf(1)]), [source('bad.zip', 'archive', [leaf(1)], true)]).coveredCount).toBe(0)
  })
  it('treats empty files as valid content and different sizes as different keys', () => {
    expect(computeCoverage(closure([leaf(0, 'empty', 0)]), [source('loose', 'loose', [leaf(0, 'other', 0)])]).coveredCount).toBe(1)
    expect(computeCoverage(closure([leaf(1, 'same', 10)]), [source('loose', 'loose', [leaf(1, 'same', 11)])]).coveredCount).toBe(0)
  })
  it.each([
    { paths: ['root/unrelated', 'root/Target'], extras: [0, 0], expected: 'root/Target' },
    { paths: ['elsewhere/A', 'root/B'], extras: [0, 0], expected: 'root/B' },
    { paths: ['root/A', 'root/B'], extras: [0, 1], expected: 'root/B' },
    { paths: ['root/B', 'root/A'], extras: [0, 0], expected: 'root/A' }
  ])('breaks full-cover ties by stem, parent, completeness, and ordinal path: $expected', ({ paths, extras, expected }) => {
    const covers = paths.map((p, i) => dir(p, 1, ...Array.from({ length: extras[i] }, (_, j) => 100 + j)))
    const evidence = computeCoverage(closure([leaf(1)]), covers, { sourcePath: 'root/Target.zip' })
    expect(evidence.matches.map(m => m.coveringPath)).toEqual([expected])
  })
})

describe('deterministic global selection', () => {
  it('黑曜石: skips three fully covered ZIPs', () => {
    const result = planSelection([zip('root/Lime.zip', 1), dir('root/Lime', 1), zip('root/Shinano.zip', 2), dir('root/Shinano', 2), zip('root/Textures.zip', 3), dir('root/Textures', 3)])
    expect(result.skip.map(s => s.reason)).toEqual(['fully-covered', 'fully-covered', 'fully-covered'])
    expect(count(result)).toBe(3); expect(result.extract).toEqual([])
  })
  it('motchiri: ten matching keys survive garbled names and sidecars', () => {
    const archive = source('root/motchiri.zip', 'archive', Array.from({ length: 10 }, (_, i) => leaf(i + 1, i === 9 ? '_Éαû╛Åæ.url' : `${i}`)))
    const scattered = source('root/motchiri', 'directory', [...Array.from({ length: 10 }, (_, i) => leaf(i + 1, `double/${i === 9 ? '_愢柧彂.url' : i}`)), leaf(11, 'preview.png'), leaf(12, 'shared.png')])
    const result = planSelection([archive, scattered])
    expect(result.skip[0]).toMatchObject({ reason: 'fully-covered', evidence: { coveredCount: 10 } })
    expect(count(result)).toBe(12)
  })
  it('名流: keeps 22 loose unitypackages and the preview, skips PSD/UV ZIPs', () => {
    const result = planSelection([dir('root/名流', ...Array.from({ length: 23 }, (_, i) => i + 1)), dir('root/名流/PSD', 101, 102, 103, 104, 105), dir('root/名流/UV', 201, 202, 203), zip('root/名流/PSD.zip', 101, 102, 103, 104, 105), zip('root/名流/UV.zip', 201, 202, 203)])
    expect(result.skip).toHaveLength(2); expect(count(result)).toBe(31); expect(result.extract).toEqual([])
  })
  it('西装: 3 loose variants cover part of RAR, extracts exactly 10 including Sio', () => {
    const rar = source('root/6447797.rar', 'archive', Array.from({ length: 13 }, (_, i) => leaf(i + 1, i === 12 ? 'Noir_Luxe_Sio.unitypackage' : `${i}.unitypackage`)))
    const result = planSelection([rar, dir('root/6447797', 1, 2, 3), zip('root/6447797/Chiffon.zip', 1), zip('root/6447797/Shinano.zip', 2)])
    expect(result.extract).toHaveLength(1)
    expect(result.extract[0]).toMatchObject({ sourcePath: rar.sourcePath, mode: 'missing', evidence: { coveredCount: 3, totalCount: 13 } })
    expect(result.extract[0].leaves).toHaveLength(10)
    expect(result.extract[0].leaves.some(l => l.relPath.includes('Sio'))).toBe(true)
    expect(count(result)).toBe(13)
  })
  it('keeps one of equal archives across directories, preferring the shallower path', () => {
    const result = planSelection([zip('root/deep/one.zip', 1, 2), zip('root/two.zip', 1, 2)])
    expect(result.keep.map(s => s.sourcePath)).toEqual(['root/two.zip'])
    expect(result.skip[0]).toMatchObject({ sourcePath: 'root/deep/one.zip', reason: 'duplicate-of-kept-archive', coveredBy: ['root/two.zip'] })
  })
  it('prefers the larger overlapping archive and extracts only the smaller remainder', () => {
    const result = planSelection([zip('root/small.zip', 1, 4), zip('root/large.zip', 1, 2, 3)])
    expect(result.extract.find(s => s.sourcePath.endsWith('small.zip'))!.leaves.map(l => l.key.crc32)).toEqual([4])
    expect(count(result)).toBe(4)
  })
  it('never lets archives cover one another cyclically or uses a skipped source as evidence', () => {
    const result = planSelection([zip('root/A.zip', 1, 2), zip('root/B.zip', 2, 3), zip('root/C.zip', 1, 3)])
    expect(count(result)).toBe(3)
    const kept = new Set(result.keep.map(s => s.sourcePath))
    expect(result.skip.every(s => s.coveredBy.every(p => kept.has(p)))).toBe(true)
  })
  it('preserves a repeated archive key after one loose appearance is covered', () => {
    const result = planSelection([source('root/a.zip', 'archive', [leaf(1, 'one'), leaf(1, 'two')]), dir('root/scatter', 1)])
    expect(result.extract[0].leaves).toHaveLength(1); expect(count(result)).toBe(2)
  })
  it('deduplicates loose copies with provenance, preferring shallow and readable names', () => {
    const result = planSelection([source('root/deep/a', 'loose', [leaf(1)]), source('root/╛bad', 'loose', [leaf(1)]), source('root/正常', 'loose', [leaf(1)])])
    expect(result.keep.map(s => s.sourcePath)).toEqual(['root/正常'])
    expect(result.skip).toHaveLength(2); expect(result.skip.every(s => s.reason === 'identical-loose-copy')).toBe(true)
  })
  it('retains same-name different-content files and noise without filtering', () => {
    const result = planSelection([source('root/A', 'directory', [leaf(1, 'same.txt'), leaf(2, 'Thumbs.db')]), source('root/B.zip', 'archive', [leaf(3, 'same.txt'), leaf(4, '.DS_Store')])])
    expect(result.skip).toEqual([]); expect(count(result)).toBe(4)
  })
  it('derives internal archive sources from a directory view without self-coverage', () => {
    const member = { ...leaf(1, 'a.zip!/1.unitypackage'), chain: [{ sourcePath: 'root/a.zip', memberPath: null, format: 'zip' as const, key: { size: 50, crc32: 2 } }] }
    const result = planSelection([source('root', 'directory', [member, leaf(2, 'loose.unitypackage')])])
    expect(result.skip).toEqual([]); expect(count(result)).toBe(2)
    expect(result.extract[0].sourcePath).toBe('root/a.zip')
  })
  it('keeps opaque containers untouched and reports unreadable entries', () => {
    const broken = source('root/broken.zip', 'archive', [leaf(1)], true)
    broken.closure.unreadable = [{ path: 'failed', reason: 'EBUSY' }]
    const result = planSelection([broken, dir('root/good', 1)])
    expect(result.skip).toEqual([]); expect(result.keep.find(s => s.sourcePath === broken.sourcePath)!.opaque).toBe(true)
    expect(result.blocked).toHaveLength(1)
  })
  it('marks large skips for byte review without doing IO', () => {
    const leaves = Array.from({ length: 10 }, (_, i) => leaf(i, `${i}`, 128 * 1024 ** 2))
    const result = planSelection([source('root/big.zip', 'archive', leaves), source('root/散', 'directory', leaves)])
    expect(result.skip[0].requiresByteReview).toBe(true); expect(result.skip[0].reviewMatches).toHaveLength(5)
  })
  it('does not drop an unreadable loose source with no content key', () => {
    const result = planSelection([source('root/unreadable', 'loose', [], true)])
    expect(result.keep).toEqual([{ sourcePath: 'root/unreadable', kind: 'loose', leaves: [], opaque: true }])
    expect(result.blocked).toHaveLength(1)
  })
  it('uses the same R12 tie-breaker when retaining equivalent loose copies', () => {
    const result = planSelection([zip('root/Target.zip', 1), dir('root/A', 1), dir('root/Target', 1)])
    expect(result.skip.find(s => s.scope === 'archive')!.coveredBy).toEqual(['root/Target'])
  })
  it('rejects contradictory identities for a single physical file', () => {
    expect(() => planSelection([source('root', 'directory', [leaf(1, 'a', 10, 'root/a')]), source('root/a', 'loose', [leaf(2)])])).toThrow(/Conflicting/)
  })
  it('retains each trusted key at its maximum required multiplicity, including archive unions', () => {
    let seed = 271828
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
    for (let run = 0; run < 40; run++) {
      const inputs: ClosureSource[] = [], required = new Map<number, number>()
      for (let i = 0; i < 8; i++) {
        const keys = Array.from({ length: 1 + next() % 8 }, () => next() % 5)
        inputs.push(zip(`root/${i}.zip`, ...keys))
        for (const key of keys) required.set(key, Math.max(required.get(key) ?? 0, keys.filter(k => k === key).length))
      }
      const result = planSelection(inputs), actual = new Map<number, number>()
      for (const leaf of result.keep.flatMap(s => s.leaves)) actual.set(leaf.key.crc32, (actual.get(leaf.key.crc32) ?? 0) + 1)
      expect([...actual].sort()).toEqual([...required].sort())
      expect(JSON.stringify(planSelection([...inputs].reverse()))).toBe(JSON.stringify(result))
    }
  })
  it('is immutable and byte-for-byte deterministic under candidate and leaf permutation', () => {
    const inputs = [zip('root/A.zip', 1, 2, 3), dir('root/X', 1, 4), zip('root/B.zip', 2, 4), dir('root/Y', 1, 5)]
    const original = JSON.stringify(inputs)
    const expected = JSON.stringify(planSelection(inputs))
    for (let n = 0; n < inputs.length; n++) {
      const shuffled = [...inputs.slice(n), ...inputs.slice(0, n)].reverse().map(s => ({ ...s, closure: { ...s.closure, leaves: [...s.closure.leaves].reverse() } }))
      expect(JSON.stringify(planSelection(shuffled))).toBe(expected)
    }
    expect(JSON.stringify(inputs)).toBe(original)
  })
})
