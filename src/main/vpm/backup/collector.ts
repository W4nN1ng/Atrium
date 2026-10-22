import type { Dirent, Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { VpmError } from '../../../shared/vpm/errors'

/**
 * 工程文件树收集器（P6-A）。
 *
 * 备份与复制共用：只**读**目录，输出稳定有序的文件清单，不压缩、不复制、不改源文件。
 *
 * 排除规则（与 `docs/prompts/VPM-P6.md` §5 对齐）：
 * - 根目录排除 `Logs` / `obj` / `Temp` / `.git` / `.atrium-tx`（大小写不敏感）；
 * - 任意层级排除 `.git`；
 * - 根目录 `Library*` 整棵排除，**但保留** `Library/LastSceneManagerSetup.txt`；
 * - 可选排除 `vpm-manifest.json` 管理的 `Packages/<id>`（未知/本地包保留）；
 * - 始终保留 `Packages/manifest.json`、`Packages/vpm-manifest.json`、
 *   `ProjectSettings/ProjectVersion.txt`；
 * - 隐藏文件不跳过（`.git` 除外）；
 * - 符号链接 / junction 一律**不跟随**，记 warning。
 */

export type CollectMode = 'backup' | 'copy'

export type CollectWarning =
  | 'symlink'
  | 'permission'
  | 'tooDeep'
  | 'longPath'
  | 'unsupported'
  | 'truncated'

export interface CollectedEntry {
  /** POSIX 分隔符的相对路径，例如 `Assets/Prefabs/A.prefab`。 */
  relativePath: string
  absolutePath: string
  size: number
}

export interface CollectProgress {
  files: number
  bytes: number
  /** 最近处理的相对路径（可能为空）。 */
  current: string
}

export interface CollectOptions {
  root: string
  mode: CollectMode
  /** 是否排除由 `vpm-manifest.json` 管理的 VPM 包目录。 */
  excludeVpmPackages?: boolean
  maxFiles?: number
  maxBytes?: number
  maxDepth?: number
  signal?: AbortSignal
  onProgress?: (progress: CollectProgress) => void
  /** 进度节流间隔（毫秒）；测试可调小。 */
  progressIntervalMs?: number
}

export interface CollectResult {
  root: string
  mode: CollectMode
  files: CollectedEntry[]
  directories: CollectedEntry[]
  fileCount: number
  byteCount: number
  warnings: Array<{ path: string; reason: CollectWarning }>
  /** 命中上限被截断（调用方必须当成失败/需要用户确认）。 */
  truncated: boolean
  elapsedMs: number
}

export const COLLECT_MAX_FILES = 200_000
export const COLLECT_MAX_BYTES = 64 * 1024 * 1024 * 1024
export const COLLECT_MAX_DEPTH = 32
/** 与解压/建工程一致的策略上限：更长的路径不保证能被其他工具处理。 */
export const COLLECT_MAX_PATH = 260

const ROOT_EXCLUDES = new Set(['logs', 'obj', 'temp', '.git', '.atrium-tx'])
const ALWAYS_KEEP = new Set([
  'packages/manifest.json',
  'packages/vpm-manifest.json',
  'projectsettings/projectversion.txt'
])
const LAST_SCENE = 'library/lastscenemanagersetup.txt'

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

/**
 * 是否排除这个相对路径。
 *
 * `depth` 是**父目录**的深度：0 = 直接位于工程根下。
 */
export function isExcluded(
  relativePath: string,
  depth: number,
  managedPackages: ReadonlySet<string>
): boolean {
  const lower = toPosix(relativePath).toLowerCase()
  if (ALWAYS_KEEP.has(lower)) return false
  if (lower === LAST_SCENE) return false

  const segments = lower.split('/')
  if (depth === 0 && ROOT_EXCLUDES.has(segments[0])) return true

  // Library* 整棵排除（多个 Library 目录按前缀处理），但保留最后场景配置：
  // 只放行精确的 `Library` 目录本身，再放行它下面的那一个文件。
  if (segments[0].startsWith('library')) {
    if (segments.length === 1) return segments[0] !== 'library'
    if (segments.length === 2) return lower !== LAST_SCENE
    return true
  }
  if (segments.includes('.git')) return true
  if (managedPackages.size > 0 && segments[0] === 'packages' && segments.length >= 2) {
    if (managedPackages.has(segments[1])) return true
  }
  return false
}

/** 从 `Packages/vpm-manifest.json` 读出受管包名（小写）；坏文件按"没有受管包"处理。 */
export async function readManagedPackages(root: string): Promise<Set<string>> {
  const out = new Set<string>()
  try {
    const text = await fs.readFile(path.join(root, 'Packages', 'vpm-manifest.json'), 'utf8')
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out
    const record = parsed as { dependencies?: unknown; locked?: unknown }
    for (const bucket of [record.dependencies, record.locked]) {
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue
      for (const name of Object.keys(bucket as Record<string, unknown>)) {
        const trimmed = name.trim().toLowerCase()
        if (trimmed) out.add(trimmed)
      }
    }
  } catch {
    /* 没有 manifest / 坏 JSON：不排除任何包 */
  }
  return out
}

interface StackItem {
  absolutePath: string
  relativePath: string
  depth: number
}

function errorReason(error: unknown): CollectWarning {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EACCES' || code === 'EPERM') return 'permission'
  return 'unsupported'
}

/**
 * 收集工程文件树。
 *
 * - 取消：`signal.aborted` 后立刻抛 `vpmCollectCancelled`，不再继续遍历；
 * - 上限：文件数/总字节/深度命中就标记 `truncated` 并停止（调用方必须当失败处理）；
 * - 排序：`files` / `directories` 都按相对路径稳定排序，同样输入必然同样输出。
 */
export async function collectProjectFiles(options: CollectOptions): Promise<CollectResult> {
  const startedAt = Date.now()
  const root = path.resolve(options.root)
  const maxFiles = options.maxFiles ?? COLLECT_MAX_FILES
  const maxBytes = options.maxBytes ?? COLLECT_MAX_BYTES
  const maxDepth = options.maxDepth ?? COLLECT_MAX_DEPTH
  const interval = options.progressIntervalMs ?? 100

  let stat: Stats
  try {
    stat = await fs.lstat(root)
  } catch {
    throw new VpmError('vpmProjectInvalid', { field: 'path' })
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new VpmError('vpmProjectInvalid', { field: 'path' })
  }

  const managed = options.excludeVpmPackages ? await readManagedPackages(root) : new Set<string>()
  const files: CollectedEntry[] = []
  const directories: CollectedEntry[] = []
  const warnings: CollectResult['warnings'] = []
  let bytes = 0
  let truncated = false
  let lastProgressAt = 0

  const report = (current: string, force = false): void => {
    if (!options.onProgress) return
    const now = Date.now()
    if (!force && now - lastProgressAt < interval) return
    lastProgressAt = now
    options.onProgress({ files: files.length, bytes, current })
  }

  const stack: StackItem[] = [{ absolutePath: root, relativePath: '', depth: 0 }]
  report('', true)

  while (stack.length > 0) {
    if (options.signal?.aborted) throw new VpmError('vpmCollectCancelled', { root })
    const current = stack.pop() as StackItem
    let entries: Dirent[]
    try {
      entries = await fs.readdir(current.absolutePath, { withFileTypes: true })
    } catch (error) {
      warnings.push({ path: current.relativePath || '.', reason: errorReason(error) })
      continue
    }
    // 稳定排序：不依赖文件系统返回顺序。
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    for (const entry of entries) {
      const relativePath = current.relativePath
        ? `${current.relativePath}/${entry.name}`
        : entry.name
      if (isExcluded(relativePath, current.depth, managed)) continue
      const absolutePath = path.join(current.absolutePath, entry.name)

      let entryStat: Stats
      try {
        entryStat = await fs.lstat(absolutePath)
      } catch (error) {
        warnings.push({ path: relativePath, reason: errorReason(error) })
        continue
      }
      if (entryStat.isSymbolicLink()) {
        // junction / reparse point 在 Node 里也报 symlink：一律不跟随。
        warnings.push({ path: relativePath, reason: 'symlink' })
        continue
      }
      if (entryStat.isDirectory()) {
        if (current.depth + 1 > maxDepth) {
          warnings.push({ path: relativePath, reason: 'tooDeep' })
          continue
        }
        directories.push({ relativePath, absolutePath, size: 0 })
        stack.push({ absolutePath, relativePath, depth: current.depth + 1 })
        continue
      }
      if (!entryStat.isFile()) {
        warnings.push({ path: relativePath, reason: 'unsupported' })
        continue
      }
      if (absolutePath.length >= COLLECT_MAX_PATH) {
        warnings.push({ path: relativePath, reason: 'longPath' })
        continue
      }
      files.push({ relativePath, absolutePath, size: entryStat.size })
      bytes += entryStat.size
      if (files.length > maxFiles || bytes > maxBytes) {
        truncated = true
        warnings.push({ path: relativePath, reason: 'truncated' })
        break
      }
      report(relativePath)
    }
    if (truncated) break
  }

  files.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0))
  directories.sort((a, b) =>
    a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0
  )
  report('', true)

  return {
    root,
    mode: options.mode,
    files,
    directories,
    fileCount: files.length,
    byteCount: bytes,
    warnings,
    truncated,
    elapsedMs: Date.now() - startedAt
  }
}
