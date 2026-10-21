import { describe, expect, it } from 'vitest'
import {
  buildChangePlan,
  type ChangePlanInput
} from '../../../src/shared/vpm/domain/plan'
import type { ResolverCatalogPackage } from '../../../src/shared/vpm/domain/resolver'

const HASH = 'a'.repeat(64)

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
    sha256: HASH,
    url: `https://example.test/${name}-${version}.zip`,
    size: 10,
    ...options
  }
}

function build(input: Partial<ChangePlanInput>): ReturnType<typeof buildChangePlan> {
  return buildChangePlan({
    projectKey: 'c:\\projects\\demo',
    unityVersion: '2022.3.22f1',
    manifestHashBefore: 'manifest-hash',
    roots: {},
    catalog: [],
    ...input
  })
}

function change(result: ReturnType<typeof buildChangePlan>, name: string) {
  return result.changes.find((item) => item.name === name)
}

describe('change plans', () => {
  it('turns an install into a plan with a download and stable hash', () => {
    const result = build({
      requests: [{ kind: 'install', name: 'com.example.a' }],
      catalog: [pkg('com.example.a', '1.0.0')]
    })

    expect(change(result, 'com.example.a')).toMatchObject({
      action: 'install',
      from: null,
      to: '1.0.0',
      reason: 'root',
      requested: true,
      requiredBy: [{ source: '', range: '*' }]
    })
    expect(result.downloads).toEqual([
      expect.objectContaining({ name: 'com.example.a', version: '1.0.0', sha256: HASH })
    ])
    expect(result.disk).toMatchObject({ downloadBytes: 10, installBytes: 10, freeBytes: null })
    expect(result.blocked).toBe(false)
    expect(result.requiresUnityClosed).toBe(true)
    expect(result.planHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps a locked package without a download', () => {
    const result = build({
      roots: { 'com.example.a': '^1.0.0' },
      locked: { 'com.example.a': { version: '1.0.0' } },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [pkg('com.example.a', '1.0.0'), pkg('com.example.a', '1.2.0')]
    })

    expect(change(result, 'com.example.a')).toMatchObject({
      action: 'keep',
      from: '1.0.0',
      to: '1.0.0',
      reason: 'locked'
    })
    expect(result.downloads).toEqual([])
    expect(result.blocked).toBe(false)
  })

  it('marks upgrade and reinstall downloads, and remove/downgrade actions', () => {
    const upgrade = build({
      roots: { 'com.example.a': '^1.0.0' },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [pkg('com.example.a', '1.0.0'), pkg('com.example.a', '1.2.0')],
      requests: [{ kind: 'upgrade', name: 'com.example.a' }]
    })
    expect(change(upgrade, 'com.example.a')).toMatchObject({
      action: 'upgrade',
      from: '1.0.0',
      to: '1.2.0',
      isMajor: false,
      reason: 'root',
      requested: true
    })

    const reinstall = build({
      roots: { 'com.example.a': '^1.0.0' },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [pkg('com.example.a', '1.0.0')],
      requests: [{ kind: 'reinstall', name: 'com.example.a' }]
    })
    expect(change(reinstall, 'com.example.a')).toMatchObject({
      action: 'reinstall',
      from: '1.0.0',
      to: '1.0.0',
      reason: 'reinstall'
    })
    expect(reinstall.downloads).toHaveLength(1)

    const removed = build({
      roots: { 'com.example.a': '^1.0.0', 'com.example.b': '^1.0.0' },
      installed: [
        { name: 'com.example.a', version: '1.0.0' },
        { name: 'com.example.b', version: '1.0.0' }
      ],
      catalog: [pkg('com.example.a', '1.0.0'), pkg('com.example.b', '1.0.0')],
      requests: [{ kind: 'remove', name: 'com.example.a' }]
    })
    expect(change(removed, 'com.example.a')).toMatchObject({ action: 'remove', from: '1.0.0', to: null, reason: 'unused' })
    expect(change(removed, 'com.example.b')).toMatchObject({ action: 'keep' })
  })

  it('sweeps exclusive dependencies but keeps shared dependencies', () => {
    const exclusive = build({
      roots: { 'com.example.a': '^1.0.0' },
      installed: [
        { name: 'com.example.a', version: '1.0.0' },
        { name: 'com.example.b', version: '1.0.0' }
      ],
      catalog: [pkg('com.example.a', '1.0.0', { dependencies: { 'com.example.b': '^1.0.0' } }), pkg('com.example.b', '1.0.0')],
      requests: [{ kind: 'remove', name: 'com.example.a' }]
    })
    expect(exclusive.changes.filter((item) => item.action === 'remove').map((item) => item.name).sort()).toEqual([
      'com.example.a',
      'com.example.b'
    ])

    const shared = build({
      roots: { 'com.example.a': '^1.0.0', 'com.example.c': '^1.0.0' },
      installed: [
        { name: 'com.example.a', version: '1.0.0' },
        { name: 'com.example.b', version: '1.0.0' },
        { name: 'com.example.c', version: '1.0.0' }
      ],
      catalog: [
        pkg('com.example.a', '1.0.0', { dependencies: { 'com.example.b': '^1.0.0' } }),
        pkg('com.example.b', '1.0.0'),
        pkg('com.example.c', '1.0.0', { dependencies: { 'com.example.b': '^1.0.0' } })
      ],
      requests: [{ kind: 'remove', name: 'com.example.a' }]
    })
    expect(change(shared, 'com.example.a')).toMatchObject({ action: 'remove' })
    expect(change(shared, 'com.example.b')).toMatchObject({ action: 'keep' })
    expect(change(shared, 'com.example.c')).toMatchObject({ action: 'keep' })
  })

  it('carries conflicts/missing into a blocked plan, never removing conflicted installed packages', () => {
    const result = build({
      roots: { 'com.example.a': '^1.0.0', 'com.example.b': '^1.0.0' },
      installed: [{ name: 'com.example.c', version: '1.0.0' }],
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
        expect.objectContaining({ name: 'com.example.c', reason: 'rangeConflict' })
      ])
    )
    expect(result.changes.some((item) => item.name === 'com.example.c' && item.action === 'remove')).toBe(false)

    const missing = build({
      roots: { 'com.example.missing': '^1.0.0' }
    })
    expect(missing.blocked).toBe(true)
    expect(missing.missing).toEqual([
      { name: 'com.example.missing', requirements: [{ source: '', range: '^1.0.0' }] }
    ])
  })

  it('blocks plans when a selected remote package has no hash or URL', () => {
    const noHash = build({
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [pkg('com.example.a', '1.0.0', { sha256: null })]
    })
    expect(noHash.blocked).toBe(true)
    expect(noHash.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'com.example.a', reason: 'missingHash' })])
    )
    expect(noHash.downloads).toEqual([])

    const noUrl = build({
      roots: { 'com.example.a': '^1.0.0' },
      catalog: [pkg('com.example.a', '1.0.0', { url: null })]
    })
    expect(noUrl.blocked).toBe(true)
    expect(noUrl.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'com.example.a', reason: 'missingSource' })])
    )
  })

  it('keeps protected and legacy packages out of executable changes', () => {
    const protectedResult = build({
      roots: { 'com.avca.bridge': '^1.0.0' },
      catalog: [pkg('com.avca.bridge', '1.0.0')]
    })
    expect(protectedResult.changes).toEqual([])
    expect(protectedResult.blocked).toBe(true)
    expect(protectedResult.conflicts[0]).toMatchObject({ reason: 'protectedPackage' })

    const legacyResult = build({
      roots: { 'com.example.old': '^1.0.0' },
      catalog: [pkg('com.example.old', '1.0.0')],
      options: { legacyPackages: ['com.example.old'] }
    })
    expect(legacyResult.changes).toEqual([])
    expect(legacyResult.blocked).toBe(true)
    expect(legacyResult.conflicts[0]).toMatchObject({ reason: 'legacyPackageConflict' })
  })

  it('expands upgradeAll without promoting transitive dependencies to roots', () => {
    const result = build({
      roots: { 'com.example.a': '^1.0.0' },
      locked: { 'com.example.b': { version: '1.0.0' } },
      installed: [
        { name: 'com.example.a', version: '1.0.0' },
        { name: 'com.example.b', version: '1.0.0' }
      ],
      catalog: [
        pkg('com.example.a', '1.0.0', { dependencies: { 'com.example.b': '^1.0.0' } }),
        pkg('com.example.a', '1.2.0', { dependencies: { 'com.example.b': '^1.0.0' } }),
        pkg('com.example.b', '1.2.0')
      ],
      preset: 'upgradeAll'
    })

    expect(change(result, 'com.example.a')).toMatchObject({
      action: 'upgrade',
      requested: true,
      reason: 'root'
    })
    expect(change(result, 'com.example.b')).toMatchObject({
      action: 'upgrade',
      requested: true,
      reason: 'dependency'
    })
    expect(result.blocked).toBe(false)
  })

  it('leaves an upgradeAll with no newer versions as all keep', () => {
    const result = build({
      roots: { 'com.example.a': '^1.0.0' },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog: [pkg('com.example.a', '1.0.0')],
      preset: 'upgradeAll'
    })
    expect(result.changes).toEqual([
      expect.objectContaining({ name: 'com.example.a', action: 'keep', requested: true })
    ])
    expect(result.blocked).toBe(false)
  })

  it('produces a stable hash independent of catalog order and input mutation', () => {
    const catalog = [pkg('com.example.a', '1.0.0'), pkg('com.example.a', '1.2.0')]
    const input: Partial<ChangePlanInput> = {
      roots: { 'com.example.a': '^1.0.0' },
      installed: [{ name: 'com.example.a', version: '1.0.0' }],
      catalog
    }
    const before = JSON.stringify(input)
    const first = build(input)
    const second = build({ ...input, catalog: [...catalog].reverse() })
    expect(first.planHash).toBe(second.planHash)
    expect(first).toEqual(second)
    expect(JSON.stringify(input)).toBe(before)
    expect(build({ ...input, manifestHashBefore: 'other' }).planHash).not.toBe(first.planHash)
  })
})
