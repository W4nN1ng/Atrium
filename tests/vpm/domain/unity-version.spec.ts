import { describe, expect, it } from 'vitest'
import {
  compareUnityVersions,
  isPartialUnityVersion,
  isUnityVersionCompatible,
  parseUnityVersion,
  parseUnityVersionOrThrow,
  unityVersionBase
} from '../../../src/shared/vpm/domain/unityVersion'

describe('Unity versions', () => {
  it('parses full, partial and China variants', () => {
    expect(parseUnityVersion('2022.3.22f1')).toMatchObject({
      major: 2022,
      minor: 3,
      patch: 22,
      stage: 'f',
      stageNumber: 1,
      china: null,
      base: '2022.3.22f1'
    })
    expect(parseUnityVersion('2022.3')).toMatchObject({ minor: 3, patch: null, stage: null })
    expect(parseUnityVersion('6000.0.23f1')).toMatchObject({ major: 6000, minor: 0, patch: 23 })
    expect(parseUnityVersion('2022.3.22f1c1')).toMatchObject({
      stage: 'f',
      stageNumber: 1,
      china: 1,
      base: '2022.3.22f1'
    })
    expect(unityVersionBase('2022.3.22f1c2')).toBe('2022.3.22f1')
    expect(isPartialUnityVersion(parseUnityVersionOrThrow('2022.3'))).toBe(true)
    expect(isPartialUnityVersion(parseUnityVersionOrThrow('2022.3.22f1'))).toBe(false)
  })

  it('orders stage/partial versions and ignores the China suffix for compatibility', () => {
    const a = parseUnityVersionOrThrow('2022.3.22f1')
    const b = parseUnityVersionOrThrow('2022.3.22f1c1')
    const c = parseUnityVersionOrThrow('2022.3.22p1')
    const d = parseUnityVersionOrThrow('2022.3.22')
    const e = parseUnityVersionOrThrow('2022.3.23f1')
    expect(compareUnityVersions(a, b)).toBe(0)
    expect(compareUnityVersions(a, c)).toBeLessThan(0)
    expect(compareUnityVersions(d, a)).toBeLessThan(0)
    expect(compareUnityVersions(a, e)).toBeLessThan(0)
    expect(isUnityVersionCompatible('2022.3', '2022.3.22f1')).toBe(true)
    expect(isUnityVersionCompatible('2022.3.23', '2022.3.22f1')).toBe(false)
    expect(isUnityVersionCompatible('2022.3.22f1c1', '2022.3.22f1')).toBe(true)
  })

  it.each([
    '2022.3f1',
    '2022.3.22c1',
    '22.3.22f1',
    '2022.03.22f1',
    '2022.3.022f1',
    '2022.3.22x1',
    '2022.3.22f',
    '2022.3.22f01',
    '2022.3.22f1c01',
    '2022.3.22f1 ' + '0',
    'x'.repeat(65)
  ])('rejects invalid Unity version %s', (value) => {
    expect(parseUnityVersion(value)).toBeNull()
    expect(() => parseUnityVersionOrThrow(value)).toThrowError(/vpmUnityVersionInvalid/)
    expect(isUnityVersionCompatible(value, '2022.3.22f1')).toBe(false)
  })
})
