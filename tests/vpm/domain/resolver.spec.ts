import { describe, expect, it } from 'vitest'
import {
  resolveVpmDependencies,
  type ResolverCatalogPackage,
  type ResolverInput
} from '../../../src/shared/vpm/domain/resolver'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function pkg(
  name: string,
  version: string,
  options: Partial<ResolverCatalogPackage> = {}
): ResolverCatalogPackage {
  return {
    name,
    version,
    dependencies: {},
    unity: null,
    yanked: false,
    repoId: 'repo-a',
    repoPriority: 0,
    sha256: HASH_A,
    ...options
  }
}

function run(input: Partial<ResolverInput>): ReturnType<typeof resolveVpmDependencies> {
  return resolveVpmDependencies({
    roots: {},
    catalog: [],
    ...input
  })
}

function byName(result: ReturnType<typeof resolveVpmDependencies>): Record<string, string> {
  return Object.fromEntries(result.selected.map((item) => [item.name, item.version]))
}

describe('VPM resolver basics', () => {
  it('installs a new root package and records its requirement', () => {
    const result = run({
      requests: [{ kind: 'install', name: 'com.example.a' }],
      catalog: [pkg('com.example.a', '1.0.0')]
    })

    expect(result.blocked).toBe(false)
    expect(byName(result)).toEqual({ 'com.example.a': '1.0.0' })
    expect(result.roots).toEqual({ 'com.example.a': '*' })
    expect(result.requirements['com.example.a']).toEqual([{ source: '', range: '*' }])
    expect(result.unused).toEqual([])
  })

  it('pulls dependencies into the queue and records their source', () => {
    const result = run({
      requests: [{ kind: 'install', name: 'com.example.a' }],
      catalog: [
        pkg('com.example.a', '1.0.0', { dependencies: { 'com.example.b': '^1.0.0' } }),
        pkg('com.example.b', '1.2.0')
      ]
    })

    expect(byName(result)).toEqual({
      'com.example.a': '1.0.0',
      'com.example.b': '1.2.0'
    })
    expect(result.requirements['com.example.b']).toEqual([
      { source: 'com.example.a', range: '^1.0.0' }
    ])
  })

  it('keeps a locked version until an upgrade request asks for newer', () => {
    const base: Partial<ResolverInput> = {
      roots: { 'com.example.a': '^1.0.0' },
      locked: { 'com.example.a': { version: '1.0.0' } },
      catalog: [pkg('com.example.a', '1.0.0'), pkg('com.example.a', '1.2.0')]
    }
    expect(byName(run(base))).toEqual({ 'com.example.a': '1.0.0' })
    expect(byName(run({ ...base, requests: [{ kind: 'upgrade', name: 'com.example.a' }] }))).toEqual({
      'com.example.a': '1.2.0'
    })
  })

  it('re-resolves a locked dependency when another root raises its range', () => {
    const result = run({
      roots: {
        'com.example.a': '^1.0.0',
        'com.example.c': '^1.0.0'
      },
      locked: { 'com.example.b': { version: '1.0.0' } },
      catalog: [
        pkg('com.example.a', '1.0.0', { dependencies: { 'com.example.b': '^1.0.0' } }),
        pkg('com.example.c', '1.0.0', { dependencies: { 'com.example.b': '>=1.1.0' } }),
        pkg('com.example.b', '1.0.0'),
        pkg('com.example.b', '1.1.0')
      ]
    })

    expect(byName(result)).toMatchObject({
      'com.example.a': '1.0.0',
      'com.example.c': '1.0.0',
      'com.example.b': '1.1.0'
    })
    expect(result.blocked).toBe(false)
  })

  it('reports two incompatible requirements with both sources', () => {
    const result = run({
      roots: { 'com.example.a': '^1.0.0', 'com.example.b': '^1.0.0' },
      catalog: [
        pkg('com.example.a', '1.0.0', { dependencies: { 'com.example.c': '^1.0.0' } }),
        pkg('com.example.b', '1.0.0', { dependencies: { 'com.example.c': '^2.0.0' } }),
        pkg('com.example.c', '1.0.0'),
        pkg('com.example.c', '2.0.0')
      ]
    })

    expect(result.blocked).toBe(true)
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'com.example.c',
          reason: 'rangeConflict',
          requirements: expect.arrayContaining([
            { source: 'com.example.a', range: '^1.0.0' },
            { source: 'com.example.b', range: '^2.0.0' }
          ])
        })
      ])
    )
    expect(result.selected.some((item) => item.name === 'com.example.c')).toBe(false)
  })

  it('supports exact downgrade and reports an unavailable exact version', () => {
    const base: Partial<ResolverInput> = {
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [pkg('com.example.a', '1.0.0'), pkg('com.example.a', '1.2.0')]
    }
    expect(
      byName(run({ ...base, requests: [{ kind: 'downgrade', name: 'com.example.a', version: '1.0.0' }] }))
    ).toEqual({ 'com.example.a': '1.0.0' })
    const missing = run({
      ...base,
      requests: [{ kind: 'downgrade', name: 'com.example.a', version: '0.9.0' }]
    })
    expect(missing.blocked).toBe(true)
    expect(missing.conflicts[0]).toMatchObject({ name: 'com.example.a', reason: 'rangeConflict' })
  })

  it('reports missing packages instead of inventing candidates', () => {
    const result = run({ roots: { 'com.example.missing': '^1.0.0' } })
    expect(result.blocked).toBe(true)
    expect(result.missing).toEqual([
      { name: 'com.example.missing', requirements: [{ source: '', range: '^1.0.0' }] }
    ])
  })
})

describe('VPM resolver candidate policy', () => {
  it('prefers stable versions and only falls back to prerelease when allowed', () => {
    const stable = run({
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [pkg('com.example.a', '1.0.0'), pkg('com.example.a', '1.1.0-beta.1')]
    })
    expect(byName(stable)).toEqual({ 'com.example.a': '1.0.0' })

    const prerelease = run({
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [pkg('com.example.a', '1.1.0-beta.1')],
      options: { allowPrerelease: true }
    })
    expect(byName(prerelease)).toEqual({ 'com.example.a': '1.1.0-beta.1' })
    expect(prerelease.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'prerelease' })])
    )

    const denied = run({
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [pkg('com.example.a', '1.1.0-beta.1')]
    })
    expect(denied.blocked).toBe(true)
  })

  it('skips yanked versions, keeps a locked yanked version with a warning', () => {
    const result = run({
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [pkg('com.example.a', '1.0.0'), pkg('com.example.a', '1.1.0', { yanked: true })]
    })
    expect(byName(result)).toEqual({ 'com.example.a': '1.0.0' })

    const onlyYanked = run({
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [pkg('com.example.a', '1.1.0', { yanked: true })]
    })
    expect(onlyYanked.blocked).toBe(true)

    const lockedYanked = run({
      roots: { 'com.example.a': '^1.0.0' },
      locked: { 'com.example.a': { version: '1.1.0' } },
      catalog: [pkg('com.example.a', '1.0.0'), pkg('com.example.a', '1.1.0', { yanked: true })]
    })
    expect(byName(lockedYanked)).toEqual({ 'com.example.a': '1.1.0' })
    expect(lockedYanked.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'yanked' })])
    )
  })

  it('filters by Unity compatibility and explains the failure', () => {
    const compatible = run({
      roots: { 'com.example.a': '^1.0.0' },
      options: { unityVersion: '2022.3.22f1' },
      catalog: [
        pkg('com.example.a', '1.0.0', { unity: '2022.3' }),
        pkg('com.example.a', '1.1.0', { unity: '2023.1' })
      ]
    })
    expect(byName(compatible)).toEqual({ 'com.example.a': '1.0.0' })

    const incompatible = run({
      roots: { 'com.example.a': '^1.0.0' },
      options: { unityVersion: '2022.3.22f1' },
      catalog: [pkg('com.example.a', '1.1.0', { unity: '2023.1' })]
    })
    expect(incompatible.blocked).toBe(true)
    expect(incompatible.conflicts[0]).toMatchObject({ reason: 'unityIncompatible' })
  })

  it('uses repository priority and rejects same-version hash conflicts', () => {
    const sameHash = run({
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [
        pkg('com.example.a', '1.0.0', { repoId: 'repo-b', repoPriority: 1, sha256: HASH_A }),
        pkg('com.example.a', '1.0.0', { repoId: 'repo-a', repoPriority: 0, sha256: HASH_A })
      ]
    })
    expect(sameHash.selected[0]).toMatchObject({ repoId: 'repo-a', version: '1.0.0' })

    const conflict = run({
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [
        pkg('com.example.a', '1.0.0', { repoId: 'repo-a', sha256: HASH_A }),
        pkg('com.example.a', '1.0.0', { repoId: 'repo-b', sha256: HASH_B })
      ]
    })
    expect(conflict.blocked).toBe(true)
    expect(conflict.conflicts[0]).toMatchObject({ name: 'com.example.a', reason: 'hashConflict' })
  })

  it('never resolves protected or legacy packages', () => {
    const protectedResult = run({
      requests: [{ kind: 'install', name: 'com.avca.bridge' }],
      catalog: [pkg('com.avca.bridge', '1.0.0')]
    })
    expect(protectedResult.selected).toEqual([])
    expect(protectedResult.conflicts[0]).toMatchObject({ reason: 'protectedPackage' })

    const legacy = run({
      roots: { 'com.example.old': '^1.0.0' },
      options: { legacyPackages: ['com.example.old'] },
      catalog: [pkg('com.example.old', '1.0.0')]
    })
    expect(legacy.selected).toEqual([])
    expect(legacy.conflicts[0]).toMatchObject({ reason: 'legacyPackageConflict' })
  })
})

describe('VPM resolver cleanup and determinism', () => {
  it('removes a root but leaves unrelated packages; transitive remove is blocked', () => {
    const removed = run({
      roots: { 'com.example.a': '^1.0.0', 'com.example.b': '^1.0.0' },
      catalog: [pkg('com.example.a', '1.0.0'), pkg('com.example.b', '1.0.0')],
      requests: [{ kind: 'remove', name: 'com.example.a' }]
    })
    expect(removed.roots).toEqual({ 'com.example.b': '^1.0.0' })
    expect(byName(removed)).toEqual({ 'com.example.b': '1.0.0' })

    const transitive = run({
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [
        pkg('com.example.a', '1.0.0', { dependencies: { 'com.example.b': '^1.0.0' } }),
        pkg('com.example.b', '1.0.0')
      ],
      requests: [{ kind: 'remove', name: 'com.example.b' }]
    })
    expect(transitive.blocked).toBe(true)
    expect(transitive.conflicts[0]).toMatchObject({ name: 'com.example.b', reason: 'transitiveRemove' })
  })

  it('reports unlisted and unused installed packages without deleting them', () => {
    const result = run({
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [pkg('com.example.a', '1.0.0')],
      installed: [
        { name: 'com.example.a', version: '1.0.0' },
        { name: 'com.example.old', version: '1.0.0', source: 'unlisted' },
        { name: 'com.example.extra', version: '1.0.0' }
      ]
    })
    expect(result.unlisted).toEqual(['com.example.old'])
    expect(result.unused).toEqual(['com.example.extra'])
  })

  it('detects dependency cycles and is deterministic', () => {
    const input: Partial<ResolverInput> = {
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [
        pkg('com.example.a', '1.0.0', { dependencies: { 'com.example.b': '^1.0.0' } }),
        pkg('com.example.b', '1.0.0', { dependencies: { 'com.example.a': '^1.0.0' } })
      ]
    }
    const first = run(input)
    const second = run(input)
    expect(first).toEqual(second)
    expect(first.selected.map((item) => item.name)).toEqual(['com.example.a', 'com.example.b'])
    expect(first.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'cycle' })])
    )
  })

  it('rejects invalid root ranges with a structured conflict', () => {
    const result = run({ roots: { 'com.example.a': '~>1.0.0' } })
    expect(result.blocked).toBe(true)
    expect(result.conflicts[0]).toMatchObject({
      name: 'com.example.a',
      reason: 'rangeInvalid'
    })
  })
})
