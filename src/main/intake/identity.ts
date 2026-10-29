import fs from 'node:fs'
import { createHash } from 'node:crypto'
import type { ContentKey } from '../../shared/intake'

const table = Array.from({ length: 256 }, (_, i) => {
  let crc = i
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  return crc >>> 0
})
export function crc32Update(crc: number, bytes: Buffer): number {
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255]
  return crc >>> 0
}
export function sameFile(a: fs.Stats, b: fs.Stats): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino && a.dev === b.dev
}
/** Full streaming identity, shared by closure/cache and M4's later matching. */
export async function fileIdentity(file: string, signal?: AbortSignal): Promise<{ key: ContentKey; sha256: string }> {
  signal?.throwIfAborted()
  const before = await fs.promises.lstat(file)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('unreadable-or-reparse')
  const hash = createHash('sha256'); let crc = 0xffffffff, size = 0
  const stream = fs.createReadStream(file, { signal })
  for await (const chunk of stream) {
    const bytes = chunk as Buffer; size += bytes.length; hash.update(bytes); crc = crc32Update(crc, bytes)
  }
  if (size !== before.size || !sameFile(before, await fs.promises.lstat(file))) throw new Error('source-changed-during-read')
  return { key: { size, crc32: (crc ^ 0xffffffff) >>> 0 }, sha256: hash.digest('hex') }
}
