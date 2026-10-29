import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn, execFile } from 'node:child_process'
import yazl from 'yazl'
import { makeZip } from '../helpers/containers'
import { listArchive, extractArchive, parseSltListing } from '../../src/main/unpack/sevenZip'
import { listZip } from '../../src/main/unpack/unzip'
import { UntrustworthyListingError } from '../../src/main/unpack/trust'

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn(actual.spawn), execFile: vi.fn(actual.execFile) }
})
let root: string
let encrypted: string
let plain: string
const password = 'public-integration-password'
const BIN = path.resolve('resources/bin')
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-listing-trust-'))
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello')
  encrypted = makeZip(root, path.join(root, 'encrypted.7z'), ['a.txt'], BIN, ['-p' + password, '-mhe=on'], '7z')
  plain = makeZip(root, path.join(root, 'plain.7z'), ['a.txt'], BIN, [], '7z')
})
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })

describe('archive adapters verify evidence before returning it', () => {
  it('7z passwords travel through stdin, never the spawned process arguments', async () => {
    vi.mocked(spawn).mockClear()
    vi.mocked(execFile).mockClear()
    const result = await listArchive(encrypted, { password, extraBackendDirs: [BIN] })
    expect(result.entries[0].crc32).toBe(0x3610a686)
    const dest = path.join(root, 'out')
    expect(await extractArchive(encrypted, dest, { password, extraBackendDirs: [BIN] })).toEqual({ files: 1, bytes: 5 })
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('hello')
    const calls = [...vi.mocked(spawn).mock.calls, ...vi.mocked(execFile).mock.calls]
    expect(calls.length).toBeGreaterThanOrEqual(2)
    for (const call of calls) expect(JSON.stringify(call[1])).not.toContain(password)
  })

  it('a backend returning exit 0 with a partial-list warning is still rejected', async () => {
    vi.mocked(spawn).mockImplementationOnce((() => {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('Path = a.txt\nSize = 5\nCRC = 3610A686\n\nWarnings: 1\n'))
        child.emit('close', 0)
      })
      return child
    }) as unknown as typeof spawn)
    await expect(listArchive(plain, { extraBackendDirs: [BIN] })).rejects.toThrow(UntrustworthyListingError)
  })

  it('7z directory attributes do not turn missing directory CRC into a fake leaf', () => {
    const entries = parseSltListing('Path = folder\nSize = 0\nAttributes = D\n\nPath = folder/a.txt\nSize = 5\nCRC = 3610A686\n')
    expect(entries[0].isDir).toBe(true)
    expect(entries[1]).toMatchObject({ isDir: false, crc32: 0x3610a686 })
  })

  it('ZIP metadata includes full CRCs and permits a real empty ZIP', async () => {
    const zip = makeZip(root, path.join(root, 'file.zip'), ['a.txt'])
    expect((await listZip(zip)).entries[0]).toMatchObject({ size: 5, crc32: 0x3610a686 })
    const empty = path.join(root, 'empty.zip')
    const archive = new yazl.ZipFile()
    await new Promise<void>((resolve, reject) => {
      archive.outputStream.pipe(fs.createWriteStream(empty)).on('finish', resolve).on('error', reject)
      archive.end()
    })
    expect((await listZip(empty)).entries).toEqual([])
  })

  it('does not return usable content evidence for a truncated ZIP or 7z', async () => {
    for (const file of [makeZip(root, path.join(root, 'whole.zip'), ['a.txt']), plain]) {
      const cut = path.join(root, 'cut-' + path.basename(file))
      fs.writeFileSync(cut, fs.readFileSync(file).subarray(0, 18))
      await expect(listArchive(cut, { extraBackendDirs: [BIN] })).rejects.toThrow(UntrustworthyListingError)
    }
  })
})
