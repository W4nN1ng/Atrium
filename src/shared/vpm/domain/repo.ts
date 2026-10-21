import { VpmError } from '../errors'

export interface ParsedRepoPackage {
  name: string
  version: string
  displayName: string | null
  description: string | null
  authorJson: string | null
  keywordsJson: string | null
  aliasesJson: string | null
  unityMin: string | null
  zipUrl: string | null
  zipSha256: string | null
  zipSize: number | null
  yanked: boolean
  yankedReason: string | null
  hidden: boolean
  deprecated: boolean
  manifestJson: string
  /** 目录/解析器提示用：没有合法 URL+hash 的版本不可安装。 */
  installable: boolean
}

export interface RepoParseWarning {
  code: string
  package?: string
  version?: string
}

export interface ParsedRepo {
  name: string | null
  id: string | null
  url: string | null
  packages: ParsedRepoPackage[]
  packageCount: number
  versionCount: number
  warnings: RepoParseWarning[]
}

export interface RepoParseOptions {
  maxBytes?: number
  maxPackages?: number
  maxVersionsPerPackage?: number
  maxWarnings?: number
}

const DEFAULTS: Required<RepoParseOptions> = {
  maxBytes: 16 * 1024 * 1024,
  maxPackages: 20_000,
  maxVersionsPerPackage: 500,
  maxWarnings: 200
}

const encoder = new TextEncoder()

const PACKAGE_NAME = /^[a-z0-9][a-z0-9._-]*$/
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const SHA256 = /^[a-f0-9]{64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function invalid(field: string, cause?: unknown): VpmError {
  return new VpmError('vpmRepoInvalid', { field }, cause)
}

function optionalString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > max) return null
  return text
}

function validPackageName(name: string): boolean {
  if (!name || name.length > 214 || !PACKAGE_NAME.test(name) || name.includes('..')) return false
  for (const part of name.split('.')) {
    if (!part || part.endsWith('.') || part.endsWith(' ')) return false
    if (WINDOWS_RESERVED.test(part)) return false
  }
  return true
}

function validVersion(version: string): boolean {
  return !!version && version.length <= 128 && VERSION.test(version) && !version.includes('..')
}

function normalizeZipUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

function normalizeSha(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return SHA256.test(normalized) ? normalized : null
}

function stringArrayJson(value: unknown, maxItems = 100, maxLength = 100): string | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (!text || text.length > maxLength) continue
    if (!out.includes(text)) out.push(text)
    if (out.length >= maxItems) break
  }
  return out.length ? JSON.stringify(out) : null
}

function authorJson(value: unknown): string | null {
  if (typeof value !== 'string' && !isRecord(value)) return null
  try {
    const text = JSON.stringify(value)
    return text.length <= 10_000 ? text : null
  } catch {
    return null
  }
}

function booleanFrom(value: unknown): boolean {
  return value === true
}

function readYanked(obj: Record<string, unknown>, vrcGet: Record<string, unknown>): {
  yanked: boolean
  reason: string | null
} {
  for (const candidate of [obj.yanked, vrcGet.yanked]) {
    if (candidate === true) return { yanked: true, reason: null }
    if (typeof candidate === 'string' && candidate.trim()) {
      return { yanked: true, reason: candidate.trim().slice(0, 500) }
    }
  }
  return { yanked: false, reason: null }
}

/** 去掉版本对象里的 headers，避免把 token 写进 manifest_json；其余未知字段保留。 */
function sanitizeVersionObject(obj: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = Object.create(null)
  for (const [key, value] of Object.entries(obj)) {
    if (key.toLowerCase() === 'headers') continue
    copy[key] = value
  }
  if (isRecord(copy['vrc-get'])) {
    const vrcGet: Record<string, unknown> = Object.create(null)
    for (const [key, value] of Object.entries(copy['vrc-get'])) {
      if (key.toLowerCase() === 'headers') continue
      vrcGet[key] = value
    }
    copy['vrc-get'] = vrcGet
  }
  return copy
}

function parsePackage(
  name: string,
  raw: unknown,
  options: Required<RepoParseOptions>,
  warn: (code: string, pkg?: string, version?: string) => void
): ParsedRepoPackage[] {
  if (!isRecord(raw) || !isRecord(raw.versions)) {
    warn('invalidPackageObject', name)
    return []
  }
  const entries = Object.entries(raw.versions)
  if (entries.length > options.maxVersionsPerPackage) {
    warn('tooManyVersions', name)
    return []
  }

  const out: ParsedRepoPackage[] = []
  for (const [version, value] of entries) {
    if (!validVersion(version)) {
      warn('invalidVersion', name, version)
      continue
    }
    if (!isRecord(value)) {
      warn('invalidVersionObject', name, version)
      continue
    }
    const vrcGet = isRecord(value['vrc-get']) ? value['vrc-get'] : {}
    const zipUrl = normalizeZipUrl(value.url)
    const zipSha256 = normalizeSha(value.zipSHA256)
    if (value.url !== undefined && !zipUrl) warn('invalidZipUrl', name, version)
    if (value.zipSHA256 !== undefined && !zipSha256) warn('invalidZipHash', name, version)
    const manifestJson = JSON.stringify(sanitizeVersionObject(value))
    if (encoder.encode(manifestJson).length > options.maxBytes) {
      warn('manifestTooLarge', name, version)
      continue
    }
    const yanked = readYanked(value, vrcGet)
    const hidden = booleanFrom(value.hidden) || booleanFrom(vrcGet.hidden)
    const deprecated = booleanFrom(value.deprecated) || booleanFrom(vrcGet.deprecated)
    const keywordsJson =
      stringArrayJson(value.keywords) ?? stringArrayJson(vrcGet.keywords)
    const aliasesJson =
      stringArrayJson(vrcGet.aliases) ?? stringArrayJson(value.aliases)
    const zipSize =
      typeof value.zipSize === 'number' &&
      Number.isFinite(value.zipSize) &&
      value.zipSize >= 0 &&
      value.zipSize <= 4 * 1024 * 1024 * 1024
        ? Math.trunc(value.zipSize)
        : null

    out.push({
      name,
      version,
      displayName: optionalString(value.displayName, 500),
      description: optionalString(value.description, 20_000),
      authorJson: authorJson(value.author),
      keywordsJson,
      aliasesJson,
      unityMin: optionalString(value.unity, 64),
      zipUrl,
      zipSha256,
      zipSize,
      yanked: yanked.yanked,
      yankedReason: yanked.reason,
      hidden,
      deprecated,
      manifestJson,
      installable: !!zipUrl && !!zipSha256
    })
  }
  return out
}

/**
 * 解析并归一仓库 JSON。
 *
 * - 仓库级坏 JSON/形状 → vpmRepoInvalid；
 * - 单个坏包/坏版本跳过并记 warning，不炸整仓；
 * - headers（含 vrc-get.headers）从 manifest_json 中剥离；
 * - zip URL 只接受 HTTPS；hash 归一为小写；没有 URL+hash 的版本不可安装。
 */
export function parseRepoJson(input: unknown, options: RepoParseOptions = {}): ParsedRepo {
  const opts: Required<RepoParseOptions> = { ...DEFAULTS, ...options }
  let parsed: unknown = input

  if (typeof input === 'string') {
    if (encoder.encode(input).length > opts.maxBytes) throw invalid('size')
    try {
      parsed = JSON.parse(input.replace(/^\uFEFF/, ''))
    } catch (error) {
      throw invalid('repo', error)
    }
  }

  if (!isRecord(parsed)) throw invalid('repo')
  if (!isRecord(parsed.packages)) throw invalid('packages')
  const packageEntries = Object.entries(parsed.packages)
  if (packageEntries.length > opts.maxPackages) throw invalid('packages')

  const warnings: RepoParseWarning[] = []
  const warn = (code: string, pkg?: string, version?: string): void => {
    if (warnings.length >= opts.maxWarnings) return
    warnings.push({ code, package: pkg, version })
  }

  const packages: ParsedRepoPackage[] = []
  let packageCount = 0
  for (const [name, raw] of packageEntries) {
    if (!validPackageName(name)) {
      warn('invalidPackageName', name)
      continue
    }
    const versions = parsePackage(name, raw, opts, warn)
    if (!versions.length) continue
    packageCount++
    packages.push(...versions)
  }

  return {
    name: optionalString(parsed.name, 200),
    id: optionalString(parsed.id, 200),
    url: optionalString(parsed.url, 2048),
    packages,
    packageCount,
    versionCount: packages.length,
    warnings
  }
}
