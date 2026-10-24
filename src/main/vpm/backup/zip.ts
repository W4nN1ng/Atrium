import fs from 'node:fs'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { VpmError } from '../../../shared/vpm/errors'

/**
 * ZIP 写入 / 校验 / 解压（P6-B）。
 *
 * - 写：`yazl`（支持 `compressionLevel`，所以 store/fast/normal 是**真的三档**）；
 * - 校验：写完后用 `yauzl` 打开读 central directory，读不了就不算成功；
 * - 解压：`yauzl` 逐条落盘，路径逃逸/符号链接/超限一律拒绝。
 *
 * 所有写入都先写 `<target>.part`，成功后 rename —— 失败/取消不会留下半成品。
 */

export type ZipCompression = 'store' | 'fast' | 'normal'

export interface ZipEntryInput {
  absolutePath: string
  /** 包内路径，必须用 `/` 分隔、相对工程根。 */
  relativePath: string
  size: number
}

export interface WriteZipOptions {
  entries: readonly ZipEntryInput[]
  /** 最终 zip 路径；实际写 `<target>.part` 再 rename。 */
  target: string
  compression: ZipCompression
  /** 需要保留的空目录（例如空的 `Assets/`）。 */
  emptyDirectories?: readonly string[]
  signal?: AbortSignal
  onProgress?: (progress: { files: number; totalFiles: number; bytesWritten: number; totalBytes: number }) => void
}

export interface WriteZipResult {
  path: string
  size: number
  entries: number
}

const LEVELS: Record<ZipCompression, number | null> = {
  store: null,
  fast: 1,
  normal: 6
}

function partPath(target: string): string {
  return `${target}.part`
}

/** yazl 的类型把 outputStream 写成 ReadableStream，运行时其实是 Node 的 Readable。 */
function destroyZipStream(stream: unknown, error?: Error): void {
  const target = stream as { destroy?: (cause?: Error) => void }
  target.destroy?.(error)
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new VpmError('vpmBackupCancelled', {})
}

/**
 * 写一个 zip。失败/取消时删掉 `.part`，不留假成功。
 */
export async function writeZip(options: WriteZipOptions): Promise<WriteZipResult> {
  const part = partPath(options.target)
  const totalBytes = options.entries.reduce((sum, entry) => sum + Math.max(0, entry.size), 0)
  const level = LEVELS[options.compression]
  if (level === undefined) throw new VpmError('vpmBackupFailed', { reason: 'compression' })

  fs.mkdirSync(path.dirname(options.target), { recursive: true })
  fs.rmSync(part, { force: true })

  const zip = new yazl.ZipFile()
  try {
    for (const dir of options.emptyDirectories ?? []) zip.addEmptyDirectory(dir)
    for (const entry of options.entries) {
      checkAborted(options.signal)
      zip.addFile(
        entry.absolutePath,
        entry.relativePath,
        level === null ? { compress: false } : { compress: true, compressionLevel: level }
      )
    }
    zip.end()
  } catch (error) {
    destroyZipStream(zip.outputStream)
    fs.rmSync(part, { force: true })
    throw error instanceof VpmError ? error : new VpmError('vpmBackupFailed', { reason: 'add' }, error)
  }

  const out = createWriteStream(part)
  let written = 0
  const onData = (chunk: Buffer): void => {
    written += chunk.length
    options.onProgress?.({
      files: options.entries.length,
      totalFiles: options.entries.length,
      bytesWritten: written,
      totalBytes
    })
  }
  zip.outputStream.on('data', onData)

  const onAbort = (): void => {
    destroyZipStream(zip.outputStream, new VpmError('vpmBackupCancelled', {}))
  }
  options.signal?.addEventListener('abort', onAbort)

  try {
    await pipeline(zip.outputStream, out)
    checkAborted(options.signal)
    fs.renameSync(part, options.target)
    const stat = fs.statSync(options.target)
    return { path: options.target, size: stat.size, entries: options.entries.length }
  } catch (error) {
    fs.rmSync(part, { force: true })
    if (error instanceof VpmError) throw error
    if (options.signal?.aborted) throw new VpmError('vpmBackupCancelled', {})
    throw new VpmError('vpmBackupFailed', { reason: 'write' }, error)
  } finally {
    zip.outputStream.off('data', onData)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export interface ZipEntryInfo {
  name: string
  size: number
  isDirectory: boolean
}

/** 打开 zip 读一遍 central directory；读不了就抛（用于"写完能不能读"的验证）。 */
export async function readZipEntries(file: string, maxEntries = 500_000): Promise<ZipEntryInfo[]> {
  return new Promise<ZipEntryInfo[]>((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) {
        reject(new VpmError('vpmBackupInvalid', { field: 'zip' }, error))
        return
      }
      const entries: ZipEntryInfo[] = []
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entries.length >= maxEntries) {
          zip.close()
          reject(new VpmError('vpmBackupInvalid', { field: 'entries' }))
          return
        }
        entries.push({
          name: entry.fileName,
          size: entry.uncompressedSize,
          isDirectory: entry.fileName.endsWith('/')
        })
        zip.readEntry()
      })
      zip.on('end', () => resolve(entries))
      zip.on('error', (cause: Error) => reject(new VpmError('vpmBackupInvalid', { field: 'zip' }, cause)))
      zip.readEntry()
    })
  })
}

const MAX_EXTRACT_PATH = 260

/** 包内路径 → 安全相对路径；不安全返回 null。 */
export function safeZipPath(name: string): string | null {
  if (!name || name.length >= MAX_EXTRACT_PATH) return null
  if (name.includes('\\') || /[\u0000-\u001f]/.test(name)) return null
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null
  const segments = name.split('/').filter(Boolean)
  if (segments.length === 0) return null
  if (segments.some((segment) => segment === '.' || segment === '..')) return null
  return segments.join('/')
}

export interface ExtractZipOptions {
  file: string
  targetDir: string
  signal?: AbortSignal
  maxBytes?: number
}

/**
 * 解压到 `targetDir`（调用方保证目录是新的/空的）。
 *
 * - 拒绝路径逃逸、反斜杠、绝对路径、超长；
 * - 拒绝符号链接条目；
 * - 取消：立刻停止并抛 `vpmBackupCancelled`。
 */
export async function extractZip(options: ExtractZipOptions): Promise<{ files: number; bytes: number }> {
  const targetRoot = options.targetDir
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024 * 1024

  return new Promise((resolve, reject) => {
    yauzl.open(options.file, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) {
        reject(new VpmError('vpmBackupInvalid', { field: 'zip' }, error))
        return
      }
      let files = 0
      let bytes = 0
      let settled = false

      const fail = (cause: unknown): void => {
        if (settled) return
        settled = true
        zip.close()
        reject(cause instanceof VpmError ? cause : new VpmError('vpmBackupInvalid', { field: 'zip' }, cause))
      }

      zip.on('entry', (entry: yauzl.Entry) => {
        if (settled) return
        if (options.signal?.aborted) {
          fail(new VpmError('vpmBackupCancelled', {}))
          return
        }
        const safe = safeZipPath(entry.fileName)
        if (!safe) {
          fail(new VpmError('vpmBackupUnsafe', { path: entry.fileName }))
          return
        }
        const isDirectory = entry.fileName.endsWith('/')
        if (isDirectory) {
          fs.mkdirSync(joinPath(targetRoot, safe), { recursive: true })
          zip.readEntry()
          return
        }
        // 符号链接在 zip 里靠外部属性标记；一律拒绝。
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000
        if (mode === 0o120000) {
          fail(new VpmError('vpmBackupUnsafe', { path: entry.fileName }))
          return
        }
        bytes += entry.uncompressedSize
        if (bytes > maxBytes) {
          fail(new VpmError('vpmBackupTooLarge', { limit: 'bytes' }))
          return
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(streamError)
            return
          }
          const target = joinPath(targetRoot, safe)
          fs.mkdirSync(path.dirname(target), { recursive: true })
          const out = createWriteStream(target)
          pipeline(stream, out)
            .then(() => {
              files++
              zip.readEntry()
            })
            .catch(fail)
        })
      })

      zip.on('end', () => {
        if (settled) return
        settled = true
        resolve({ files, bytes })
      })
      zip.on('error', fail)
      zip.readEntry()
    })
  })
}

function joinPath(root: string, relative: string): string {
  return path.join(root, ...relative.split('/'))
}
