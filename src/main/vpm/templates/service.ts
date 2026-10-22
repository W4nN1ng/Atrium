import fs from 'node:fs'
import path from 'node:path'
import {
  isValidTemplateId,
  parseTemplateManifest,
  resolveTemplate,
  serializeTemplateManifest,
  type TemplateIssue,
  type TemplateManifest
} from '../../../shared/vpm/domain/template'
import { VpmError } from '../../../shared/vpm/errors'
import { ulid } from '../../../shared/ulid'
import type { VpmDb } from '../db'
import { writeFileAtomic } from '../fsUtil'
import { BUILTIN_TEMPLATES, builtinTemplate } from './builtin'
import { TemplateStore } from './store'
import type {
  CreateTemplateInput,
  TemplateListEntry,
  TemplateListOptions,
  TemplateRow,
  UpdateTemplateInput
} from './types'

export interface TemplateServiceOptions {
  db: VpmDb
  /** 非 C 数据根；模板文件写 `<dataRoot>/templates/<id>/`。 */
  dataRoot: string
  now?: () => number
}

export interface ResolvedTemplate {
  manifest: TemplateManifest
  /** 从最底层 base 到当前模板。 */
  chain: string[]
}

const MANIFEST_FILE = 'template.json'
const FILES_DIR = 'files'

function toEntry(
  manifest: TemplateManifest,
  meta: { favorite: boolean; visible: boolean; lastUsedAt: number | null; createdAt: number; updatedAt: number; source: TemplateListEntry['source']; builtin: boolean },
  broken = false,
  issues: string[] = []
): TemplateListEntry {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    source: meta.source,
    base: manifest.base,
    unity: manifest.unity,
    dependencies: manifest.dependencies,
    unitypackages: manifest.unitypackages,
    favorite: meta.favorite,
    visible: meta.visible,
    lastUsedAt: meta.lastUsedAt,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    builtin: meta.builtin,
    broken,
    issues
  }
}

function issueSummary(issues: readonly TemplateIssue[]): string {
  return issues.map((item) => `${item.code}:${item.field}`).join(', ').slice(0, 400)
}

/**
 * 模板服务（P5-A）。
 *
 * - 内置模板：代码生成，不落盘、不入库、不可改。
 * - 用户模板：`<dataRoot>/templates/<id>/template.json`（+ 可选 `files/`），
 *   数据库只存索引（收藏/可见/最近使用）。
 * - 删除 = `visible=0`，**永远不动用户文件**；要真删由用户自己动手（P5-D 给入口）。
 */
export class TemplateService {
  private readonly store: TemplateStore
  private readonly root: string

  constructor(private readonly options: TemplateServiceOptions) {
    this.store = new TemplateStore(options.db, options.now)
    this.root = path.join(options.dataRoot, 'templates')
  }

  /** `<dataRoot>/templates`；P5-B/C 从这里取附件。 */
  get templatesRoot(): string {
    return this.root
  }

  filesDir(id: string): string {
    this.assertId(id)
    return path.join(this.root, id, FILES_DIR)
  }

  manifestPath(id: string): string {
    this.assertId(id)
    return path.join(this.root, id, MANIFEST_FILE)
  }

  list(options: TemplateListOptions = {}): TemplateListEntry[] {
    const builtins = BUILTIN_TEMPLATES.map((manifest) =>
      toEntry(manifest, {
        favorite: false,
        visible: true,
        lastUsedAt: null,
        createdAt: 0,
        updatedAt: 0,
        source: 'builtin',
        builtin: true
      })
    )
    const rows = this.store.list(options.includeHidden)
    const userEntries = rows.map((row) => this.entryFromRow(row))
    userEntries.sort(compareEntries)
    return [...builtins, ...userEntries]
  }

  get(id: string): ResolvedTemplate {
    this.assertId(id)
    if (!builtinTemplate(id)) {
      if (!this.store.get(id)) throw new VpmError('vpmTemplateNotFound', { id })
      // 文件才是真相：坏了/没了都报"模板不合法"，不要说成"找不到模板"。
      const parsed = this.readManifestResult(id)
      if (!parsed.ok) throw new VpmError('vpmTemplateInvalid', { reason: issueSummary(parsed.issues) })
    }
    const result = resolveTemplate(id, this.lookup())
    if (!result.ok) {
      const missingBase = result.issues.find((item) => item.code === 'missingBase')
      throw missingBase
        ? new VpmError('vpmTemplateNotFound', { id: missingBase.detail ?? id })
        : new VpmError('vpmTemplateInvalid', { reason: issueSummary(result.issues) })
    }
    return result.resolution
  }

  /** 原始清单（不解析 base）；内置模板直接从代码取。 */
  raw(id: string): TemplateManifest | null {
    this.assertId(id)
    return this.lookup()(id)
  }

  create(input: CreateTemplateInput): TemplateListEntry {
    const id = input.id ?? ulid()
    this.assertId(id)
    if (this.store.get(id) || builtinTemplate(id)) {
      throw new VpmError('vpmTemplateInvalid', { reason: `id exists: ${id}` })
    }
    const manifest = this.buildManifest(id, input)
    this.assertBaseExists(manifest)
    this.writeManifest(id, manifest)
    const row = this.upsertRow(manifest, 'user')
    return this.entryFromRow(row)
  }

  update(id: string, patch: UpdateTemplateInput): TemplateListEntry {
    this.assertId(id)
    if (builtinTemplate(id)) throw new VpmError('vpmTemplateReadOnly', { id })
    const row = this.requireUserTemplate(id)
    const current = this.readManifest(id)
    const merged = this.buildManifest(id, {
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      base: patch.base === undefined ? current.base : patch.base,
      unity: { ...current.unity, ...(patch.unity ?? {}) },
      dependencies: patch.dependencies ?? current.dependencies,
      unitypackages: patch.unitypackages ?? current.unitypackages,
      settings: patch.settings ?? current.settings
    })
    // 保留未知字段
    merged.extra = current.extra
    this.assertBaseExists(merged)
    this.writeManifest(id, merged)
    const saved = this.upsertRow(merged, row.source === 'imported' ? 'imported' : 'user')
    return this.entryFromRow(saved)
  }

  /** 复制一份（新 id）；内置模板也可以复制成用户模板。 */
  duplicate(id: string, name?: string): TemplateListEntry {
    this.assertId(id)
    const source = this.raw(id)
    if (!source) throw new VpmError('vpmTemplateNotFound', { id })
    const nextId = ulid()
    const manifest = this.buildManifest(nextId, {
      name: name?.trim() || `${source.name} #2`,
      description: source.description,
      base: source.base,
      unity: source.unity,
      dependencies: source.dependencies,
      unitypackages: source.unitypackages,
      settings: source.settings
    })
    manifest.extra = source.extra
    if (!source.id.startsWith('builtin.')) this.copyFiles(id, nextId)
    this.writeManifest(nextId, manifest)
    return this.entryFromRow(this.upsertRow(manifest, 'user'))
  }

  setFavorite(id: string, favorite: boolean): TemplateListEntry {
    this.assertId(id)
    if (builtinTemplate(id)) throw new VpmError('vpmTemplateReadOnly', { id })
    const row = this.store.setFavorite(id, favorite)
    if (!row) throw new VpmError('vpmTemplateNotFound', { id })
    return this.entryFromRow(row)
  }

  /** 删除引用：只是从列表隐藏，**不删文件**。 */
  removeReference(id: string): TemplateListEntry {
    this.assertId(id)
    if (builtinTemplate(id)) throw new VpmError('vpmTemplateReadOnly', { id })
    const row = this.store.setVisible(id, false)
    if (!row) throw new VpmError('vpmTemplateNotFound', { id })
    return this.entryFromRow(row)
  }

  restore(id: string): TemplateListEntry {
    this.assertId(id)
    if (builtinTemplate(id)) throw new VpmError('vpmTemplateReadOnly', { id })
    const row = this.store.setVisible(id, true)
    if (!row) throw new VpmError('vpmTemplateNotFound', { id })
    return this.entryFromRow(row)
  }

  markUsed(id: string): void {
    this.assertId(id)
    if (builtinTemplate(id)) return
    this.store.markUsed(id)
  }

  recentLocations(limit = 8): Array<{ path: string; lastUsedAt: number }> {
    return this.store.recentLocations(limit)
  }

  recordLocation(target: string): void {
    const value = typeof target === 'string' ? target.trim() : ''
    if (!value || value.includes('\0')) return
    this.store.recordLocation(value)
  }

  private entryFromRow(row: TemplateRow): TemplateListEntry {
    if (row.source === 'builtin') {
      const manifest = builtinTemplate(row.id)
      if (manifest) {
        return toEntry(manifest, {
          favorite: row.favorite,
          visible: row.visible,
          lastUsedAt: row.lastUsedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          source: 'builtin',
          builtin: true
        })
      }
    }
    const parsed = this.readManifestResult(row.id)
    if (parsed.ok && parsed.manifest) {
      return toEntry(
        parsed.manifest,
        {
          favorite: row.favorite,
          visible: row.visible,
          lastUsedAt: row.lastUsedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          source: row.source,
          builtin: false
        }
      )
    }
    // 文件坏了/没了：用行里的元数据兜底，并明确标成 broken。
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      source: row.source,
      base: row.baseId,
      unity: { min: '2022.3', max: null, recommended: null },
      dependencies: safeParse<Record<string, string>>(row.dependenciesJson, {}),
      unitypackages: safeParse(row.unitypackagesJson, []),
      favorite: row.favorite,
      visible: row.visible,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      builtin: false,
      broken: true,
      issues: parsed.issues.map((item) => `${item.code}:${item.field}`)
    }
  }

  private buildManifest(id: string, input: CreateTemplateInput): TemplateManifest {
    const raw = {
      schemaVersion: 1,
      id,
      name: input.name,
      description: input.description ?? null,
      base: input.base ?? null,
      unity: {
        min: input.unity?.min ?? '2022.3',
        max: input.unity?.max ?? null,
        recommended: input.unity?.recommended ?? null
      },
      dependencies: input.dependencies ?? {},
      unitypackages: input.unitypackages ?? [],
      settings: input.settings ?? {}
    }
    const parsed = parseTemplateManifest(raw)
    if (!parsed.ok || !parsed.manifest) {
      throw new VpmError('vpmTemplateInvalid', { reason: issueSummary(parsed.issues) })
    }
    return parsed.manifest
  }

  private writeManifest(id: string, manifest: TemplateManifest): void {
    const dir = path.join(this.root, id)
    try {
      fs.mkdirSync(path.join(dir, FILES_DIR), { recursive: true })
      writeFileAtomic(path.join(dir, MANIFEST_FILE), serializeTemplateManifest(manifest))
    } catch (error) {
      throw new VpmError('vpmTemplateWriteFailed', { id }, error)
    }
  }

  private readManifest(id: string): TemplateManifest {
    const parsed = this.readManifestResult(id)
    if (!parsed.ok || !parsed.manifest) {
      throw new VpmError('vpmTemplateInvalid', { reason: issueSummary(parsed.issues) })
    }
    return parsed.manifest
  }

  private readManifestResult(id: string): { ok: boolean; manifest: TemplateManifest | null; issues: TemplateIssue[] } {
    const file = path.join(this.root, id, MANIFEST_FILE)
    let text: string
    try {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return { ok: false, manifest: null, issues: [{ code: 'notObject', field: 'template.json', detail: 'notFile' }] }
      }
      text = fs.readFileSync(file, 'utf8')
    } catch {
      return { ok: false, manifest: null, issues: [{ code: 'notObject', field: 'template.json', detail: 'missing' }] }
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return { ok: false, manifest: null, issues: [{ code: 'notObject', field: 'template.json', detail: 'json' }] }
    }
    const parsed = parseTemplateManifest(value)
    if (parsed.manifest && parsed.manifest.id !== id) {
      parsed.issues.push({ code: 'id', field: 'id', detail: `expected ${id}` })
      return { ok: false, manifest: parsed.manifest, issues: parsed.issues }
    }
    return parsed
  }

  private upsertRow(manifest: TemplateManifest, source: TemplateRow['source']): TemplateRow {
    const existing = this.store.get(manifest.id)
    return this.store.upsert({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      source,
      format: 'atrium',
      baseId: manifest.base,
      unityRange: manifest.unity.max
        ? `${manifest.unity.min} - ${manifest.unity.max}`
        : manifest.unity.min,
      dependenciesJson: JSON.stringify(manifest.dependencies),
      unitypackagesJson: JSON.stringify(manifest.unitypackages),
      settingsJson: JSON.stringify(manifest.settings),
      favorite: existing?.favorite ?? false,
      visible: existing?.visible ?? true,
      lastUsedAt: existing?.lastUsedAt ?? null
    })
  }

  private requireUserTemplate(id: string): TemplateRow {
    const row = this.store.get(id)
    if (!row) throw new VpmError('vpmTemplateNotFound', { id })
    if (row.source === 'builtin') throw new VpmError('vpmTemplateReadOnly', { id })
    return row
  }

  private lookup(): (id: string) => TemplateManifest | null {
    const cache = new Map<string, TemplateManifest | null>()
    return (id: string): TemplateManifest | null => {
      if (cache.has(id)) return cache.get(id) ?? null
      const builtin = builtinTemplate(id)
      if (builtin) {
        cache.set(id, builtin)
        return builtin
      }
      const row = this.store.get(id)
      if (!row || !row.visible) {
        cache.set(id, null)
        return null
      }
      const parsed = this.readManifestResult(id)
      const manifest = parsed.ok ? parsed.manifest : null
      cache.set(id, manifest)
      return manifest
    }
  }

  private copyFiles(fromId: string, toId: string): void {
    const from = path.join(this.root, fromId, FILES_DIR)
    const to = path.join(this.root, toId, FILES_DIR)
    if (!fs.existsSync(from)) return
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const source = path.join(from, entry.name)
      const target = path.join(to, entry.name)
      if (entry.isDirectory()) copyDirectory(source, target)
      else if (entry.isFile()) fs.copyFileSync(source, target)
    }
  }

  private assertBaseExists(manifest: TemplateManifest): void {
    if (!manifest.base) return
    if (!this.raw(manifest.base)) {
      throw new VpmError('vpmTemplateInvalid', { reason: `base missing: ${manifest.base}` })
    }
  }

  private assertId(id: string): void {
    if (!isValidTemplateId(id)) throw new VpmError('vpmTemplateNotFound', { id })
  }
}

function copyDirectory(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyDirectory(source, target)
    else if (entry.isFile()) fs.copyFileSync(source, target)
  }
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

function compareEntries(a: TemplateListEntry, b: TemplateListEntry): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
  const left = a.lastUsedAt ?? 0
  const right = b.lastUsedAt ?? 0
  if (left !== right) return right - left
  return a.name.localeCompare(b.name)
}
