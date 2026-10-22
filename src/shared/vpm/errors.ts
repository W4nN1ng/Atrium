/**
 * VPM 子系统的错误码与文案 key。
 *
 * 规矩：主进程只说 code + 参数，界面用 `vpm.errors.<code>` 出文案。
 * 这里不出现中文提示，避免主进程把 UI 文案写死。
 */

export const VPM_ERROR_CODES = [
  'vpmDisabled',
  'vpmSafeMode',
  'vpmDataRootRequired',
  'vpmDataRootInvalid',
  'vpmDataRootOnSystemDrive',
  'vpmDataRootInsideLibrary',
  'vpmDataRootInsideProject',
  'vpmDataRootInsideApp',
  'vpmDataRootNotWritable',
  'vpmSnapshotFailed',
  'vpmConfigRecovered',
  'vpmDbOpenFailed',
  'vpmDbVersionTooNew',
  'vpmDbMigrationFailed',
  'vpmDbBackupFailed',
  'vpmDbIntegrityFailed',
  'vpmRepoInvalid',
  'vpmRepoConflict',
  'vpmRepoNotFound',
  'vpmVersionInvalid',
  'vpmRangeInvalid',
  'vpmUnityVersionInvalid',
  'vpmPackageIdInvalid',
  'vpmResolutionFailed',
  'vpmPlanNotFound',
  'vpmPlanExpired',
  'vpmPlanChanged',
  'vpmPlanBlocked',
  'vpmProjectChanged',
  'vpmUnityRunning',
  'vpmProjectImporting',
  'vpmProtectedPackage',
  'vpmProjectNoSpace',
  'vpmProjectPathUnsafe',
  'vpmTransactionFailed',
  'vpmRollbackFailed',
  'vpmVaultUnavailable',
  'vpmVaultArchiveFailed',
  'vpmProjectInvalid',
  'vpmManifestInvalid',
  'vpmProjectPackagesUnreadable',
  'vpmProjectAccessDenied',
  'vpmProjectBusy',
  'vpmOperationNotFound',
  'vpmOperationInvalid',
  'vpmJournalInvalid',
  'vpmJournalWriteFailed',
  'vpmRecoveryRequired',
  'vpmUndoUnsafe',
  'vpmTemplateNotFound',
  'vpmTemplateInvalid',
  'vpmTemplateReadOnly',
  'vpmTemplateWriteFailed',
  'vpmCreateRejected',
  'vpmCreateFailed',
  'vpmCollectCancelled',
  'vpmBackupCancelled',
  'vpmBackupFailed',
  'vpmBackupInvalid',
  'vpmBackupUnsafe',
  'vpmBackupTooLarge',
  'vpmBackupConflict',
  'vpmUnityPackageInvalid',
  'vpmUnityPackageUnsafe',
  'vpmUnityPackageConflict',
  'vpmUnityPackageTooLarge',
  'vpmUnityPackageFailed',
  'vpmCancelTooLate',
  'vpmUnityNotFound',
  'vpmUnityLaunchFailed',
  'vpmUnityInvalid',
  'vpmUnityAccessDenied',
  'vpmUnityVersionUnknown',
  'vpmNetworkNotConsented',
  'vpmHttpBlocked',
  'vpmHttpTimeout',
  'vpmHttpTooLarge',
  'vpmHttpStatus',
  'vpmHttpRedirect',
  'vpmHttpNetwork',
  'vpmHttpInvalidJson',
  'vpmHttpAborted',
  'vpmCachePathInvalid',
  'vpmCacheWriteFailed',
  'vpmCacheHashMismatch',
  'vpmCacheHashMissing',
  'vpmCacheQuotaExceeded',
  'vpmCacheNoSpace',
  'vpmArchiveInvalid',
  'vpmArchiveUnsafePath',
  'vpmArchiveSymlink',
  'vpmArchiveBomb',
  'vpmArchivePackageInvalid',
  'vpmArchiveWriteFailed',
  'vpmRuntimeNotReady',
  'vpmInternal'
] as const

export type VpmErrorCode = (typeof VPM_ERROR_CODES)[number]

export const VPM_WARNING_CODES = [
  'vpmDataRootUnc',
  'vpmDataRootRemovable',
  'vpmDataRootNonNtfs',
  'vpmProjectSymlinkSkipped',
  'vpmProjectDuplicatePackage',
  'vpmProjectScanTruncated',
  'vpmProjectPackageInvalid',
  'vpmProjectMissingPackage',
  'vpmProjectVersionMismatch',
  'vpmLegacyCleanupSkipped',
  'vpmLegacyCleanupFailed',
  'vpmVaultPending'
] as const

export type VpmWarningCode = (typeof VPM_WARNING_CODES)[number]

export type VpmParams = Record<string, string | number>

/** 带机器可读 code 的错误；message 仍是 `i18n:` key，兼容现有 IPC 文案链路。 */
export class VpmError extends Error {
  readonly code: VpmErrorCode
  readonly params?: VpmParams

  constructor(code: VpmErrorCode, params?: VpmParams, cause?: unknown) {
    super(vpmErrorKey(code), { cause })
    this.name = 'VpmError'
    this.code = code
    this.params = params
  }
}

export function vpmErrorKey(code: VpmErrorCode): string {
  return `i18n:vpm.errors.${code}`
}

export function vpmWarningKey(code: VpmWarningCode): string {
  return `vpm.warnings.${code}`
}

export function isVpmErrorCode(value: string): value is VpmErrorCode {
  return (VPM_ERROR_CODES as readonly string[]).includes(value)
}

export function isVpmWarningCode(value: string): value is VpmWarningCode {
  return (VPM_WARNING_CODES as readonly string[]).includes(value)
}
