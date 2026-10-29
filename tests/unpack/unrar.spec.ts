import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listRar, extractRar } from '../../src/main/unpack/unrar'
import { listArchive, extractArchive, PasswordNeededError } from '../../src/main/unpack/sevenZip'
import { UntrustworthyListingError } from '../../src/main/unpack/trust'

const fixtures = path.resolve('tests/fixtures/rar')
const sample = path.join(process.env.AVCA_INTAKE_FIXTURES ?? '', 'A/衣服/西装/6447797.rar')
const hasSample = !!process.env.AVCA_INTAKE_FIXTURES && fs.existsSync(sample)
let tmp: string
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-unrar-')) })
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

describe('bundled UnRAR library', () => {
  it('reads structured file sizes and unsigned CRC32 without an installed executable', async () => {
    const result = await listRar(path.join(fixtures, 'WithComment.rar'))
    expect(result.members).toHaveLength(2)
    expect(result.warnings).toEqual([])
    for (const item of result.members) {
      expect(Number.isInteger(item.crc32)).toBe(true)
      expect(item.crc32).toBeGreaterThanOrEqual(0)
    }
  })

  it('routes renamed RAR bytes to UnRAR, independently of extension and CLI cache', async () => {
    const renamed = path.join(tmp, 'actually-rar.zip')
    fs.copyFileSync(path.join(fixtures, 'WithComment.rar'), renamed)
    const result = await listArchive(renamed)
    expect(result.backend).toBe('unrar-wasm')
    expect(result.entries).toHaveLength(2)
  })

  it('consumes all generators and serializes concurrent access to the decoder', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => listRar(path.join(fixtures, 'WithComment.rar'))))
    expect(results.map((result) => result.members.length)).toEqual([2, 2, 2, 2, 2])
  })

  it('requests header passwords and accepts correct passwords through the library API', async () => {
    const file = path.join(fixtures, 'HeaderEnc1234.rar')
    await expect(listRar(file)).rejects.toThrow(PasswordNeededError)
    await expect(listRar(file, { password: 'incorrect' })).rejects.toThrow(PasswordNeededError)
    const listed = await listRar(file, { password: '1234' })
    expect(listed.members.length).toBeGreaterThan(0)
    const wanted = listed.members.find((item) => !item.isDir)!
    const dest = path.join(tmp, 'encrypted')
    const extracted = await extractRar(file, [wanted.path], dest, { password: '1234' })
    expect(extracted.files).toBe(1)
    expect(fs.statSync(path.join(dest, wanted.path)).size).toBe(wanted.size)
  })

  it('extracts only requested members and treats an empty selection as no work', async () => {
    const file = path.join(fixtures, 'WithComment.rar')
    const info = await listRar(file)
    const dest = path.join(tmp, 'selected')
    expect(await extractArchive(file, dest, { only: [info.members[0].path] })).toEqual({ files: 1, bytes: info.members[0].size })
    expect(fs.readdirSync(dest)).toHaveLength(1)
    const empty = path.join(tmp, 'empty-selection')
    expect(await extractRar(file, [], empty)).toEqual({ files: 0, bytes: 0 })
    expect(fs.existsSync(empty)).toBe(false)
  })

  it('rejects truncated headers and missing end records instead of returning partial members', async () => {
    const bytes = fs.readFileSync(path.join(fixtures, 'WithComment.rar'))
    for (const length of [12, Math.floor(bytes.length / 2), bytes.length - 1]) {
      const file = path.join(tmp, `cut-${length}.rar`)
      fs.writeFileSync(file, bytes.subarray(0, length))
      await expect(listRar(file)).rejects.toThrow(UntrustworthyListingError)
    }
  })
  it('drains native handles on cancellation and skips remaining selected payloads', async () => {
    const file = path.join(fixtures, 'WithComment.rar'), controller = new AbortController()
    const dest = path.join(tmp, 'cancelled')
    await expect(extractRar(file, undefined, dest, { signal: controller.signal, onProgress: () => controller.abort() })).rejects.toThrow()
    expect(fs.readdirSync(dest)).toHaveLength(1)
    expect((await listRar(file)).members).toHaveLength(2)
    expect((await extractRar(file, undefined, path.join(tmp, 'after-cancel'))).files).toBe(2)
  })
})

describe.skipIf(!hasSample)('M0 private fixture copy (explicit opt-in)', () => {
  it('lists all 13 variants including Sio with their real content keys', async () => {
    const result = await listArchive(sample)
    expect(result.backend).toBe('unrar-wasm')
    expect(result.entries).toHaveLength(13)
    expect(result.entries.some((entry) => entry.path === 'Noir_Luxe_Sio.zip')).toBe(true)
    expect(result.entries.find((entry) => entry.path === 'Noir_Luxe_Chiffon_Lime.zip')).toMatchObject({ size: 4125529, crc32: 0x62a66903 })
    expect(result.warnings).toEqual([])
  })
  it('rejects a RAR cut inside its first stored ZIP payload', async () => {
    const file = path.join(tmp, 'cut-real.rar')
    const fd = fs.openSync(sample, 'r')
    const bytes = Buffer.alloc(1024 * 1024)
    try { fs.readSync(fd, bytes) } finally { fs.closeSync(fd) }
    fs.writeFileSync(file, bytes)
    await expect(listArchive(file)).rejects.toThrow(UntrustworthyListingError)
  })
})
