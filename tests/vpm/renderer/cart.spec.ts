import { describe, expect, it } from 'vitest'
import type { VpmProjectPackageDto } from '../../../src/shared/vpm/dto'
import {
  actionFor,
  compareVersions,
  countUpdates,
  filterRows,
  removeEntry,
  rowModel,
  sanitizeCart,
  setVersionEntry,
  toRequests,
  toggleEntry
} from '../../../src/renderer/vpm/lib/cart'

function pkg(overrides: Partial<VpmProjectPackageDto> = {}): VpmProjectPackageDto {
  return {
    name: 'com.example.a',
    displayName: 'Example A',
    version: '1.0.0',
    source: 'embedded',
    state: 'installed',
    isLegacy: false,
    protected: false,
    path: 'Packages/com.example.a',
    unity: null,
    ...overrides
  }
}

const catalog = {
  name: 'com.example.a',
  displayName: 'Example A',
  sourceName: 'Official',
  latestVersion: '2.0.0',
  versions: [
    { version: '2.0.0', latest: true, yanked: false, deprecated: false, unityMin: null, repoName: 'official' },
    { version: '1.5.0', latest: false, yanked: false, deprecated: false, unityMin: null, repoName: 'official' },
    { version: '1.0.0', latest: false, yanked: false, deprecated: false, unityMin: null, repoName: 'official' }
  ],
  hasConflict: false
}

describe('compareVersions', () => {
  it('compares numeric segments and falls back for non-numeric', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0)
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBe(0)
  })
})

describe('row model and actions', () => {
  it('shows display name and repository source, falling back to the package id', () => {
    const row = rowModel(pkg(), catalog)
    expect(row.displayName).toBe('Example A')
    expect(row.repoName).toBe('Official')
    expect(rowModel(pkg({ displayName: null }), { ...catalog, displayName: 'Catalog Name' }).displayName).toBe(
      'Catalog Name'
    )
    const unknown = rowModel(pkg({ displayName: null }), undefined)
    expect(unknown.displayName).toBeNull()
    expect(unknown.repoName).toBeNull()
  })

  it('searches both display name and package id', () => {
    const rows = [rowModel(pkg(), catalog)]
    expect(filterRows(rows, { text: 'example', only: 'all' })).toHaveLength(1)
    expect(filterRows(rows, { text: 'com.example', only: 'all' })).toHaveLength(1)
    expect(filterRows(rows, { text: 'missing', only: 'all' })).toHaveLength(0)
  })

  it('marks updates only when the catalog is newer', () => {
    const row = rowModel(pkg(), catalog)
    expect(row.updateAvailable).toBe(true)
    expect(row.latestVersion).toBe('2.0.0')
    expect(rowModel(pkg({ version: '2.0.0' }), catalog).updateAvailable).toBe(false)
    expect(rowModel(pkg(), undefined).updateAvailable).toBe(false)
  })

  it('derives the action from the direction of the version change', () => {
    expect(actionFor('1.0.0', '2.0.0')).toBe('upgrade')
    expect(actionFor('2.0.0', '1.0.0')).toBe('downgrade')
    expect(actionFor('1.0.0', '1.0.0')).toBe('reinstall')
    expect(actionFor(null, '1.0.0')).toBe('install')
  })
})

describe('change cart', () => {
  it('selects an update by default and clears on second toggle', () => {
    const row = rowModel(pkg(), catalog)
    const cart = toggleEntry(new Map(), row)
    expect(cart.get('com.example.a')).toEqual({
      name: 'com.example.a',
      action: 'upgrade',
      version: '2.0.0'
    })
    expect(toggleEntry(cart, row).size).toBe(0)
  })

  it('falls back to reinstall when there is no update', () => {
    const row = rowModel(pkg({ version: '2.0.0' }), catalog)
    expect(toggleEntry(new Map(), row).get('com.example.a')).toEqual({
      name: 'com.example.a',
      action: 'reinstall',
      version: '2.0.0'
    })
  })

  it('never lets a protected package into the cart', () => {
    const row = rowModel(pkg({ state: 'protected', protected: true }), catalog)
    expect(toggleEntry(new Map(), row).size).toBe(0)
    expect(setVersionEntry(new Map(), row, '2.0.0').size).toBe(0)
    expect(removeEntry(new Map(), row).size).toBe(0)
  })

  it('records explicit version picks and removals', () => {
    const row = rowModel(pkg(), catalog)
    const cart = setVersionEntry(new Map(), row, '1.5.0')
    expect(cart.get('com.example.a')).toEqual({
      name: 'com.example.a',
      action: 'upgrade',
      version: '1.5.0'
    })
    expect(setVersionEntry(new Map(), row, '1.0.0').get('com.example.a')?.action).toBe('reinstall')
    expect(removeEntry(new Map(), row).get('com.example.a')).toEqual({
      name: 'com.example.a',
      action: 'remove',
      version: null
    })
  })

  it('builds sorted requests and drops protected names defensively', () => {
    const row = rowModel(pkg(), catalog)
    const protectedRow = rowModel(pkg({ name: 'com.avca.bridge', state: 'protected', protected: true }), undefined)
    const cart = new Map([
      ['com.example.b', { name: 'com.example.b', action: 'remove' as const, version: null }],
      ...setVersionEntry(new Map(), row, '2.0.0')
    ])
    cart.set('com.avca.bridge', { name: 'com.avca.bridge', action: 'remove', version: null })
    const safe = sanitizeCart(cart, [row, protectedRow])
    expect(safe.has('com.avca.bridge')).toBe(false)
    expect(toRequests(safe)).toEqual([
      { kind: 'upgrade', name: 'com.example.a', version: '2.0.0' },
      { kind: 'remove', name: 'com.example.b' }
    ])
  })
})

describe('filtering and counts', () => {
  const rows = [
    rowModel(pkg({ name: 'com.a', version: '1.0.0' }), { ...catalog, name: 'com.a', latestVersion: '2.0.0' }),
    rowModel(pkg({ name: 'com.b', version: '2.0.0' }), { ...catalog, name: 'com.b', latestVersion: '2.0.0' }),
    rowModel(pkg({ name: 'com.c', version: '1.0.0' }), {
      ...catalog,
      name: 'com.c',
      latestVersion: '2.0.0',
      hasConflict: true
    })
  ]

  it('filters by text and by update/conflict state', () => {
    expect(filterRows(rows, { text: 'com.b', only: 'all' }).map((row) => row.name)).toEqual(['com.b'])
    expect(filterRows(rows, { text: '', only: 'updates' }).map((row) => row.name)).toEqual(['com.a', 'com.c'])
    expect(filterRows(rows, { text: '', only: 'conflicts' }).map((row) => row.name)).toEqual(['com.c'])
    expect(countUpdates(rows)).toBe(2)
  })
})
