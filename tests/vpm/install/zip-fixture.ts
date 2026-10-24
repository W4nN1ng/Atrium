import zlib from 'node:zlib'

export interface ZipFixtureEntry {
  name: string
  data?: Buffer | string
  /** 高 16 位 Unix mode；默认目录 0o040755 / 文件 0o100644。 */
  mode?: number
  compression?: 'store' | 'deflate'
  /** 覆盖压缩方法（例如 12 = bzip2）；默认按 compression 推断。 */
  method?: number
  /** 覆盖 general purpose flags（例如 0x1 = encrypted）；默认 UTF-8 位。 */
  flags?: number
  directory?: boolean
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * 测试用最小 ZIP 写入器（store/deflate + Unix mode）。
 * 不引入生产依赖；只服务于恶意样本和安全边界测试。
 */
export function makeZip(entries: readonly ZipFixtureEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const input of entries) {
    const name = Buffer.from(input.name, 'utf8')
    const data = input.data === undefined ? Buffer.alloc(0) : Buffer.from(input.data)
    const directory = input.directory ?? input.name.endsWith('/')
    const mode = input.mode ?? (directory ? 0o040755 : 0o100644)
    const method =
      input.method ?? (directory || (input.compression ?? 'store') === 'store' ? 0 : 8)
    const stored = method === 8 ? zlib.deflateRawSync(data) : data
    const flags = 0x800 | (input.flags ?? 0)
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const localRecord = Buffer.concat([local, name, stored])

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    const centralRecord = Buffer.concat([central, name])

    locals.push(localRecord)
    centrals.push(centralRecord)
    offset += localRecord.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralDirectory, end])
}
