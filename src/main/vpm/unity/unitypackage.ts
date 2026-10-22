import fs from 'node:fs'
import path from 'node:path'
import * as tar from 'tar'
import {
  UNITYPACKAGE_MAX_BYTES,
  UNITYPACKAGE_MAX_ENTRIES,
  isValidGuid,
  planUnityPackage,
  type UnityPackageEntry
} from '../../../shared/vpm/domain/unitypackage'
import { VpmError } from '../../../shared/vpm/errors'
import type { TemplateService } from '../templates'
import type { TemplateAttachmentPort } from './create'

/**
 * `.unitypackage` 落盘适配器（P5-C）。
 *
 * 流程刻意分成"先解到临时目录 → 再按计划搬进 Assets"两段：
 * 只有所有路径都校验通过、且目标都不存在时，才开始往工程里写，
 * 所以失败不会留下半套资源。
 *
 * 铁律：**只搬 `asset` 与 `asset.meta`，绝不生成/补写 `.meta`**。
 */

const ALLOWED_FILES = new Set(['pathname', 'asset', 'asset.meta', 'preview.png'])

export interface ExtractUnityPackageInput {
  packagePath: string
  /** 工程根目录；目标会落在 `<projectPath>/Assets/...`。 */
  projectPath: string
  /** 目标已存在时：`reject`（默认，整个中止）或 `skip`（跳过该文件）。 */
  onConflict?: 'reject' | 'skip'
  maxEntries?: number
  maxBytes?: number
  /** 临时目录根；默认 `<projectPath>/Temp`。 */
  tempRoot?: string
}

export interface ExtractUnityPackageResult {
  /** 真正写进工程的目标相对路径（不含 `.meta`）。 */
  applied: string[]
  skipped: Array<{ path: string; reason: 'exists' | 'invalidPathname' | 'noPathname' | 'noAsset' | 'duplicatePath' | 'invalidGuid' }>
  warnings: Array<{ path: string; reason: 'missingMeta' }>
}

function inside(parent: string, child: string): boolean {
  const root = path.resolve(parent).toLowerCase()
  const target = path.resolve(child).toLowerCase()
  return target === root || target.startsWith(`${root}${path.sep}`)
}

function isFile(target: string): boolean {
  try {
    const stat = fs.lstatSync(target)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** 只接受 `<32位guid>/<白名单文件名>`，其余一律不落盘。 */
function safeEntryPath(entryPath: string): boolean {
  const segments = entryPath.split('/')
  if (segments.length === 1) return isValidGuid(segments[0])
  if (segments.length !== 2) return false
  if (!isValidGuid(segments[0])) return false
  return ALLOWED_FILES.has(segments[1])
}

function readEntries(temp: string): UnityPackageEntry[] {
  const entries: UnityPackageEntry[] = []
  let names: string[]
  try {
    names = fs.readdirSync(temp)
  } catch {
    return entries
  }
  for (const guid of names) {
    if (!isValidGuid(guid)) continue
    const dir = path.join(temp, guid)
    try {
      if (!fs.lstatSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    let pathname: string | null = null
    const pathnameFile = path.join(dir, 'pathname')
    try {
      const stat = fs.lstatSync(pathnameFile)
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4096) {
        pathname = fs.readFileSync(pathnameFile, 'utf8')
      }
    } catch {
      pathname = null
    }
    entries.push({
      guid,
      pathname,
      hasAsset: isFile(path.join(dir, 'asset')),
      hasMeta: isFile(path.join(dir, 'asset.meta'))
    })
  }
  return entries
}

function removeEmptyDirs(dirs: readonly string[]): void {
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      fs.rmdirSync(dir)
    } catch {
      /* 非空或被占用：留着比删错好 */
    }
  }
}

/**
 * 解包一个 unitypackage 到工程 `Assets/`。
 *
 * - 路径不安全 / 目标已存在 / 超出限额 → 抛错，工程里一个字节都没动；
 * - 包内缺 `asset.meta` → 只复制 asset，并给 `missingMeta` 警告（让 Unity 自己生成）；
 * - 中途 IO 失败 → 回滚本次已经搬进去的文件（只删自己搬的）。
 */
export async function extractUnityPackage(
  input: ExtractUnityPackageInput
): Promise<ExtractUnityPackageResult> {
  const packagePath = path.resolve(input.packagePath)
  const projectPath = path.resolve(input.projectPath)
  const onConflict = input.onConflict ?? 'reject'
  const maxEntries = input.maxEntries ?? UNITYPACKAGE_MAX_ENTRIES
  const maxBytes = input.maxBytes ?? UNITYPACKAGE_MAX_BYTES

  if (!isFile(packagePath)) throw new VpmError('vpmUnityPackageInvalid', { field: 'package' })
  const assetsRoot = path.join(projectPath, 'Assets')
  if (!fs.existsSync(assetsRoot)) throw new VpmError('vpmUnityPackageInvalid', { field: 'assets' })

  const tempRoot = input.tempRoot ? path.resolve(input.tempRoot) : path.join(projectPath, 'Temp')
  fs.mkdirSync(tempRoot, { recursive: true })
  const temp = fs.mkdtempSync(path.join(tempRoot, 'atrium-unitypackage-'))

  try {
    let count = 0
    let bytes = 0
    // 不要在 filter 里抛错：tar 的流不会因此中止，promise 会悬着。
    // 超限就一路返回 false（不写盘），解完再抛。
    let limitHit: 'entries' | 'bytes' | null = null
    try {
      await tar.x({
        file: packagePath,
        cwd: temp,
        strict: true,
        preservePaths: false,
        filter: (entryPath, entry) => {
          if (limitHit) return false
          if (!safeEntryPath(entryPath)) return false
          // 只接受普通文件与目录；符号链接/硬链接/设备文件一律跳过。
          const type = String(entry.type)
          if (type !== 'File' && type !== 'Directory') return false
          count++
          if (count > maxEntries) {
            limitHit = 'entries'
            return false
          }
          bytes += Number(entry.size ?? 0)
          if (bytes > maxBytes) {
            limitHit = 'bytes'
            return false
          }
          return true
        }
      })
    } catch (error) {
      if (error instanceof VpmError) throw error
      throw new VpmError('vpmUnityPackageInvalid', { field: 'archive' }, error)
    }
    if (limitHit) throw new VpmError('vpmUnityPackageTooLarge', { limit: limitHit })

    const plan = planUnityPackage(readEntries(temp))
    const skipped: ExtractUnityPackageResult['skipped'] = plan.skipped.map((item) => ({
      path: item.detail ?? item.guid,
      reason: item.reason
    }))
    const warnings: ExtractUnityPackageResult['warnings'] = []

    // 先把冲突全部查清楚：只要有一个目标已存在且策略是 reject，就整体中止。
    const actionable = plan.items.filter((item) => {
      const target = path.join(projectPath, item.path)
      const metaTarget = `${target}.meta`
      if (!inside(assetsRoot, target) || !inside(assetsRoot, metaTarget)) {
        skipped.push({ path: item.path, reason: 'invalidPathname' })
        return false
      }
      const exists = fs.existsSync(target) || fs.existsSync(metaTarget)
      if (!exists) return true
      if (onConflict === 'skip') {
        skipped.push({ path: item.path, reason: 'exists' })
        return false
      }
      throw new VpmError('vpmUnityPackageConflict', { path: item.path })
    })

    const moved: string[] = []
    const createdDirs: string[] = []
    const applied: string[] = []
    try {
      for (const item of actionable) {
        const target = path.join(projectPath, item.path)
        const parent = path.dirname(target)
        if (!fs.existsSync(parent)) {
          const missing: string[] = []
          let cursor = parent
          while (!fs.existsSync(cursor) && inside(assetsRoot, cursor)) {
            missing.push(cursor)
            cursor = path.dirname(cursor)
          }
          fs.mkdirSync(parent, { recursive: true })
          createdDirs.push(...missing)
        }
        fs.renameSync(path.join(temp, item.guid, 'asset'), target)
        moved.push(target)
        if (!item.missingMeta) {
          fs.renameSync(path.join(temp, item.guid, 'asset.meta'), `${target}.meta`)
          moved.push(`${target}.meta`)
        } else {
          warnings.push({ path: item.path, reason: 'missingMeta' })
        }
        applied.push(item.path)
      }
    } catch (error) {
      // 回滚：只删本次搬进去的文件与本次建的空目录。
      for (const file of moved.reverse()) {
        try {
          fs.rmSync(file, { force: true })
        } catch {
          /* 尽力而为 */
        }
      }
      removeEmptyDirs(createdDirs)
      throw new VpmError('vpmUnityPackageFailed', { moved: moved.length }, error)
    }

    return { applied, skipped, warnings }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

/**
 * 模板附件端口（P5-B 的 `TemplateAttachmentPort` 实现）。
 *
 * 逐个把模板 `files/` 下的 unitypackage 解到临时工程的 `Assets/`；
 * 任何一个失败都抛错——P5-B 会把整个临时工程归档，不留半套。
 */
export function createTemplateAttachmentPort(options: {
  templates: TemplateService
  tempRoot?: string
}): TemplateAttachmentPort {
  return {
    async apply({ projectPath, templateId, attachments }) {
      const filesRoot = options.templates.filesDir(templateId)
      let applied = 0
      const warnings: string[] = []
      for (const attachment of attachments) {
        const relative = attachment.path.startsWith('files/')
          ? attachment.path.slice('files/'.length)
          : attachment.path
        const absolute = path.resolve(filesRoot, relative)
        if (!inside(filesRoot, absolute)) {
          throw new VpmError('vpmUnityPackageUnsafe', { path: attachment.path })
        }
        const result = await extractUnityPackage({
          packagePath: absolute,
          projectPath,
          onConflict: 'reject',
          ...(options.tempRoot ? { tempRoot: options.tempRoot } : {})
        })
        applied += result.applied.length
        for (const warning of result.warnings) warnings.push(`${warning.reason}:${warning.path}`)
      }
      return { applied, warnings }
    }
  }
}
