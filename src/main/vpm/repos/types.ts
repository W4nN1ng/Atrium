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
  limit?: number
  offset?: number
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
