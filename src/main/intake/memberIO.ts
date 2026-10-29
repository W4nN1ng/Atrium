import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { extractRar } from '../unpack/unrar'
import { resolveBackend, type ArchiveEntry } from '../unpack/sevenZip'
import { PasswordNeededError } from '../unpack/errors'
import type { MemberOptions } from '../unpack/members'
import type { CacheMember } from './expandCache'

/** Binary streaming through numeric paths avoids path traversal and Windows filename loss. */
function sizeGuard(expected: number): Transform {
  let bytes = 0
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length
    callback(bytes > expected ? new Error('member-size-overrun') : null, chunk)
  }, flush(callback) { callback(bytes !== expected ? new Error('member-size-mismatch') : null) } })
}
async function nativeMember(file: string, format: string, entry: ArchiveEntry, target: string, opts: MemberOptions): Promise<void> {
  opts.signal?.throwIfAborted()
  if (entry.encrypted && !opts.password) throw new PasswordNeededError(file)
  if (opts.password && /[\r\n\0]/.test(opts.password)) throw new Error('Invalid CLI password')
  const backend = resolveBackend(opts.extraBackendDirs)
  if (!backend) throw new Error('Missing 7z backend')
  const child = spawn(backend.exe, ['x', '-so', '-y', '-bso0', '-bsp0', '-bse2', '-sccUTF-8', '-spd', `-t${format === 'sevenz' ? '7z' : format}`, '--', file, entry.path], { windowsHide: true, signal: opts.signal, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''; let overflow = false
  child.stderr.on('data', (bytes: Buffer) => {
    if (stderr.length + bytes.length > 1024 * 1024) { overflow = true; child.kill() }
    else stderr += bytes.toString('utf8')
  })
  child.stdin.on('error', () => {}); child.stdin.end(opts.password ? `${opts.password}\n` : undefined)
  const completed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
  const streaming = pipeline(child.stdout, sizeGuard(entry.size), fs.createWriteStream(target, { flags: 'wx' }), { signal: opts.signal }).catch(error => { child.kill(); throw error })
  const results = await Promise.allSettled([completed, streaming])
  opts.signal?.throwIfAborted()
  if (results[0].status === 'rejected') throw results[0].reason
  if (/password|encrypted|wrong password/i.test(stderr)) throw new PasswordNeededError(file)
  if (results[1].status === 'rejected') throw results[1].reason
  if (results[0].value !== 0 || stderr.trim() || overflow) throw new Error('native-member-extraction-failed')
}

export async function extractFlat(file: string, format: string, entries: ArchiveEntry[], members: CacheMember[], dest: string, opts: MemberOptions): Promise<void> {
  if (!members.length) return
  if (format === 'rar') {
    await extractRar(file, members.map(m => m.originalPath), dest, { ...opts, targetNames: new Map(members.map(m => [m.originalPath, m.file])) })
    return
  }
  if (format === 'zip' && !entries.some(e => e.encrypted)) {
    const zf = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(file,
      { lazyEntries: true, decodeStrings: false, autoClose: false, validateEntrySizes: false },
      (error, zip) => error || !zip ? reject(error ?? new Error('zip-open')) : resolve(zip)))
    let ordinal = 0, memberIndex = 0
    let abort: (() => void) | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        zf.on('error', reject); zf.on('end', () => ordinal === entries.length && memberIndex === members.length ? resolve() : reject(new Error('zip-entry-count-changed')))
        abort = (): void => { zf.close(); reject(opts.signal?.reason ?? new Error('aborted')) }
        opts.signal?.addEventListener('abort', abort, { once: true })
        zf.on('entry', (entry: yauzl.Entry) => {
          const expected = entries[ordinal++]
          if (!expected || entry.uncompressedSize !== expected.size || (!expected.isDir && entry.crc32 !== expected.crc32)) { reject(new Error('zip-entry-changed')); return }
          if (expected.isDir) { zf.readEntry(); return }
          const member = members[memberIndex++]
          zf.openReadStream(entry, (error, stream) => {
            if (error || !stream) { reject(error ?? new Error('zip-stream')); return }
            pipeline(stream, sizeGuard(expected.size), fs.createWriteStream(path.join(dest, member.file), { flags: 'wx' }), { signal: opts.signal })
              .then(() => zf.readEntry(), reject)
          })
        })
        opts.signal?.throwIfAborted(); zf.readEntry()
      })
    } finally { if (abort) opts.signal?.removeEventListener('abort', abort); zf.close() }
    return
  }
  const files = entries.filter(e => !e.isDir)
  if (new Set(files.map(e => e.path)).size !== files.length) throw new Error('ambiguous-native-member-path')
  for (let i = 0; i < files.length; i++) await nativeMember(file, format, files[i], path.join(dest, members[i].file), opts)
}
