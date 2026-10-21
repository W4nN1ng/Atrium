import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { compareVpmVersions } from '../../../shared/vpm/domain/version'
import { VpmError, type VpmErrorCode } from '../../../shared/vpm/errors'
import type { VpmDb } from '../db'

const MAX_JSON_BYTES = 2 * 1024 * 1024
const UNITY_VERSION = /(?:^|\s)(\d{4}\.\d+\.\d+[abfp]\d+(?:c\d+)?)(?=$|\s|\()/

export type UnityInstallSource = 'hub' | 'manual' | 'scan'
export type UnityArch = 'x86_64' | 'arm64' | 'x86'

export interface UnityInstall {
  id: string
  path: string
  version: string | null
  versionWithRevision: string | null
  source: UnityInstallSource
  /** 未知架构按 x86_64 显示，但 `archInferred` 为 true；数据库里仍存 null。 */
  arch: UnityArch
  archInferred: boolean
  versionUnknown: boolean
  missing: boolean
  lastSeenAt: number | null
}

export interface UnityManualInput {
  path: string
  version?: string
  revision?: string
  arch?: string
}

export interface UnityDiscoveryOptions {
  appDataDir?: string
  programFiles?: string[]
  localAppData?: string
  extraRoots?: string[]
  now?: () => number
}

export interface UnityDiscoveryWarning {
  code: VpmErrorCode
  source: 'hub' | 'scan'
  path: string | null
  detail: string | null
}

export interface UnityDiscoveryResult {
  installs: UnityInstall[]
  warnings: UnityDiscoveryWarning[]
}

export interface HubEditorRecord {
  location: string
  version: string | null
  revision: string | null
  arch: UnityArch | null
}

interface Candidate {
  path: string
  version: string | null
  versionWithRevision: string | null
  source: UnityInstallSource
  arch: UnityArch | null
  missing: boolean
  lastSeenAt: number | null
}

interface UnityDbRow {
  id: string
  path: string
  version: string | null
  version_with_revision: string | null
  source: string
  arch: string | null
  last_seen_at: number | null
  missing: number
}

function warning(
  code: VpmErrorCode,
  source: 'hub' | 'scan',
  target: string | null,
  detail: unknown = null
): UnityDiscoveryWarning {
  return {
    code,
    source,
    path: target,
    detail: detail instanceof Error ? detail.message.slice(0, 240) : detail ? String(detail).slice(0, 240) : null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (isRecord(value)) return strings(value.path ?? value.location ?? value.executablePath)
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) out.push(...strings(item))
  return out
}

export function parseUnityVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  const match = UNITY_VERSION.exec(text)
  return match ? match[1] : null
}

export function parseUnityArch(value: unknown): UnityArch | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'x86_64' || normalized === 'x64' || normalized === 'amd64' || normalized === 'win64') {
    return 'x86_64'
  }
  if (normalized === 'arm64' || normalized === 'aarch64') return 'arm64'
  if (normalized === 'x86' || normalized === 'win32' || normalized === 'i386') return 'x86'
  return null
}

export function parseHubEditorRecords(value: unknown): HubEditorRecord[] {
  const out: HubEditorRecord[] = []
  const seen = new Set<string>()

  const walk = (node: unknown, depth: number): void => {
    if (depth > 5 || node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (!isRecord(node)) return

    const locations = strings(
      node.location ?? node.path ?? node.editorPath ?? node.installPath ?? node.executablePath ?? node.exePath
    )
    const version = parseUnityVersion(
      firstString(node, ['version', 'versionWithRevision', 'editorVersion', 'versionString'])
    )
    const revision = firstString(node, ['revision', 'changeset', 'hash'])
    const arch = parseUnityArch(firstString(node, ['architecture', 'arch', 'platform']))

    for (const location of locations) {
      const key = `${pathKey(location)}\0${version ?? ''}\0${revision ?? ''}\0${arch ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ location, version, revision, arch })
    }

    for (const key of ['editors', 'editorsV2', 'installations', 'versions', 'items', 'entries']) {
      walk(node[key], depth + 1)
    }
  }

  walk(value, 0)
  return out
}

export function parseInstallRoots(value: unknown): string[] {
  const out: string[] = []
  const walk = (node: unknown, depth: number): void => {
    if (depth > 3 || node === null || node === undefined) return
    if (typeof node === 'string') {
      if (node.trim()) out.push(node.trim())
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (!isRecord(node)) return
    for (const key of [
      'path',
      'installPath',
      'secondaryInstallPath',
      'editorInstallPath',
      'root',
      'editorRoot'
    ]) {
      walk(node[key], depth + 1)
    }
    for (const key of ['paths', 'roots', 'installPaths', 'editorRoots']) {
      walk(node[key], depth + 1)
    }
  }
  walk(value, 0)
  return out
}

function pathKey(value: string): string {
  return path.resolve(value).replace(/[\\/]+$/, '').toLowerCase()
}

function canonicalPath(value: string): string {
  let resolved = path.resolve(value)
  try {
    resolved = fs.realpathSync.native(resolved)
  } catch {
    /* 不存在/无权限时保留 resolve 结果；读取阶段会给出状态 */
  }
  return resolved.replace(/[\\/]+$/, '') || resolved
}

function stableId(value: string): string {
  const digest = createHash('sha256').update(pathKey(value)).digest('hex')
  return `unity-${digest.slice(0, 24)}`
}

function versionWithRevision(version: string | null, revision: string | null): string | null {
  if (!version) return null
  return revision ? `${version} (${revision})` : version
}

function inferVersion(value: string): string | null {
  const parts = value.split(/[\\/]+/).reverse()
  for (const part of parts) {
    const version = parseUnityVersion(part)
    if (version) return version
  }
  return null
}

function inferArch(value: string): UnityArch | null {
  const normalized = value.toLowerCase()
  if (/[\\/](arm64|aarch64)[\\/]/.test(normalized)) return 'arm64'
  if (/[\\/](x86|win32)[\\/]/.test(normalized)) return 'x86'
  if (/[\\/](x86_64|x64|amd64)[\\/]/.test(normalized)) return 'x86_64'
  return null
}

function resolveExe(location: string): string {
  const normalized = path.resolve(location)
  if (/unity\.exe$/i.test(normalized)) return normalized
  if (path.basename(normalized).toLowerCase() === 'editor') {
    return path.join(normalized, 'Unity.exe')
  }
  try {
    if (fs.statSync(normalized).isDirectory()) {
      const direct = path.join(normalized, 'Unity.exe')
      if (isFile(direct)) return direct
      return path.join(normalized, 'Editor', 'Unity.exe')
    }
  } catch {
    /* 缺失记录也要保留路径；下面按默认布局推断 */
  }
  return path.join(normalized, 'Editor', 'Unity.exe')
}

function isFile(file: string): boolean {
  try {
    return fs.lstatSync(file).isFile()
  } catch {
    return false
  }
}

function inspectExe(
  file: string,
  source: 'hub' | 'scan',
  warnings: UnityDiscoveryWarning[]
): { exists: boolean; missing: boolean } {
  if (path.basename(file).toLowerCase() !== 'unity.exe') {
    warnings.push(warning('vpmUnityInvalid', source, file, 'expected Unity.exe'))
    return { exists: false, missing: true }
  }
  try {
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink()) {
      warnings.push(warning('vpmUnityInvalid', source, file, 'symbolic link'))
      return { exists: false, missing: true }
    }
    if (!stat.isFile()) {
      warnings.push(warning('vpmUnityInvalid', source, file, 'not a file'))
      return { exists: false, missing: true }
    }
    return { exists: true, missing: false }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      warnings.push(warning('vpmUnityNotFound', source, file))
    } else if (code === 'EACCES' || code === 'EPERM') {
      warnings.push(warning('vpmUnityAccessDenied', source, file))
    } else {
      warnings.push(warning('vpmUnityInvalid', source, file, error))
    }
    return { exists: false, missing: true }
  }
}

function candidate(
  file: string,
  source: 'hub' | 'scan',
  input: { version?: string | null; revision?: string | null; arch?: UnityArch | null; at: number },
  warnings: UnityDiscoveryWarning[]
): Candidate | null {
  const exe = canonicalPath(resolveExe(file))
  const inspected = inspectExe(exe, source, warnings)
  const version = parseUnityVersion(input.version) ?? inferVersion(exe)
  const arch = parseUnityArch(input.arch) ?? inferArch(exe)
  return {
    path: exe,
    version,
    versionWithRevision: versionWithRevision(version, input.revision ?? null),
    source,
    arch,
    missing: inspected.missing,
    lastSeenAt: input.at
  }
}

function mergeCandidates(a: Candidate, b: Candidate): Candidate {
  const priority: Record<UnityInstallSource, number> = { manual: 3, hub: 2, scan: 1 }
  const primary = priority[b.source] > priority[a.source] ? b : a
  const secondary = primary === a ? b : a
  return {
    path: primary.path,
    version: primary.version ?? secondary.version,
    versionWithRevision: primary.versionWithRevision ?? secondary.versionWithRevision,
    source: primary.source,
    arch: primary.arch ?? secondary.arch,
    missing: a.missing && b.missing,
    lastSeenAt: Math.max(a.lastSeenAt ?? 0, b.lastSeenAt ?? 0) || null
  }
}

function readJson(
  file: string,
  source: 'hub' | 'scan',
  warnings: UnityDiscoveryWarning[]
): unknown {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile()) return null
    if (stat.size > MAX_JSON_BYTES) {
      warnings.push(warning('vpmUnityInvalid', source, file, 'json too large'))
      return null
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    if (code === 'EACCES' || code === 'EPERM') {
      warnings.push(warning('vpmUnityAccessDenied', source, file))
    } else {
      warnings.push(warning('vpmUnityInvalid', source, file, error))
    }
    return null
  }
}

function defaultAppDataDir(): string {
  return process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
}

function defaultLocalAppDataDir(): string {
  return process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Local')
}

function defaultProgramFiles(): string[] {
  return [...new Set(
    [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
      .filter((value): value is string => Boolean(value && path.isAbsolute(value)))
  )]
}

function scanRoot(
  root: string,
  at: number,
  warnings: UnityDiscoveryWarning[]
): Candidate[] {
  const normalized = canonicalPath(root)
  let entries: fs.Dirent[]
  try {
    const stat = fs.lstatSync(normalized)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return []
    entries = fs.readdirSync(normalized, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') {
      warnings.push(warning('vpmUnityAccessDenied', 'scan', normalized))
    }
    return []
  }

  const out: Candidate[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(normalized, entry.name)
    try {
      if (fs.lstatSync(dir).isSymbolicLink()) continue
    } catch {
      continue
    }
    const version = parseUnityVersion(entry.name) ?? inferVersion(dir)
    const choices = [path.join(dir, 'Editor', 'Unity.exe'), path.join(dir, 'Unity.exe')]
    const exe = choices.find((choice) => isFile(choice))
    if (!exe) continue
    const item = candidate(exe, 'scan', { version, at }, warnings)
    if (item) out.push(item)
  }

  // 自定义根有时直接就是某个编辑器的安装根，而不是“版本目录”的父目录。
  const direct = [path.join(normalized, 'Editor', 'Unity.exe'), path.join(normalized, 'Unity.exe')]
  const directExe = direct.find((choice) => isFile(choice))
  if (directExe) {
    const item = candidate(directExe, 'scan', { version: inferVersion(normalized), at }, warnings)
    if (item) out.push(item)
  }
  return out
}

/**
 * 只读发现 Unity 编辑器。
 *
 * 来源优先级：manual（仓储内人工记录）> hub（Hub 清单）> scan（默认/自定义安装根）。
 * 不启动 Unity；版本优先用 Hub 记录，其次路径目录名；架构缺少时留给 DTO 推断。
 */
export function discoverUnityEditors(options: UnityDiscoveryOptions = {}): UnityDiscoveryResult {
  const at = (options.now ?? Date.now)()
  const warnings: UnityDiscoveryWarning[] = []
  const installsByKey = new Map<string, Candidate>()

  const add = (item: Candidate | null): void => {
    if (!item) return
    const key = pathKey(item.path)
    const existing = installsByKey.get(key)
    installsByKey.set(key, existing ? mergeCandidates(existing, item) : item)
  }

  const appDataDir = options.appDataDir ?? defaultAppDataDir()
  const hubDir = path.join(appDataDir, 'UnityHub')
  const hubFiles = [path.join(hubDir, 'editors-v2.json'), path.join(hubDir, 'editors.json')]
  for (const file of hubFiles) {
    const value = readJson(file, 'hub', warnings)
    for (const record of parseHubEditorRecords(value)) {
      add(
        candidate(
          record.location,
          'hub',
          { version: record.version, revision: record.revision, arch: record.arch, at },
          warnings
        )
      )
    }
  }

  const roots = new Set<string>()
  for (const root of [
    ...(options.programFiles ?? defaultProgramFiles()).map((dir) => path.join(dir, 'Unity', 'Hub', 'Editor')),
    path.join(options.localAppData ?? defaultLocalAppDataDir(), 'Unity', 'Hub', 'Editor')
  ]) {
    if (path.isAbsolute(root)) roots.add(path.resolve(root))
  }

  for (const file of ['secondaryInstallPath.json', 'settings.json']) {
    const value = readJson(path.join(hubDir, file), 'hub', warnings)
    for (const root of parseInstallRoots(value)) {
      if (path.isAbsolute(root)) roots.add(path.resolve(root))
    }
  }
  for (const root of options.extraRoots ?? []) {
    if (path.isAbsolute(root)) roots.add(path.resolve(root))
  }

  for (const root of roots) {
    for (const item of scanRoot(root, at, warnings)) add(item)
  }

  const installs = [...installsByKey.values()]
    .map((item) => toInstall(item))
    .sort(compareInstalls)
  return { installs, warnings }
}

function toInstall(item: Candidate): UnityInstall {
  const arch = item.arch ?? 'x86_64'
  return {
    id: stableId(item.path),
    path: item.path,
    version: item.version,
    versionWithRevision: item.versionWithRevision,
    source: item.source,
    arch,
    archInferred: item.arch === null,
    versionUnknown: item.version === null,
    missing: item.missing,
    lastSeenAt: item.lastSeenAt
  }
}

function compareInstalls(a: UnityInstall, b: UnityInstall): number {
  if (a.missing !== b.missing) return a.missing ? 1 : -1
  if (a.version === null && b.version === null) return a.path.localeCompare(b.path)
  if (a.version === null) return 1
  if (b.version === null) return -1
  const compared = compareVpmVersions(a.version, b.version)
  if (compared !== 0) return -compared
  return (a.versionWithRevision ?? a.version).localeCompare(b.versionWithRevision ?? b.version)
}

function mapRow(row: UnityDbRow): UnityInstall {
  const arch = parseUnityArch(row.arch)
  return {
    id: row.id,
    path: row.path,
    version: row.version,
    versionWithRevision: row.version_with_revision,
    source: (['hub', 'manual', 'scan'].includes(row.source) ? row.source : 'scan') as UnityInstallSource,
    arch: arch ?? 'x86_64',
    archInferred: arch === null,
    versionUnknown: row.version === null,
    missing: row.missing === 1,
    lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at)
  }
}

/**
 * vpm_unity_install 的唯一 SQL 入口。
 *
 * 合并策略：同一路径只留一条；手动记录优先保留 source/版本覆盖；
 * 未在本轮发现中的记录只标 missing，不删除。
 */
export class UnityInstallStore {
  constructor(
    private readonly db: VpmDb,
    private readonly now: () => number = Date.now
  ) {}

  list(): UnityInstall[] {
    const rows = this.db
      .prepare('SELECT * FROM vpm_unity_install')
      .all() as UnityDbRow[]
    return rows.map(mapRow).sort(compareInstalls)
  }

  getByPath(file: string): UnityInstall | null {
    const row = this.db
      .prepare('SELECT * FROM vpm_unity_install WHERE path = ?')
      .get(canonicalPath(file)) as UnityDbRow | undefined
    return row ? mapRow(row) : null
  }

  merge(discovered: readonly UnityInstall[], markMissing = true): UnityInstall[] {
    const at = this.now()
    const seen = new Set<string>()
    const candidates = discovered.map((item) => ({
      path: canonicalPath(item.path),
      version: item.version,
      versionWithRevision: item.versionWithRevision ?? versionWithRevision(item.version, null),
      source: item.source,
      arch: item.archInferred ? null : item.arch,
      missing: item.missing,
      lastSeenAt: item.lastSeenAt ?? at
    }))

    const write = this.db.transaction(() => {
      for (const item of candidates) {
        this.upsert(item)
        seen.add(pathKey(item.path))
      }
      if (markMissing) {
        const rows = this.db.prepare('SELECT id, path FROM vpm_unity_install').all() as Array<{
          id: string
          path: string
        }>
        const mark = this.db.prepare('UPDATE vpm_unity_install SET missing = 1 WHERE id = ?')
        for (const row of rows) {
          if (!seen.has(pathKey(row.path))) mark.run(row.id)
        }
      }
    })
    write()
    return this.list()
  }

  addManual(input: UnityManualInput): UnityInstall {
    if (!input || typeof input !== 'object' || typeof input.path !== 'string' || !input.path.trim()) {
      throw new VpmError('vpmUnityInvalid', { field: 'path' })
    }
    const file = canonicalPath(resolveExe(input.path))
    if (path.basename(file).toLowerCase() !== 'unity.exe') {
      throw new VpmError('vpmUnityInvalid', { field: 'path' })
    }
    try {
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new VpmError('vpmUnityInvalid', { field: 'path' })
    } catch (error) {
      if (error instanceof VpmError) throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new VpmError('vpmUnityNotFound', { field: 'path' })
      if (code === 'EACCES' || code === 'EPERM') throw new VpmError('vpmUnityAccessDenied', { field: 'path' })
      throw new VpmError('vpmUnityInvalid', { field: 'path' }, error)
    }

    const version = parseUnityVersion(input.version) ?? inferVersion(file)
    if (!version) throw new VpmError('vpmUnityVersionUnknown', { field: 'version' })
    if (input.version !== undefined && !parseUnityVersion(input.version)) {
      throw new VpmError('vpmUnityInvalid', { field: 'version' })
    }
    const revision =
      typeof input.revision === 'string' && input.revision.trim()
        ? input.revision.trim().slice(0, 100)
        : null
    const rawArch = input.arch === undefined ? null : parseUnityArch(input.arch)
    if (input.arch !== undefined && rawArch === null) {
      throw new VpmError('vpmUnityInvalid', { field: 'arch' })
    }
    const existing = this.getByPath(file)
    const arch = rawArch ?? (existing && !existing.archInferred ? existing.arch : null)
    this.upsert({
      path: file,
      version,
      versionWithRevision: versionWithRevision(version, revision),
      source: 'manual',
      arch,
      missing: false,
      lastSeenAt: this.now()
    })
    return this.getByPath(file) as UnityInstall
  }

  private upsert(item: Candidate): void {
    const existing = this.db
      .prepare('SELECT * FROM vpm_unity_install WHERE path = ?')
      .get(item.path) as UnityDbRow | undefined
    const source = existing?.source === 'manual' ? 'manual' : item.source
    const version = item.version ?? existing?.version ?? null
    const versionRev = item.versionWithRevision ?? existing?.version_with_revision ?? null
    const arch = item.arch ?? parseUnityArch(existing?.arch) ?? null
    const id = existing?.id ?? stableId(item.path)
    this.db
      .prepare(
        `INSERT INTO vpm_unity_install
          (id, path, version, version_with_revision, source, arch, last_seen_at, missing)
         VALUES
          (@id, @path, @version, @versionWithRevision, @source, @arch, @lastSeenAt, @missing)
         ON CONFLICT(path) DO UPDATE SET
          version = excluded.version,
          version_with_revision = excluded.version_with_revision,
          source = excluded.source,
          arch = excluded.arch,
          last_seen_at = excluded.last_seen_at,
          missing = excluded.missing`
      )
      .run({
        id,
        path: item.path,
        version,
        versionWithRevision: versionRev,
        source,
        arch,
        lastSeenAt: item.lastSeenAt ?? this.now(),
        missing: item.missing ? 1 : 0
      })
  }
}

/** P2-C/P5 只需要的只读入口。 */
export function listUnityInstalls(db: VpmDb): UnityInstall[] {
  return new UnityInstallStore(db).list()
}

/**
 * 应用服务：发现/手动添加都写同一个仓储。
 * `refresh` 不启动 Unity，也不因单个 Hub 文件坏掉而失败。
 */
export class UnityEditorService {
  constructor(
    private readonly store: UnityInstallStore,
    private readonly options: UnityDiscoveryOptions = {}
  ) {}

  list(): UnityInstall[] {
    return this.store.list()
  }

  refresh(): UnityDiscoveryResult {
    const result = discoverUnityEditors(this.options)
    return { installs: this.store.merge(result.installs), warnings: result.warnings }
  }

  addManual(input: UnityManualInput): UnityInstall {
    return this.store.addManual(input)
  }
}
