import { describe, expect, it } from 'vitest'
import { candidateKind, selectCoverCandidates, coverErrorAdvice } from '../../src/shared/coverPresentation'
import type { CoverCandidate } from '../../src/shared/covers'
const item = (id: string, name: string, file: string, members: string[] = []): CoverCandidate => ({
  id, name, path: file, memberPaths: members, sourceGuid: 'a'.repeat(32), persistent: true, isScene: false
})
describe('cover candidate presentation', () => {
  const raw = item('raw', 'Chocolate', 'Assets/Props/CHOCOLATE.FBX', ['Gift.unitypackage'])
  const prefab = item('prefab', 'Chocolate ready', 'Assets/Props/Chocolate.prefab', ['Gift.unitypackage'])
  it('prioritizes complete prefab configurations without hiding raw models or selecting an image', () => {
    const inputs = [raw, prefab], result = selectCoverCandidates(inputs, '', 'all')
    expect(result.map(value => value.id)).toEqual(['prefab', 'raw'])
    expect(inputs.map(value => value.id)).toEqual(['raw', 'prefab'])
    expect(candidateKind(raw)).toBe('model'); expect(candidateKind(prefab)).toBe('prefab')
  })
  it('searches normalized names, paths and source package provenance with all words required', () => {
    const fullwidth = item('wide', 'ＣＨＯＣＯ', 'Assets/巧克力/Box.prefab', ['Valentines Gift.unitypackage'])
    expect(selectCoverCandidates([raw, fullwidth], 'choco 巧克力 gift', 'all')).toEqual([fullwidth])
    expect(selectCoverCandidates([raw, prefab], 'props gift', 'model')).toEqual([raw])
    expect(selectCoverCandidates([raw, prefab], 'missing', 'all')).toEqual([])
  })
  it('filters type without modifying objects or discarding material-specific prefab variants', () => {
    const another = { ...prefab, id: 'another', name: 'Chocolate blue' }
    expect(selectCoverCandidates([raw, prefab, another], '', 'prefab')).toHaveLength(2)
    expect(selectCoverCandidates([raw], '', 'model')[0]).toBe(raw)
  })
  it('returns deterministic ordering for equal names regardless of incoming batch order', () => {
    const a = item('a', 'Same', 'Assets/A.prefab'), b = item('b', 'Same', 'Assets/B.prefab')
    expect(selectCoverCandidates([b, a], '', 'all')).toEqual(selectCoverCandidates([a, b], '', 'all'))
  })
})
describe('actionable cover error guidance', () => {
  it('distinguishes configuration, original file, timeout and dependency errors', () => {
    expect(coverErrorAdvice('covers.dependencyMissing')).toBe('covers.adviceDependency')
    expect(coverErrorAdvice('covers.missingShader')).toBe('covers.adviceShader')
    expect(coverErrorAdvice('covers.unityStartTimeout')).toBe('covers.adviceStartup')
    expect(coverErrorAdvice('covers.sourceUnavailable')).toBe('covers.adviceSource')
    expect(coverErrorAdvice('covers.packageConflict')).toBe('covers.adviceConflict')
    expect(coverErrorAdvice('covers.noMesh')).toBe('covers.adviceTarget')
    expect(coverErrorAdvice('unknown')).toBe('covers.adviceRetry')
  })
})
