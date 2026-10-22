import { describe, expect, it } from 'vitest'
import {
  isValidGuid,
  normalizeUnityPathname,
  planUnityPackage,
  type UnityPackageEntry
} from '../../../src/shared/vpm/domain/unitypackage'

const GUID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const GUID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function entry(overrides: Partial<UnityPackageEntry> = {}): UnityPackageEntry {
  return {
    guid: GUID,
    pathname: 'Assets/Prefab.prefab',
    hasAsset: true,
    hasMeta: true,
    ...overrides
  }
}

describe('normalizeUnityPathname', () => {
  it('accepts Assets paths and normalizes the first segment', () => {
    expect(normalizeUnityPathname('Assets/A.prefab')).toEqual({ ok: true, path: 'Assets/A.prefab' })
    expect(normalizeUnityPathname('Assets/Dir/A.mat')).toEqual({ ok: true, path: 'Assets/Dir/A.mat' })
    expect(normalizeUnityPathname('assets/A.prefab')).toEqual({ ok: true, path: 'Assets/A.prefab' })
    expect(normalizeUnityPathname('Assets/A.prefab\n')).toEqual({ ok: true, path: 'Assets/A.prefab' })
  })

  it('rejects unsafe paths', () => {
    const cases: Array<[string, string]> = [
      ['', 'empty'],
      ['Assets/\u0000bad', 'control'],
      ['Assets\\A.prefab', 'backslash'],
      ['/Assets/A.prefab', 'absolute'],
      ['C:/Assets/A.prefab', 'driveLetter'],
      ['Assets/../evil.prefab', 'traversal'],
      ['Assets//A.prefab', 'emptySegment'],
      ['Packages/A.prefab', 'notUnderAssets'],
      ['Assets', 'notUnderAssets'],
      ['Assets/CON', 'reserved'],
      ['Assets/COM1.txt', 'reserved'],
      ['Assets/A.prefab.', 'trailingDotOrSpace'],
      ['Assets/A.prefab ', 'trailingDotOrSpace'],
      [`Assets/${'x'.repeat(300)}.prefab`, 'tooLong']
    ]
    for (const [value, issue] of cases) {
      const result = normalizeUnityPathname(value)
      expect(result.ok, value).toBe(false)
      if (!result.ok) expect(result.issue, value).toBe(issue)
    }
  })
})

describe('planUnityPackage', () => {
  it('keeps valid entries, warns about missing meta and sorts by path', () => {
    const plan = planUnityPackage([
      entry({ guid: GUID_B, pathname: 'Assets/Z.prefab' }),
      entry({ guid: GUID, pathname: 'Assets/A.prefab', hasMeta: false })
    ])
    expect(plan.items.map((item) => item.path)).toEqual(['Assets/A.prefab', 'Assets/Z.prefab'])
    expect(plan.items[0]).toMatchObject({ missingMeta: true, metaPath: 'Assets/A.prefab.meta' })
    expect(plan.skipped).toEqual([])
  })

  it('skips entries without guid / pathname / asset', () => {
    const plan = planUnityPackage([
      entry({ guid: 'not-a-guid' }),
      entry({ pathname: null }),
      entry({ hasAsset: false })
    ])
    expect(plan.items).toEqual([])
    expect(plan.skipped.map((item) => item.reason)).toEqual(['invalidGuid', 'noPathname', 'noAsset'])
  })

  it('skips unsafe pathnames with the underlying issue', () => {
    const plan = planUnityPackage([entry({ pathname: 'Assets/../evil.prefab' })])
    expect(plan.items).toEqual([])
    expect(plan.skipped[0]).toMatchObject({ reason: 'invalidPathname', detail: 'traversal' })
  })

  it('treats case-insensitive duplicates as the same target', () => {
    const plan = planUnityPackage([
      entry({ guid: GUID, pathname: 'Assets/A.prefab' }),
      entry({ guid: GUID_B, pathname: 'Assets/a.PREFAB' })
    ])
    expect(plan.items).toHaveLength(1)
    expect(plan.skipped[0]).toMatchObject({ reason: 'duplicatePath' })
  })
})

describe('guid', () => {
  it('only accepts 32 hex characters', () => {
    expect(isValidGuid(GUID)).toBe(true)
    expect(isValidGuid('A'.repeat(32))).toBe(true)
    expect(isValidGuid('a'.repeat(31))).toBe(false)
    expect(isValidGuid('z'.repeat(32))).toBe(false)
  })
})
