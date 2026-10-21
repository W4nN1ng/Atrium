import { compareVpmVersions } from '../../../shared/vpm/domain/version'
import type { CatalogPackageRow, CatalogQuery, RepoStore } from '../repos'
import type {
  CatalogConflictDto,
  CatalogListQuery,
  CatalogPackageDetail,
  CatalogPackageSummary,
  CatalogPage,
  CatalogVersionDto
} from './types'

const PAGE_SIZE = 500
const MAX_ROWS = 50_000
const MAX_LIST = 500
const MAX_KEYWORDS = 50

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

function stringList(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : []
  } catch {
    return []
  }
}

function uniqueStrings(lists: string[][]): string[] {
  const out: string[] = []
  for (const list of lists) {
    for (const item of list) {
      if (!out.includes(item)) out.push(item)
      if (out.length >= MAX_KEYWORDS) return out
    }
  }
  return out
}

function sources(rows: CatalogPackageRow[]): Array<{ repoId: string; repoName: string }> {
  const map = new Map<string, { repoId: string; repoName: string }>()
  for (const row of rows) {
    if (!map.has(row.repoId)) map.set(row.repoId, { repoId: row.repoId, repoName: row.repoName })
  }
  return [...map.values()]
}

function firstValue<T>(rows: CatalogPackageRow[], pick: (row: CatalogPackageRow) => T | null): T | null {
  for (const row of rows) {
    const value = pick(row)
    if (value !== null) return value
  }
  return null
}

function versionGroups(rows: CatalogPackageRow[]): Array<[string, CatalogPackageRow[]]> {
  const map = new Map<string, CatalogPackageRow[]>()
  for (const row of rows) {
    const group = map.get(row.version)
    if (group) group.push(row)
    else map.set(row.version, [row])
  }
  return [...map.entries()].sort((a, b) => compareVpmVersions(b[0], a[0]))
}

function conflictsFor(version: string, rows: CatalogPackageRow[]): CatalogConflictDto | null {
  const hashes = [...new Set(rows.map((row) => row.zipSha256).filter((hash): hash is string => !!hash))]
  if (hashes.length <= 1) return null
  return {
    version,
    hashes: hashes.sort(),
    sources: [...new Set(rows.map((row) => row.repoName))]
  }
}

function summaryFor(name: string, rows: CatalogPackageRow[]): CatalogPackageSummary {
  const groups = versionGroups(rows)
  const latestGroup = groups.find(([, group]) => group.some((row) => !row.yanked)) ?? groups[0]
  const flat = groups.flatMap(([, group]) => group)
  const conflicts = groups
    .map(([version, group]) => conflictsFor(version, group))
    .filter((conflict): conflict is CatalogConflictDto => !!conflict)

  return {
    name,
    displayName: firstValue(flat, (row) => row.displayName),
    description: firstValue(flat, (row) => row.description),
    unityMin: firstValue(flat, (row) => row.unityMin),
    latestVersion: latestGroup[0],
    versionCount: groups.length,
    sources: sources(flat),
    hasConflict: conflicts.length > 0,
    conflictCount: conflicts.length,
    hasYanked: flat.some((row) => row.yanked),
    hidden: flat.every((row) => row.hidden),
    keywords: uniqueStrings(flat.map((row) => stringList(row.keywordsJson))),
    aliases: uniqueStrings(flat.map((row) => stringList(row.aliasesJson)))
  }
}

function detailFor(name: string, rows: CatalogPackageRow[]): CatalogPackageDetail {
  const summary = summaryFor(name, rows)
  const groups = versionGroups(rows)
  const conflicts = groups
    .map(([version, group]) => conflictsFor(version, group))
    .filter((conflict): conflict is CatalogConflictDto => !!conflict)
  const versions: CatalogVersionDto[] = groups.map(([version, group]) => ({
    version,
    displayName: firstValue(group, (row) => row.displayName),
    description: firstValue(group, (row) => row.description),
    unityMin: firstValue(group, (row) => row.unityMin),
    yanked: group.some((row) => row.yanked),
    yankedReason: firstValue(group, (row) => row.yankedReason),
    hidden: group.some((row) => row.hidden),
    deprecated: group.some((row) => row.deprecated),
    sources: group.map((row) => ({
      repoId: row.repoId,
      repoName: row.repoName,
      zipUrl: row.zipUrl,
      zipSha256: row.zipSha256,
      zipSize: row.zipSize
    })),
    zipUrl: firstValue(group, (row) => row.zipUrl),
    zipSha256: firstValue(group, (row) => row.zipSha256),
    zipSize: firstValue(group, (row) => row.zipSize)
  }))
  return { ...summary, versions, conflicts }
}

/**
 * 只读目录：把仓储里的“按版本行”合并成包卡片/详情。
 *
 * - 同名包跨仓库合并；同版本不同 hash 标冲突，不静默挑一个；
 * - latestVersion 用共享 SemVer 比较器，稳定排序；
 * - 不联网、不写库；搜索/过滤最终由 RepoStore 的 SQL 完成。
 */
export class CatalogService {
  constructor(private readonly store: RepoStore) {}

  query(query: CatalogListQuery = {}): CatalogPage {
    const limit = clamp(query.limit, 100, 1, MAX_LIST)
    const offset = clamp(query.offset, 0, 0, 1_000_000)
    const rows = this.fetchRows({
      name: query.name,
      text: query.text,
      repoIds: query.repoIds,
      enabledOnly: query.enabledOnly,
      includeHidden: query.includeHidden,
      includeYanked: query.includeYanked
    })

    const byName = new Map<string, CatalogPackageRow[]>()
    for (const row of rows) {
      const current = byName.get(row.name)
      if (current) current.push(row)
      else byName.set(row.name, [row])
    }
    const all = [...byName.entries()]
      .map(([name, group]) => summaryFor(name, group))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { items: all.slice(offset, offset + limit), total: all.length, limit, offset }
  }

  getPackage(name: string): CatalogPackageDetail | null {
    if (!/^[a-z0-9][a-z0-9._-]{0,213}$/.test(name)) return null
    const rows = this.fetchRows({
      name,
      enabledOnly: true,
      includeHidden: true,
      includeYanked: true
    })
    return rows.length ? detailFor(name, rows) : null
  }

  private fetchRows(query: CatalogQuery): CatalogPackageRow[] {
    const rows: CatalogPackageRow[] = []
    let offset = 0
    while (rows.length < MAX_ROWS) {
      const page = this.store.queryCatalog({ ...query, limit: PAGE_SIZE, offset })
      rows.push(...page.items)
      if (page.items.length === 0 || rows.length >= page.total) break
      offset += PAGE_SIZE
    }
    return rows
  }
}
