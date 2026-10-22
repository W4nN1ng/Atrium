import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractPackageZip } from '../../../src/main/vpm/install/archive'
import { makeZip, type ZipFixtureEntry } from './zip-fixture'

let root: string
let out: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-archive-'))
  out = path.join(root, 'out')
  fs.mkdirSync(out)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function writeZip(name: string, entries: readonly ZipFixtureEntry[]): string {
  const file = path.join(root, name)
  fs.writeFileSync(file, makeZip(entries))
  return file
}

function target(name: string): string {
  return path.join(out, name)
}

function packageJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'com.example.pkg',
    version: '1.2.3',
    vpmDependencies: { 'com.example.dep': '^2.0.0' },
    ...overrides
  })
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

describe('extractPackageZip', () => {
  it('extracts a valid package, preserves .meta bytes and empty directories, and finds the root', async () => {
    const meta = Buffer.from([0, 1, 2, 3, 255, 254])
    const zip = writeZip('ok.zip', [
      { name: 'package.json', data: packageJson() },
      { name: 'Textures/a.png', data: 'png bytes' },
      { name: 'Textures/a.png.meta', data: meta },
      { name: 'empty/', directory: true }
    ])
    const result = await extractPackageZip({
      zipPath: zip,
      targetDir: target('ok'),
      expected: { name: 'com.example.pkg', version: '1.2.3' }
    })

    expect(result).toMatchObject({
      name: 'com.example.pkg',
      version: '1.2.3',
      entries: 4,
      bytes: Buffer.byteLength(packageJson()) + 9 + meta.length
    })
    expect(result.rootDir).toBe(fs.realpathSync(target('ok')))
    expect(result.packageJsonPath).toBe(path.join(result.rootDir, 'package.json'))
    expect(fs.readFileSync(path.join(result.rootDir, 'Textures', 'a.png.meta'))).toEqual(meta)
    expect(fs.statSync(path.join(result.rootDir, 'empty')).isDirectory()).toBe(true)
    expect(result.manifest).toMatchObject({
      name: 'com.example.pkg',
      version: '1.2.3',
      vpmDependencies: { 'com.example.dep': '^2.0.0' }
    })
  })

  it('accepts one unique wrapper directory and rejects ambiguous/missing roots', async () => {
    const wrapped = writeZip('wrapped.zip', [
      { name: 'com.example.pkg-1.2.3/package.json', data: packageJson() },
      { name: 'com.example.pkg-1.2.3/README.md', data: 'readme' }
    ])
    const result = await extractPackageZip({
      zipPath: wrapped,
      targetDir: target('wrapped'),
      expected: { name: 'com.example.pkg', version: '1.2.3' }
    })
    expect(result.rootDir).toBe(
      fs.realpathSync(path.join(target('wrapped'), 'com.example.pkg-1.2.3'))
    )

    const missing = writeZip('missing.zip', [{ name: 'README.md', data: 'x' }])
    expect(
      await errorCode(
        extractPackageZip({ zipPath: missing, targetDir: target('missing') })
      )
    ).toBe('vpmArchivePackageInvalid')

    const ambiguous = writeZip('ambiguous.zip', [
      { name: 'a/package.json', data: packageJson() },
      { name: 'b/package.json', data: packageJson() }
    ])
    expect(
      await errorCode(
        extractPackageZip({ zipPath: ambiguous, targetDir: target('ambiguous') })
      )
    ).toBe('vpmArchivePackageInvalid')

    expect(
      await errorCode(
        extractPackageZip({
          zipPath: wrapped,
          targetDir: target('mismatch'),
          expected: { name: 'com.example.other', version: '1.2.3' }
        })
      )
    ).toBe('vpmArchivePackageInvalid')
  })

  it('rejects bad package.json identity, versions and dependency ranges', async () => {
    const cases: Array<{ name: string; json: string }> = [
      { name: 'bad-id', json: packageJson({ name: 'CON' }) },
      { name: 'bad-version', json: packageJson({ version: 'v1.2.3' }) },
      { name: 'bad-dep-name', json: packageJson({ vpmDependencies: { '../escape': '^1.0.0' } }) },
      { name: 'bad-dep-range', json: packageJson({ vpmDependencies: { 'com.example.dep': 'wat' } }) },
      { name: 'bad-dep-shape', json: packageJson({ vpmDependencies: [] }) }
    ]
    for (const item of cases) {
      const zip = writeZip(`${item.name}.zip`, [{ name: 'package.json', data: item.json }])
      expect(
        await errorCode(
          extractPackageZip({ zipPath: zip, targetDir: target(item.name) })
        )
      ).toBe('vpmArchivePackageInvalid')
    }
  })

  it('rejects zip-slip, absolute, drive, UNC, reserved, ADS, trailing-dot and duplicate paths', async () => {
    const cases: Array<{ name: string; entries: ZipFixtureEntry[] }> = [
      { name: 'dotdot', entries: [{ name: '../evil.txt', data: 'x' }] },
      { name: 'nested-dotdot', entries: [{ name: 'safe/../../evil.txt', data: 'x' }] },
      { name: 'absolute', entries: [{ name: '/evil.txt', data: 'x' }] },
      { name: 'drive', entries: [{ name: 'C:/evil.txt', data: 'x' }] },
      { name: 'unc', entries: [{ name: '\\\\server\\share\\evil.txt', data: 'x' }] },
      { name: 'reserved', entries: [{ name: 'CON', data: 'x' }] },
      { name: 'reserved-ext', entries: [{ name: 'nul.txt', data: 'x' }] },
      { name: 'ads', entries: [{ name: 'foo.txt:bar', data: 'x' }] },
      { name: 'trailing-dot', entries: [{ name: 'foo./bar.txt', data: 'x' }] },
      { name: 'trailing-space', entries: [{ name: 'foo /bar.txt', data: 'x' }] },
      { name: 'invalid-char', entries: [{ name: 'a?b.txt', data: 'x' }] },
      { name: 'duplicate-case', entries: [{ name: 'A.txt', data: 'a' }, { name: 'a.txt', data: 'b' }] },
      { name: 'duplicate-slash', entries: [{ name: 'a/b.txt', data: 'a' }, { name: 'a\\b.txt', data: 'b' }] },
      { name: 'file-then-child', entries: [{ name: 'a', data: 'a' }, { name: 'a/b', data: 'b' }] },
      { name: 'child-then-file', entries: [{ name: 'a/b', data: 'b' }, { name: 'a', data: 'a' }] },
      { name: 'long-path', entries: [{ name: 'x'.repeat(300), data: 'x' }] }
    ]

    for (const item of cases) {
      const zip = writeZip(`${item.name}.zip`, item.entries)
      expect(
        await errorCode(
          extractPackageZip({ zipPath: zip, targetDir: target(item.name) })
        ),
        item.name
      ).toBe('vpmArchiveUnsafePath')
    }
    expect(fs.existsSync(path.join(out, 'evil.txt'))).toBe(false)
  })

  it('rejects symlink entries before creating anything outside the target', async () => {
    const zip = writeZip('symlink.zip', [
      { name: 'package.json', data: packageJson() },
      { name: 'link', data: '../outside', mode: 0o120777 }
    ])
    expect(
      await errorCode(
        extractPackageZip({ zipPath: zip, targetDir: target('symlink') })
      )
    ).toBe('vpmArchiveSymlink')
    expect(fs.existsSync(path.join(out, 'outside'))).toBe(false)
    expect(fs.existsSync(path.join(out, 'symlink', 'link'))).toBe(false)
  })

  it('rejects zip bombs by ratio, entries, total bytes and single entry size', async () => {
    const zeros = Buffer.alloc(2 * 1024 * 1024)
    const ratio = writeZip('ratio.zip', [
      { name: 'package.json', data: packageJson() },
      { name: 'zeros.bin', data: zeros, compression: 'deflate' }
    ])
    expect(
      await errorCode(
        extractPackageZip({
          zipPath: ratio,
          targetDir: target('ratio'),
          limits: { maxCompressionRatio: 10, ratioMinBytes: 1024 }
        })
      )
    ).toBe('vpmArchiveBomb')

    const many = writeZip('many.zip', [
      { name: 'a', data: 'a' },
      { name: 'b', data: 'b' }
    ])
    expect(
      await errorCode(
        extractPackageZip({ zipPath: many, targetDir: target('many'), limits: { maxEntries: 1 } })
      )
    ).toBe('vpmArchiveBomb')

    const total = writeZip('total.zip', [{ name: 'a', data: Buffer.alloc(100) }])
    expect(
      await errorCode(
        extractPackageZip({ zipPath: total, targetDir: target('total'), limits: { maxTotalBytes: 50 } })
      )
    ).toBe('vpmArchiveBomb')

    const single = writeZip('single.zip', [{ name: 'a', data: Buffer.alloc(100) }])
    expect(
      await errorCode(
        extractPackageZip({ zipPath: single, targetDir: target('single'), limits: { maxEntryBytes: 10 } })
      )
    ).toBe('vpmArchiveBomb')
  })

  it('rejects corrupt archives, existing targets and invalid limit values', async () => {
    const corrupt = path.join(root, 'corrupt.zip')
    fs.writeFileSync(corrupt, 'not a zip')
    expect(
      await errorCode(
        extractPackageZip({ zipPath: corrupt, targetDir: target('corrupt') })
      )
    ).toBe('vpmArchiveInvalid')

    const existing = target('existing')
    fs.mkdirSync(existing)
    const valid = writeZip('valid.zip', [{ name: 'package.json', data: packageJson() }])
    expect(
      await errorCode(
        extractPackageZip({ zipPath: valid, targetDir: existing })
      )
    ).toBe('vpmArchiveWriteFailed')

    expect(
      await errorCode(
        extractPackageZip({
          zipPath: valid,
          targetDir: target('bad-limits'),
          limits: { maxEntries: 0 }
        })
      )
    ).toBe('vpmArchiveInvalid')

    expect(
      await errorCode(
        extractPackageZip({ zipPath: path.join(root, 'missing.zip'), targetDir: target('missing-zip') })
      )
    ).toBe('vpmArchiveInvalid')
  })

  it('leaves the target directory and already extracted files for diagnosis on failure', async () => {
    const zip = writeZip('partial.zip', [
      { name: 'package.json', data: packageJson() },
      { name: 'ok.txt', data: 'ok' },
      { name: '../escape.txt', data: 'bad' }
    ])
    const dest = target('partial')
    expect(
      await errorCode(extractPackageZip({ zipPath: zip, targetDir: dest }))
    ).toBe('vpmArchiveUnsafePath')
    expect(fs.existsSync(dest)).toBe(true)
    expect(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).toContain('com.example.pkg')
    expect(fs.readFileSync(path.join(dest, 'ok.txt'), 'utf8')).toBe('ok')
    expect(fs.existsSync(path.join(out, 'escape.txt'))).toBe(false)
  })
})
