import { ulid } from '../../../shared/ulid'
import { VpmError } from '../../../shared/vpm/errors'
import type { VpmDb } from '../db'
import type {
  CatalogNamePage,
  CatalogPage,
  CatalogPackageRow,
  CatalogQuery,
  PackageVersionInput,
  RepoFetchState,
  RepoInput,
  RepoRow
} from './types'

interface RepoDbRow {
  id: string
  url: string
  name: string
  kind: string
  enabled: number
  sort_order: number
  etag: string | null
  last_modified: string | null
  last_fetch_at: number | null
  last_success_at: number | null
  last_error_code: string | null
  created_at: number
  updated_at: number
  package_count: number
}

interface PackageDbRow {
  repo_id: string
  repo_name: string
  name: string
  version: string
  display_name: string | null
  description: string | null
  author_json: string | null
  keywords_json: string | null
  aliases_json: string | null
  unity_min: string | null
  zip_url: string | null
  zip_sha256: string | null
  zip_size: number | null
  yanked: number
  yanked_reason: string | null
  hidden: number
  deprecated: number
  manifest_json: string
  fetched_at: number
}

interface PreparedPackage {
  repoId: string
  name: string
  version: string
  displayName: string | null
  description: string | null
  authorJson: string | null
  keywordsJson: string | null
  aliasesJson: string | null
  unityMin: string | null
  zipUrl: string | null
  zipSha256: string | null
  zipSize: number | null
  yanked: number
  yankedReason: string | null
  hidden: number
  deprecated: number
  manifestJson: string
  fetchedAt: number
}

function invalid(field: string, cause?: unknown): VpmError {
  return new VpmError('vpmRepoInvalid', { field }, cause)
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw invalid(field)
  const normalized = value.trim()
  if (!normalized || normalized.length > max) throw invalid(field)
  return normalized
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw invalid(field)
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > max) throw invalid(field)
  return normalized
}

function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(field)
  const normalized = Math.trunc(value)
  if (normalized < min || normalized > max) throw invalid(field)
  return normalized
}

function optionalInteger(value: unknown, field: string, min: number, max: number): number | null {
  if (value === null || value === undefined) return null
  return integer(value, field, min, max)
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalid(field)
  return value
}

function sha256(value: unknown): string | null {
  const normalized = optionalText(value, 'zipSha256', 64)
  if (normalized === null) return null
  const lower = normalized.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(lower)) throw invalid('zipSha256')
  return lower
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  const message = error instanceof Error ? error.message : String(error)
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    /UNIQUE constraint failed/i.test(message)
  )
}

const SELECT_REPO = `
SELECT r.*, (SELECT COUNT(*) FROM vpm_repo_package p WHERE p.repo_id = r.id) AS package_count
FROM vpm_repo r
`

function mapRepo(row: RepoDbRow): RepoRow {
  return {
    id: row.id,
    url: row.url,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled === 1,
    sortOrder: Number(row.sort_order),
    lastFetchAt: row.last_fetch_at === null ? null : Number(row.last_fetch_at),
    lastSuccessAt: row.last_success_at === null ? null : Number(row.last_success_at),
    lastErrorCode: row.last_error_code,
    etag: row.etag,
    lastModified: row.last_modified,
    packageCount: Number(row.package_count),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  }
}

function mapPackage(row: PackageDbRow): CatalogPackageRow {
  return {
    repoId: row.repo_id,
    repoName: row.repo_name,
    name: row.name,
    version: row.version,
    displayName: row.display_name,
    description: row.description,
    authorJson: row.author_json,
    keywordsJson: row.keywords_json,
    aliasesJson: row.aliases_json,
    unityMin: row.unity_min,
    zipUrl: row.zip_url,
    zipSha256: row.zip_sha256,
    zipSize: row.zip_size === null ? null : Number(row.zip_size),
    yanked: row.yanked === 1,
    yankedReason: row.yanked_reason,
    hidden: row.hidden === 1,
    deprecated: row.deprecated === 1,
    manifestJson: row.manifest_json,
    fetchedAt: Number(row.fetched_at)
  }
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/**
 * 仓库/包索引的唯一 SQL 入口。
 *
 * - 不联网、不解析仓库 JSON、不返回渲染层 DTO；
 * - 替换包索引用单事务，失败保留旧行；
 * - 所有写入都做防御性校验，错误码统一 vpmRepo*。
 */
export class RepoStore {
  constructor(
    private readonly db: VpmDb,
    private readonly now: () => number = Date.now
  ) {}

  listRepos(): RepoRow[] {
    const rows = this.db
      .prepare(`${SELECT_REPO} ORDER BY r.sort_order ASC, r.name COLLATE NOCASE ASC, r.id ASC`)
      .all() as RepoDbRow[]
    return rows.map(mapRepo)
  }

  getRepo(id: string): RepoRow | null {
    const row = this.db.prepare(`${SELECT_REPO} WHERE r.id = ?`).get(id) as RepoDbRow | undefined
    return row ? mapRepo(row) : null
  }

  getRepoByUrl(url: string): RepoRow | null {
    const row = this.db.prepare(`${SELECT_REPO} WHERE r.url = ?`).get(url) as RepoDbRow | undefined
    return row ? mapRepo(row) : null
  }

  upsertRepo(input: RepoInput): RepoRow {
    if (!input || typeof input !== 'object') throw invalid('repo')
    const id = input.id === undefined ? ulid() : text(input.id, 'id', 100)
    const url = text(input.url, 'url', 2048)
    const name = text(input.name, 'name', 200)
    const kind = input.kind === undefined ? 'remote' : text(input.kind, 'kind', 50)
    const enabled = input.enabled === undefined ? true : booleanField(input.enabled, 'enabled')
    const sortOrder = input.sortOrder === undefined ? 0 : integer(input.sortOrder, 'sortOrder', -1_000_000, 1_000_000)

    const existing = this.getRepoByUrl(url)
    if (existing && existing.id !== id) throw new VpmError('vpmRepoConflict', { field: 'url' })

    const at = this.now()
    try {
      this.db
        .prepare(
          `INSERT INTO vpm_repo
            (id, url, name, kind, enabled, sort_order, created_at, updated_at)
           VALUES
            (@id, @url, @name, @kind, @enabled, @sortOrder, @at, @at)
           ON CONFLICT(id) DO UPDATE SET
            url = excluded.url,
            name = excluded.name,
            kind = excluded.kind,
            enabled = excluded.enabled,
            sort_order = excluded.sort_order,
            updated_at = excluded.updated_at`
        )
        .run({
          id,
          url,
          name,
          kind,
          enabled: enabled ? 1 : 0,
          sortOrder,
          at
        })
    } catch (error) {
      if (isUniqueViolation(error)) throw new VpmError('vpmRepoConflict', { field: 'url' }, error)
      throw invalid('repo', error)
    }

    const saved = this.getRepo(id)
    if (!saved) throw invalid('id')
    return saved
  }

  updateRepoFetchState(id: string, state: RepoFetchState): void {
    if (!state || typeof state !== 'object') throw invalid('fetchState')
    const etag = optionalText(state.etag, 'etag', 2048)
    const lastModified = optionalText(state.lastModified, 'lastModified', 2048)
    const lastFetchAt = integer(state.lastFetchAt, 'lastFetchAt', 0, Number.MAX_SAFE_INTEGER)
    const lastSuccessAt = optionalInteger(state.lastSuccessAt, 'lastSuccessAt', 0, Number.MAX_SAFE_INTEGER)
    const lastErrorCode = optionalText(state.lastErrorCode, 'lastErrorCode', 200)
    const result = this.db
      .prepare(
        `UPDATE vpm_repo SET
           etag = @etag,
           last_modified = @lastModified,
           last_fetch_at = @lastFetchAt,
           last_success_at = @lastSuccessAt,
           last_error_code = @lastErrorCode,
           updated_at = @at
         WHERE id = @id`
      )
      .run({ id, etag, lastModified, lastFetchAt, lastSuccessAt, lastErrorCode, at: this.now() })
    if (result.changes === 0) throw new VpmError('vpmRepoNotFound')
  }

  /** 批量写排序（P7-A）；只更新存在的行，返回实际改了几行。 */
  setSortOrders(entries: ReadonlyArray<{ id: string; sortOrder: number }>): number {
    let changed = 0
    const at = this.now()
    const statement = this.db.prepare(
      'UPDATE vpm_repo SET sort_order = ?, updated_at = ? WHERE id = ?'
    )
    for (const entry of entries) {
      const result = statement.run(entry.sortOrder, at, entry.id)
      changed += result.changes
    }
    return changed
  }

  removeRepo(id: string): boolean {
    return this.db.prepare('DELETE FROM vpm_repo WHERE id = ?').run(id).changes > 0
  }

  replaceRepoPackages(repoId: string, packages: readonly PackageVersionInput[]): number {
    if (!this.getRepo(repoId)) throw new VpmError('vpmRepoNotFound')
    if (!Array.isArray(packages)) throw invalid('packages')
    if (packages.length > 20_000) throw invalid('packages')

    const prepared: PreparedPackage[] = packages.map((row) => {
      if (!row || typeof row !== 'object') throw invalid('packages')
      return {
        repoId,
        name: text(row.name, 'name', 214),
        version: text(row.version, 'version', 128),
        displayName: optionalText(row.displayName, 'displayName', 500),
        description: optionalText(row.description, 'description', 20_000),
        authorJson: optionalText(row.authorJson, 'authorJson', 10_000),
        keywordsJson: optionalText(row.keywordsJson, 'keywordsJson', 50_000),
        aliasesJson: optionalText(row.aliasesJson, 'aliasesJson', 50_000),
        unityMin: optionalText(row.unityMin, 'unityMin', 64),
        zipUrl: optionalText(row.zipUrl, 'zipUrl', 4096),
        zipSha256: sha256(row.zipSha256),
        zipSize: optionalInteger(row.zipSize, 'zipSize', 0, 4 * 1024 * 1024 * 1024),
        yanked: booleanField(row.yanked, 'yanked') ? 1 : 0,
        yankedReason: optionalText(row.yankedReason, 'yankedReason', 500),
        hidden: booleanField(row.hidden, 'hidden') ? 1 : 0,
        deprecated: booleanField(row.deprecated, 'deprecated') ? 1 : 0,
        manifestJson: text(row.manifestJson, 'manifestJson', 16 * 1024 * 1024),
        fetchedAt: integer(row.fetchedAt, 'fetchedAt', 0, Number.MAX_SAFE_INTEGER)
      }
    })

    try {
      const replace = this.db.transaction((rows: PreparedPackage[]) => {
        this.db.prepare('DELETE FROM vpm_repo_package WHERE repo_id = ?').run(repoId)
        const insert = this.db.prepare(
          `INSERT INTO vpm_repo_package
            (repo_id, name, version, display_name, description, author_json, keywords_json,
             aliases_json, unity_min, zip_url, zip_sha256, zip_size, yanked, yanked_reason,
             hidden, deprecated, manifest_json, fetched_at)
           VALUES
            (@repoId, @name, @version, @displayName, @description, @authorJson, @keywordsJson,
             @aliasesJson, @unityMin, @zipUrl, @zipSha256, @zipSize, @yanked, @yankedReason,
             @hidden, @deprecated, @manifestJson, @fetchedAt)`
        )
        for (const row of rows) insert.run(row)
      })
      replace(prepared)
      return prepared.length
    } catch (error) {
      if (error instanceof VpmError) throw error
      throw invalid('packages', error)
    }
  }

  /**
   * 把查询条件翻译成 WHERE。
   *
   * P9-C 新增两条**在 SQL 里就生效**的偏好过滤（`excludeNames` / `excludePrerelease`）：
   * 目录分页改成"先取一页包名、再取这些包的行"，如果隐藏/预发布过滤留在 JS 里，
   * 分页会先被隐藏项占掉名额，第二页就少几行 —— 所以必须在分页之前筛掉。
   */
  private catalogWhere(query: CatalogQuery): {
    where: string[]
    filters: Record<string, string | number>
  } {
    const exactName = query.name === undefined ? null : text(query.name, 'name', 214)
    const rawText = query.text === undefined ? '' : query.text.trim()
    if (rawText.length > 200) throw invalid('text')
    const repoIds = Array.isArray(query.repoIds)
      ? [...new Set(query.repoIds.map((id) => text(id, 'repoIds', 100)))]
      : []
    if (repoIds.length > 100) throw invalid('repoIds')
    const names = Array.isArray(query.names)
      ? [...new Set(query.names.map((name) => text(name, 'names', 214)))]
      : []
    if (names.length > 500) throw invalid('names')
    const excludeNames = Array.isArray(query.excludeNames)
      ? [...new Set(query.excludeNames.map((name) => text(name, 'excludeNames', 214)))]
      : []
    if (excludeNames.length > 5000) throw invalid('excludeNames')

    // 值一律是字符串/数字：名字列表用 JSON.stringify 变成一个参数。
    const filters: Record<string, string | number> = {}
    const where: string[] = []

    if (query.enabledOnly !== false) where.push('r.enabled = 1')
    if (query.includeHidden !== true) where.push('p.hidden = 0')
    if (query.includeYanked !== true) where.push('p.yanked = 0')
    if (exactName) {
      where.push('p.name = @name')
      filters.name = exactName
    }
    if (rawText) {
      // instr + lower：按字面量搜索，`%`/`_` 不当通配符；中文仍按原字面匹配。
      where.push(
        '(instr(lower(p.name), lower(@text)) > 0 OR instr(lower(p.display_name), lower(@text)) > 0 OR instr(lower(p.description), lower(@text)) > 0 OR instr(lower(p.aliases_json), lower(@text)) > 0 OR instr(lower(p.keywords_json), lower(@text)) > 0 OR instr(lower(r.name), lower(@text)) > 0)'
      )
      filters.text = rawText
    }
    if (repoIds.length) {
      const placeholders = repoIds.map((id, index) => {
        const key = `repo${index}`
        filters[key] = id
        return `@${key}`
      })
      where.push(`p.repo_id IN (${placeholders.join(', ')})`)
    }
    if (names.length) {
      // json_each 而不是几百个占位符：SQLite 的绑定变量上限撑不住 500 个名字。
      where.push('p.name IN (SELECT value FROM json_each(@names))')
      filters.names = JSON.stringify(names)
    }
    if (excludeNames.length) {
      where.push('p.name NOT IN (SELECT value FROM json_each(@excludeNames))')
      filters.excludeNames = JSON.stringify(excludeNames)
    }
    if (query.excludePrerelease === true) {
      // 与 JS 的 `version.includes('-')` 等价（SemVer 预发布段）。
      where.push("instr(p.version, '-') = 0")
    }
    return { where, filters }
  }

  /**
   * P9-C：只按**包名**分页（每页 limit 个包，不是 limit 行）。
   *
   * 目录列表只显示 100 张卡片，但旧实现为了分页把整个目录（10,000 行）读进内存再分组，
   * 10k 行实测 p95 500ms+。名字页只扫一遍索引、返回 100 个字符串。
   */
  queryCatalogNames(query: CatalogQuery = {}): CatalogNamePage {
    if (!query || typeof query !== 'object') throw invalid('query')
    if (query.text !== undefined && typeof query.text !== 'string') throw invalid('text')
    const { where, filters } = this.catalogWhere(query)
    const limit = clamp(query.limit, 100, 1, 500)
    const offset = clamp(query.offset, 0, 0, 1_000_000)
    const fromWhere = `FROM vpm_repo_package p JOIN vpm_repo r ON r.id = p.repo_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`
    const totalRow = this.db
      .prepare(`SELECT COUNT(DISTINCT p.name) AS n ${fromWhere}`)
      .get(filters) as { n: number } | undefined
    const rows = this.db
      .prepare(
        `SELECT DISTINCT p.name AS name ${fromWhere}
         ORDER BY p.name COLLATE NOCASE ASC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...filters, limit, offset }) as Array<{ name: string }>
    return {
      names: rows.map((row) => row.name),
      total: Number(totalRow?.n ?? 0),
      limit,
      offset
    }
  }

  queryCatalog(query: CatalogQuery = {}): CatalogPage {
    if (!query || typeof query !== 'object') throw invalid('query')
    if (query.text !== undefined && typeof query.text !== 'string') throw invalid('text')
    const limit = clamp(query.limit, 200, 1, 500)
    const offset = clamp(query.offset, 0, 0, 1_000_000)
    const { where, filters } = this.catalogWhere(query)
    const fromWhere = `FROM vpm_repo_package p JOIN vpm_repo r ON r.id = p.repo_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS n ${fromWhere}`)
      .get(filters) as { n: number } | undefined
    const rows = this.db
      .prepare(
        `SELECT p.repo_id, p.name, p.version, p.display_name, p.description, p.author_json,
                p.keywords_json, p.aliases_json, p.unity_min, p.zip_url, p.zip_sha256,
                p.zip_size, p.yanked, p.yanked_reason, p.hidden, p.deprecated,
                p.manifest_json, p.fetched_at, r.name AS repo_name
         ${fromWhere}
         ORDER BY p.name COLLATE NOCASE ASC, p.version DESC, r.sort_order ASC, r.id ASC
         LIMIT @limit OFFSET @offset`
      )
      .all({ ...filters, limit, offset }) as PackageDbRow[]

    return {
      items: rows.map(mapPackage),
      total: Number(totalRow?.n ?? 0),
      limit,
      offset
    }
  }
}
