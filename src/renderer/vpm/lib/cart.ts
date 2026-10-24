import type { ChangePlanRequest } from '../../../shared/vpm/domain/plan'
import type {
  VpmPackageCatalogInfoDto,
  VpmProjectPackageDto
} from '../../../shared/vpm/dto'

/**
 * 包管理页的纯逻辑：版本比较、变更单、请求组装。
 *
 * 组件只管渲染；这里可以在 Node 里直接单测（没有 DOM、没有 IPC）。
 */

export type CartAction = 'install' | 'upgrade' | 'downgrade' | 'reinstall' | 'remove'

export interface CartEntry {
  name: string
  action: CartAction
  /** install/upgrade/downgrade/reinstall 的目标版本；remove 没有。 */
  version: string | null
}

export interface PackageRowModel {
  name: string
  displayName: string | null
  /** 仓库里的来源名（Official / Curated / 自定义仓库）；工程内包没有仓库来源时为 null。 */
  repoName: string | null
  source: string
  installedVersion: string | null
  manifestVersion: string | null
  state: VpmProjectPackageDto['state']
  protected: boolean
  latestVersion: string | null
  updateAvailable: boolean
  versions: VpmPackageCatalogInfoDto['versions']
  hasConflict: boolean
}

/** `1.2.3` 这类纯数字版本比较；非纯数字回退到字符串比较，避免抛错。 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] | null => {
    const core = value.split('-')[0]
    const parts = core.split('.').map((part) => Number(part))
    return parts.every((part) => Number.isFinite(part)) ? parts : null
  }
  const left = parse(a)
  const right = parse(b)
  if (!left || !right) return a.localeCompare(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export function rowModel(
  pkg: VpmProjectPackageDto,
  catalog: VpmPackageCatalogInfoDto | undefined
): PackageRowModel {
  const latestVersion = catalog?.latestVersion ?? null
  const installedVersion = pkg.version
  return {
    name: pkg.name,
    displayName: pkg.displayName ?? catalog?.displayName ?? null,
    repoName: catalog?.sourceName ?? null,
    source: pkg.source,
    installedVersion,
    manifestVersion: null,
    state: pkg.state,
    protected: pkg.protected || pkg.state === 'protected',
    latestVersion,
    updateAvailable:
      !!latestVersion && !!installedVersion && compareVersions(latestVersion, installedVersion) > 0,
    versions: catalog?.versions ?? [],
    hasConflict: catalog?.hasConflict === true
  }
}

/** 选一个目标版本时该走哪种动作。 */
export function actionFor(current: string | null, target: string): CartAction {
  if (!current) return 'install'
  const diff = compareVersions(target, current)
  if (diff > 0) return 'upgrade'
  if (diff < 0) return 'downgrade'
  return 'reinstall'
}

/** 勾选一行时的默认动作：有更新就升级到最新，否则重装。 */
export function defaultEntry(row: PackageRowModel): CartEntry | null {
  if (row.protected) return null
  if (row.updateAvailable && row.latestVersion) {
    return { name: row.name, action: 'upgrade', version: row.latestVersion }
  }
  if (!row.installedVersion) return null
  return { name: row.name, action: 'reinstall', version: row.installedVersion }
}

export function toggleEntry(cart: Map<string, CartEntry>, row: PackageRowModel): Map<string, CartEntry> {
  const next = new Map(cart)
  if (next.has(row.name)) {
    next.delete(row.name)
    return next
  }
  const entry = defaultEntry(row)
  if (entry) next.set(row.name, entry)
  return next
}

export function setVersionEntry(
  cart: Map<string, CartEntry>,
  row: PackageRowModel,
  version: string
): Map<string, CartEntry> {
  if (row.protected) return cart
  const next = new Map(cart)
  next.set(row.name, { name: row.name, action: actionFor(row.installedVersion, version), version })
  return next
}

export function removeEntry(cart: Map<string, CartEntry>, row: PackageRowModel): Map<string, CartEntry> {
  if (row.protected) return cart
  const next = new Map(cart)
  next.set(row.name, { name: row.name, action: 'remove', version: null })
  return next
}

export function clearEntry(cart: Map<string, CartEntry>, name: string): Map<string, CartEntry> {
  const next = new Map(cart)
  next.delete(name)
  return next
}

/** 变更单 → P3 解析请求；顺序稳定，便于测试与日志。 */
export function toRequests(cart: ReadonlyMap<string, CartEntry>): ChangePlanRequest[] {
  return [...cart.values()]
    .map((entry) => ({
      kind: entry.action,
      name: entry.name,
      ...(entry.version ? { version: entry.version } : {})
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))
}

export interface PackageFilter {
  text: string
  only: 'all' | 'installed' | 'updates' | 'conflicts'
}

export function filterRows(rows: readonly PackageRowModel[], filter: PackageFilter): PackageRowModel[] {
  const text = filter.text.trim().toLowerCase()
  return rows.filter((row) => {
    if (
      text &&
      !row.name.toLowerCase().includes(text) &&
      !(row.displayName ?? '').toLowerCase().includes(text)
    ) {
      return false
    }
    if (filter.only === 'installed') return !!row.installedVersion
    if (filter.only === 'updates') return row.updateAvailable
    if (filter.only === 'conflicts') return row.hasConflict
    return true
  })
}

export function countUpdates(rows: readonly PackageRowModel[]): number {
  return rows.filter((row) => row.updateAvailable).length
}

/** 受保护包永远不出现在可变更集合里（双保险：这里再挡一次）。 */
export function sanitizeCart(
  cart: ReadonlyMap<string, CartEntry>,
  rows: readonly PackageRowModel[]
): Map<string, CartEntry> {
  const protectedNames = new Set(rows.filter((row) => row.protected).map((row) => row.name))
  const next = new Map<string, CartEntry>()
  for (const [name, entry] of cart) {
    if (protectedNames.has(name)) continue
    next.set(name, entry)
  }
  return next
}
