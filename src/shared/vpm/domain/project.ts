import { VpmError, type VpmErrorCode, type VpmWarningCode } from '../errors'
import { sha256Hex } from './hash'

export const PROTECTED_PROJECT_PACKAGE = 'com.avca.bridge'
const MAX_PACKAGE_JSON_BYTES = 256 * 1024
const DEFAULT_MAX_PACKAGES = 500
const DEFAULT_MAX_LEGACY_ENTRIES = 2000
const DEFAULT_MAX_LEGACY_DEPTH = 4
const IGNORED_LEGACY_DIRS = new Set(['library', 'temp', 'logs', 'obj', '.git', 'node_modules'])

export type ProjectWarningCode = VpmErrorCode | VpmWarningCode

export interface ProjectWarning {
  code: ProjectWarningCode
  path: string | null
  detail: string | null
}

export interface ProjectFsEntry {
  name: string
  kind: 'file' | 'dir'
  symlink: boolean
}

/** P2-C 的 fs 适配器实现；领域层只依赖这个窄端口，不碰 node:fs。 */
export interface ProjectReaderPort {
  read(relativePath: string): { text: string; mtime: number } | null
  list(relativePath: string): ProjectFsEntry[]
  stat(relativePath: string): ProjectFsEntry | null
}

export interface UnityProjectVersion {
  version: string
  revision: string | null
  versionWithRevision: string
}

export interface VpmLegacyEntry {
  packageId: string
  path: string
}

export interface VpmManifestSnapshot {
  hasManifest: boolean
  raw: string
  valid: boolean
  data: Record<string, unknown> | null
  dependencies: Record<string, string>
  locked: Record<string, unknown>
  legacyFolders: VpmLegacyEntry[]
  legacyFiles: VpmLegacyEntry[]
  legacyPackages: string[]
  error: string | null
}

export type ProjectPackageState = 'installed' | 'missing' | 'unlisted' | 'mismatch' | 'protected'

export interface ProjectPackageSnapshot {
  name: string
  displayName: string | null
  version: string | null
  manifestVersion: string | null
  source: 'embedded' | 'legacy'
  state: ProjectPackageState
  missing: boolean
  path: string
  unity: string | null
  vpmDependencies: Record<string, string>
}

export interface LegacyPackageCandidate {
  name: string | null
  relativePath: string | null
  match: 'packageJson' | 'legacyFolder' | 'legacyFile' | 'legacyPackage'
  confidence: 'high' | 'medium' | 'low'
  risk: 'backupRequired'
}

export interface LegacyPackageReport {
  readOnly: true
  scanned: number
  truncated: boolean
  candidates: LegacyPackageCandidate[]
}

export interface ProjectSnapshot {
  readOnly: true
  projectKey: string
  projectPath: string
  name: string
  projectSlug: string
  unityVersion: string
  unityRevision: string | null
  unityVersionWithRevision: string
  productGuid: string | null
  manifest: VpmManifestSnapshot
  manifestHash: string | null
  manifestMtime: number | null
  packages: ProjectPackageSnapshot[]
  legacy: LegacyPackageReport
  fingerprint: string
  warnings: ProjectWarning[]
}

export interface ProjectReadOptions {
  maxPackages?: number
  maxLegacyEntries?: number
  maxLegacyDepth?: number
}

export interface ProjectPackageJson {
  name: string
  displayName: string | null
  version: string | null
  unity: string | null
  vpmDependencies: Record<string, string>
  raw: string
}

const UNITY_VERSION = /^\d{4}\.\d+\.\d+[abfp]\d+(?:c\d+)?$/

function addWarning(
  warnings: ProjectWarning[],
  code: ProjectWarningCode,
  target: string | null,
  detail: unknown = null
): void {
  warnings.push({
    code,
    path: target,
    detail: detail instanceof Error ? detail.message.slice(0, 240) : detail ? String(detail).slice(0, 240) : null
  })
}

function codeOf(error: unknown, fallback: ProjectWarningCode): ProjectWarningCode {
  if (error instanceof VpmError) return error.code
  return fallback
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function sha256(text: string): string {
  return sha256Hex(text)
}

function windowsBasename(value: string): string {
  const normalized = value.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  return normalized.slice(index + 1) || normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function textOrNull(value: unknown, max = 100): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > max || /[\u0000-\u001f]/.test(text)) return null
  return text
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!key || typeof item !== 'string') continue
    const text = item.trim()
    if (text && text.length <= 200) out[key] = text
  }
  return out
}

/**
 * VPM manifest 的 dependencies 有两种写法：
 * - 旧版：`"com.vrchat.avatars": "3.10.5"`
 * - VCC/ALCOM 新版：`"com.vrchat.avatars": { "version": "3.10.5" }`
 *
 * 只读取版本范围；对象里的其它字段留在 `manifest.data` 里，构建时原样保留。
 */
function dependencyRange(value: unknown): string | null {
  const raw = typeof value === 'string' ? value : isRecord(value) ? value.version : null
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  return text && text.length <= 200 && !/[\u0000-\u001f]/.test(text) ? text : null
}

function manifestDependencyMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!key) continue
    const range = dependencyRange(item)
    if (range) out[key] = range
  }
  return out
}

function lockedVersionOf(value: unknown): string | null {
  if (!isRecord(value)) return null
  return dependencyRange(value)
}

function safeLegacyPath(value: string): string | null {
  let normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || /^[a-zA-Z]:/.test(normalized)) return null
  if (normalized.split('/').some((part) => part === '..')) return null
  normalized = normalized.replace(/^assets\//i, '')
  if (!normalized) return null
  return `Assets/${normalized}`
}

function legacyPaths(value: unknown): VpmLegacyEntry[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((path) => ({ packageId: '', path }))
  }
  if (!isRecord(value)) return []
  const out: VpmLegacyEntry[] = []
  for (const [packageId, item] of Object.entries(value)) {
    if (typeof item === 'string') out.push({ packageId, path: item })
    else if (Array.isArray(item)) {
      for (const entry of item) if (typeof entry === 'string') out.push({ packageId, path: entry })
    }
  }
  return out
}

function legacyPackages(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (isRecord(value)) return Object.keys(value)
  return []
}

export function normalizeProjectPath(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new VpmError('vpmProjectInvalid', { field: 'path' })
  const raw = value.trim()
  const unc = /^[\\/]{2}/.test(raw)
  if (!unc && !/^[a-zA-Z]:[\\/]/.test(raw)) {
    throw new VpmError('vpmProjectInvalid', { field: 'path' })
  }
  let normalized = raw.replace(/[\\/]+/g, '\\')
  if (unc) normalized = '\\\\' + normalized.replace(/^\\+/, '')
  if (normalized.length > 3) normalized = normalized.replace(/\\+$/, '')
  if (!normalized || normalized === '\\') throw new VpmError('vpmProjectInvalid', { field: 'path' })
  return normalized
}

export function projectKeyOf(projectPath: string): string {
  return normalizeProjectPath(projectPath).toLowerCase()
}

export function projectSlugOf(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath)
  const key = normalized.toLowerCase()
  const name = windowsBasename(key) || 'project'
  const safe = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 40) || 'project'
  return `${safe}-${sha256(key).slice(0, 8)}`
}

export function parseProjectVersion(text: string): UnityProjectVersion {
  const editor = /^\s*m_EditorVersion:\s*(\S+)\s*$/m.exec(text)?.[1] ?? null
  const withRevision = /^\s*m_EditorVersionWithRevision:\s*(.+?)\s*$/m.exec(text)?.[1] ?? null
  const fromRevision = withRevision ? /(\d{4}\.\d+\.\d+[abfp]\d+(?:c\d+)?)/.exec(withRevision)?.[1] ?? null : null
  const version = editor ?? fromRevision
  if (!version || !UNITY_VERSION.test(version)) {
    throw new VpmError('vpmProjectInvalid', { field: 'ProjectVersion.txt' })
  }
  const revision = withRevision ? /\(([^)]+)\)/.exec(withRevision)?.[1]?.trim() ?? null : null
  return {
    version,
    revision: revision || null,
    versionWithRevision: withRevision || version
  }
}

export function parseVpmManifest(text: string | null): VpmManifestSnapshot {
  if (text === null) {
    return {
      hasManifest: false,
      raw: '',
      valid: true,
      data: null,
      dependencies: {},
      locked: {},
      legacyFolders: [],
      legacyFiles: [],
      legacyPackages: [],
      error: null
    }
  }
  const raw = text
  try {
    const parsed = JSON.parse(stripBom(text)) as unknown
    if (!isRecord(parsed)) throw new Error('manifest is not an object')
    return {
      hasManifest: true,
      raw,
      valid: true,
      data: parsed,
      dependencies: manifestDependencyMap(parsed.dependencies),
      locked: isRecord(parsed.locked) ? parsed.locked : {},
      legacyFolders: legacyPaths(parsed.legacyFolders),
      legacyFiles: legacyPaths(parsed.legacyFiles),
      legacyPackages: legacyPackages(parsed.legacyPackages),
      error: null
    }
  } catch (error) {
    return {
      hasManifest: true,
      raw,
      valid: false,
      data: null,
      dependencies: {},
      locked: {},
      legacyFolders: [],
      legacyFiles: [],
      legacyPackages: [],
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function parseProjectPackageJson(text: string): ProjectPackageJson {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(text))
  } catch (error) {
    throw new VpmError('vpmProjectInvalid', { field: 'package.json' }, error)
  }
  if (!isRecord(parsed)) throw new VpmError('vpmProjectInvalid', { field: 'package.json' })
  const name = textOrNull(parsed.name, 214)
  if (!name || /[\\/]/.test(name)) throw new VpmError('vpmProjectInvalid', { field: 'package.name' })
  const displayName = textOrNull(parsed.displayName, 500)
  const version = textOrNull(parsed.version, 100)
  const unity = textOrNull(parsed.unity, 100)
  return {
    name,
    displayName,
    version,
    unity,
    vpmDependencies: stringMap(parsed.vpmDependencies),
    raw: text
  }
}

function readFile(
  port: ProjectReaderPort,
  relativePath: string,
  warnings: ProjectWarning[]
): { text: string; mtime: number } | null {
  try {
    return port.read(relativePath)
  } catch (error) {
    addWarning(warnings, codeOf(error, 'vpmProjectAccessDenied'), relativePath, error)
    return null
  }
}

function listDir(
  port: ProjectReaderPort,
  relativePath: string,
  warnings: ProjectWarning[],
  fallback: ProjectWarningCode
): ProjectFsEntry[] {
  try {
    return port.list(relativePath)
  } catch (error) {
    addWarning(warnings, codeOf(error, fallback), relativePath, error)
    return []
  }
}

function statPath(
  port: ProjectReaderPort,
  relativePath: string,
  warnings: ProjectWarning[]
): ProjectFsEntry | null {
  try {
    return port.stat(relativePath)
  } catch (error) {
    addWarning(warnings, codeOf(error, 'vpmProjectAccessDenied'), relativePath, error)
    return null
  }
}

function packageState(name: string, version: string | null, manifestVersion: string | null): ProjectPackageState {
  if (name === PROTECTED_PROJECT_PACKAGE) return 'protected'
  if (manifestVersion === null) return 'unlisted'
  if (version !== manifestVersion) return 'mismatch'
  return 'installed'
}

function readPackages(
  port: ProjectReaderPort,
  manifest: VpmManifestSnapshot,
  options: ProjectReadOptions,
  warnings: ProjectWarning[],
  rawFiles: Map<string, string>
): ProjectPackageSnapshot[] {
  const max = Math.max(1, Math.trunc(options.maxPackages ?? DEFAULT_MAX_PACKAGES))
  const rows = new Map<string, ProjectPackageSnapshot>()
  let scanned = 0
  const entries = listDir(port, 'Packages', warnings, 'vpmProjectPackagesUnreadable')

  for (const entry of entries) {
    if (entry.kind !== 'dir') continue
    if (entry.symlink) {
      addWarning(warnings, 'vpmProjectSymlinkSkipped', `Packages/${entry.name}`)
      continue
    }
    if (scanned >= max) {
      addWarning(warnings, 'vpmProjectScanTruncated', 'Packages')
      break
    }
    scanned++
    if (/[\\/]/.test(entry.name)) continue
    const relativePath = `Packages/${entry.name}/package.json`
    const file = readFile(port, relativePath, warnings)
    if (!file) continue
    if (file.text.length > MAX_PACKAGE_JSON_BYTES) {
      addWarning(warnings, 'vpmProjectPackageInvalid', relativePath, 'package.json too large')
      continue
    }
    let pkg: ProjectPackageJson
    try {
      pkg = parseProjectPackageJson(file.text)
    } catch (error) {
      addWarning(warnings, 'vpmProjectPackageInvalid', relativePath, error)
      continue
    }
    if (rows.has(pkg.name)) {
      addWarning(warnings, 'vpmProjectDuplicatePackage', relativePath, pkg.name)
      continue
    }
    const manifestVersion = manifest.dependencies[pkg.name] ?? lockedVersionOf(manifest.locked[pkg.name])
    rows.set(pkg.name, {
      name: pkg.name,
      displayName: pkg.displayName,
      version: pkg.version,
      manifestVersion,
      source: 'embedded',
      state: packageState(pkg.name, pkg.version, manifestVersion),
      missing: false,
      path: `Packages/${entry.name}`,
      unity: pkg.unity,
      vpmDependencies: pkg.vpmDependencies
    })
    rawFiles.set(pkg.name, file.text)
  }

  for (const [name, version] of Object.entries(manifest.dependencies)) {
    if (rows.has(name)) continue
    rows.set(name, {
      name,
      displayName: null,
      version: null,
      manifestVersion: version,
      source: 'embedded',
      state: name === PROTECTED_PROJECT_PACKAGE ? 'protected' : 'missing',
      missing: true,
      path: `Packages/${name}`,
      unity: null,
      vpmDependencies: {}
    })
  }

  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function addLegacyCandidate(
  candidates: LegacyPackageCandidate[],
  seen: Set<string>,
  candidate: LegacyPackageCandidate
): void {
  const key = `${candidate.match}\0${candidate.relativePath ?? ''}\0${candidate.name ?? ''}`
  if (seen.has(key)) return
  seen.add(key)
  candidates.push(candidate)
}

function readLegacy(
  port: ProjectReaderPort,
  manifest: VpmManifestSnapshot,
  options: ProjectReadOptions,
  warnings: ProjectWarning[]
): LegacyPackageReport {
  const maxEntries = Math.max(1, Math.trunc(options.maxLegacyEntries ?? DEFAULT_MAX_LEGACY_ENTRIES))
  const maxDepth = Math.max(1, Math.trunc(options.maxLegacyDepth ?? DEFAULT_MAX_LEGACY_DEPTH))
  const candidates: LegacyPackageCandidate[] = []
  const seen = new Set<string>()
  const scannedNames = new Map<string, string>()
  let scanned = 0
  let truncated = false

  const walk = (relativePath: string, depth: number): void => {
    if (truncated) return
    const entries = listDir(port, relativePath, warnings, 'vpmProjectAccessDenied')
    for (const entry of entries) {
      if (truncated) return
      if (scanned >= maxEntries) {
        truncated = true
        addWarning(warnings, 'vpmProjectScanTruncated', relativePath)
        return
      }
      scanned++
      const child = `${relativePath}/${entry.name}`
      if (entry.symlink) {
        addWarning(warnings, 'vpmProjectSymlinkSkipped', child)
        continue
      }
      if (entry.kind === 'dir') {
        if (depth >= maxDepth) {
          truncated = true
          addWarning(warnings, 'vpmProjectScanTruncated', child)
          continue
        }
        if (IGNORED_LEGACY_DIRS.has(entry.name.toLowerCase()) || entry.name.startsWith('.')) continue
        walk(child, depth + 1)
        continue
      }
      if (entry.name.toLowerCase() !== 'package.json') continue
      const file = readFile(port, child, warnings)
      if (!file) continue
      try {
        const pkg = parseProjectPackageJson(file.text)
        scannedNames.set(pkg.name, relativePath)
        addLegacyCandidate(candidates, seen, {
          name: pkg.name,
          relativePath,
          match: 'packageJson',
          confidence: 'high',
          risk: 'backupRequired'
        })
      } catch (error) {
        addWarning(warnings, 'vpmProjectPackageInvalid', child, error)
      }
    }
  }

  walk('Assets', 0)

  for (const entry of manifest.legacyFolders) {
    const target = safeLegacyPath(entry.path)
    if (!target) continue
    const stat = statPath(port, target, warnings)
    if (stat?.kind === 'dir') {
      addLegacyCandidate(candidates, seen, {
        name: entry.packageId || null,
        relativePath: target,
        match: 'legacyFolder',
        confidence: 'high',
        risk: 'backupRequired'
      })
    }
  }
  for (const entry of manifest.legacyFiles) {
    const target = safeLegacyPath(entry.path)
    if (!target) continue
    const stat = statPath(port, target, warnings)
    if (stat?.kind === 'file') {
      addLegacyCandidate(candidates, seen, {
        name: entry.packageId || null,
        relativePath: target,
        match: 'legacyFile',
        confidence: 'high',
        risk: 'backupRequired'
      })
    }
  }
  for (const packageId of manifest.legacyPackages) {
    const relativePath = scannedNames.get(packageId) ?? null
    addLegacyCandidate(candidates, seen, {
      name: packageId,
      relativePath,
      match: 'legacyPackage',
      confidence: relativePath ? 'high' : 'medium',
      risk: 'backupRequired'
    })
  }

  return { readOnly: true, scanned, truncated, candidates }
}

function readProductGuid(
  port: ProjectReaderPort,
  warnings: ProjectWarning[]
): string | null {
  const file = readFile(port, 'ProjectSettings/ProjectSettings.asset', warnings)
  if (!file) return null
  return /^\s*productGUID:\s*([0-9a-fA-F]{32})\s*$/m.exec(file.text)?.[1]?.toLowerCase() ?? null
}

/**
 * 从已读取的目录/文件内容构建工程快照。
 *
 * 这是纯逻辑：文件读取由 P2-C 的 fs 适配器通过 `ProjectReaderPort` 提供。
 * 不写任何工程文件；manifest 未知字段保存在 `manifest.data` 里。
 */
export function readProjectSnapshot(
  port: ProjectReaderPort,
  projectPath: string,
  options: ProjectReadOptions = {}
): ProjectSnapshot {
  const normalizedPath = normalizeProjectPath(projectPath)
  const warnings: ProjectWarning[] = []
  const versionFile = readFile(port, 'ProjectSettings/ProjectVersion.txt', warnings)
  if (!versionFile) throw new VpmError('vpmProjectInvalid', { field: 'ProjectVersion.txt' })
  const version = parseProjectVersion(versionFile.text)

  const manifestFile = readFile(port, 'Packages/vpm-manifest.json', warnings)
  const manifest = parseVpmManifest(manifestFile?.text ?? null)
  if (manifest.hasManifest && !manifest.valid) {
    addWarning(warnings, 'vpmManifestInvalid', 'Packages/vpm-manifest.json', manifest.error)
  }

  const rawFiles = new Map<string, string>()
  const packages = readPackages(port, manifest, options, warnings, rawFiles)
  const legacy = readLegacy(port, manifest, options, warnings)
  const productGuid = readProductGuid(port, warnings)
  const projectKey = normalizedPath.toLowerCase()
  const name = windowsBasename(normalizedPath) || 'project'

  const fingerprintParts = [
    `version\0${version.versionWithRevision}`,
    `manifest\0${manifest.raw}`,
    `product\0${productGuid ?? ''}`
  ]
  for (const [pkgName, raw] of [...rawFiles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    fingerprintParts.push(`package\0${pkgName}\0${raw}`)
  }
  const fingerprint = sha256(fingerprintParts.join('\0'))

  return {
    readOnly: true,
    projectKey,
    projectPath: normalizedPath,
    name,
    projectSlug: projectSlugOf(normalizedPath),
    unityVersion: version.version,
    unityRevision: version.revision,
    unityVersionWithRevision: version.versionWithRevision,
    productGuid,
    manifest,
    manifestHash: manifestFile ? sha256(manifestFile.text) : null,
    manifestMtime: manifestFile?.mtime ?? null,
    packages,
    legacy,
    fingerprint,
    warnings
  }
}
