import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { VpmError } from '../../shared/vpm/errors'

/**
 * VPM 文件原语：原子写、rename 退避重试、目录树复制与摘要。
 *
 * 这里只做“同一件事的正确做法”，不含业务判断：
 * - 失败一律抛 `VpmError`，由调用方决定降级成哪个错误码；
 * - 不跟随符号链接；复制遇到链接直接中止，绝不把工程外的内容带进回滚仓；
 * - 所有写入先落到同目录临时文件/临时位置，再 rename。
 */

const DEFAULT_RENAME_RETRIES = 5
const DEFAULT_RENAME_DELAY_MS = 40
const RETRYABLE_RENAME_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EEXIST'])

export interface RenameOptions {
  /** 含首次尝试的总次数；默认 5。 */
  retries?: number
  /** 首次退避毫秒；之后线性递增；默认 40。 */
  delayMs?: number
  sleep?: (ms: number) => Promise<void>
}

export interface TreeDigest {
  sha256: string
  size: number
  files: number
}

function fsError(step: string, cause?: unknown): VpmError {
  return new VpmError('vpmTransactionFailed', { step }, cause)
}

function unsafe(step: string): VpmError {
  return new VpmError('vpmProjectPathUnsafe', { step })
}

export function lstatOrNull(file: string): fs.Stats | null {
  try {
    return fs.lstatSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw fsError('lstat', error)
  }
}

export function isRealDirectory(file: string): boolean {
  try {
    const stat = fs.lstatSync(file)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Windows 上 rename 经常被杀毒/索引/Unity 残留短暂占用（EBUSY/EPERM/EACCES）。
 * 有限次退避重试后仍失败就抛错——绝不强删/强移。
 */
export async function renameWithRetry(
  from: string,
  to: string,
  options: RenameOptions = {}
): Promise<void> {
  const retries = Math.max(1, Math.trunc(options.retries ?? DEFAULT_RENAME_RETRIES))
  const delayMs = Math.max(0, Math.trunc(options.delayMs ?? DEFAULT_RENAME_DELAY_MS))
  const sleep = options.sleep ?? defaultSleep
  let last: unknown = null
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (error) {
      last = error
      const code = (error as NodeJS.ErrnoException).code
      if (!code || !RETRYABLE_RENAME_CODES.has(code) || attempt === retries) break
      await sleep(delayMs * attempt)
    }
  }
  throw fsError('rename', last)
}

/**
 * 同步版 rename 重试：给启动恢复用（恢复发生在 `initVpm()` 里，没有可让出的事件循环）。
 * 立即重试、不睡眠；仍然失败就抛错，由恢复层落 `needs_attention`。
 */
export function renameSyncWithRetry(from: string, to: string, retries = 3): void {
  const attempts = Math.max(1, Math.trunc(retries))
  let last: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (error) {
      last = error
      const code = (error as NodeJS.ErrnoException).code
      if (!code || !RETRYABLE_RENAME_CODES.has(code) || attempt === attempts) break
    }
  }
  throw fsError('rename', last)
}

/** 同目录临时文件 → fsync → rename；目录 fsync 失败不掩盖主流程（Windows 不保证）。 */
export function writeFileAtomic(file: string, contents: string, mode = 0o600): void {
  const dir = path.dirname(file)
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  let fd: number | null = null
  try {
    fd = fs.openSync(temp, 'wx', mode)
    fs.writeFileSync(fd, contents, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    fs.renameSync(temp, file)
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* 已关闭 */
      }
    }
    try {
      fs.unlinkSync(temp)
    } catch {
      /* 临时文件没写成或已 rename */
    }
    throw fsError('write', error)
  }
  try {
    const dirFd = fs.openSync(dir, 'r')
    try {
      fs.fsyncSync(dirFd)
    } finally {
      fs.closeSync(dirFd)
    }
  } catch {
    /* Windows 不保证目录 fsync；文件本身已经 fsync + rename */
  }
}

export async function hashFile(file: string): Promise<{ sha256: string; size: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    let size = 0
    const stream = fs.createReadStream(file)
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      hash.update(buffer)
    })
    stream.on('error', (error) => reject(fsError('hash', error)))
    stream.on('end', () => resolve({ sha256: hash.digest('hex'), size }))
  })
}

interface CopyContext {
  sourceRoot: string
  targetRoot: string
  lines: string[]
  bytes: number
  files: number
}

async function copyFileInto(context: CopyContext, relative: string): Promise<void> {
  const source = path.join(context.sourceRoot, relative)
  const target = path.join(context.targetRoot, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const hashed = await hashFile(source)
  try {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
  } catch (error) {
    throw fsError('copy', error)
  }
  const copied = await hashFile(target)
  if (copied.sha256 !== hashed.sha256 || copied.size !== hashed.size) {
    throw fsError('copy-verify')
  }
  context.bytes += hashed.size
  context.files++
  context.lines.push(`${relative}\u0000${hashed.size}\u0000${hashed.sha256}`)
}

async function walkInto(context: CopyContext, relative: string, depth: number): Promise<void> {
  if (depth > 64) throw fsError('copy-depth')
  const dir = path.join(context.sourceRoot, relative)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    throw fsError('copy-list', error)
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw unsafe('copy-symlink')
    if (entry.isDirectory()) {
      fs.mkdirSync(path.join(context.targetRoot, childRelative), { recursive: true })
      await walkInto(context, childRelative, depth + 1)
      continue
    }
    if (!entry.isFile()) throw unsafe('copy-special')
    await copyFileInto(context, childRelative)
  }
}

/**
 * 复制目录树到 target（target 可以已存在，用于重试续传），逐文件校验 hash。
 * 返回稳定树摘要：按相对路径排序的 `rel\0size\0fileHash` 行的 SHA-256。
 * 空目录也会被创建；符号链接/特殊文件直接中止。
 */
export async function copyTreeWithDigest(source: string, target: string): Promise<TreeDigest> {
  const context: CopyContext = {
    sourceRoot: source,
    targetRoot: target,
    lines: [],
    bytes: 0,
    files: 0
  }
  fs.mkdirSync(target, { recursive: true })
  await walkInto(context, '', 0)
  context.lines.sort()
  const sha256 = createHash('sha256').update(context.lines.join('\n'), 'utf8').digest('hex')
  return { sha256, size: context.bytes, files: context.files }
}

/** 递归统计目录占用；不跟随链接，读不到的条目跳过。 */
export function directoryUsage(dir: string): { bytes: number; files: number } {
  let bytes = 0
  let files = 0
  const walk = (current: string, depth: number): void => {
    if (depth > 32) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = fs.statSync(full)
        bytes += stat.size
        files++
      } catch {
        /* 并发清理/锁定：跳过 */
      }
    }
  }
  walk(dir, 0)
  return { bytes, files }
}

/** 删除一个目录树；只用于应用自己的临时目录。 */
export function removeTree(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 })
  } catch (error) {
    throw fsError('remove', error)
  }
}

/** 只在目录为空时删除，避免误删现场。 */
export function removeEmptyDirectory(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return true
    fs.rmdirSync(dir)
    return true
  } catch {
    return false
  }
}
