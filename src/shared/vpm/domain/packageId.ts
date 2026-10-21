import { VpmError } from '../errors'

const MAX_PACKAGE_ID_LENGTH = 214
const PACKAGE_ID = /^[a-z0-9][a-z0-9._-]*$/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

function invalid(): VpmError {
  return new VpmError('vpmPackageIdInvalid', { field: 'name' })
}

function validateSegments(id: string): void {
  if (id.endsWith('.') || id.includes('..')) throw invalid()
  const segments = id.split('.')
  for (const segment of segments) {
    if (!segment || segment.endsWith('.') || segment.endsWith(' ')) throw invalid()
    if (WINDOWS_RESERVED.test(segment)) throw invalid()
  }
}

/**
 * VPM 包名归一：trim + 小写，只允许 `a-z0-9._-`，拒绝路径分隔符、控制字符、
 * `..`、尾点/空格和 Windows 保留名（包名最终会变成 Packages/<name> 目录）。
 */
export function normalizePackageId(input: unknown): string {
  if (typeof input !== 'string') throw invalid()
  const normalized = input.trim().toLowerCase()
  if (!normalized || normalized.length > MAX_PACKAGE_ID_LENGTH) throw invalid()
  if (!PACKAGE_ID.test(normalized)) throw invalid()
  validateSegments(normalized)
  return normalized
}

export function isValidPackageId(input: unknown): boolean {
  try {
    normalizePackageId(input)
    return true
  } catch {
    return false
  }
}

export function assertPackageId(input: unknown): string {
  return normalizePackageId(input)
}

export function packageIdSegments(input: unknown): string[] {
  return normalizePackageId(input).split('.')
}
