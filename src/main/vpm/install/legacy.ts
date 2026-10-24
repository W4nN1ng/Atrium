import fs from 'node:fs'
import path from 'node:path'
import type { ProjectSnapshot, VpmLegacyEntry } from '../../../shared/vpm/domain/project'
import type { LegacyGuardPort } from '../../../shared/vpm/linkage'
import { lstatOrNull, renameWithRetry } from '../fsUtil'

const DEFAULT_MAX_ENTRIES = 5_000
const MAX_DEPTH = 16

export type { LegacyGuardPort }

/** 这些包的旧 Assets 声明即使出现在移除集合里也绝不清理。 */
const PROTECTED_LEGACY_OWNERS = new Set(['com.avca.bridge'])

export interface LegacyCleanupInput {
  projectPath: string
  /** `<project>/.atrium-tx/<op>/trash`；旧 Assets 会移到 `legacy/Assets/...`。 */
  trashDir: string
  snapshot: ProjectSnapshot
  /** 本次移除的包名（大小写不敏感）。 */
  removedPackages: readonly string[]
  guard?: LegacyGuardPort
  maxEntries?: number
  renameRetries?: number
  sleep?: (ms: number) => Promise<void>
}

export type LegacySkipReason =
  | 'unknownOwner'
  | 'outsideAssets'
  | 'missing'
  | 'symlink'
  | 'protected'
  | 'protectedPackage'
  | 'unsupported'
  | 'truncated'

export interface LegacyCleanupMoved {
  /** 原路径（`Assets/...`）。 */
  path: string
  /** 事务区里的相对路径（`legacy/Assets/...`）。 */
  trashRelativePath: string
  kind: 'file' | 'dir'
}

export interface LegacyCleanupSkip {
  path: string
  reason: LegacySkipReason
}

export interface LegacyCleanupResult {
  moved: LegacyCleanupMoved[]
  skipped: LegacyCleanupSkip[]
}

/**
 * 旧式 VPM 包在 `Assets/` 里留下的资源清理（**路径级**，GUID 级留给 P6）。
 *
 * 硬规则：
 * - 只处理 manifest 里 `legacyFolders`/`legacyFiles` **声明**的路径，且必须能归到本次移除的包；
 * - 路径必须解析后仍在 `<project>/Assets/` 下，且不是 `Assets` 本身；
 * - 不跟随符号链接；目录里有链接就整目录跳过；
 * - `guard.isProtected()` 命中的文件/目录一律保留；
 * - 文件连同同名 `.meta` 一起移动；**不生成、不改写任何 `.meta`**；
 * - 只移动到事务区，不删除；任何不确定都跳过并报告。
 */
export async function cleanupLegacyAssets(
  input: LegacyCleanupInput
): Promise<LegacyCleanupResult> {
  const result: LegacyCleanupResult = { moved: [], skipped: [] }
  const manifest = input.snapshot?.manifest
  if (!manifest) return result

  const removed = new Set(input.removedPackages.map((name) => name.trim().toLowerCase()))
  if (removed.size === 0) return result

  const assetsRoot = path.resolve(input.projectPath, 'Assets')
  const maxEntries = Math.max(1, Math.trunc(input.maxEntries ?? DEFAULT_MAX_ENTRIES))
  const seen = new Set<string>()
  // 清理开始前刷新保护集合：一次事务内 `import_log` 不会变（维护租约挡着导入）。
  input.guard?.prime?.(input.projectPath)

  const candidates: Array<{ entry: VpmLegacyEntry; kind: 'dir' | 'file' }> = [
    ...manifest.legacyFolders.map((entry) => ({ entry, kind: 'dir' as const })),
    ...manifest.legacyFiles.map((entry) => ({ entry, kind: 'file' as const }))
  ]

  for (const { entry, kind } of candidates) {
    const owner = typeof entry?.packageId === 'string' ? entry.packageId.trim().toLowerCase() : ''
    if (!owner) {
      result.skipped.push({ path: String(entry?.path ?? ''), reason: 'unknownOwner' })
      continue
    }
    if (!removed.has(owner)) continue
    if (PROTECTED_LEGACY_OWNERS.has(owner)) {
      result.skipped.push({ path: String(entry?.path ?? ''), reason: 'protectedPackage' })
      continue
    }

    const relative = normalizeLegacyPath(entry.path)
    if (!relative) {
      result.skipped.push({ path: String(entry?.path ?? ''), reason: 'outsideAssets' })
      continue
    }
    if (seen.has(relative)) continue
    seen.add(relative)

    const absolute = path.resolve(input.projectPath, relative)
    if (absolute === assetsRoot || !isInside(assetsRoot, absolute)) {
      result.skipped.push({ path: relative, reason: 'outsideAssets' })
      continue
    }

    const stat = lstatOrNull(absolute)
    if (!stat) {
      result.skipped.push({ path: relative, reason: 'missing' })
      continue
    }
    if (stat.isSymbolicLink()) {
      result.skipped.push({ path: relative, reason: 'symlink' })
      continue
    }
    if (input.guard?.isProtected(input.projectPath, relative)) {
      result.skipped.push({ path: relative, reason: 'protected' })
      continue
    }

    if (kind === 'file') {
      if (!stat.isFile()) {
        result.skipped.push({ path: relative, reason: 'unsupported' })
        continue
      }
      await moveEntry(input, result, relative, 'file')
      continue
    }

    if (!stat.isDirectory()) {
      result.skipped.push({ path: relative, reason: 'unsupported' })
      continue
    }
    const scan = scanDirectory(absolute, relative, input.guard, input.projectPath, maxEntries)
    if (scan.reason) {
      result.skipped.push({ path: relative, reason: scan.reason })
      continue
    }
    await moveEntry(input, result, relative, 'dir')
  }

  return result
}

function normalizeLegacyPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  let normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || /^[A-Za-z]:/.test(normalized)) return null
  if (normalized.split('/').some((part) => part === '..' || part === '.' || !part)) return null
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return null
  if (!/^assets\//i.test(normalized)) return null
  normalized = `Assets/${normalized.slice('assets/'.length)}`
  return normalized === 'Assets' ? null : normalized
}

function isInside(parent: string, candidate: string): boolean {
  const base = parent.toLowerCase()
  const target = candidate.toLowerCase()
  return target === base || target.startsWith(base + path.sep)
}

interface ScanResult {
  reason: LegacySkipReason | null
}

/** 目录整移的前置检查：任何链接/受保护文件/超限都整目录跳过。 */
function scanDirectory(
  absolute: string,
  relative: string,
  guard: LegacyGuardPort | undefined,
  projectPath: string,
  maxEntries: number
): ScanResult {
  let count = 0
  const walk = (currentAbsolute: string, currentRelative: string, depth: number): ScanResult => {
    if (depth > MAX_DEPTH) return { reason: 'truncated' }
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(currentAbsolute, { withFileTypes: true })
    } catch {
      return { reason: 'unsupported' }
    }
    for (const entry of entries) {
      count++
      if (count > maxEntries) return { reason: 'truncated' }
      const childRelative = `${currentRelative}/${entry.name}`
      if (entry.isSymbolicLink()) return { reason: 'symlink' }
      if (guard?.isProtected(projectPath, childRelative)) return { reason: 'protected' }
      if (entry.isDirectory()) {
        const nested = walk(path.join(currentAbsolute, entry.name), childRelative, depth + 1)
        if (nested.reason) return nested
        continue
      }
      if (!entry.isFile()) return { reason: 'unsupported' }
    }
    return { reason: null }
  }
  return walk(absolute, relative, 0)
}

async function moveEntry(
  input: LegacyCleanupInput,
  result: LegacyCleanupResult,
  relative: string,
  kind: 'file' | 'dir'
): Promise<void> {
  const source = path.resolve(input.projectPath, relative)
  const trashRelative = `legacy/${relative}`
  const target = path.resolve(input.trashDir, trashRelative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  await renameWithRetry(source, target, {
    retries: input.renameRetries,
    sleep: input.sleep
  })
  result.moved.push({ path: relative, trashRelativePath: trashRelative, kind })

  // 文件与目录都要连同同名 `.meta` 一起移动；不生成、不改写任何 `.meta`。
  const metaSource = `${source}.meta`
  const metaStat = lstatOrNull(metaSource)
  if (!metaStat || metaStat.isSymbolicLink() || !metaStat.isFile()) return
  const metaTarget = `${target}.meta`
  try {
    await renameWithRetry(metaSource, metaTarget, {
      retries: input.renameRetries,
      sleep: input.sleep
    })
    result.moved.push({
      path: `${relative}.meta`,
      trashRelativePath: `${trashRelative}.meta`,
      kind: 'file'
    })
  } catch {
    // `.meta` 没搬走不是致命问题：文件本体已在事务区，Unity 会重新生成 meta。
    // 记录为跳过，交给上层 warning，不假装已清理。
    result.skipped.push({ path: `${relative}.meta`, reason: 'unsupported' })
  }
}
