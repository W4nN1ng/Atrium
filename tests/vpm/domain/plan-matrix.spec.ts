import { describe, expect, it } from 'vitest'
import { buildChangePlan, type ChangePlanInput } from '../../../src/shared/vpm/domain/plan'
import type { ResolverCatalogPackage } from '../../../src/shared/vpm/domain/resolver'

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
  url: `https://example.test/${name}-${version}.zip`,
  size: 10,
  ...extra
})
const build = (input: Partial<ChangePlanInput>) => buildChangePlan({
  projectKey: 'p',
  unityVersion: '2022.3.22f1',
  manifestHashBefore: 'h',
  roots: {},
  catalog: [],
  ...input
})

describe('plan matrix', () => {
  it.each([
    {
      name: 'install',
      input: { requests: [{ kind: 'install', name: 'a' }], catalog: [pkg('a', '1.0.0')] },
      actions: { a: 'install' },
      blocked: false
    },
    {
      name: 'keep',
      input: { roots: { a: '^1' }, installed: [{ name: 'a', version: '1.0.0' }], catalog: [pkg('a', '1.0.0')] },
      actions: { a: 'keep' },
      blocked: false
    },
    {
      name: 'upgrade',
      input: { roots: { a: '^1' }, installed: [{ name: 'a', version: '1.0.0' }], catalog: [pkg('a', '1.0.0'), pkg('a', '1.1.0')], requests: [{ kind: 'upgrade', name: 'a' }] },
      actions: { a: 'upgrade' },
      blocked: false
    },
    {
      name: 'remove exclusive dependency',
      input: {
        roots: { a: '^1' },
        installed: [{ name: 'a', version: '1.0.0' }, { name: 'b', version: '1.0.0' }],
        catalog: [pkg('a', '1.0.0', { dependencies: { b: '^1' } }), pkg('b', '1.0.0')],
        requests: [{ kind: 'remove', name: 'a' }]
      },
      actions: { a: 'remove', b: 'remove' },
      blocked: false
    },
    {
      name: 'mixed upgrade-all',
      input: {
        roots: { a: '^1' },
        locked: { b: { version: '1.0.0' } },
        installed: [{ name: 'a', version: '1.0.0' }, { name: 'b', version: '1.0.0' }],
        catalog: [pkg('a', '1.0.0', { dependencies: { b: '^1' } }), pkg('a', '1.1.0', { dependencies: { b: '^1' } }), pkg('b', '1.1.0')],
        preset: 'upgradeAll'
      },
      actions: { a: 'upgrade', b: 'upgrade' },
      blocked: false
    },
    {
      name: 'missing hash blocks',
      input: { requests: [{ kind: 'install', name: 'a' }], catalog: [pkg('a', '1.0.0', { sha256: null })] },
      actions: { a: 'install' },
      blocked: true
    }
  ] as Array<{ name: string; input: Partial<ChangePlanInput>; actions: Record<string, string>; blocked: boolean }>)(
    '$name',
    ({ input, actions, blocked }) => {
      const plan = build(input)
      expect(Object.fromEntries(plan.changes.map((change) => [change.name, change.action]))).toEqual(actions)
      expect(plan.blocked).toBe(blocked)
    }
  )
})
