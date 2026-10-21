import type { VpmErrorCode } from '../errors'
export type {
  VpmPlanDto,
  VpmPlanExplainDto,
  VpmPlanResolveInput
} from './plan'
export type {
  VpmProjectDetailDto,
  VpmProjectLegacyDto,
  VpmProjectLegacyMatch,
  VpmProjectPackageDto,
  VpmProjectPackageState,
  VpmProjectSummaryDto,
  VpmProjectWarningDto
} from './project'

export interface VpmRepoDto {
  id: string
  url: string
  name: string
  kind: string
  enabled: boolean
  sortOrder: number
  packageCount: number
  lastFetchAt: number | null
  lastSuccessAt: number | null
  lastErrorCode: string | null
}

export type VpmRepoRefreshStatus = 'updated' | 'not-modified' | 'error'

export interface VpmRepoRefreshResult {
  repo: VpmRepoDto
  status: VpmRepoRefreshStatus
  packageCount: number
  errorCode: VpmErrorCode | null
}

export interface VpmOperationStart {
  operationId: string
  repoIds: string[]
}

export interface VpmRepoProgressEvent {
  operationId: string
  phase: 'start' | 'repo'
  repoId?: string
  repoIds?: string[]
  result?: VpmRepoRefreshResult
}

export interface VpmRepoDoneEvent {
  operationId: string
  results: VpmRepoRefreshResult[]
}

export interface VpmNetworkStatus {
  consentAt: string | null
  allowed: boolean
}

export interface VpmCatalogQuery {
  name?: string
  text?: string
  repoIds?: string[]
  enabledOnly?: boolean
  includeHidden?: boolean
  includeYanked?: boolean
  limit?: number
  offset?: number
}

export interface VpmCatalogSourceDto {
  repoId: string
  repoName: string
  zipUrl: string | null
  zipSha256: string | null
  zipSize: number | null
}

export interface VpmCatalogVersionDto {
  version: string
  displayName: string | null
  description: string | null
  unityMin: string | null
  yanked: boolean
  yankedReason: string | null
  hidden: boolean
  deprecated: boolean
  sources: VpmCatalogSourceDto[]
  zipUrl: string | null
  zipSha256: string | null
  zipSize: number | null
  changelogUrl: string | null
  documentationUrl: string | null
}

export interface VpmCatalogConflictDto {
  version: string
  hashes: string[]
  sources: string[]
}

export interface VpmCatalogPackageSummary {
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

export interface VpmCatalogPackageDetail extends VpmCatalogPackageSummary {
  versions: VpmCatalogVersionDto[]
  conflicts: VpmCatalogConflictDto[]
}

export interface VpmCatalogPage {
  items: VpmCatalogPackageSummary[]
  total: number
  limit: number
  offset: number
}
