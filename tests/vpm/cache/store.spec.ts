import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VpmCacheStore } from '../../../src/main/vpm/cache'

let root: string
let dataRoot: string
let cache: VpmCacheStore

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function tempFile(content: Buffer | string): { file: string; hash: string; size: number } {
  const file = cache.createTempPath()
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content)
  fs.writeFileSync(file, buffer)
  return { file, hash: sha256(buffer), size: buffer.length }
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-vpm-cache-'))
  dataRoot = path.join(root, 'data')
  fs.mkdirSync(dataRoot, { recursive: true })
  cache = new VpmCacheStore({ dataRoot })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('VpmCacheStore', () => {
  it('keeps temp files and packages inside the cache root', () => {
    const temp = cache.createTempPath('download')
    expect(temp.startsWith(cache.tmpRoot + path.sep)).toBe(true)

    const hash = 'a'.repeat(64)
    const file = cache.pathForPackage(hash)
    expect(file).toBe(path.join(cache.packagesRoot, 'aa', `${hash}.zip`))
    expect(file.startsWith(cache.cacheRoot + path.sep)).toBe(true)
  })

  it('rejects relative data roots, cache roots outside the data root, and cacheRoot==dataRoot', () => {
    expect(codeOf(() => new VpmCacheStore({ dataRoot: 'relative' }))).toBe('vpmCachePathInvalid')
    expect(
      codeOf(() => new VpmCacheStore({ dataRoot, cacheRoot: path.join(root, 'outside') }))
    ).toBe('vpmCachePathInvalid')
    expect(codeOf(() => new VpmCacheStore({ dataRoot, cacheRoot: dataRoot }))).toBe(
      'vpmCachePathInvalid'
    )
    expect(codeOf(() => new VpmCacheStore({ dataRoot: path.join(root, 'missing') }))).toBe(
      'vpmCachePathInvalid'
    )
  })

  it('commits a verified temp file with an atomic rename', () => {
    const content = Buffer.from('package bytes')
    const temp = tempFile(content)
    const final = cache.pathForPackage(temp.hash)

    const entry = cache.commitDownload({
      tempPath: temp.file,
      sha256: temp.hash,
      size: temp.size,
      expectedSha256: temp.hash
    })

    expect(entry).toEqual({ path: final, size: content.length, sha256: temp.hash })
    expect(fs.readFileSync(final)).toEqual(content)
    expect(fs.existsSync(temp.file)).toBe(false)
    expect(cache.hasPackage(temp.hash)).toBe(true)
  })

  it('rejects a mismatched expected hash and removes the temp file', () => {
    const temp = tempFile('content')
    const final = cache.pathForPackage(temp.hash)

    expect(
      codeOf(() =>
        cache.commitDownload({
          tempPath: temp.file,
          sha256: temp.hash,
          size: temp.size,
          expectedSha256: 'b'.repeat(64)
        })
      )
    ).toBe('vpmCacheHashMismatch')
    expect(fs.existsSync(temp.file)).toBe(false)
    expect(fs.existsSync(final)).toBe(false)
  })

  it('rejects a size mismatch and removes the temp file', () => {
    const temp = tempFile('content')
    expect(
      codeOf(() =>
        cache.commitDownload({ tempPath: temp.file, sha256: temp.hash, size: temp.size + 1 })
      )
    ).toBe('vpmCacheHashMismatch')
    expect(fs.existsSync(temp.file)).toBe(false)
  })

  it('refuses a temp file outside tmp and does not delete it', () => {
    const outside = path.join(root, 'outside.part')
    fs.writeFileSync(outside, 'keep me')
    expect(
      codeOf(() => cache.commitDownload({ tempPath: outside, sha256: sha256('keep me'), size: 7 }))
    ).toBe('vpmCachePathInvalid')
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep me')
  })

  it('verifies an existing cache file and detects corruption', async () => {
    const content = Buffer.from('verify me')
    const temp = tempFile(content)
    const entry = cache.commitDownload({ tempPath: temp.file, sha256: temp.hash, size: temp.size })

    await expect(cache.verifyFile(entry.path, temp.hash)).resolves.toMatchObject({
      path: entry.path,
      size: content.length,
      sha256: temp.hash
    })

    fs.writeFileSync(entry.path, 'changed')
    await expect(cache.verifyFile(entry.path, temp.hash)).rejects.toMatchObject({
      code: 'vpmCacheHashMismatch'
    })
  })

  it('clears only tmp on clearTmp and only packages on clearPackages', () => {
    const temp = tempFile('keep')
    const entry = cache.commitDownload({ tempPath: temp.file, sha256: temp.hash, size: temp.size })
    const anotherTemp = cache.createTempPath()
    fs.writeFileSync(anotherTemp, 'x')

    cache.clearTmp()
    expect(fs.existsSync(anotherTemp)).toBe(false)
    expect(fs.existsSync(entry.path)).toBe(true)

    cache.clearPackages()
    expect(fs.existsSync(entry.path)).toBe(false)
  })

  it('removes a package idempotently', () => {
    const temp = tempFile('remove')
    const entry = cache.commitDownload({ tempPath: temp.file, sha256: temp.hash, size: temp.size })
    expect(cache.removePackage(temp.hash)).toBe(true)
    expect(fs.existsSync(entry.path)).toBe(false)
    expect(cache.removePackage(temp.hash)).toBe(false)
  })

  it('quarantines corrupt cache/temp files into cache/corrupt and preserves bytes', () => {
    const temp = tempFile('quarantine me')
    const destination = cache.quarantine(temp.file, temp.hash)
    expect(destination).not.toBeNull()
    expect(destination?.startsWith(cache.corruptRoot + path.sep)).toBe(true)
    expect(fs.readFileSync(destination as string, 'utf8')).toBe('quarantine me')
    expect(fs.existsSync(temp.file)).toBe(false)

    const outside = path.join(root, 'outside.bin')
    fs.writeFileSync(outside, 'keep')
    expect(codeOf(() => cache.quarantine(outside, temp.hash))).toBe('vpmCachePathInvalid')
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep')
  })

  it('lists only valid package files under packages/<prefix>/', () => {
    const temp = tempFile('list me')
    const entry = cache.commitDownload({ tempPath: temp.file, sha256: temp.hash, size: temp.size })
    fs.writeFileSync(path.join(cache.packagesRoot, 'not-a-package.zip'), 'x')
    const wrongPrefix = path.join(cache.packagesRoot, 'zz')
    fs.mkdirSync(wrongPrefix, { recursive: true })
    fs.writeFileSync(path.join(wrongPrefix, `${temp.hash}.zip`), 'wrong prefix')

    expect(cache.listPackages()).toEqual([
      expect.objectContaining({
        sha256: temp.hash,
        path: entry.path,
        size: temp.size
      })
    ])
  })
})
