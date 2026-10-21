import { describe, expect, it } from 'vitest'
import {
  compareParsedVersions,
  compareVpmVersions,
  formatVpmVersion,
  isPrereleaseVersion,
  parseVpmVersion,
  parseVpmVersionOrThrow
} from '../../../src/shared/vpm/domain/version'

describe('VPM version ordering', () => {
  it('orders numeric segments correctly', () => {
    expect(compareVpmVersions('1.9.0', '1.10.0')).toBeLessThan(0)
    expect(compareVpmVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVpmVersions('2.0.0', '1.99.99')).toBeGreaterThan(0)
  })

  it('keeps prerelease below release and orders prerelease identifiers', () => {
    expect(compareVpmVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0)
    expect(compareVpmVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0)
    expect(compareVpmVersions('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBeLessThan(0)
    expect(compareVpmVersions('1.0.0-beta', '1.0.0-beta.2')).toBeLessThan(0)
    expect(compareVpmVersions('1.0.0-beta.11', '1.0.0-beta.2')).toBeGreaterThan(0)
  })

  it('ignores build metadata and accepts a v prefix', () => {
    expect(compareVpmVersions('1.0.0+build.1', '1.0.0+build.2')).toBe(0)
    expect(compareVpmVersions('v1.2.3', '1.2.3')).toBe(0)
  })
})

describe('strict SemVer parsing', () => {
  it('parses valid SemVer 2.0 values', () => {
    expect(parseVpmVersion('1.2.3')).toMatchObject({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: []
    })
    expect(parseVpmVersion('1.0.0-alpha.1+build.9')).toMatchObject({
      prerelease: ['alpha', '1'],
      build: ['build', '9']
    })
    expect(parseVpmVersionOrThrow('0.0.0')).toMatchObject({ major: 0, minor: 0, patch: 0 })
    expect(parseVpmVersion(' 1.2.3 ')).toMatchObject({ raw: '1.2.3' })
    expect(formatVpmVersion(parseVpmVersionOrThrow('1.2.3-beta.2+x'))).toBe('1.2.3-beta.2+x')
  })

  it.each([
    '1.0',
    'v1.2.3',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-01',
    '1.2.3-',
    '1.2.3+',
    '1.2.3.4',
    '1.2.3-beta..1',
    '1.2.3+foo..bar',
    '1.2.3-α',
    'x'.repeat(201)
  ])('rejects invalid or oversized value %s', (value) => {
    expect(parseVpmVersion(value)).toBeNull()
    expect(() => parseVpmVersionOrThrow(value)).toThrowError(/vpmVersionInvalid/)
  })

  it('keeps stable above prerelease and follows SemVer precedence', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0'
    ]
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        expect(compareVpmVersions(ordered[i], ordered[j]), `${ordered[i]} < ${ordered[j]}`).toBeLessThan(0)
        expect(compareVpmVersions(ordered[j], ordered[i]), `${ordered[j]} > ${ordered[i]}`).toBeGreaterThan(0)
      }
    }
  })

  it('is transitive and ignores build metadata', () => {
    const versions = ['1.0.0-alpha', '1.0.0', '1.2.0', '2.0.0-rc.1', '2.0.0']
    for (const a of versions) {
      for (const b of versions) {
        const forward = Math.sign(compareVpmVersions(a, b))
        const backward = Math.sign(compareVpmVersions(b, a))
        expect(forward).toBe(backward === 0 ? 0 : -backward)
        for (const c of versions) {
          if (compareVpmVersions(a, b) < 0 && compareVpmVersions(b, c) < 0) {
            expect(compareVpmVersions(a, c)).toBeLessThan(0)
          }
        }
      }
    }
    const parsed = parseVpmVersionOrThrow('1.2.3')
    expect(compareParsedVersions(parsed, parseVpmVersionOrThrow('1.2.3+build'))).toBe(0)
    expect(isPrereleaseVersion(parseVpmVersionOrThrow('1.2.3-rc.1'))).toBe(true)
  })
})
