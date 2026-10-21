import { describe, expect, it } from 'vitest'
import { compareVpmVersions } from '../../../src/shared/vpm/domain/version'

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
