import type { VpmErrorCode } from '../errors'

/** 编辑器（只给界面要用的字段，不含数据库行）。 */
export interface VpmUnityInstallDto {
  id: string
  path: string
  version: string | null
  versionWithRevision: string | null
  source: 'hub' | 'manual' | 'scan'
  missing: boolean
  versionUnknown: boolean
}

export interface VpmLaunchResultDto {
  /** `unverified` = 启动命令发出去了，但 45 秒内没看到工程被打开。 */
  status: 'launched' | 'alreadyRunning' | 'unverified'
  exePath: string
  version: string | null
  args: string[]
  pid: number | null
  /** 走的是 Unity Hub 协议。 */
  viaHub: boolean
  /** 看到 `Temp/UnityLockfile` = 工程真的被打开了。 */
  verified: boolean
}

export interface VpmCreateProjectInput {
  parentDir: string
  name: string
  unityVersion: string
  unityRevision?: string | null
  templateId?: string
}

export interface VpmCreateIssueDto {
  code: string
  detail: string | null
}

export interface VpmCreateProjectResultDto {
  projectPath: string
  projectKey: string
  templateId: string
  dependencyStatus: 'none' | 'installed' | 'failed'
  operationId: string | null
  errorCode: VpmErrorCode | null
  warnings: VpmCreateIssueDto[]
}

export interface VpmTemplateDto {
  id: string
  name: string
  description: string | null
  source: 'builtin' | 'imported' | 'user'
  base: string | null
  unity: { min: string; max: string | null; recommended: string | null }
  dependencies: Record<string, string>
  unitypackages: Array<{ path: string; name: string | null }>
  favorite: boolean
  visible: boolean
  lastUsedAt: number | null
  builtin: boolean
  broken: boolean
  issues: string[]
}

export interface VpmRecentLocationDto {
  path: string
  lastUsedAt: number
}

export interface VpmBackupDto {
  id: string
  projectKey: string
  projectName: string
  filePath: string
  size: number | null
  sha256: string | null
  unityVersion: string | null
  packageCount: number | null
  status: 'running' | 'ok' | 'failed' | 'cancelled'
  createdAt: number
  finishedAt: number | null
  errorCode: string | null
}

export interface VpmCopyResultDto {
  projectPath: string
  files: number
  bytes: number
}

export interface VpmVersionChangeResultDto {
  previous: string
  next: string
  downgrade: boolean
  backupId: string | null
  backupSkipped: boolean
}

export interface VpmMigrateCandidateInput {
  packageId: string | null
  relativePath: string | null
  confidence: 'high' | 'medium' | 'low'
}

export interface VpmMigrateResultDto {
  backupId: string | null
  installed: string[]
  skipped: Array<{ packageId: string; reason: string }>
  failed: Array<{ packageId: string; errorCode: string | null }>
}

export interface VpmRepoHeadersDto {
  available: boolean
  names: string[]
}

export interface VpmRepoTestDto {
  ok: boolean
  status: number | null
  errorCode: string | null
}
