import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseUnityVersion } from '../../../shared/vpm/domain/unityVersion'

/**
 * 本地用户包目录（P7-C）。
 *
 * 只做**扫描与校验**：把用户显式信任的目录里的 `package.json` 读成候选包。
 * 不自动扫全盘、不下载、不写工程——安装仍然走 P4 的事务。
 *
 * 约定：
 * - 一个"包目录"= 含 `package.json` 的目录；
 * - 也支持"包集合目录"= 下一层里每个含 `package.json` 的子目录；
 * - `name` 必须是合法的包名（`com.foo.bar` 形态），否则跳过并记原因；
 * - 内容变化用 `package.json` 的 sha256 判断（不看整个目录，避免 Library 噪音）。
 */

export type LocalPackageIssue = 'noPackageJson' | 'invalidJson' | 'nameMissing' | 'nameInvalid' | 'versionMissing'

export interface LocalPackage {
  /** 包名（`package.json.name`）。 */
  name: string
  version: string
  displayName: string | null
  description: string | null
  /** `unity` 字段原样（例如 `2022.3`）。 */
  unity: string | null
  dependencies: Record<string, string>
  /** 包目录绝对路径。 */
  path: string
  /** `package.json` 的 sha256：用来判断内容有没有变。 */
  hash: string
}

export interface LocalScanResult {
  root: string
  packages: LocalPackage[]
  skipped: Array<{ path: string; reason: LocalPackageIssue }>
}

const PACKAGE_NAME = /^[a-z0-9][a-z0-9._-]*\.[a-z0-9][a-z0-9._-]*$/

function readJson(file: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function hashOf(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function dependenciesOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [name, version] of Object.entries(value as Record<string, unknown>)) {
    if (typeof version === 'string' && version.trim()) out[name] = version.trim()
  }
  return out
}

/** 读一个包目录；不合格就返回原因。 */
export function readLocalPackage(dir: string): LocalPackage | LocalPackageIssue {
  const manifestPath = path.join(dir, 'package.json')
  if (!fs.existsSync(manifestPath)) return 'noPackageJson'
  const raw = readJson(manifestPath)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'invalidJson'
  const record = raw as Record<string, unknown>
  const name = asString(record.name)
  if (!name) return 'nameMissing'
  if (!PACKAGE_NAME.test(name)) return 'nameInvalid'
  const version = asString(record.version)
  if (!version) return 'versionMissing'
  const unity = asString(record.unity)
  return {
    name,
    version,
    displayName: asString(record.displayName),
    description: asString(record.description),
    // `unity` 只接受能解析的版本号；写错就当没有（不因此拒绝整个包）。
    unity: unity && parseUnityVersion(unity) ? unity : null,
    dependencies: dependenciesOf(record.dependencies),
    path: dir,
    hash: hashOf(manifestPath)
  }
}

/**
 * 扫一个用户信任的目录。
 *
 * - 目录本身有 `package.json` → 当单个包；
 * - 否则扫**下一层**子目录（不递归更深，避免把 node_modules 之类扫进来）。
 */
export function scanLocalPackages(root: string): LocalScanResult {
  const result: LocalScanResult = { root, packages: [], skipped: [] }
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(root)
  } catch {
    result.skipped.push({ path: root, reason: 'noPackageJson' })
    return result
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    result.skipped.push({ path: root, reason: 'noPackageJson' })
    return result
  }

  const self = readLocalPackage(root)
  if (typeof self !== 'string') {
    result.packages.push(self)
    return result
  }

  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    result.skipped.push({ path: root, reason: 'noPackageJson' })
    return result
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const child = path.join(root, entry.name)
    const pkg = readLocalPackage(child)
    if (typeof pkg === 'string') {
      // 子目录不是包很正常（README、图片…），只有"有 package.json 但坏"才值得记。
      if (pkg !== 'noPackageJson') result.skipped.push({ path: child, reason: pkg })
      continue
    }
    result.packages.push(pkg)
  }
  return result
}

/** 两次扫描的差异（内容变化按 `package.json` 的 hash 判断）。 */
export function diffLocalPackages(
  previous: readonly LocalPackage[],
  next: readonly LocalPackage[]
): { added: LocalPackage[]; removed: LocalPackage[]; changed: LocalPackage[] } {
  const before = new Map(previous.map((pkg) => [pkg.name, pkg]))
  const after = new Map(next.map((pkg) => [pkg.name, pkg]))
  const added = next.filter((pkg) => !before.has(pkg.name))
  const removed = previous.filter((pkg) => !after.has(pkg.name))
  const changed = next.filter((pkg) => {
    const old = before.get(pkg.name)
    return old ? old.hash !== pkg.hash || old.version !== pkg.version : false
  })
  return { added, removed, changed }
}
