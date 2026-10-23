import { describe, expect, it } from 'vitest'
import { deepLinksInArgv, parseDeepLink } from '../../../src/main/vpm/interop/deeplink'

describe('atrium deep links (P7-E)', () => {
  it('parses open-project with an absolute path', () => {
    const result = parseDeepLink('atrium://open?path=E%3A%5Cprojects%5CDemo')
    expect(result.rejection).toBeNull()
    expect(result.intent).toEqual({ kind: 'open-project', path: 'E:\\projects\\Demo' })
  })

  it('rejects a relative or empty project path', () => {
    expect(parseDeepLink('atrium://open?path=demo').rejection).toBe('notAbsolutePath')
    expect(parseDeepLink('atrium://open').rejection).toBe('notAbsolutePath')
  })

  it('parses add-repo for both schemes', () => {
    const atrium = parseDeepLink('atrium://add-repo?url=https%3A%2F%2Fexample.test%2Findex.json&name=Mine')
    expect(atrium.intent).toEqual({
      kind: 'add-repo',
      url: 'https://example.test/index.json',
      name: 'Mine',
      source: 'atrium'
    })

    const vcc = parseDeepLink('vcc://vpm/addRepo?url=https%3A%2F%2Fexample.test%2Findex.json')
    expect(vcc.intent).toMatchObject({ kind: 'add-repo', source: 'vcc', name: null })
  })

  it('refuses any link that carries credentials', () => {
    for (const key of ['headers', 'token', 'authorization', 'password']) {
      const result = parseDeepLink(
        `vcc://vpm/addRepo?url=https%3A%2F%2Fexample.test%2Findex.json&${key}=x`
      )
      expect(result.intent, key).toBeNull()
      expect(result.rejection, key).toBe('credentials')
    }
  })

  it('rejects non-https repo urls and unknown schemes', () => {
    expect(parseDeepLink('vcc://vpm/addRepo?url=http%3A%2F%2Finsecure.test%2Fa.json').rejection).toBe(
      'badUrl'
    )
    expect(parseDeepLink('https://example.test/').rejection).toBe('badScheme')
    expect(parseDeepLink('not a url').rejection).toBe('badUrl')
  })

  it('marks unknown atrium hosts instead of guessing', () => {
    const result = parseDeepLink('atrium://something-else?x=1')
    expect(result.intent).toEqual({ kind: 'unknown', raw: 'atrium://something-else?x=1' })
  })

  it('picks deep links out of argv', () => {
    expect(
      deepLinksInArgv([
        'C:\\Program Files\\Atrium\\Atrium.exe',
        '--flag',
        'atrium://open?path=E%3A%5Ca',
        'vcc://vpm/addRepo?url=https%3A%2F%2Fexample.test%2Fi.json'
      ])
    ).toEqual([
      'atrium://open?path=E%3A%5Ca',
      'vcc://vpm/addRepo?url=https%3A%2F%2Fexample.test%2Fi.json'
    ])
  })
})
