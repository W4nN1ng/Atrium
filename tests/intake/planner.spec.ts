import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildIntakePlan, type PlannerIndex, type LibraryBlob } from '../../src/main/intake/planner'
import { validateIntakePlan } from '../../src/main/db/repos/intakePlan'
import { loadLexicon } from '../../src/main/classify/lexicon'
import type { ClassifyDeps } from '../../src/main/classify/engine'
import type { LeafRef } from '../../src/shared/intake'

let deps: ClassifyDeps
beforeAll(() => { deps = { lex: loadLexicon({ builtin: path.resolve('resources/lexicon/lexicon.json') }), categories: JSON.parse(fs.readFileSync('resources/lexicon/categories.json', 'utf8')) } })
const sha = (n: number) => n.toString(16).padStart(64, '0')
const leaf = (name: string, n: number, size = 10): LeafRef => ({ relPath: name, key: { size, crc32: n }, blobId: sha(n), localPath: `E:/source/${name}`, chain: [], kind: name.endsWith('.unitypackage') ? 'unitypackage' : 'file' })
function input(name: string, leaves: LeafRef[]): PlannerIndex {
  const root = `E:/source/${name}`
  return { libraryRoot: 'E:/library', classifyDeps: deps, sources: [{ sourcePath: root, kind: 'directory', closure: { leaves: leaves.map(l => ({ ...l, localPath: `${root}/${l.relPath}` })), opaque: false, warnings: [] } }] }
}
const allOps = (plan: ReturnType<typeof buildIntakePlan>) => plan.units.flatMap(u => [...u.copyOps, ...u.sidecars])
function blob(n: number, assetId = 'existing'): LibraryBlob { return { blobId: sha(n), key: { size: 10, crc32: n }, storagePath: `E:/library/.atrium/blobs/${sha(n)}`, refs: [{ assetId, relPath: `${n}.unitypackage` }] } }

describe('normalized intake planner', () => {
  it('motchiri keeps the source unit, two sidecars and full content evidence', () => {
    const leaves = Array.from({ length: 10 }, (_, i) => leaf(`motchiri/motchiri/${i === 9 ? '_愢柧彂.url' : `${i}.unitypackage`}`, i + 1))
    leaves.push(leaf('preview.png', 11), leaf('shared.png', 12))
    const index = input('motchiri', leaves)
    const plan = buildIntakePlan('E:/source/motchiri', index, [])
    expect(plan.units).toHaveLength(1); expect(plan.units[0].displayName).toBe('motchiri')
    expect(allOps(plan)).toHaveLength(12); expect(plan.units[0].sidecars).toHaveLength(2)
    expect(plan.units[0].coverCandidates).toHaveLength(2)
    expect(plan.units[0].classification?.units).toHaveLength(1)
    expect(plan.occurrences).toHaveLength(12)
  })
  it('preserves same-name different contents by deterministic target uniquification', () => {
    const index = input('衬衫', [leaf('a|b/file.unitypackage', 1), leaf('a?b/file.unitypackage', 2), leaf('CON.txt', 3)])
    const plan = buildIntakePlan('E:/source/衬衫', index, [])
    const targets = allOps(plan).map(o => o.targetRelPath)
    expect(new Set(targets.map(p => p.toLowerCase())).size).toBe(3)
    expect(targets.every(p => !/[<>:"|?*]/.test(p))).toBe(true)
    expect(targets.some(p => p.includes('a_b (2)'))).toBe(true)
    expect(plan.warnings.join()).toMatch(/renamed/)
    expect(allOps(plan).map(o => o.originalRelPath)).toContain('a|b/file.unitypackage')
  })
  it('shares generic parent images across the existing classifier’s basket units', () => {
    const index = input('道具2件', [leaf('Alpha/Alpha.unitypackage', 1), leaf('Beta/Beta.unitypackage', 2), leaf('preview.png', 3)])
    const plan = buildIntakePlan('E:/source/道具2件', index, [])
    expect(plan.units).toHaveLength(2)
    expect(plan.units.every(u => u.sidecars.length === 1 && u.coverCandidates.length === 1)).toBe(true)
    expect(plan.units.flatMap(u => u.copyOps)).toHaveLength(2)
    expect(plan.occurrences.filter(o => o.relPath === 'preview.png')).toHaveLength(2)
  })
  it('assigns a named parent preview only to its matching unit', () => {
    const index = input('道具2件', [leaf('Alpha/Alpha.unitypackage', 1), leaf('Beta/Beta.unitypackage', 2), leaf('Alpha-preview.png', 3)])
    const plan = buildIntakePlan('E:/source/道具2件', index, [])
    expect(plan.units.find(u => u.displayName === 'Alpha')!.sidecars).toHaveLength(1)
    expect(plan.units.find(u => u.displayName === 'Beta')!.sidecars).toHaveLength(0)
  })
  it('R14 all-existing unit is duplicate without allocating a new asset or copy', () => {
    const index = input('existing', [leaf('one.unitypackage', 1), leaf('two.unitypackage', 2)])
    const plan = buildIntakePlan('E:/source/existing', index, [blob(1, 'A'), blob(2, 'B')])
    expect(plan.units[0]).toMatchObject({ disposition: 'duplicate', assetId: null, existingAssetIds: ['A', 'B'] })
    expect(allOps(plan).every(o => o.action === 'reuse')).toBe(true)
    expect(plan.occurrences.every(o => o.blobId && o.existingAssetIds.length)).toBe(true)
  })
  it('R14 partially existing unit reuses its blob and plans only missing physical content', () => {
    const index = input('partial', [leaf('one.unitypackage', 1), leaf('two.unitypackage', 2)])
    const plan = buildIntakePlan('E:/source/partial', index, [blob(1)])
    expect(plan.units[0].disposition).toBe('merge')
    expect(plan.units[0].assetId).not.toBeNull()
    expect(allOps(plan).map(o => o.action).sort()).toEqual(['copy', 'reuse'])
  })
  it('never treats matching CRC and size with a different SHA as an existing blob', () => {
    const index = input('collision', [leaf('one.unitypackage', 1)])
    const candidate = { ...blob(1), blobId: sha(999) }
    const plan = buildIntakePlan('E:/source/collision', index, [candidate])
    expect(allOps(plan)[0].action).toBe('copy'); expect(plan.units[0].disposition).toBe('new')
  })
  it('requires full identity review before reusing a key whose SHA is unavailable', () => {
    const unknown = { ...leaf('one.unitypackage', 1), blobId: undefined }
    const plan = buildIntakePlan('E:/source/unknown', input('unknown', [unknown]), [blob(1)])
    expect(plan.reviews.some(r => r.kind === 'library-identity')).toBe(true)
    expect(plan.units[0].disposition).not.toBe('duplicate')
  })
  it('keeps empty and noise files and records all equal loose appearances', () => {
    const plan = buildIntakePlan('E:/source/noise', input('noise', [leaf('one.txt', 1), leaf('two.txt', 1), leaf('Thumbs.db', 2, 0), leaf('.DS_Store', 3)]), [])
    expect(plan.occurrences).toHaveLength(4)
    expect(allOps(plan).some(o => o.originalRelPath === 'Thumbs.db')).toBe(true)
    expect(allOps(plan).some(o => o.originalRelPath === '.DS_Store')).toBe(true)
    expect(allOps(plan).filter(o => o.action === 'copy')).toHaveLength(3)
    expect(allOps(plan).filter(o => o.reuseFromOpId)).toHaveLength(1)
  })
  it('rescues a source SHA collision from a CRC-only skip, retaining both payloads', () => {
    const index = input('collision', [leaf('one.unitypackage', 1)])
    const different = { ...leaf('two.unitypackage', 1), blobId: sha(99), localPath: 'C:/cache/two' }
    index.sources.push({ sourcePath: 'E:/source/collision/two.zip', kind: 'archive', closure: { leaves: [different], opaque: false, warnings: [] } })
    const plan = buildIntakePlan('E:/source/collision', index, [])
    expect(allOps(plan)).toHaveLength(2)
    expect(plan.skips.some(s => s.entry.endsWith('two.zip'))).toBe(false)
    expect(plan.reviews.some(r => r.kind === 'content-collision')).toBe(true)
  })
  it('retains unreadable sources as blocked instead of issuing a successful empty unit', () => {
    const index = input('unreadable', [])
    index.sources[0].closure = { leaves: [], opaque: true, warnings: ['unreadable'], unreadable: [{ path: 'locked', reason: 'EBUSY' }] }
    const plan = buildIntakePlan('E:/source/unreadable', index, [])
    expect(plan.blocked).toHaveLength(1)
    expect(plan.units.some(u => u.disposition === 'duplicate')).toBe(false)
  })
  it('copies an opaque root archive verbatim without claiming to extract a member from it', () => {
    const raw = { ...leaf('broken.rar', 1), localPath: 'E:/source/broken.rar', kind: 'opaque' as const }
    const index: PlannerIndex = { libraryRoot: 'E:/library', classifyDeps: deps, sources: [{ sourcePath: raw.localPath, kind: 'archive', closure: { leaves: [raw], opaque: true, warnings: ['bad listing'] } }] }
    const plan = buildIntakePlan(raw.localPath, index, [])
    expect(allOps(plan).map(o => o.targetRelPath)).toEqual(['broken/broken.rar'])
    expect(plan.extracts).toEqual([]); expect(plan.skips).toEqual([])
    expect(plan.occurrences[0].kind).toBe('loose')
  })
  it('normalizes a single nested ZIP without expanding its unitypackage', () => {
    const cached = { ...leaf('inner.zip!/a.unitypackage', 1), localPath: 'C:/cache/a', chain: [{ sourcePath: 'E:/source/outer.zip', memberPath: 'inner.zip', format: 'zip' as const, key: { size: 30, crc32: 3 } }] }
    const index: PlannerIndex = { libraryRoot: 'E:/library', classifyDeps: deps, sources: [{ sourcePath: 'E:/source/outer.zip', kind: 'archive', closure: { leaves: [cached], opaque: false, warnings: [] } }] }
    const plan = buildIntakePlan('E:/source/outer.zip', index, [])
    expect(allOps(plan)[0].targetRelPath).toBe('outer/inner/a.unitypackage')
    expect(plan.occurrences[0].kind).toBe('extracted'); validateIntakePlan(plan)
  })
  it('preserves a complete partially covered logical archive while copying from the loose representative', () => {
    const index = input('partial-tree', [leaf('Scatter/a.unitypackage', 1)])
    index.sources.push({ sourcePath: 'E:/source/partial-tree/Other.zip', kind: 'archive', closure: { leaves: [{ ...leaf('a.unitypackage', 1), localPath: 'C:/cache/a' }, { ...leaf('b.unitypackage', 2), localPath: 'C:/cache/b' }], opaque: false, warnings: [] } })
    const plan = buildIntakePlan('E:/source/partial-tree', index, []), ops = allOps(plan)
    expect(ops).toHaveLength(3); expect(ops.filter(o => o.action === 'copy')).toHaveLength(2)
    expect(ops.find(o => o.blobId === sha(1) && o.action === 'copy')!.sourcePath).toBe('E:/source/partial-tree/Scatter/a.unitypackage')
    expect(ops.some(o => o.targetRelPath === 'partial-tree/Other/a.unitypackage')).toBe(true)
    expect(plan.extracts[0].members).toEqual(['b.unitypackage'])
  })
  it('validates shared sidecar blob dependencies across independently classified units', () => {
    const plan = buildIntakePlan('E:/source/道具2件', input('道具2件', [leaf('Alpha/Alpha.unitypackage', 1), leaf('Beta/Beta.unitypackage', 2), leaf('preview.png', 3)]), [])
    const shared = allOps(plan).find(o => o.reuseFromOpId)!
    expect(shared).toBeDefined(); expect(allOps(plan).some(o => o.id === shared.reuseFromOpId && o.action === 'copy')).toBe(true)
    validateIntakePlan(plan)
  })
  it('keeps R17 review requirements and cache references in the durable plan', () => {
    const leaves = Array.from({ length: 10 }, (_, i) => leaf(`${i}.unitypackage`, i + 1, 128 * 1024 ** 2))
    const index = input('large', leaves)
    index.sources[0].closure.cacheKeys = [sha(42)]
    index.sources.push({ sourcePath: 'E:/source/large/a.zip', kind: 'archive', closure: { leaves, opaque: false, warnings: [], cacheKeys: [sha(43)] } })
    const plan = buildIntakePlan('E:/source/large', index, [])
    expect(plan.reviews.some(r => r.kind === 'coverage' && r.matches.length === 5)).toBe(true)
    expect(plan.cacheKeys).toEqual([sha(42), sha(43)])
    expect(plan.skips.find(s => s.entry.endsWith('a.zip'))?.requiresByteReview).toBe(true)
  })
  it('never plans source/library overlap or an unsafe target root', () => {
    expect(() => buildIntakePlan('E:/source/a', { ...input('a', [leaf('a.txt', 1)]), libraryRoot: 'E:/source/a/library' }, [])).toThrow(/overlap/)
    expect(() => buildIntakePlan('E:/source/a', { ...input('a', []), libraryRoot: 'E:/' }, [])).toThrow()
  })
  it('shortens a unit name before blocking an otherwise valid long target path', () => {
    const name = 'x'.repeat(95), member = `${'d'.repeat(80)}/${'e'.repeat(70)}.unitypackage`
    const plan = buildIntakePlan(`E:/source/${name}`, input(name, [leaf(member, 1)]), [])
    expect(plan.blocked).toEqual([])
    expect(plan.units[0].relativeRoot.length).toBeLessThan(95)
    expect(allOps(plan)[0].targetRelPath.length + plan.libraryRoot.length + 1).toBeLessThan(260)
  })
  it('preserves unplaceable deeply nested files as explicit blocked occurrences', () => {
    const member = `${'a/'.repeat(130)}p.unitypackage`
    const plan = buildIntakePlan('E:/source/deep', input('deep', [leaf(member, 1)]), [])
    expect(plan.blocked).toHaveLength(1); expect(plan.units[0].disposition).toBe('blocked')
    expect(plan.occurrences[0].copyOpId).toBeNull()
  })
  it('keeps stable IDs and byte-identical plans under enumeration permutations', () => {
    const index = input('deterministic', [leaf('B/B.unitypackage', 2), leaf('A/A.unitypackage', 1), leaf('preview.png', 3)])
    const original = JSON.stringify(index.sources)
    const first = JSON.stringify(buildIntakePlan('E:/source/deterministic', index, []))
    const reversed = { ...index, sources: index.sources.map(s => ({ ...s, closure: { ...s.closure, leaves: [...s.closure.leaves].reverse() } })).reverse() }
    expect(JSON.stringify(buildIntakePlan('E:/source/deterministic', reversed, []))).toBe(first)
    expect(JSON.stringify(index.sources)).toBe(original)
  })
  it('matches a portable plan snapshot without cache or absolute source paths', () => {
    const plan = buildIntakePlan('E:/source/名流', input('名流', [leaf('A.unitypackage', 1), leaf('材质/UV.png', 2), leaf('ATTITUDE The Royal Bunny.jpg', 3)]), [])
    expect(plan.units.map(u => ({ name: u.displayName, disposition: u.disposition, targets: [...u.copyOps, ...u.sidecars].map(o => o.targetRelPath).sort(), covers: u.coverCandidates }))).toMatchInlineSnapshot(`
      [
        {
          "covers": [
            "名流/ATTITUDE The Royal Bunny.jpg",
            "名流/材质/UV.png",
          ],
          "disposition": "new",
          "name": "名流",
          "targets": [
            "名流/A.unitypackage",
            "名流/ATTITUDE The Royal Bunny.jpg",
            "名流/材质/UV.png",
          ],
        },
      ]
    `)
  })
})
