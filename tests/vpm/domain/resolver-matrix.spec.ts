import { describe, expect, it } from 'vitest'
import {
  resolveVpmDependencies,
  type ResolverCatalogPackage,
  type ResolverInput
} from '../../../src/shared/vpm/domain/resolver'

const HASH = 'a'.repeat(64)
const pkg = (name: string, version: string, extra: Partial<ResolverCatalogPackage> = {}): ResolverCatalogPackage => ({
  name,
  version,
  dependencies: {},
  unity: null,
  yanked: false,
  repoId: 'repo-a',
  repoPriority: 0,
  sha256: HASH,
  ...extra
})
const run = (input: Partial<ResolverInput>) => resolveVpmDependencies({ roots: {}, catalog: [], ...input })

describe('resolver matrix', () => {
  it.each([
    {
      name: 'root install',
      input: { requests: [{ kind: 'install', name: 'a' }], catalog: [pkg('a', '1.0.0')] },
      selected: { a: '1.0.0' },
      blocked: false
    },
    {
      name: 'locked keep',
      input: { roots: { a: '^1' }, locked: { a: { version: '1.0.0' } }, catalog: [pkg('a', '1.0.0'), pkg('a', '1.1.0')] },
      selected: { a: '1.0.0' },
      blocked: false
    },
    {
      name: 'explicit upgrade',
      input: { roots: { a: '^1' }, locked: { a: { version: '1.0.0' } }, catalog: [pkg('a', '1.0.0'), pkg('a', '1.1.0')], requests: [{ kind: 'upgrade', name: 'a' }] },
      selected: { a: '1.1.0' },
      blocked: false
    },
    {
      name: 'transitive dependency',
      input: { roots: { a: '^1' }, catalog: [pkg('a', '1.0.0', { dependencies: { b: '^2' } }), pkg('b', '2.1.0')] },
      selected: { a: '1.0.0', b: '2.1.0' },
      blocked: false
    },
    {
      name: 'range conflict',
      input: { roots: { a: '^1', b: '^1' }, catalog: [pkg('a', '1.0.0', { dependencies: { c: '^1' } }), pkg('b', '1.0.0', { dependencies: { c: '^2' } }), pkg('c', '1.0.0'), pkg('c', '2.0.0')] },
      selected: { a: '1.0.0', b: '1.0.0' },
      blocked: true
    },
    {
      name: 'yanked only',
      input: { roots: { a: '^1' }, catalog: [pkg('a', '1.0.0', { yanked: true })] },
      selected: {},
      blocked: true
    },
    {
      name: 'unity incompatible',
      input: { roots: { a: '^1' }, catalog: [pkg('a', '1.0.0', { unity: '6000.0' })], options: { unityVersion: '2022.3.22f1' } },
      selected: {},
      blocked: true
    },
    {
      name: 'protected',
      input: { requests: [{ kind: 'install', name: 'com.avca.bridge' }], catalog: [pkg('com.avca.bridge', '1.0.0')] },
      selected: {},
      blocked: true
    }
  ] as Array<{ name: string; input: Partial<ResolverInput>; selected: Record<string, string>; blocked: boolean }>)(
    '$name',
    ({ input, selected, blocked }) => {
      const result = run(input)
      expect(Object.fromEntries(result.selected.map((item) => [item.name, item.version]))).toEqual(selected)
      expect(result.blocked).toBe(blocked)
    }
  )
})
