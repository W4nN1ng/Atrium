import type { VpmErrorCode, VpmParams, VpmWarningCode } from './errors'

export const VPM_SETTINGS_SCHEMA_VERSION = 1

export interface VpmRollbackSnapshot {
  path: string
  sha256: string
  createdAt: string
}

/**
 * `%APPDATA%\A\vpm\settings.json`。
 *
 * 这是 VPM 自己的设置，**不要**塞进核心 `AppSettings`：
 * 停用/移除 VPM 时，核心设置不需要迁移，也不会留下半套字段。
 */
export interface VpmSettingsFile {
  schemaVersion: typeof VPM_SETTINGS_SCHEMA_VERSION
  enabled: boolean
  networkConsentAt: string | null
  dataRoot: string | null
  cacheQuotaGb: number
  vaultQuotaGb: number
  allowPrerelease: boolean
  hiddenPackageIds: string[]
  defaultUnityArgs: string
  checkUpdates: boolean
  rollbackSnapshot: VpmRollbackSnapshot | null
}

export interface VpmStatus {
  /** 持久化开关；安全模式下仍可能是 true，界面另看 safeMode。 */
  enabled: boolean
  safeMode: boolean
  degraded: boolean
  /** 运行时/配置降级原因；正常为 null。 */
  degradedCode: VpmErrorCode | null
  dataRoot: string | null
  dataRootValid: boolean
  networkConsentAt: string | null
  configRecovered: boolean
  appVersion: string
  rollbackSnapshot: VpmRollbackSnapshot | null
}

export interface VpmDataRootContext {
  platform: string
  /** 例如 `C:`；从 `process.env.SystemDrive` 来，不写死盘符。 */
  systemDrive?: string | null
  libraryRoot?: string | null
  knownProjectPaths?: string[]
  appInstallDirs?: string[]
  /** 可选：main 侧探测到文件系统类型时传入。 */
  fsType?: string | null
  removable?: boolean
}

export type VpmDataRootValidation =
  | { ok: true; normalized: string; warnings: VpmWarningCode[] }
  | { ok: false; code: VpmErrorCode; params?: VpmParams }

/** 目录选择器返回：取消时 path=null；选择后带一次只读校验结果。 */
export interface VpmDataRootPick {
  path: string | null
  validation: VpmDataRootValidation | null
}

export interface VpmEnableInput {
  dataRoot: string
}

export interface VpmReadResult {
  settings: VpmSettingsFile
  recovered: boolean
  corruptPath: string | null
}
