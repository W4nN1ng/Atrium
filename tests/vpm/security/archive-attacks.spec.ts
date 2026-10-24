import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractPackageZip } from '../../../src/main/vpm/install/archive'
import { makeZip, type ZipFixtureEntry } from '../install/zip-fixture'

let root: string
let out: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-security-zip-'))
  out = path.join(root, 'out')
  fs.mkdirSync(out)
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function zip(name: string, entries: ZipFixtureEntry[]): string {
  const file = path.join(root, name)
  fs.writeFileSync(file, makeZip(entries))
  return file
}

function target(name: string): string {
  return path.join(out, name)
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise
    return null
  } catch (error) {
    return (error as { code?: string }).code ?? null
  }
}

describe('ZIP attack matrix (P9-A)', () => {
  it('rejects traversal, absolute, drive, UNC, reserved, ADS, trailing-dot, case-duplicate and long paths', async () => {
    const cases: Array<[string, ZipFixtureEntry[], string]> = [
      ['traversal', [{ name: '../evil.txt', data: 'x' }], 'vpmArchiveUnsafePath'],
      ['absolute', [{ name: '/etc/passwd', data: 'x' }], 'vpmArchiveUnsafePath'],
      ['drive', [{ name: 'C:/evil.txt', data: 'x' }], 'vpmArchiveUnsafePath'],
      ['unc', [{ name: '\\\\server\\share\\evil.txt', data: 'x' }], 'vpmArchiveUnsafePath'],
      ['reserved', [{ name: 'CON', data: 'x' }], 'vpmArchiveUnsafePath'],
      ['ads', [{ name: 'foo.txt:bar', data: 'x' }], 'vpmArchiveUnsafePath'],
      ['trailing-dot', [{ name: 'foo./bar', data: 'x' }], 'vpmArchiveUnsafePath'],
      ['case-duplicate', [{ name: 'A.txt', data: 'a' }, { name: 'a.txt', data: 'b' }], 'vpmArchiveUnsafePath'],
      ['long-path', [{ name: 'x'.repeat(300), data: 'x' }], 'vpmArchiveUnsafePath']
    ]
    for (const [name, entries, expected] of cases) {
      const file = zip(`${name}.zip`, entries)
      expect(await codeOf(extractPackageZip({ zipPath: file, targetDir: target(name) })), name).toBe(
        expected
      )
      expect(fs.existsSync(path.join(out, 'evil.txt')), name).toBe(false)
    }
  })

  it('rejects symlink entries', async () => {
    const file = zip('symlink.zip', [
      { name: 'link', data: '../outside', mode: 0o120777 }
    ])
    expect(await codeOf(extractPackageZip({ zipPath: file, targetDir: target('symlink') }))).toBe(
      'vpmArchiveSymlink'
    )
  })

  it('rejects encrypted archives and unsupported compression methods', async () => {
    const encrypted = zip('encrypted.zip', [
      { name: 'package.json', data: '{}', flags: 1 }
    ])
    expect(await codeOf(extractPackageZip({ zipPath: encrypted, targetDir: target('encrypted') }))).toBe(
      'vpmArchiveInvalid'
    )

    const bzip2 = zip('bzip2.zip', [{ name: 'a', data: 'x', method: 12 }])
    expect(await codeOf(extractPackageZip({ zipPath: bzip2, targetDir: target('bzip2') }))).toBe(
      'vpmArchiveInvalid'
    )
  })

  it('rejects ratio, entry-count and total-size bombs', async () => {
    const ratio = zip('ratio.zip', [
      { name: 'package.json', data: '{}' },
      { name: 'zeros.bin', data: Buffer.alloc(2 * 1024 * 1024), compression: 'deflate' }
    ])
    expect(
      await codeOf(
        extractPackageZip({
          zipPath: ratio,
          targetDir: target('ratio'),
          limits: { maxCompressionRatio: 10, ratioMinBytes: 1024 }
        })
      )
    ).toBe('vpmArchiveBomb')

    const count = zip('count.zip', [
      { name: 'a', data: 'a' },
      { name: 'b', data: 'b' }
    ])
    expect(
      await codeOf(
        extractPackageZip({ zipPath: count, targetDir: target('count'), limits: { maxEntries: 1 } })
      )
    ).toBe('vpmArchiveBomb')

    const total = zip('total.zip', [{ name: 'a', data: Buffer.alloc(100) }])
    expect(
      await codeOf(
        extractPackageZip({
          zipPath: total,
          targetDir: target('total'),
          limits: { maxTotalBytes: 10 }
        })
      )
    ).toBe('vpmArchiveBomb')
  })

  it('rejects corrupt archives and leaves no file outside the target', async () => {
    const corrupt = path.join(root, 'corrupt.zip')
    fs.writeFileSync(corrupt, 'not a zip')
    expect(await codeOf(extractPackageZip({ zipPath: corrupt, targetDir: target('corrupt') }))).toBe(
      'vpmArchiveInvalid'
    )
    expect(fs.existsSync(path.join(out, 'evil.txt'))).toBe(false)
  })
})
