/**
 * `.unitypackage` 的**纯解析**（无 IO）。
 *
 * 一个 unitypackage 是 tar.gz，每条记录是一个 GUID 目录：
 *
 * ```text
 * <guid>/pathname      目标资源路径（通常 Assets/...）
 * <guid>/asset         文件内容
 * <guid>/asset.meta    Unity 生成的 meta（原样搬运，绝不重写）
 * <guid>/preview.png   预览图（忽略）
 * ```
 *
 * 这里只做"把条目变成一份安全的落盘计划"：路径归一、拒绝逃逸、去重。
 * 真正解包在 `main/vpm/unity/unitypackage.ts`。
 */

export const UNITYPACKAGE_MAX_ENTRIES = 100_000
export const UNITYPACKAGE_MAX_BYTES = 2 * 1024 * 1024 * 1024
export const UNITYPACKAGE_MAX_PATH = 260

const GUID_RE = /^[0-9a-f]{32}$/i
const RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export type PathnameIssue =
  | 'empty'
  | 'control'
  | 'backslash'
  | 'absolute'
  | 'driveLetter'
  | 'traversal'
  | 'emptySegment'
  | 'notUnderAssets'
  | 'reserved'
  | 'trailingDotOrSpace'
  | 'tooLong'

export type PathnameResult =
  | { ok: true; path: string }
  | { ok: false; issue: PathnameIssue; detail: string | null }

/**
 * 归一化包内 `pathname`。
 *
 * 只接受 `Assets/...`：拒绝绝对路径、盘符、`..`、反斜杠、控制字符、保留名、
 * 结尾点/空格，长度按 260 策略上限。
 */
export function normalizeUnityPathname(value: unknown): PathnameResult {
  if (typeof value !== 'string') return { ok: false, issue: 'empty', detail: null }
  // `pathname` 文件末尾通常有换行；只去掉行尾空白，不动中间。
  const raw = value.replace(/[\r\n]+$/g, '')
  if (!raw) return { ok: false, issue: 'empty', detail: null }
  if (/[\u0000-\u001f\u007f]/.test(raw)) return { ok: false, issue: 'control', detail: null }
  if (raw.includes('\\')) return { ok: false, issue: 'backslash', detail: null }
  if (raw.startsWith('/')) return { ok: false, issue: 'absolute', detail: raw.slice(0, 120) }
  if (/^[a-zA-Z]:/.test(raw)) return { ok: false, issue: 'driveLetter', detail: raw.slice(0, 120) }
  if (raw.length >= UNITYPACKAGE_MAX_PATH) return { ok: false, issue: 'tooLong', detail: String(raw.length) }

  const segments = raw.split('/')
  if (segments.some((segment) => segment.length === 0)) {
    return { ok: false, issue: 'emptySegment', detail: raw.slice(0, 120) }
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      return { ok: false, issue: 'traversal', detail: raw.slice(0, 120) }
    }
    if (RESERVED_SEGMENT.test(segment)) {
      return { ok: false, issue: 'reserved', detail: segment }
    }
    if (/[. ]$/.test(segment)) {
      return { ok: false, issue: 'trailingDotOrSpace', detail: segment }
    }
    if (/[<>:"|?*]/.test(segment)) {
      return { ok: false, issue: 'reserved', detail: segment }
    }
  }
  if (segments[0].toLowerCase() !== 'assets' || segments.length < 2) {
    return { ok: false, issue: 'notUnderAssets', detail: segments[0] ?? null }
  }
  // 首段统一成 Unity 的 `Assets`（包内偶尔写成 `assets/`）。
  return { ok: true, path: ['Assets', ...segments.slice(1)].join('/') }
}

export function isValidGuid(value: unknown): value is string {
  return typeof value === 'string' && GUID_RE.test(value)
}

/** 从 tar 里读到的一条记录。 */
export interface UnityPackageEntry {
  guid: string
  /** `pathname` 文件的内容；没有这个文件就是 null。 */
  pathname: string | null
  hasAsset: boolean
  hasMeta: boolean
}

export type UnityPackageSkipReason =
  | 'invalidGuid'
  | 'noPathname'
  | 'noAsset'
  | 'invalidPathname'
  | 'duplicatePath'

export interface UnityPackagePlanItem {
  guid: string
  /** 归一化后的目标相对路径，`Assets/...`。 */
  path: string
  /** 目标 meta 相对路径（`<path>.meta`）。 */
  metaPath: string
  /** 包内没有 `asset.meta`：只复制 asset，让 Unity 生成 meta。 */
  missingMeta: boolean
}

export interface UnityPackageSkip {
  guid: string
  reason: UnityPackageSkipReason
  detail: string | null
}

export interface UnityPackagePlan {
  items: UnityPackagePlanItem[]
  skipped: UnityPackageSkip[]
}

/**
 * 条目 → 落盘计划。
 *
 * - 没有合法 GUID / 没有 pathname / 没有 asset 的条目跳过；
 * - pathname 不安全的条目跳过（不猜、不修正）；
 * - 同一目标路径（大小写不敏感）只保留第一条，其余跳过并标 `duplicatePath`；
 * - 结果按路径排序，便于测试与日志。
 */
export function planUnityPackage(entries: readonly UnityPackageEntry[]): UnityPackagePlan {
  const items: UnityPackagePlanItem[] = []
  const skipped: UnityPackageSkip[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!isValidGuid(entry.guid)) {
      skipped.push({ guid: String(entry.guid), reason: 'invalidGuid', detail: null })
      continue
    }
    if (entry.pathname === null) {
      skipped.push({ guid: entry.guid, reason: 'noPathname', detail: null })
      continue
    }
    if (!entry.hasAsset) {
      skipped.push({ guid: entry.guid, reason: 'noAsset', detail: null })
      continue
    }
    const normalized = normalizeUnityPathname(entry.pathname)
    if (!normalized.ok) {
      skipped.push({ guid: entry.guid, reason: 'invalidPathname', detail: normalized.issue })
      continue
    }
    const key = normalized.path.toLowerCase()
    if (seen.has(key)) {
      skipped.push({ guid: entry.guid, reason: 'duplicatePath', detail: normalized.path })
      continue
    }
    seen.add(key)
    items.push({
      guid: entry.guid,
      path: normalized.path,
      metaPath: `${normalized.path}.meta`,
      missingMeta: !entry.hasMeta
    })
  }

  items.sort((a, b) => a.path.localeCompare(b.path))
  return { items, skipped }
}
