import path from 'node:path'
import type { VpmErrorCode, VpmParams, VpmWarningCode } from './errors'
import type { VpmDataRootContext, VpmDataRootValidation } from './types'

const MAX_DATA_ROOT_LENGTH = 240
const WINDOWS_BAD_SEGMENT = /[<>:"|?*\u0000-\u001f]/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const TRAILING_DOT_OR_SPACE = /[. ]$/

function fail(code: VpmErrorCode, params?: VpmParams): VpmDataRootValidation {
  return { ok: false, code, params }
}

function isWindows(platform: string): boolean {
  return platform === 'win32'
}

function pathApi(platform: string): typeof path.win32 | typeof path.posix {
  return isWindows(platform) ? path.win32 : path.posix
}

/** 仅规整分隔符/`.`，不解析符号链接；真实路径校验在 main 侧。 */
export function normalizeVpmDataRoot(input: string, platform: string): string {
  const api = pathApi(platform)
  const withSeparators = isWindows(platform) ? input.replace(/\//g, '\\') : input
  let normalized = api.normalize(withSeparators)
  const root = api.parse(normalized).root
  if (normalized !== root) normalized = normalized.replace(/[\\/]+$/, '')
  return normalized
}

function comparable(value: string, platform: string): string {
  const normalized = normalizeVpmDataRoot(value, platform)
  return isWindows(platform) ? normalized.toLowerCase() : normalized
}

/** Windows 大小写不敏感；比较时按目录边界，`E:\AB` 不算在 `E:\A` 内。 */
export function isSameOrInside(parent: string, candidate: string, platform: string): boolean {
  const p = comparable(parent, platform)
  const c = comparable(candidate, platform)
  if (!p || !c) return false
  if (p === c) return true
  const api = pathApi(platform)
  const prefix = p.endsWith(api.sep) ? p : p + api.sep
  return c.startsWith(prefix)
}

function isDriveRoot(normalized: string, platform: string): boolean {
  if (!isWindows(platform)) return normalized === '/'
  const root = path.win32.parse(normalized).root
  return normalized.toLowerCase() === root.toLowerCase()
}

function driveOf(normalized: string): string | null {
  const match = /^([A-Za-z]:)[\\/]/.exec(normalized)
  return match ? match[1] : null
}

/**
 * 纯数据根校验：不创建目录、不写文件、不解析 symlink。
 * main 侧在启用时补“可创建/可写”与真实路径检查。
 */
export function validateVpmDataRoot(
  input: unknown,
  context: VpmDataRootContext
): VpmDataRootValidation {
  if (typeof input !== 'string' || input.trim() === '') return fail('vpmDataRootRequired')

  const raw = input.trim()
  if (raw.includes('\0')) return fail('vpmDataRootInvalid')

  const platform = context.platform
  const api = pathApi(platform)

  if (!api.isAbsolute(raw)) return fail('vpmDataRootInvalid')
  if (isWindows(platform)) {
    // 扩展路径/设备路径会把真实目标藏起来，VPM 只接受普通盘符或 UNC。
    if (/^\\\\[?.]\\/.test(raw)) return fail('vpmDataRootInvalid')
    if (/^\/\//.test(raw) && !/^\\\\[^\\?]/.test(raw)) return fail('vpmDataRootInvalid')
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(raw)) return fail('vpmDataRootInvalid')

  const normalized = normalizeVpmDataRoot(raw, platform)
  if (normalized.length > MAX_DATA_ROOT_LENGTH) {
    return fail('vpmDataRootInvalid', { max: MAX_DATA_ROOT_LENGTH })
  }
  if (isDriveRoot(normalized, platform)) return fail('vpmDataRootInvalid')

  if (isWindows(platform)) {
    const withoutDrive = normalized.replace(/^[A-Za-z]:/, '')
    if (WINDOWS_BAD_SEGMENT.test(withoutDrive)) return fail('vpmDataRootInvalid')
    for (const part of withoutDrive.split(/[\\/]+/)) {
      if (!part) continue
      if (TRAILING_DOT_OR_SPACE.test(part) || WINDOWS_RESERVED.test(part)) {
        return fail('vpmDataRootInvalid')
      }
    }

    const systemDrive = (context.systemDrive ?? 'C:').replace(/[\\/]+$/, '')
    const drive = driveOf(normalized)
    if (drive && systemDrive && drive.toLowerCase() === systemDrive.toLowerCase()) {
      return fail('vpmDataRootOnSystemDrive', { drive: systemDrive.toUpperCase() })
    }
  }

  if (context.libraryRoot && isSameOrInside(context.libraryRoot, normalized, platform)) {
    return fail('vpmDataRootInsideLibrary')
  }
  for (const project of context.knownProjectPaths ?? []) {
    if (project && isSameOrInside(project, normalized, platform)) {
      return fail('vpmDataRootInsideProject')
    }
  }
  for (const appDir of context.appInstallDirs ?? []) {
    if (appDir && isSameOrInside(appDir, normalized, platform)) {
      return fail('vpmDataRootInsideApp')
    }
  }

  const warnings: VpmWarningCode[] = []
  if (isWindows(platform) && normalized.startsWith('\\\\')) warnings.push('vpmDataRootUnc')
  if (context.removable === true) warnings.push('vpmDataRootRemovable')
  if (context.fsType && context.fsType.toLowerCase() !== 'ntfs' && !warnings.includes('vpmDataRootNonNtfs')) {
    warnings.push('vpmDataRootNonNtfs')
  }

  return { ok: true, normalized, warnings }
}
