import { VpmError } from '../errors'
import { sha256Hex } from './hash'

/**
 * `Packages/vpm-manifest.json` 的纯构建逻辑。
 *
 * 只负责“把计划结果写成 manifest 对象/文本”，不碰文件系统：
 * - 未知顶层字段原样保留（VCC/ALCOM 以后加的字段不能被吃掉）；
 * - `dependencies` 只写计划里的最终根依赖，不把传递依赖提升为根；
 * - `locked` 写所有最终包的精确版本与依赖范围；
 * - 受保护包/旧式包/未列出的包不在最终集合里时，保留它们原来的 locked 条目；
 * - 输出顺序稳定，同一输入得到同一文本与同一 hash。
 */

export interface ManifestLockEntry {
  version: string
  dependencies: Record<string, string>
}

export interface ManifestFinalPackage {
  name: string
  version: string
}

export interface BuildManifestInput {
  /** 现有 manifest 的原始对象；null = 工程还没有 manifest。 */
  before: Record<string, unknown> | null
  /** 计划完成后的根依赖（`ChangePlan.roots`）。 */
  roots: Record<string, string>
  /** 计划完成后的包集合（`ChangePlan.finalPackages`）。 */
  finalPackages: readonly ManifestFinalPackage[]
  /** 本次移除的包名；大小写不敏感。 */
  removed?: readonly string[]
  /** 每个包的 vpmDependencies；缺失时用 before.locked 里的依赖。 */
  dependenciesOf?: Record<string, Record<string, string>>
}

export interface BuiltManifest {
  data: Record<string, unknown>
  text: string
  hash: string
  dependencies: Record<string, string>
  locked: Record<string, ManifestLockEntry>
}

const MAX_NAME = 214
const MAX_RANGE = 200
const MAX_PACKAGES = 2_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name.length > MAX_NAME) return null
  if (/[\s\u0000-\u001f<>:"|?*/\\]/.test(name)) return null
  return name
}

function normalizeRange(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const range = value.trim()
  if (!range || range.length > MAX_RANGE) return null
  if (/[\u0000-\u001f]/.test(range)) return null
  return range
}

/** 只保留字符串范围；排序保证稳定。 */
function rangeMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [rawName, rawRange] of Object.entries(value)) {
    const name = normalizeName(rawName)
    const range = normalizeRange(rawRange)
    if (name && range) out[name] = range
  }
  return sortRecord(out)
}

function sortRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

function sortKeys<T>(input: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

function lockEntryOf(value: unknown): ManifestLockEntry | null {
  if (!isRecord(value)) return null
  const version = normalizeRange(value.version)
  if (!version) return null
  return { version, dependencies: rangeMap(value.dependencies) }
}

function lowerSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))
}

/**
 * VCC/ALCOM 新版 manifest 的 dependencies 是对象数组：
 *   `"com.vrchat.avatars": { "version": "3.10.5" }`
 * 旧版是字符串。写回时沿用原来的形状；对象里除 version 外的未知字段原样保留。
 */
function buildDependencies(
  before: unknown,
  roots: Record<string, string>
): Record<string, unknown> {
  const objectFormat =
    isRecord(before) && Object.values(before).some((value) => isRecord(value))
  if (!objectFormat) return roots
  const out: Record<string, unknown> = {}
  for (const [name, range] of Object.entries(roots)) {
    const previous = isRecord(before) ? before[name] : undefined
    out[name] = isRecord(previous) ? { ...previous, version: range } : { version: range }
  }
  return sortKeys(out)
}

export function buildManifest(input: BuildManifestInput): BuiltManifest {
  const before = isRecord(input.before) ? input.before : {}
  const removed = lowerSet(input.removed)
  const roots = rangeMap(input.roots)

  const finalNames = new Set<string>()
  const finalByName = new Map<string, ManifestFinalPackage>()
  for (const pkg of input.finalPackages ?? []) {
    const name = normalizeName(pkg?.name)
    const version = normalizeRange(pkg?.version)
    if (!name || !version) continue
    if (finalNames.has(name.toLowerCase())) continue
    finalNames.add(name.toLowerCase())
    finalByName.set(name.toLowerCase(), { name, version })
  }
  if (finalByName.size > MAX_PACKAGES) throw new VpmError('vpmManifestInvalid', { field: 'locked' })

  const beforeLocked = isRecord(before.locked) ? before.locked : {}
  const locked: Record<string, ManifestLockEntry> = {}
  // 先保留不属于本次变更的旧条目：受保护包、旧式包、unlisted 包都靠这一步不被抹掉。
  for (const [rawName, rawEntry] of Object.entries(beforeLocked)) {
    const name = normalizeName(rawName)
    if (!name) continue
    const key = name.toLowerCase()
    if (removed.has(key) || finalNames.has(key)) continue
    const entry = lockEntryOf(rawEntry)
    if (entry) locked[name] = entry
  }
  for (const [key, pkg] of finalByName) {
    const declared = input.dependenciesOf?.[key] ?? input.dependenciesOf?.[pkg.name]
    const fallback = locked[pkg.name]?.dependencies ?? lockEntryOf(beforeLocked[pkg.name])?.dependencies
    locked[pkg.name] = {
      version: pkg.version,
      dependencies: declared ? rangeMap(declared) : fallback ? rangeMap(fallback) : {}
    }
  }

  const data: Record<string, unknown> = {
    ...before,
    dependencies: buildDependencies(before.dependencies, roots),
    locked: sortKeys(locked)
  }
  const text = JSON.stringify(data, null, 2)
  return { data, text, hash: sha256Hex(text), dependencies: roots, locked: data.locked as Record<string, ManifestLockEntry> }
}
