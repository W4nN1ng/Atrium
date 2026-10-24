import { describe, expect, it } from 'vitest'
import { reverseRequests } from '../../../src/shared/vpm/domain/undo'
import type { ChangePlanChange } from '../../../src/shared/vpm/domain/plan'

function change(overrides: Partial<ChangePlanChange>): ChangePlanChange {
  return {
    name: 'com.example.a',
    action: 'install',
    from: null,
    to: '1.0.0',
    isMajor: false,
    reason: 'root',
    requested: true,
    requiredBy: [],
    repoId: null,
    risk: [],
    ...overrides
  }
}

describe('reverseRequests', () => {
  it('turns install into remove and remove back into an exact install', () => {
    expect(reverseRequests([change({ action: 'install', from: null, to: '1.0.0' })])).toEqual([
      { kind: 'remove', name: 'com.example.a' }
    ])
    expect(
      reverseRequests([change({ action: 'remove', from: '1.2.3', to: null })])
    ).toEqual([{ kind: 'install', name: 'com.example.a', version: '1.2.3' }])
  })

  it('restores the previous version for upgrades, downgrades and reinstalls', () => {
    expect(
      reverseRequests([change({ action: 'upgrade', from: '1.0.0', to: '2.0.0' })])
    ).toEqual([{ kind: 'install', name: 'com.example.a', version: '1.0.0' }])
    expect(
      reverseRequests([change({ action: 'downgrade', from: '3.0.0', to: '2.0.0' })])
    ).toEqual([{ kind: 'install', name: 'com.example.a', version: '3.0.0' }])
    expect(
      reverseRequests([change({ action: 'reinstall', from: '1.0.0', to: '1.0.0' })])
    ).toEqual([{ kind: 'reinstall', name: 'com.example.a', version: '1.0.0' }])
  })

  it('skips keep rows and rows without a usable version', () => {
    expect(
      reverseRequests([
        change({ action: 'keep', from: '1.0.0', to: '1.0.0' }),
        change({ action: 'remove', from: null, to: null }),
        change({ action: 'upgrade', from: null, to: '2.0.0' })
      ])
    ).toEqual([])
  })

  it('deduplicates and sorts for stable plans', () => {
    const out = reverseRequests([
      change({ name: 'com.example.b', action: 'install' }),
      change({ name: 'com.example.a', action: 'install' }),
      change({ name: 'com.example.a', action: 'install' })
    ])
    expect(out).toEqual([
      { kind: 'remove', name: 'com.example.a' },
      { kind: 'remove', name: 'com.example.b' }
    ])
  })
})
