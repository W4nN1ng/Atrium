import type { VpmErrorCode } from '../errors'

/** 渲染层看到的状态集合；与 `main/vpm/install/types.ts` 保持一致（有编译期对齐检查）。 */
export type VpmOperationStatus =
  | 'planned'
  | 'preflight'
  | 'applying'
  | 'committed'
  | 'failed'
  | 'rolled_back'
  | 'needs_attention'

export type VpmOperationKind = 'install' | 'remove' | 'upgrade' | 'undo'

export interface VpmOperationWarningDto {
  code: string
  params?: Record<string, string | number>
  detail: string | null
}

/** 恢复动作；`none` = 已结束，不需要恢复。 */
export type VpmRecoveryAction = 'none' | 'rollback' | 'complete' | 'needs_attention' | 'wait'

export type VpmRecoveryReason =
  | 'terminal'
  | 'manifest_committed'
  | 'before_commit'
  | 'journal_missing'
  | 'journal_invalid'
  | 'journal_mismatch'
  | 'project_missing'
  | 'project_changed'
  | 'project_busy'
  | 'unity_running'

/**
 * `needs_attention`/未收尾操作的可解释判定。
 *
 * - `canApply=true`：现在点"恢复"会真的动文件（回滚或补完）；
 * - `canApply=false`：先按原因处理外部条件（关 Unity、修复 manifest/journal），再重试；
 * - `applied` 等结果只在 `OperationRecover` 返回值里，不存 DB。
 */
export interface VpmRecoveryDecisionDto {
  operationId: string
  action: VpmRecoveryAction
  reason: VpmRecoveryReason
  journalPhase: VpmOperationStatus | null
  canApply: boolean
}

/** 一次操作的结果/状态；`OperationStatus` 与 `PlanApply` 返回同一个形状。 */
export interface VpmOperationDto {
  operationId: string
  projectKey: string
  kind: VpmOperationKind
  status: VpmOperationStatus
  errorCode: VpmErrorCode | null
  errorDetail: string | null
  warnings: VpmOperationWarningDto[]
  installed: string[]
  removed: string[]
  kept: string[]
  vaultPending: boolean
  elapsedMs: number
  /** `before` = 还没写 manifest；`manifest_written` = 已提交。 */
  commitPoint: 'before' | 'manifest_written'
  /** 未收尾操作才给；committed/failed/rolled_back 为 null。 */
  recovery: VpmRecoveryDecisionDto | null
}

/** 手动恢复的结果：操作本身 + 这次实际执行的判定。 */
export interface VpmOperationRecoveryResultDto {
  operation: VpmOperationDto
  decision: VpmRecoveryDecisionDto
  applied: boolean
  resultStatus: VpmOperationStatus | null
  errorCode: VpmErrorCode | null
}

export interface VpmOperationStartInput {
  projectKey: string
  /** 只给 planId；渲染层不能回传计划内容。 */
  planId: string
}

export interface VpmOperationCancelResult {
  ok: boolean
  /** true = 已过提交点，取消来不及了；操作会继续跑完。 */
  tooLate: boolean
}

export type VpmUndoBlockedReason =
  | 'notCommitted'
  | 'notLatest'
  | 'projectChanged'
  | 'unityRunning'
  | 'busy'
  | 'noReverse'
  | 'unsupported'

export interface VpmOperationSummaryDto {
  operationId: string
  projectKey: string
  kind: VpmOperationKind
  status: VpmOperationStatus
  createdAt: number
  finishedAt: number | null
  errorCode: VpmErrorCode | null
  /** 变更条数（来自计划摘要）。 */
  changeCount: number
  /** 这次操作能不能撤销；不能时给原因。 */
  canUndo: boolean
  undoBlockedReason: VpmUndoBlockedReason | null
  /** 未收尾操作可点"恢复"；已结束为 null。 */
  recovery: VpmRecoveryDecisionDto | null
}

export interface VpmOperationProgressEvent {
  operationId: string
  projectKey: string
  step: string
  phase: 'start' | 'done' | 'failed'
  index: number
  total: number
}

export interface VpmOperationDoneEvent {
  operationId: string
  projectKey: string
  status: VpmOperationStatus
  errorCode: VpmErrorCode | null
}

export interface VpmPackageVersionOptionDto {
  version: string
  latest: boolean
  yanked: boolean
  deprecated: boolean
  unityMin: string | null
  repoName: string | null
}

/** 单个包在仓库里的可选版本；工程包里没有的字段不回传。 */
export interface VpmPackageCatalogInfoDto {
  name: string
  displayName: string | null
  sourceName: string | null
  latestVersion: string | null
  versions: VpmPackageVersionOptionDto[]
  hasConflict: boolean
}

export interface VpmProjectCatalogDto {
  packages: VpmPackageCatalogInfoDto[]
  /** 超过上限时只回传前 N 个，避免一次 IPC 太大。 */
  truncated: boolean
}
