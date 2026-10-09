import fs from 'node:fs'
import path from 'node:path'
import yauzl from 'yauzl'
import { decodeText, decodeZipName, normalizeEntryPath } from './encoding'
import { safeJoin } from '../security/paths'
import { PasswordNeededError, CorruptArchiveError, extractArchive, type ArchiveEntry, type ListResult } from './sevenZip'
import { memberMatches } from './entryMatch'

/**
 * ZIP 专用：必须自己拿到**原始文件名字节**才能做 cp932/GBK 回退，
 * 所以用 yauzl 的 decodeStrings:false（node-stream-zip 会先把字节按 UTF-8/cp437 转成字符串，
 * 转坏之后就再也救不回来了）。
 */

export interface ZipListResult extends ListResult {
  /** 条目名里有多少是靠回退解码救回来的 —— 用来验证 cp932 逻辑真的在工作 */
  fallbackDecoded: number
}

/**
 * 单读一个条目的看门狗。
 * 元数据只是"加分项"，为它把整个摄取任务挂住是最坏的取舍 —— 所以到点就当读不到。
 */
const READ_ENTRY_TIMEOUT_MS = 15_000

function open(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      file,
      { lazyEntries: true, decodeStrings: false, autoClose: false, validateEntrySizes: false },
      (err, zf) => {
        if (err || !zf) {
          reject(new CorruptArchiveError(file, err?.message ?? '打不开'))
          return
        }
        resolve(zf)
      }
    )
  })
}

export async function listZip(file: string): Promise<ZipListResult> {
  const zf = await open(file)
  const entries: ArchiveEntry[] = []
  let encrypted = false
  let fallbackDecoded = 0
  try {
    await new Promise<void>((resolve, reject) => {
      zf.on('error', (e: Error) => reject(new CorruptArchiveError(file, e.message)))
      zf.on('end', () => resolve())
      zf.on('entry', (entry: yauzl.Entry) => {
        const raw = entry.fileName as unknown as Buffer
        const declaredUtf8 = (entry.generalPurposeBitFlag & 0x800) !== 0
        const { encoding } = decodeZipName(raw, declaredUtf8)
        if (encoding !== 'UTF-8') fallbackDecoded++
        if (entry.isEncrypted()) encrypted = true
        entries.push({
          path: normalizeEntryPath(decodeZipName(raw, declaredUtf8).name),
          size: entry.uncompressedSize,
          isDir: /\/$/.test(decodeZipName(raw, declaredUtf8).name),
          encrypted: entry.isEncrypted()
        })
        zf.readEntry()
      })
      zf.readEntry()
    })
  } finally {
    zf.close()
  }
  return {
    entries,
    totalBytes: entries.reduce((a, e) => a + (e.isDir ? 0 : e.size), 0),
    encrypted,
    backend: 'yauzl',
    fallbackDecoded
  }
}

export interface ZipExtractOptions {
  password?: string
  only?: string[]
  /** 与 7z 后端保持一致：百分比 + 当前条目名 */
  onProgress?: (percent: number, current: string) => void
  signal?: AbortSignal
  /** 传目录列表给 7z 兜底时用 */
  extraBackendDirs?: string[]
}

/**
 * 解压 zip。加密的 zip 直接转交 7z 后端（yauzl 不支持解密）。
 * 每个条目名都过 safeJoin，挡 zip-slip。
 */
export async function extractZip(
  file: string,
  destDir: string,
  opts: ZipExtractOptions = {}
): Promise<{ files: number; bytes: number }> {
  // 给了 only 但里面一条没有 = 用户要的东西这个包里根本没有。
  // 不能当成"没给过滤条件"，那样会把整包解到暂存目录（实测 39MB 的包解出 933 个文件 / 75MB，
  // 而暂存目录在系统盘上）。想解全部就别传 only。
  if (opts.only && opts.only.length === 0) return { files: 0, bytes: 0 }
  const info = await listZip(file)
  if (info.encrypted) {
    if (!opts.password) throw new PasswordNeededError(file)
    /**
     * 加密 zip 转交 7z 后端。
     * ⚠ 这里以前**没往下传 `only`** —— 于是"我只抽这 3 个成员"的加密 zip
     * 会被 7z 整包解出来（等于 P0-2 想防的事从加密那条门又灌进来一遍）。
     * `only: []` 在上面已经被挡掉了，所以传下去的一定是点名的清单。
     */
    return extractArchive(file, destDir, {
      password: opts.password,
      extraBackendDirs: opts.extraBackendDirs,
      only: opts.only,
      signal: opts.signal,
      onProgress: opts.onProgress
    })
  }

  const zf = await open(file)
  fs.mkdirSync(destDir, { recursive: true })
  const total = info.entries.length || 1
  let done = 0
  let bytes = 0
  let files = 0

  try {
    await new Promise<void>((resolve, reject) => {
      let aborted = false
      const onAbort = (): void => {
        aborted = true
        zf.close()
        reject(new Error('已取消'))
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })

      zf.on('error', (e: Error) => {
        reject(new CorruptArchiveError(file, e.message))
      })
      zf.on('end', () => {
        opts.signal?.removeEventListener('abort', onAbort)
        resolve()
      })
      zf.on('entry', (entry: yauzl.Entry) => {
        if (aborted) return
        done++
        const raw = entry.fileName as unknown as Buffer
        const declaredUtf8 = (entry.generalPurposeBitFlag & 0x800) !== 0
        const rawName = decodeZipName(raw, declaredUtf8).name
        // yauzl 没有 isDirectory：目录条目以 / 或 \ 结尾
        const isDir = /[/\\]$/.test(rawName)
        const name = normalizeEntryPath(rawName)
        opts.onProgress?.(Math.min(1, done / total), name)
        const target = safeJoin(destDir, name)
        if (!target) {
          // 条目名不可信（穿越 / 非法字符），丢掉但不清空整包
          zf.readEntry()
          return
        }
        if (isDir) {
          fs.mkdirSync(target, { recursive: true })
          zf.readEntry()
          return
        }
        if (opts.only?.length && !opts.only.some((p) => memberMatches(name, p))) {
          /**
           * ⚠ 以前这里是 `name.startsWith(p)` —— 前缀匹配。
           * 勾 `A.pack` 会顺带解出 `A.package.unitypackage`。
           * 口径统一收在 `entryMatch.memberMatches`（等值，或"目录前缀 + 斜杠"），
           * 别再在这里写第二份 —— 两处各写一遍就一定会漂。
           */
          zf.readEntry()
          return
        }
        fs.mkdirSync(path.dirname(target), { recursive: true })
        zf.openReadStream(entry, (err, stream) => {
          if (err || !stream) {
            zf.readEntry()
            return
          }
          const ws = fs.createWriteStream(target)
          stream.on('data', (c: Buffer) => {
            bytes += c.length
          })
          stream.on('error', () => {
            ws.destroy()
            zf.readEntry()
          })
          ws.on('close', () => {
            files++
            zf.readEntry()
          })
          ws.on('error', () => zf.readEntry())
          stream.pipe(ws)
        })
      })
      zf.readEntry()
    })
  } finally {
    try {
      zf.close()
    } catch {
      /* 已经关了 */
    }
  }
  return { files, bytes }
}

/**
 * 按需读包内**一个**小文件的文本（第 2 份 §1.3 要读 readme / .url 抽元数据，
 * 但默认不自动解压，不能为了读 200 字节把整包解出来）。
 *
 * 匹配用的是解码后的路径 —— 调用方给的 relPath 也是解码后的，两边口径一致。
 * 读不到就返回 null，不抛：元数据缺一点比摄取整条流程挂掉好。
 *
 * 坑（实测卡死过 10 分钟）：`open()` 把 yauzl 的 'open' 事件当成 promise 的 resolve 用掉了，
 * 等我们再 `zf.on('open', …)` 时事件早就发完了 → readEntry() 永远没人叫 →
 * 既不报错也不返回，整个摄取任务挂在那儿。所以这里和 listZip 一样，挂好监听直接 readEntry()
 * （yauzl 的 LazyZipFile 会等中央目录读完再动）。
 */
export async function readZipEntryText(
  file: string,
  wantRelPath: string,
  maxBytes = 64 * 1024
): Promise<string | null> {
  const want = wantRelPath.split('\\').join('/').replace(/^\.\//, '')
  let zf: yauzl.ZipFile
  try {
    zf = await open(file)
  } catch {
    return null
  }
  return new Promise<string | null>((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const finish = (v: string | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        zf.close()
      } catch {
        /* 已经关了 */
      }
      resolve(v)
    }
    // 兜底：单读只是给元数据加料，永远不该把摄取卡死（等 'open' 事件那回就卡了 10 分钟）
    timer = setTimeout(() => finish(null), READ_ENTRY_TIMEOUT_MS)
    zf.on('error', () => finish(null))
    zf.on('end', () => finish(null))
    zf.on('entry', (entry: yauzl.Entry) => {
      const raw = entry.fileName as unknown as Buffer
      const declaredUtf8 = (entry.generalPurposeBitFlag & 0x800) !== 0
      const name = normalizeEntryPath(decodeZipName(raw, declaredUtf8).name)
      if (name !== want) {
        zf.readEntry()
        return
      }
      if ((entry.uncompressedSize ?? 0) > maxBytes) {
        finish(null)
        return
      }
      zf.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          finish(null)
          return
        }
        const chunks: Buffer[] = []
        let len = 0
        stream.on('data', (c: Buffer) => {
          if (len >= maxBytes) return
          chunks.push(c)
          len += c.length
        })
        stream.on('error', () => finish(null))
        stream.on('end', () => finish(decodeTextSafe(Buffer.concat(chunks).subarray(0, maxBytes))))
      })
    })
    zf.readEntry()
  })
}

function decodeTextSafe(buf: Buffer): string {
  return decodeText(buf).text
}
