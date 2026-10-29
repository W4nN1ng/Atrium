import fs from 'node:fs'
import { crc32 } from 'hash-wasm'
import { UntrustworthyListingError } from './trust'

/** Verify block boundaries/end records too: the decoder's EOF alone can hide a cut final header. */
export async function assertRarEnvelope(file: string, rar5: boolean): Promise<boolean> {
  const fd = fs.openSync(file, 'r')
  const size = fs.fstatSync(fd).size
  const bad = (reason: string): never => { throw new UntrustworthyListingError(file, [reason]) }
  const read = (offset: number, length: number): Buffer => {
    if (length < 0 || length > 2 * 1024 * 1024 || offset + length > size) bad('rar-block-bounds')
    const bytes = Buffer.alloc(length)
    if (fs.readSync(fd, bytes, 0, length, offset) !== length) bad('rar-short-read')
    return bytes
  }
  const vint = (bytes: Buffer, start: number): { value: number; next: number } => {
    let value = 0
    for (let index = start, shift = 0; index < bytes.length && shift < 56; index++, shift += 7) {
      value += (bytes[index] & 127) * 2 ** shift
      if (!Number.isSafeInteger(value)) bad('rar-integer-overflow')
      if (!(bytes[index] & 128)) return { value, next: index + 1 }
    }
    return bad('rar-invalid-integer')
  }
  try {
    let offset = rar5 ? 8 : 7
    for (let blocks = 0; blocks < 100000; blocks++) {
      if (rar5) {
        const prefix = read(offset, Math.min(14, size - offset))
        if (prefix.length < 5) bad('rar-missing-end-record')
        const headerSize = vint(prefix, 4)
        const header = read(offset, headerSize.next + headerSize.value)
        if (Number.parseInt(await crc32(header.subarray(4)), 16) !== header.readUInt32LE(0)) bad('rar-header-crc')
        const type = vint(header, headerSize.next)
        const flags = vint(header, type.next)
        let cursor = flags.next
        if (flags.value & 1) cursor = vint(header, cursor).next
        const dataSize = flags.value & 2 ? vint(header, cursor).value : 0
        const next = offset + header.length + dataSize
        if (!Number.isSafeInteger(next) || next > size || next <= offset) bad('rar-block-bounds')
        // Encrypted headers are validated by UnRAR after decryption, not guessed from ciphertext.
        if (type.value === 4) return true
        if (type.value === 5) {
          if (next !== size) bad('rar-trailing-data')
          return false
        }
        offset = next
      } else {
        const prefix = read(offset, 7)
        const type = prefix[2], flags = prefix.readUInt16LE(3), headerSize = prefix.readUInt16LE(5)
        if (headerSize < 7) bad('rar-invalid-header')
        const header = read(offset, headerSize)
        let packed = flags & 0x8000 ? header.readUInt32LE(7) : 0
        if (type === 0x74 && (flags & 0x100)) packed += header.readUInt32LE(32) * 2 ** 32
        const next = offset + headerSize + packed
        if (!Number.isSafeInteger(next) || next > size || next <= offset) bad('rar-block-bounds')
        if (type === 0x73 && (flags & 0x80)) return true
        if (type === 0x7b) {
          if (next !== size) bad('rar-trailing-data')
          return false
        }
        offset = next
      }
    }
    return bad('rar-header-budget')
  } catch (error) {
    if (error instanceof UntrustworthyListingError) throw error
    return bad('rar-malformed-header')
  } finally {
    fs.closeSync(fd)
  }
}
