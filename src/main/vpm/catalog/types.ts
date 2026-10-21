import type { CatalogQuery } from '../repos'

export interface CatalogSourceDto {
  repoId: string
  repoName: string
  zipUrl: string | null
  zipSha256: string | null
  zipSize: number | null
}

export interface CatalogVersionDto {
  version: string
  displayName: string | null
  description: string | null
  unityMin: string | null
  yanked: boolean
  yankedReason: string | null
  hidden: boolean
  deprecated: boolean
  sources: CatalogSourceDto[]
  zipUrl: string | null
  zipSha256: string | null
  zipSize: number | null
  changelogUrl: string | null
  documentationUrl: string | null
}

export interface CatalogConflictDto {
  version: string
  hashes: string[]
  sources: string[]
}

export interface CatalogPackageSummary {
  name: string
  displayName: string | null
  description: string | null
  unityMin: string | null
  latestVersion: string
  versionCount: number
  sources: Array<{ repoId: string; repoName: string }>
  hasConflict: boolean
  conflictCount: number
  hasYanked: boolean
  hidden: boolean
  keywords: string[]
  aliases: string[]
}

export interface CatalogPackageDetail extends CatalogPackageSummary {
  versions: CatalogVersionDto[]
  conflicts: CatalogConflictDto[]
}

export interface CatalogPage {
  items: CatalogPackageSummary[]
  total: number
  limit: number
  offset: number
}

export type CatalogListQuery = CatalogQuery
