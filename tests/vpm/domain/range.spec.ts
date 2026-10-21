import { describe, expect, it } from 'vitest'
import {
  exactVpmRangeVersion,
  parseVpmRange,
  satisfiesVpmRange,
  tryParseVpmRange
} from '../../../src/shared/vpm/domain/range'

function yes(version: string, range: string, options = {}): void {
  expect(satisfiesVpmRange(version, range, options), `${version} satisfies ${range}`).toBe(true)
}
function no(version: string, range: string, options = {}): void {
  expect(satisfiesVpmRange(version, range, options), `${version} does not satisfy ${range}`).toBe(false)
}

describe('VPM version ranges', () => {
  it('supports exact, caret, tilde and comparator ranges', () => {
    yes('1.2.3', '1.2.3')
    no('1.2.4', '1.2.3')
    yes('1.5.0', '^1.2.3')
    no('2.0.0', '^1.2.3')
    yes('0.2.9', '^0.2.3')
    no('0.3.0', '^0.2.3')
    yes('0.0.3', '^0.0.3')
    no('0.0.4', '^0.0.3')
    yes('1.2.9', '~1.2.3')
    no('1.3.0', '~1.2.3')
    yes('1.2.9', '~1.2')
    no('1.3.0', '~1.2')
    yes('1.9.9', '~1')
    no('2.0.0', '~1')
    yes('1.5.0', '>=1.2.3 <2.0.0')
    no('2.0.0', '>=1.2.3 <2.0.0')
    yes('1.2.3', '=1.2.3')
    yes('1.2.3', '<=1.2.3')
    no('1.2.4', '<=1.2.3')
    yes('1.2.4', '>1.2.3')
    no('1.2.3', '>1.2.3')
    yes('1.5.0', '>= 1.2.3 < 2.0.0')
  })

  it('supports partial versions, wildcards and comparator partials', () => {
    yes('1.2.9', '1.2')
    no('1.3.0', '1.2')
    yes('1.2.9', '1.2.x')
    no('1.3.0', '1.2.x')
    yes('1.9.9', '1.x')
    no('2.0.0', '1.x')
    yes('99.0.0', '*')
    yes('1.2.9', '>=1.2')
    no('1.1.9', '>=1.2')
    yes('1.2.9', '<=1.2')
    no('1.3.0', '<=1.2')
    no('1.2.9', '>1.2')
    yes('1.3.0', '>1.2')
    yes('1.1.9', '<1.2')
    no('1.2.0', '<1.2')
  })

  it('supports OR and hyphen ranges', () => {
    yes('1.5.0', '1.x || >=3.0.0')
    yes('3.1.0', '1.x || >=3.0.0')
    no('2.0.0', '1.x || >=3.0.0')
    yes('1.2.3', '1.2.3 - 2.3.4')
    yes('2.3.4', '1.2.3 - 2.3.4')
    no('2.3.5', '1.2.3 - 2.3.4')
    yes('2.3.9', '1.2 - 2.3')
    no('2.4.0', '1.2 - 2.3')
  })

  it('follows SemVer prerelease rules unless explicitly allowed', () => {
    yes('1.0.0-beta', '1.0.0-beta')
    yes('1.0.0-beta.2', '^1.0.0-beta')
    no('1.1.0-beta', '^1.0.0')
    no('1.0.1-beta', '>=1.0.0-a')
    yes('1.1.0-beta', '^1.0.0', { includePrerelease: true })
    no('1.1.0-beta', '*')
    yes('1.1.0-beta', '*', { includePrerelease: true })
  })

  it('exposes exact ranges and safely rejects invalid syntax', () => {
    const exact = parseVpmRange('1.2.3')
    expect(exactVpmRangeVersion(exact)).toMatchObject({ major: 1, minor: 2, patch: 3 })
    expect(exactVpmRangeVersion('1.2')).toBeNull()
    expect(exactVpmRangeVersion('^1.2.3')).toBeNull()
    expect(tryParseVpmRange('>=1.2.3')).not.toBeNull()

    for (const value of [
      '',
      '||',
      '>=',
      '1.2.3 -',
      '~>1.2',
      '1.2.3,',
      '01.2.3',
      '1.2-beta',
      '1.2.3 <',
      '1.2.3 || ',
      'x'.repeat(501)
    ]) {
      expect(tryParseVpmRange(value), value).toBeNull()
      expect(() => parseVpmRange(value), value).toThrowError(/vpmRangeInvalid/)
    }
  })
})
