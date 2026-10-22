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
  status: 'launched' | 'alreadyRunning'
  exePath: string
  version: string | null
  args: string[]
  pid: number | null
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
