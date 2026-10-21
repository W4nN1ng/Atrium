import { describe, expect, it } from 'vitest'
import {
  isValidPackageId,
  normalizePackageId,
  packageIdSegments
} from '../../../src/shared/vpm/domain/packageId'

describe('VPM package IDs', () => {
  it('normalizes case and keeps valid reverse-DNS names', () => {
    expect(normalizePackageId(' com.VRChat.Avatars ')).toBe('com.vrchat.avatars')
    expect(packageIdSegments('com.example.pkg')).toEqual(['com', 'example', 'pkg'])
    expect(isValidPackageId('com.avca.bridge')).toBe(true)
    expect(isValidPackageId('com.example.pkg-1_test')).toBe(true)
  })

  it.each([
    '',
    '   ',
    '../evil',
    'com/example',
    'com\\example',
    'com.example.',
    'com..example',
    '.com.example',
    'com .example',
    'com.con',
    'con',
    'NUL.pkg',
    'com.example.pkg:',
    'com.example.pkg?',
    'x'.repeat(215)
  ])('rejects invalid or unsafe package ID %s', (value) => {
    expect(isValidPackageId(value)).toBe(false)
    expect(() => normalizePackageId(value)).toThrowError(/vpmPackageIdInvalid/)
  })
})
