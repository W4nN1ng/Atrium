/** 仓库行；`packageCount` 是查询时算出来的，不是表里的列。 */
export interface RepoRow {
  id: string
  url: string
  name: string
  kind: string
  enabled: boolean
  sortOrder: number
  lastFetchAt: number | null
  lastSuccessAt: number | null
  lastErrorCode: string | null
  etag: string | null
  lastModified: string | null
  packageCount: number
  createdAt: number
  updatedAt: number
}

export interface RepoInput {
  /** 不传则生成 ULID；P1-D 的 addRepo 可以显式指定。 */
  id?: string
  url: string
  name: string
  kind?: string
  enabled?: boolean
  sortOrder?: number
}

export interface RepoFetchState {
  etag: string | null
  lastModified: string | null
  lastFetchAt: number
  lastSuccessAt: number | null
  lastErrorCode: string | null
}

/** 替换某仓库包索引时用的输入；repoId 由 replaceRepoPackages 参数决定。 */
export interface PackageVersionInput {
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
  yanked: boolean
  yankedReason: string | null
  hidden: boolean
  deprecated: boolean
  manifestJson: string
  fetchedAt: number
}

export interface CatalogQuery {
  /** 精确包名（详情页用）；与 text 可同时使用。 */
  name?: string
  /** 只查这些包名（P9-C：先分页拿名字，再按名字取行）。 */
  names?: string[]
  /** 包名/显示名/描述/别名/关键词/仓库名的子串；空则不筛。 */
  text?: string
  /** 只查这些仓库；空数组视为不筛。 */
  repoIds?: string[]
  /** 默认 true：只查启用仓库。 */
  enabledOnly?: boolean
  /** 默认 false。 */
  includeHidden?: boolean
  /** 默认 false。 */
  includeYanked?: boolean
  /** P9-C：用户隐藏的包，在 SQL 里就排除（否则分页会空出格子）。 */
  excludeNames?: string[]
  /** P9-C：排除带 `-` 的预发布版本（等价于 `!version.includes('-')`）。 */
  excludePrerelease?: boolean
  limit?: number
  offset?: number
}

/** P9-C：目录按包名分页的结果（`total` 是包的数量，不是版本行数）。 */
export interface CatalogNamePage {
  names: string[]
  total: number
  limit: number
  offset: number
}

export interface CatalogPackageRow extends PackageVersionInput {
  repoId: string
  repoName: string
}

export interface CatalogPage {
  items: CatalogPackageRow[]
  total: number
  limit: number
  offset: number
}
