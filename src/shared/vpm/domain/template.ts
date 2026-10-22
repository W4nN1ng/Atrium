import { normalizePackageId } from './packageId'
import { exactVpmRangeVersion, satisfiesVpmRange, tryParseVpmRange } from './range'
import { parseUnityVersion } from './unityVersion'

/**
 * Atrium 自有模板格式（`template.json`）。
 *
 * 设计原则：
 * - **未知字段保留**：`extra` 收下所有不认识的顶层键，导出时原样写回。
 * - **版本化**：`schemaVersion` 必须显式校验；不认识就拒绝，不猜。
 * - **base 继承**：解析时先取 base，再用当前模板覆盖（依赖同名覆盖、附件追加、
 *   Unity 范围取交集、settings 浅合并）；深度 ≤8，检测循环。
 * - 纯函数：无 IO、无时钟、无 DB。存储与文件校验在 `main/vpm/templates/`。
 */

export const TEMPLATE_SCHEMA_VERSION = 1
export const TEMPLATE_MAX_DEPTH = 8
export const TEMPLATE_MAX_ATTACHMENTS = 32
export const TEMPLATE_MANIFEST_MAX_BYTES = 256 * 1024
/** 容器（ZIP）上限；P7-D 打包时检查。 */
export const TEMPLATE_MAX_CONTAINER_BYTES = 2 * 1024 * 1024 * 1024

// 模板 id 来自 ULID（大写）或 `builtin.xxx`；只允许安全字符。
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_NAME = 120
const MAX_DESCRIPTION = 2000

export type TemplateSource = 'builtin' | 'imported' | 'user'

export interface TemplateUnityRange {
  /** `2022.3` 或 `2022.3.22f1`。 */
  min: string
  max: string | null
  recommended: string | null
}

export interface TemplateAttachment {
  /** 必须是 `files/` 下的相对路径。 */
  path: string
  name: string | null
}

export interface TemplateManifest {
  schemaVersion: number
  id: string
  name: string
  description: string | null
  base: string | null
  unity: TemplateUnityRange
  dependencies: Record<string, string>
  unitypackages: TemplateAttachment[]
  settings: Record<string, unknown>
  /** 不认识的顶层字段，原样保留。 */
  extra: Record<string, unknown>
}

export type TemplateIssueCode =
  | 'schemaVersion'
  | 'id'
  | 'name'
  | 'description'
  | 'base'
  | 'unityMin'
  | 'unityMax'
  | 'unityRecommended'
  | 'unityRange'
  | 'dependency'
  | 'attachment'
  | 'settings'
  | 'cycle'
  | 'depth'
  | 'missingBase'
  | 'notObject'

export interface TemplateIssue {
  code: TemplateIssueCode
  field: string
  detail: string | null
}

export interface TemplateParseResult {
  ok: boolean
  manifest: TemplateManifest | null
  issues: TemplateIssue[]
}

const KNOWN_KEYS = new Set([
  'schemaVersion',
  'id',
  'name',
  'description',
  'base',
  'unity',
  'dependencies',
  'unitypackages',
  'settings'
])

function issue(code: TemplateIssueCode, field: string, detail: string | null = null): TemplateIssue {
  return { code, field, detail }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null
  return trimmed
}

export function isValidTemplateId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value)
}

/** 附件路径：必须 `files/` 下、相对、无反斜杠/上跳/控制字符。 */
export function normalizeAttachmentPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > 512) return null
  if (raw.includes('\\') || raw.includes('\0') || /[\u0000-\u001f\u007f]/.test(raw)) return null
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return null
  const segments = raw.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null
  if (segments[0] !== 'files') return null
  return segments.join('/')
}

function parseUnityRange(value: unknown, issues: TemplateIssue[]): TemplateUnityRange {
  const fallback: TemplateUnityRange = { min: '2022.3', max: null, recommended: null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push(issue('unityMin', 'unity', 'missing'))
    return fallback
  }
  const raw = value as Record<string, unknown>
  const min = typeof raw.min === 'string' ? raw.min.trim() : ''
  const parsedMin = parseUnityVersion(min)
  if (!parsedMin) {
    issues.push(issue('unityMin', 'unity.min', String(raw.min ?? '')))
    return fallback
  }
  let max: string | null = null
  if (raw.max !== null && raw.max !== undefined) {
    const value = typeof raw.max === 'string' ? raw.max.trim() : ''
    const parsedMax = parseUnityVersion(value)
    if (!parsedMax) {
      issues.push(issue('unityMax', 'unity.max', String(raw.max)))
    } else if (compareUnity(value, min) < 0) {
      issues.push(issue('unityRange', 'unity.max', `${value} < ${min}`))
    } else {
      max = value
    }
  }
  let recommended: string | null = null
  if (raw.recommended !== null && raw.recommended !== undefined) {
    const value = typeof raw.recommended === 'string' ? raw.recommended.trim() : ''
    if (!parseUnityVersion(value)) issues.push(issue('unityRecommended', 'unity.recommended', String(raw.recommended)))
    else recommended = value
  }
  return { min, max, recommended }
}

/** `2022.3.22f1` vs `2022.3`：按数字段比较，缺的段当 0。 */
export function compareUnity(a: string, b: string): number {
  const parts = (value: string): number[] => {
    const core = value.split(/[abfp]/)[0]
    return core.split('.').map((part) => Number(part) || 0)
  }
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

function parseDependencies(value: unknown, issues: TemplateIssue[]): Record<string, string> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    issues.push(issue('dependency', 'dependencies', 'notObject'))
    return {}
  }
  const out: Record<string, string> = {}
  for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
    let normalized: string
    try {
      normalized = normalizePackageId(name)
    } catch {
      issues.push(issue('dependency', `dependencies.${name}`, 'name'))
      continue
    }
    if (typeof range !== 'string' || !tryParseVpmRange(range)) {
      issues.push(issue('dependency', `dependencies.${normalized}`, String(range)))
      continue
    }
    out[normalized] = range.trim()
  }
  return out
}

function parseAttachments(value: unknown, issues: TemplateIssue[]): TemplateAttachment[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    issues.push(issue('attachment', 'unitypackages', 'notArray'))
    return []
  }
  if (value.length > TEMPLATE_MAX_ATTACHMENTS) {
    issues.push(issue('attachment', 'unitypackages', `>${TEMPLATE_MAX_ATTACHMENTS}`))
    return []
  }
  const out: TemplateAttachment[] = []
  const seen = new Set<string>()
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push(issue('attachment', `unitypackages.${index}`, 'notObject'))
      continue
    }
    const entry = raw as Record<string, unknown>
    const path = normalizeAttachmentPath(entry.path)
    if (!path) {
      issues.push(issue('attachment', `unitypackages.${index}.path`, String(entry.path ?? '')))
      continue
    }
    const key = path.toLowerCase()
    if (seen.has(key)) {
      issues.push(issue('attachment', `unitypackages.${index}.path`, 'duplicate'))
      continue
    }
    seen.add(key)
    const name = entry.name === null || entry.name === undefined ? null : text(entry.name, 120)
    if (entry.name !== null && entry.name !== undefined && !name) {
      issues.push(issue('attachment', `unitypackages.${index}.name`, String(entry.name)))
      continue
    }
    out.push({ path, name })
  }
  return out
}

function parseSettings(value: unknown, issues: TemplateIssue[]): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    issues.push(issue('settings', 'settings', 'notObject'))
    return {}
  }
  return { ...(value as Record<string, unknown>) }
}

/** 校验并解析 `template.json`；不抛异常，问题都进 `issues`。 */
export function parseTemplateManifest(value: unknown): TemplateParseResult {
  const issues: TemplateIssue[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, manifest: null, issues: [issue('notObject', 'template')] }
  }
  const raw = value as Record<string, unknown>

  const schemaVersion = raw.schemaVersion
  if (schemaVersion !== TEMPLATE_SCHEMA_VERSION) {
    issues.push(issue('schemaVersion', 'schemaVersion', String(schemaVersion ?? '')))
  }

  const id = raw.id
  if (!isValidTemplateId(id)) issues.push(issue('id', 'id', String(id ?? '')))

  const name = text(raw.name, MAX_NAME)
  if (!name) issues.push(issue('name', 'name', String(raw.name ?? '')))

  let description: string | null = null
  if (raw.description !== null && raw.description !== undefined) {
    description = text(raw.description, MAX_DESCRIPTION)
    if (!description) issues.push(issue('description', 'description', 'invalid'))
  }

  let base: string | null = null
  if (raw.base !== null && raw.base !== undefined) {
    if (!isValidTemplateId(raw.base)) issues.push(issue('base', 'base', String(raw.base)))
    else if (raw.base === id) issues.push(issue('cycle', 'base', 'self'))
    else base = raw.base
  }

  const unity = parseUnityRange(raw.unity, issues)
  const dependencies = parseDependencies(raw.dependencies, issues)
  const unitypackages = parseAttachments(raw.unitypackages, issues)
  const settings = parseSettings(raw.settings, issues)

  const extra: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = entry
  }

  const manifest: TemplateManifest = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    id: id as string,
    name: name ?? '',
    description,
    base,
    unity,
    dependencies,
    unitypackages,
    settings,
    extra
  }
  return { ok: issues.length === 0, manifest, issues }
}

/** 序列化回 `template.json` 的纯文本（保留未知字段）。 */
export function serializeTemplateManifest(manifest: TemplateManifest): string {
  const data: Record<string, unknown> = {
    ...manifest.extra,
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    base: manifest.base,
    unity: {
      min: manifest.unity.min,
      max: manifest.unity.max,
      recommended: manifest.unity.recommended
    },
    dependencies: sortRecord(manifest.dependencies),
    unitypackages: manifest.unitypackages.map((item) => ({
      path: item.path,
      ...(item.name === null ? {} : { name: item.name })
    })),
    settings: manifest.settings
  }
  return `${JSON.stringify(data, null, 2)}\n`
}

function sortRecord(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of Object.keys(input).sort()) out[key] = input[key]
  return out
}

/**
 * Unity 范围取交集：min 取较晚的、max 取较早的；交集为空返回 `null`。
 */
export function intersectUnityRange(
  base: TemplateUnityRange,
  child: TemplateUnityRange
): TemplateUnityRange | null {
  const min = compareUnity(base.min, child.min) >= 0 ? base.min : child.min
  const candidates = [base.max, child.max].filter((value): value is string => !!value)
  const max = candidates.length ? candidates.sort(compareUnity)[0] : null
  if (max && compareUnity(min, max) > 0) return null
  return { min, max, recommended: child.recommended ?? base.recommended }
}

/**
 * 两个 VPM 范围是否可能重叠。
 *
 * 不做完整 SAT：只处理"至少一边能确定具体版本"的常见情况（`=1.2.3` / `1.2.3`），
 * 其余情况按"可能重叠"处理——这是**警告**用的，不参与安全判断。
 */
export function rangesOverlap(a: string, b: string): boolean {
  const left = tryParseVpmRange(a)
  const right = tryParseVpmRange(b)
  if (!left || !right) return true
  const exactLeft = exactVpmRangeVersion(left)
  const exactRight = exactVpmRangeVersion(right)
  if (exactLeft) return satisfiesVpmRange(exactLeft, right, { includePrerelease: true })
  if (exactRight) return satisfiesVpmRange(exactRight, left, { includePrerelease: true })
  return true
}

export interface TemplateResolution {
  manifest: TemplateManifest
  /** 从最底层 base 到当前模板的 id 链。 */
  chain: string[]
}

export type TemplateResolveResult =
  | { ok: true; resolution: TemplateResolution }
  | { ok: false; issues: TemplateIssue[] }

/**
 * 解析模板（含 base 继承）。`lookup` 返回**原始**清单（未解析）。
 *
 * 规则：先递归解析 base，再与当前合并；深度 ≤8；检测循环与缺失 base。
 */
export function resolveTemplate(
  id: string,
  lookup: (id: string) => TemplateManifest | null
): TemplateResolveResult {
  const chain: string[] = []
  const issues: TemplateIssue[] = []

  const walk = (currentId: string, depth: number, seen: Set<string>): TemplateManifest | null => {
    if (depth > TEMPLATE_MAX_DEPTH) {
      issues.push(issue('depth', 'base', `>${TEMPLATE_MAX_DEPTH}`))
      return null
    }
    if (seen.has(currentId)) {
      issues.push(issue('cycle', 'base', currentId))
      return null
    }
    seen.add(currentId)
    const manifest = lookup(currentId)
    if (!manifest) {
      issues.push(issue('missingBase', 'base', currentId))
      return null
    }
    chain.push(currentId)
    if (!manifest.base) return manifest
    const base = walk(manifest.base, depth + 1, seen)
    if (!base) return null
    const merged = mergeTemplate(base, manifest)
    if (!merged) {
      issues.push(issue('unityRange', 'unity', 'empty intersection'))
      return null
    }
    return merged
  }

  const merged = walk(id, 0, new Set())
  if (!merged || issues.length) return { ok: false, issues }
  return { ok: true, resolution: { manifest: merged, chain } }
}

/**
 * base → child 合并：依赖同名覆盖、附件追加、Unity 范围取交集、settings 浅合并。
 * 交集为空返回 `null`（调用方按 `unityRange` 报错）。
 */
export function mergeTemplate(
  base: TemplateManifest,
  child: TemplateManifest
): TemplateManifest | null {
  const unity = intersectUnityRange(base.unity, child.unity)
  if (!unity) return null
  const attachments = [...base.unitypackages]
  const seen = new Set(attachments.map((item) => item.path.toLowerCase()))
  for (const item of child.unitypackages) {
    if (seen.has(item.path.toLowerCase())) continue
    seen.add(item.path.toLowerCase())
    attachments.push(item)
  }
  return {
    ...child,
    unity,
    dependencies: { ...base.dependencies, ...child.dependencies },
    unitypackages: attachments,
    settings: { ...base.settings, ...child.settings }
  }
}
