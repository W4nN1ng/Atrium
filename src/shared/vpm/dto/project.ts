export type VpmProjectPackageState =
  | 'installed'
  | 'missing'
  | 'unlisted'
  | 'mismatch'
  | 'protected'

export type VpmProjectLegacyMatch =
  | 'packageJson'
  | 'legacyFolder'
  | 'legacyFile'
  | 'legacyPackage'

export interface VpmProjectSummaryDto {
  projectKey: string
  coreId: string | null
  path: string
  name: string
  unityVersion: string | null
  unityRevision: string | null
  running: boolean
  detectedBy: string[]
  bridgeVersion: string | null
  busyReason: string | null
  linked: boolean
  hasLedger: boolean
  lastScanAt: number | null
  packageCount: number
  legacyCount: number
  hasVpmManifest: boolean
}

export interface VpmProjectPackageDto {
  name: string
  version: string | null
  source: string
  state: VpmProjectPackageState
  isLegacy: boolean
  protected: boolean
  path: string | null
  unity: string | null
}

export interface VpmProjectWarningDto {
  code: string
  path: string | null
  detail: string | null
}

export interface VpmProjectLegacyDto {
  name: string | null
  relativePath: string | null
  match: VpmProjectLegacyMatch
  confidence: 'high' | 'medium' | 'low'
}

export interface VpmProjectDetailDto extends VpmProjectSummaryDto {
  manifestHash: string | null
  manifestMtime: number | null
  unityExePath: string | null
  unityArgsJson: string | null
  packages: VpmProjectPackageDto[]
  warnings: VpmProjectWarningDto[]
  legacy: {
    readOnly: true
    truncated: boolean
    candidates: VpmProjectLegacyDto[]
  }
}
