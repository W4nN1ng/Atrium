import fs from 'node:fs'
import path from 'node:path'
import { xxhash64, createXXHash64, type IHasher } from 'hash-wasm'

/**
 * 内容指纹（xxh64）。第 1 份 §5 的 hash_xxh64 列就用它。
 * Node 没有内置 xxhash，所以用 hash-wasm（纯 wasm，worker 里可直接用）。
 *
 * 注意导出名是 xxhash64 / createXXHash64（小写 h），不是 xxh64。
 */

const STREAM_CHUNK = 1 << 20

/** 整个文件的 xxh64，流式读，不把大包读进内存 */
export async function hashFile(file: string): Promise<string> {
  const h: IHasher = await createXXHash64()
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file, { highWaterMark: STREAM_CHUNK })
    stream.on('data', (c: string | Buffer) => h.update(typeof c === 'string' ? Buffer.from(c) : c))
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return h.digest('hex')
}

export async function hashBuffer(buf: Buffer): Promise<string> {
  return xxhash64(buf)
}

/**
 * 大文件加速：头 / 中 / 尾各取一段 + 总长度算指纹，避免给几 GB 的包算全量哈希。
 * 这不是密码学安全指纹，只用于"同内容不同名"的查重提示 —— 误判的后果是多问一句，
 * 所以宁可保守：真合并前 UI 还会让用户确认。
 */
export async function hashSampled(file: string, partSize = 1 << 20): Promise<string> {
  const st = await fs.promises.stat(file)
  if (st.size <= partSize * 3) return hashFile(file)
  const fd = await fs.promises.open(file, 'r')
  try {
    const head = Buffer.alloc(partSize)
    const mid = Buffer.alloc(partSize)
    const tail = Buffer.alloc(partSize)
    await fd.read(head, 0, partSize, 0)
    await fd.read(mid, 0, partSize, Math.floor(st.size / 2) - partSize / 2)
    await fd.read(tail, 0, partSize, st.size - partSize)
    const h = await createXXHash64()
    h.update(head)
    h.update(mid)
    h.update(tail)
    h.update(Buffer.from(String(st.size), 'ascii'))
    return h.digest('hex')
  } finally {
    await fd.close()
  }
}

/** 大于这个字节数的文件在目录指纹里只抽样 */
const TREE_SAMPLE_THRESHOLD = 8 * 1024 * 1024

/**
 * 目录指纹：按相对路径排序后拼 "路径:大小:哈希" 再哈希。
 * 只哈希前 maxHashedFiles 个文件内容，其余记路径与大小 —— 25 GB 的库不能扫到地老天荒。
 */
export async function hashTree(
  dir: string,
  opts: { maxHashedFiles?: number } = {}
): Promise<{ hash: string; files: number; bytes: number }> {
  const maxHashed = opts.maxHashedFiles ?? 200
  const items: string[] = []
  const running = await createXXHash64()
  let files = 0
  let bytes = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop() as string
    let list: fs.Dirent[]
    try {
      list = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        stack.push(p)
        continue
      }
      let size = 0
      try {
        size = (await fs.promises.stat(p)).size
      } catch {
        /* 读不到就算 0，不中断整棵树 */
      }
      files++
      bytes += size
      const rel = path.relative(dir, p).replace(/\\/g, '/')
      if (files <= maxHashed) {
        const h = size > TREE_SAMPLE_THRESHOLD ? await hashSampled(p) : await hashFile(p)
        items.push(`${rel}:${size}:${h}`)
      } else {
        items.push(`${rel}:${size}:`)
      }
    }
  }
  items.sort()
  running.update(Buffer.from(items.join('\n'), 'utf8'))
  return { hash: running.digest('hex'), files, bytes }
}

/** 两个指纹是否同一内容 */
export function sameHash(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a === b
}
