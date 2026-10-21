import { describe, expect, it } from 'vitest'
import { parseRepoJson } from '../../../src/shared/vpm/domain/repo'

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

function repo(packages: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: 'Test Repo', packages, ...extra })
}

describe('repository JSON parser', () => {
  it('normalizes a valid package and strips headers from the stored manifest', () => {
    const parsed = parseRepoJson(
      repo({
        'com.example.foo': {
          versions: {
            '1.0.0': {
              displayName: 'Foo',
              description: 'A package',
              unity: '2022.3',
              url: 'https://example.test/foo.zip#frag',
              zipSHA256: 'A'.repeat(64),
              zipSize: 123,
              author: { name: 'Example' },
              keywords: ['avatar', 'tool'],
              vpmDependencies: { 'com.example.bar': '>=1.0.0' },
              legacyFolders: ['Assets/Foo'],
              headers: { Authorization: 'secret' },
              'vrc-get': {
                aliases: ['foo-alias'],
                yanked: 'broken build',
                hidden: true,
                headers: { Authorization: 'nested-secret' }
              }
            }
          }
        }
      })
    )

    expect(parsed).toMatchObject({ name: 'Test Repo', packageCount: 1, versionCount: 1 })
    const pkg = parsed.packages[0]
    expect(pkg).toMatchObject({
      name: 'com.example.foo',
      version: '1.0.0',
      displayName: 'Foo',
      description: 'A package',
      unityMin: '2022.3',
      zipUrl: 'https://example.test/foo.zip',
      zipSha256: 'a'.repeat(64),
      zipSize: 123,
      yanked: true,
      yankedReason: 'broken build',
      hidden: true,
      deprecated: false,
      installable: true
    })
    expect(pkg.aliasesJson).toBe('["foo-alias"]')
    expect(pkg.keywordsJson).toBe('["avatar","tool"]')
    expect(pkg.manifestJson).toContain('legacyFolders')
    expect(pkg.manifestJson).toContain('vpmDependencies')
    expect(pkg.manifestJson).not.toContain('secret')
    expect(pkg.manifestJson).not.toContain('headers')
  })

  it('skips invalid packages/versions and reports warnings', () => {
    const parsed = parseRepoJson(
      repo({
        'COM.Upper': { versions: { '1.0.0': {} } },
        'com.example.good': {
          versions: {
            'not a version': { url: 'https://example.test/a.zip' },
            '1.0.0': 'not an object'
          }
        }
      })
    )
    expect(parsed.packageCount).toBe(0)
    expect(parsed.versionCount).toBe(0)
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['invalidPackageName', 'invalidVersion', 'invalidVersionObject'])
    )
  })

  it('marks missing/invalid URL or hash as not installable but keeps the version', () => {
    const parsed = parseRepoJson(
      repo({
        'com.example.foo': {
          versions: {
            '1.0.0': { url: 'http://example.test/foo.zip', zipSHA256: 'bad' },
            '2.0.0': { url: 'https://example.test/foo.zip' }
          }
        }
      })
    )
    expect(parsed.packages).toHaveLength(2)
    for (const pkg of parsed.packages) {
      expect(pkg.installable).toBe(false)
      expect(pkg.zipUrl === null || pkg.zipUrl.startsWith('https://')).toBe(true)
    }
    expect(parsed.warnings.some((warning) => warning.code === 'invalidZipUrl')).toBe(true)
    expect(parsed.warnings.some((warning) => warning.code === 'invalidZipHash')).toBe(true)
  })

  it('accepts BOM JSON and preserves unknown fields', () => {
    const parsed = parseRepoJson(
      '\uFEFF' +
        repo({
          'com.example.foo': {
            versions: {
              '1.0.0': { unknownField: { keep: true }, url: 'https://example.test/a.zip' }
            }
          }
        })
    )
    expect(parsed.packages[0].manifestJson).toContain('unknownField')
  })

  it('rejects repo-level bad JSON/shape and enforces package limits', () => {
    expect(codeOf(() => parseRepoJson('{bad'))).toBe('vpmRepoInvalid')
    expect(codeOf(() => parseRepoJson('[]'))).toBe('vpmRepoInvalid')
    expect(codeOf(() => parseRepoJson(JSON.stringify({ packages: [] })))).toBe('vpmRepoInvalid')
    expect(
      codeOf(() =>
        parseRepoJson(
          repo({
            'com.a': { versions: {} },
            'com.b': { versions: {} }
          }),
          { maxPackages: 1 }
        )
      )
    ).toBe('vpmRepoInvalid')
  })

  it('skips a package with too many versions instead of failing the repo', () => {
    const parsed = parseRepoJson(
      repo({
        'com.example.foo': {
          versions: {
            '1.0.0': {},
            '2.0.0': {}
          }
        }
      }),
      { maxVersionsPerPackage: 1 }
    )
    expect(parsed.packageCount).toBe(0)
    expect(parsed.warnings[0]).toMatchObject({ code: 'tooManyVersions', package: 'com.example.foo' })
  })
})
