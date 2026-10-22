import fs from 'node:fs'
import path from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { VpmError } from '../../../shared/vpm/errors'
import { isSameOrInside } from '../../../shared/vpm/dataRoot'
import { normalizePackageId } from '../../../shared/vpm/domain/packageId'
import { parseVpmVersion } from '../../../shared/vpm/domain/version'
import { parseVpmRange } from '../../../shared/vpm/domain/range'

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const WINDOWS_INVALID = /[<>:"|?*]/
const MAX_PACKAGE_JSON_BYTES = 256 * 1024

export interface ArchiveLimits {
  /** 压缩包文件本身的上限。 */
  maxZipBytes: number
  /** 条目数上限（含目录）。 */
  maxEntries: number
  /** 单个条目展开后的上限。 */
  maxEntryBytes: number
  /** 所有条目展开后的总上限。 */
  maxTotalBytes: number
  /** 压缩比阈值；高于它且展开量超过 ratioMinBytes 视为炸弹。 */
  maxCompressionRatio: number
  ratioMinBytes: number
  /** 目标绝对路径长度上限（Windows 260 保守值）。 */
  maxPathLength: number
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxZipBytes: 4 * 1024 * 1024 * 1024,
  maxEntries: 100_000,
  maxEntryBytes: 4 * 1024 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  maxCompressionRatio: 1000,
  ratioMinBytes: 64 * 1024 * 1024,
  maxPathLength: 260
}

export interface ExtractPackageZipInput {
  /** 已校验/缓存的 zip 绝对路径；适配器只读。 */
  zipPath: string
  /** 新的解压目标目录；必须不存在，失败时保留现场供诊断。 */
  targetDir: string
  /** 计划里的期望身份；提供时 name/version 必须精确匹配。 */
  expected?: { name: string; version: string }
  limits?: Partial<ArchiveLimits>
}

export interface ExtractedPackage {
  rootDir: string
  packageJsonPath: string
  name: string
  version: string
  manifest: Record<string, unknown>
  entries: number
  bytes: number
}

/**
 * P4 只实现 zip；`local` 在 P7 接入。事务的移动/回滚逻辑不关心来源。
 * P4-B 不实现 local，只把类型定下来，避免 P4-C 写死 zip。
 */
export type PreparedPackage =
  | { kind: 'zip'; zipPath: string; sha256: string }
  | { kind: 'local'; sourceDir: string; fingerprint: string }

function invalid(cause?: unknown): VpmError {
  return new VpmError('vpmArchiveInvalid', undefined, cause)
}

/** yauzl 自己会拒绝绝对路径/`..`/反斜杠；这些仍然是“不安全路径”，不是“损坏”。 */
function zipError(error: unknown): VpmError {
  const message = error instanceof Error ? error.message : String(error)
  if (/invalid relative path|absolute path|invalid characters in fileName/i.test(message)) {
    return new VpmError('vpmArchiveUnsafePath', undefined, error)
  }
  return invalid(error)
}

function unsafe(): never {
  throw new VpmError('vpmArchiveUnsafePath')
}

function bomb(): never {
  throw new VpmError('vpmArchiveBomb')
}

function writeFailed(cause?: unknown): VpmError {
  return new VpmError('vpmArchiveWriteFailed', undefined, cause)
}

function packageInvalid(cause?: unknown): VpmError {
  return new VpmError('vpmArchivePackageInvalid', undefined, cause)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function inside(parent: string, candidate: string): boolean {
  return isSameOrInside(parent, candidate, process.platform)
}

function normalizeLimits(overrides?: Partial<ArchiveLimits>): ArchiveLimits {
  const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...overrides }
  for (const key of [
    'maxZipBytes',
    'maxEntries',
    'maxEntryBytes',
    'maxTotalBytes',
    'ratioMinBytes',
    'maxPathLength'
  ] as const) {
    const value = limits[key]
    if (!Number.isSafeInteger(value) || value <= 0) throw invalid()
  }
  if (!Number.isFinite(limits.maxCompressionRatio) || limits.maxCompressionRatio <= 0) {
    throw invalid()
  }
  return limits
}

function validateZipPath(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw invalid()
  }
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(value)
  } catch (error) {
    throw invalid(error)
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw invalid()
  try {
    return fs.realpathSync(value)
  } catch (error) {
    throw invalid(error)
  }
}

function prepareTarget(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw writeFailed()
  }
  if (fs.existsSync(value)) throw writeFailed()
  try {
    fs.mkdirSync(value, { recursive: false })
  } catch (error) {
    throw writeFailed(error)
  }
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(value)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('not a directory')
    return fs.realpathSync(value)
  } catch (error) {
    throw writeFailed(error)
  }
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(
      file,
      { lazyEntries: true, autoClose: true, decodeStrings: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) {
          reject(invalid(error))
          return
        }
        resolve(zip)
      }
    )
  })
}

interface EntryClassification {
  relative: string
  directory: boolean
}

function classifyEntry(entry: yauzl.Entry): EntryClassification {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff
  const type = mode & 0xf000
  if (type === 0xa000) throw new VpmError('vpmArchiveSymlink')
  if (type !== 0 && type !== 0x8000 && type !== 0x4000) throw invalid()
  if (entry.isEncrypted()) throw invalid()
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw invalid()

  const raw = entry.fileName.replace(/\\/g, '/')
  const directory =
    raw.endsWith('/') ||
    type === 0x4000 ||
    (entry.externalFileAttributes & 0x10) !== 0
  const trimmed = raw.replace(/\/+$/g, '')
  if (!trimmed) unsafe()
  if (trimmed.startsWith('/') || trimmed.startsWith('//') || /^[A-Za-z]:/.test(trimmed)) {
    unsafe()
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) unsafe()
  const parts = trimmed.split('/')
  for (const part of parts) {
    if (!part || part === '.' || part === '..') unsafe()
    if (/[\u0000-\u001f\u007f]/.test(part)) unsafe()
    if (WINDOWS_INVALID.test(part)) unsafe()
    if (/[. ]$/.test(part)) unsafe()
    if (WINDOWS_RESERVED.test(part)) unsafe()
  }
  return { relative: parts.join('/'), directory }
}

function assertEntryLimits(entry: yauzl.Entry, limits: ArchiveLimits, totalBytes: number): void {
  const uncompressed = entry.uncompressedSize
  const compressed = entry.compressedSize
  if (
    !Number.isSafeInteger(uncompressed) ||
    uncompressed < 0 ||
    !Number.isSafeInteger(compressed) ||
    compressed < 0
  ) {
    bomb()
  }
  if (uncompressed > limits.maxEntryBytes) bomb()
  if (totalBytes + uncompressed > limits.maxTotalBytes) bomb()
  if (uncompressed > 0) {
    if (compressed === 0) bomb()
    if (
      uncompressed > limits.ratioMinBytes &&
      uncompressed / compressed > limits.maxCompressionRatio
    ) {
      bomb()
    }
  }
}

function keyOf(relative: string): string {
  return relative.normalize('NFC').toLowerCase()
}

function ancestors(key: string): string[] {
  const parts = key.split('/')
  const out: string[] = []
  for (let index = 1; index < parts.length; index++) out.push(parts.slice(0, index).join('/'))
  return out
}

function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise<Readable>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(invalid(error))
        return
      }
      resolve(stream)
    })
  })
}

interface ExtractCounters {
  entries: number
  bytes: number
}

async function extractEntry(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
  classification: EntryClassification,
  targetReal: string,
  limits: ArchiveLimits,
  counters: ExtractCounters
): Promise<void> {
  const full = path.join(targetReal, classification.relative)
  if (full.length >= limits.maxPathLength || !inside(targetReal, full)) unsafe()

  if (classification.directory) {
    if (entry.uncompressedSize !== 0) throw invalid()
    try {
      fs.mkdirSync(full, { recursive: true, mode: 0o755 })
      const real = fs.realpathSync(full)
      if (real !== targetReal && !inside(targetReal, real)) unsafe()
    } catch (error) {
      if (error instanceof VpmError) throw error
      throw writeFailed(error)
    }
    return
  }

  try {
    fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o755 })
    const parentReal = fs.realpathSync(path.dirname(full))
    if (parentReal !== targetReal && !inside(targetReal, parentReal)) unsafe()
  } catch (error) {
    if (error instanceof VpmError) throw error
    throw writeFailed(error)
  }

  const stream = await openEntry(zip, entry)
  let written = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback): void {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      written += buffer.length
      counters.bytes += buffer.length
      if (written > entry.uncompressedSize || counters.bytes > limits.maxTotalBytes) {
        callback(new VpmError('vpmArchiveBomb'))
        return
      }
      callback(null, buffer)
    }
  })
  try {
    await pipeline(
      stream,
      meter,
      fs.createWriteStream(full, { flags: 'wx', mode: 0o600 })
    )
  } catch (error) {
    if (error instanceof VpmError) throw error
    throw writeFailed(error)
  }
  if (written !== entry.uncompressedSize) throw invalid()
}

function extractAll(
  zip: yauzl.ZipFile,
  targetReal: string,
  limits: ArchiveLimits
): Promise<ExtractCounters> {
  return new Promise<ExtractCounters>((resolve, reject) => {
    let settled = false
    let entries = 0
    let bytes = 0
    const seen = new Set<string>()
    const files = new Set<string>()
    const dirs = new Set<string>()

    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      try {
        zip.close()
      } catch {
        /* 已关闭/损坏 */
      }
      reject(error instanceof VpmError ? error : invalid(error))
    }

    const onEntry = (entry: yauzl.Entry): void => {
      if (settled) return
      void (async () => {
        const classification = classifyEntry(entry)
        const key = keyOf(classification.relative)
        if (seen.has(key)) unsafe()
        seen.add(key)
        for (const ancestor of ancestors(key)) {
          if (files.has(ancestor)) unsafe()
        }
        if (!classification.directory && dirs.has(key)) unsafe()

        entries++
        if (entries > limits.maxEntries) bomb()
        assertEntryLimits(entry, limits, bytes)

        for (const ancestor of ancestors(key)) dirs.add(ancestor)
        await extractEntry(zip, entry, classification, targetReal, limits, {
          entries,
          bytes
        })
        bytes += entry.uncompressedSize
        if (classification.directory) {
          dirs.add(key)
        } else {
          files.add(key)
        }

        if (!settled) zip.readEntry()
      })().catch(fail)
    }

    zip.on('entry', onEntry)
    zip.on('end', () => {
      if (settled) return
      settled = true
      resolve({ entries, bytes })
    })
    zip.on('error', (error) => fail(zipError(error)))
    try {
      zip.readEntry()
    } catch (error) {
      fail(zipError(error))
    }
  })
}

function isRegularFile(file: string): boolean {
  try {
    const stat = fs.lstatSync(file)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

function locatePackageRoot(targetReal: string): { rootDir: string; packageJsonPath: string } {
  const rootJson = path.join(targetReal, 'package.json')
  if (isRegularFile(rootJson)) {
    return { rootDir: targetReal, packageJsonPath: rootJson }
  }
  let children: fs.Dirent[]
  try {
    children = fs.readdirSync(targetReal, { withFileTypes: true })
  } catch (error) {
    throw packageInvalid(error)
  }
  const candidates: string[] = []
  for (const child of children) {
    if (!child.isDirectory() || child.isSymbolicLink()) continue
    const json = path.join(targetReal, child.name, 'package.json')
    if (isRegularFile(json)) candidates.push(path.join(targetReal, child.name))
  }
  if (candidates.length !== 1) throw packageInvalid()
  const rootDir = candidates[0]
  if (!inside(targetReal, rootDir)) throw packageInvalid()
  return { rootDir, packageJsonPath: path.join(rootDir, 'package.json') }
}

function validatePackage(
  rootDir: string,
  packageJsonPath: string,
  expected?: { name: string; version: string }
): { name: string; version: string; manifest: Record<string, unknown> } {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(packageJsonPath)
  } catch (error) {
    throw packageInvalid(error)
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_PACKAGE_JSON_BYTES) {
    throw packageInvalid()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    throw packageInvalid(error)
  }
  if (!isRecord(parsed)) throw packageInvalid()

  let name: string
  try {
    name = normalizePackageId(parsed.name)
  } catch (error) {
    throw packageInvalid(error)
  }
  const version = parseVpmVersion(parsed.version)
  if (!version) throw packageInvalid()

  const dependencies = parsed.vpmDependencies
  if (dependencies !== undefined) {
    if (!isRecord(dependencies)) throw packageInvalid()
    for (const [depName, range] of Object.entries(dependencies)) {
      try {
        normalizePackageId(depName)
        if (typeof range !== 'string') throw packageInvalid()
        parseVpmRange(range)
      } catch (error) {
        if (error instanceof VpmError && error.code === 'vpmArchivePackageInvalid') throw error
        throw packageInvalid(error)
      }
    }
  }

  if (expected) {
    let expectedName: string
    let expectedVersion: ReturnType<typeof parseVpmVersion>
    try {
      expectedName = normalizePackageId(expected.name)
      expectedVersion = parseVpmVersion(expected.version)
    } catch (error) {
      throw packageInvalid(error)
    }
    if (!expectedVersion) throw packageInvalid()
    if (name !== expectedName || version.raw !== expectedVersion.raw) {
      throw packageInvalid()
    }
  }

  if (!inside(rootDir, packageJsonPath)) throw packageInvalid()
  return { name, version: version.raw, manifest: parsed }
}

/**
 * 安全解压 VPM 包 zip 到调用方给出的、同卷新建目录。
 *
 * - 逐条目校验：路径逃逸/绝对路径/盘符/UNC/`..`/ADS/保留名/尾点空格/大小写重复/
 *   文件-目录冲突/超长路径；符号链接和特殊文件直接拒绝；
 * - 条目数/单条/总量/压缩比/zip 文件大小上限，超限按压缩炸弹处理；
 * - 不跟随链接，写文件前用 realpath 再确认父目录在目标内；
 * - 失败保留目标目录（可能含已解出的前缀文件），绝不删除或回滚工程文件；
 * - `.meta` 原样解压；解压后必须找到唯一的 package.json，并校验 name/version/deps。
 */
export async function extractPackageZip(input: ExtractPackageZipInput): Promise<ExtractedPackage> {
  if (!input || typeof input !== 'object') throw invalid()
  const zipPath = validateZipPath(input.zipPath)
  const limits = normalizeLimits(input.limits)
  let zipStat: fs.Stats
  try {
    zipStat = fs.statSync(zipPath)
  } catch (error) {
    throw invalid(error)
  }
  if (zipStat.size > limits.maxZipBytes) bomb()
  const targetReal = prepareTarget(input.targetDir)
  const zip = await openZip(zipPath)
  let counters: ExtractCounters
  try {
    counters = await extractAll(zip, targetReal, limits)
  } finally {
    try {
      zip.close()
    } catch {
      /* autoClose 已关闭 */
    }
  }
  const root = locatePackageRoot(targetReal)
  const pkg = validatePackage(root.rootDir, root.packageJsonPath, input.expected)
  return {
    rootDir: root.rootDir,
    packageJsonPath: root.packageJsonPath,
    name: pkg.name,
    version: pkg.version,
    manifest: pkg.manifest,
    entries: counters.entries,
    bytes: counters.bytes
  }
}
