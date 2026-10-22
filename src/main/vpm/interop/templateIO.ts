import { VpmError } from '../../../shared/vpm/errors'
import type { TemplateAttachment, TemplateManifest, TemplateUnityRange } from '../../../shared/vpm/domain/template'

/**
 * 模板导入/导出（P7-D）。
 *
 * 只做**格式转换**，不碰磁盘、不写库：
 * - 导入：接受 Atrium 自有格式，也接受"别的工具"常见的几种字段名（宽容但不猜内容）；
 * - 导出：只产出 Atrium 自有格式（`schemaVersion` + `id` + …），
 *   不注册全局文件关联、不复制附件。
 */

export const ATRIUM_TEMPLATE_SCHEMA = 1

export type TemplateSource = 'atrium' | 'foreign'

export interface ImportedTemplate {
  source: TemplateSource
  manifest: TemplateManifest
  /** 导入时被忽略的字段（给界面提示"有些东西没带过来"）。 */
  ignored: string[]
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown, max = 200): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function unityRange(value: unknown): TemplateUnityRange {
  const record = asRecord(value)
  const min = text(record?.min, 32) ?? text(value, 32) ?? '2022.3'
  return {
    min,
    max: text(record?.max, 32),
    recommended: text(record?.recommended, 32)
  }
}

function dependenciesOf(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  const out: Record<string, string> = {}
  for (const [name, version] of Object.entries(record)) {
    if (typeof version === 'string' && version.trim()) out[name] = version.trim()
  }
  return out
}

function attachmentsOf(value: unknown): TemplateAttachment[] {
  if (!Array.isArray(value)) return []
  const out: TemplateAttachment[] = []
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      out.push({ path: entry.trim(), name: null })
      continue
    }
    const record = asRecord(entry)
    const path = text(record?.path ?? record?.file, 500)
    if (!path) continue
    out.push({ path, name: text(record?.name, 200) })
  }
  return out
}

function slug(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'template'
}

/**
 * 解析一份模板文件。
 *
 * 认两种：
 * 1. Atrium 自有：带 `schemaVersion` 与 `name`；
 * 2. 外部（例如 ALCOM 的 `.alcomtemplate`）：只有 `name` + `packages`/`dependencies`。
 *
 * 缺 `name` 直接拒绝——模板没名字没法在列表里认。
 */
export function parseTemplateFile(input: unknown, fallbackName = 'imported'): ImportedTemplate {
  const record = asRecord(input)
  if (!record) throw new VpmError('vpmTemplateInvalid', { reason: 'notObject' })

  const name = text(record.name, 120) ?? text(record.displayName, 120) ?? text(fallbackName, 120)
  if (!name) throw new VpmError('vpmTemplateInvalid', { reason: 'name' })

  const source: TemplateSource =
    typeof record.schemaVersion === 'number' ? 'atrium' : 'foreign'
  const ignored: string[] = []

  // 依赖：Atrium 用 `dependencies`，外部常见 `packages`（数组或对象）
  let dependencies = dependenciesOf(record.dependencies)
  if (Object.keys(dependencies).length === 0 && record.packages !== undefined) {
    const packages = record.packages
    if (Array.isArray(packages)) {
      const map: Record<string, string> = {}
      for (const entry of packages) {
        if (typeof entry === 'string' && entry.includes('@')) {
          const at = entry.lastIndexOf('@')
          map[entry.slice(0, at)] = entry.slice(at + 1)
          continue
        }
        const item = asRecord(entry)
        const packageName = text(item?.name, 200)
        const version = text(item?.version, 64)
        if (packageName && version) map[packageName] = version
      }
      dependencies = map
    } else {
      dependencies = dependenciesOf(packages)
    }
  }

  const unityValue = record.unity ?? record.unityVersion ?? record.unityRange
  const unity = unityRange(
    typeof unityValue === 'string' ? { min: unityValue } : unityValue
  )

  const manifest: TemplateManifest = {
    schemaVersion: ATRIUM_TEMPLATE_SCHEMA,
    id: text(record.id, 120) ?? slug(name),
    name,
    description: text(record.description, 1000),
    base: text(record.base, 200),
    unity,
    dependencies,
    unitypackages: attachmentsOf(record.unitypackages ?? record.unityPackages),
    settings: asRecord(record.settings) ?? {},
    extra: {}
  }

  for (const key of Object.keys(record)) {
    if (!['schemaVersion', 'id', 'name', 'displayName', 'description', 'base', 'unity', 'unityVersion', 'unityRange', 'dependencies', 'packages', 'unitypackages', 'unityPackages', 'settings'].includes(key)) {
      ignored.push(key)
    }
  }
  if (source === 'foreign' && record.schemaVersion !== undefined) ignored.push('schemaVersion')

  return { source, manifest, ignored }
}

/** 导出成 Atrium 自有模板文件内容（pretty JSON，带 schemaVersion）。 */
export function exportTemplate(manifest: TemplateManifest): string {
  const payload = {
    schemaVersion: ATRIUM_TEMPLATE_SCHEMA,
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    base: manifest.base,
    unity: manifest.unity,
    dependencies: manifest.dependencies,
    unitypackages: manifest.unitypackages,
    settings: manifest.settings
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}
