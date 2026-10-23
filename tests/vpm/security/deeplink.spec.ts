import { describe, expect, it } from 'vitest'
import { parseDeepLink } from '../../../src/main/vpm/interop/deeplink'

describe('deep-link attack matrix (P9-A)', () => {
  it('rejects every credential-bearing key case-insensitively', () => {
    const keys = [
      'headers',
      'header',
      'token',
      'access_token',
      'authorization',
      'auth',
      'password',
      'secret',
      'cookie'
    ]
    for (const key of keys) {
      for (const variant of [key, key.toUpperCase()]) {
        const result = parseDeepLink(
          `vcc://vpm/addRepo?url=https%3A%2F%2Fexample.test%2Findex.json&${variant}=leak`
        )
        expect(result.intent, variant).toBeNull()
        expect(result.rejection, variant).toBe('credentials')
      }
    }
  })

  it('rejects credentials embedded in the project-open link too', () => {
    const result = parseDeepLink(
      'atrium://open?path=E%3A%5CProjects%5CDemo&token=secret'
    )
    expect(result.intent).toBeNull()
    expect(result.rejection).toBe('credentials')
  })

  it('rejects non-HTTPS, userinfo, relative and unknown-scheme links', () => {
    const cases: Array<[string, string | null]> = [
      ['vcc://vpm/addRepo?url=http%3A%2F%2Fevil.test%2Findex.json', 'badUrl'],
      ['vcc://vpm/addRepo?url=https%3A%2F%2Fuser%3Apass%40evil.test%2Findex.json', 'badUrl'],
      ['atrium://open?path=demo%2Fproject', 'notAbsolutePath'],
      ['atrium://open?path=', 'notAbsolutePath'],
      ['https://example.test/x', 'badScheme'],
      ['file:///C:/secret', 'badScheme'],
      ['not a url', 'badUrl']
    ]
    for (const [raw, expected] of cases) {
      const result = parseDeepLink(raw)
      expect(result.intent, raw).toBeNull()
      expect(result.rejection, raw).toBe(expected)
    }
  })

  it('does not invent an intent for unknown atrium/vcc hosts', () => {
    expect(parseDeepLink('atrium://unknown?x=1').intent).toMatchObject({ kind: 'unknown' })
    expect(parseDeepLink('vcc://unknown/path?x=1').intent).toMatchObject({ kind: 'unknown' })
  })
})
