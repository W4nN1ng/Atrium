import type { VpmErrorCode } from '../../../shared/vpm/errors'

/**
 * P4-A 的操作状态集合。
 *
 * 和 VPM 架构 §6.4/§7.1 一致；`needs_attention` 是“现场无法判定”的保守状态，
 * 不表示成功，也不表示已经回滚。
 */
export const OPERATION_STATUSES = [
  'planned',
  'preflight',
  'applying',
  'committed',
  'failed',
  'rolled_back',
  'needs_attention'
] as const

export type OperationStatus = (typeof OPERATION_STATUSES)[number]

/** 会占用“同一工程串行”名额的状态；对应 vpm.db 的部分唯一索引。 */
export const ACTIVE_OPERATION_STATUSES = ['planned', 'preflight', 'applying'] as const

export type ActiveOperationStatus = (typeof ACTIVE_OPERATION_STATUSES)[number]

export const OPERATION_KINDS = ['install', 'remove', 'upgrade', 'undo'] as const

export type OperationKind = (typeof OPERATION_KINDS)[number]

export const STEP_STATUSES = ['running', 'done', 'failed', 'skipped'] as const

export type StepStatus = (typeof STEP_STATUSES)[number]

export const FILE_ACTIONS = ['move-out', 'move-in', 'legacy', 'vault'] as const

export type FileAction = (typeof FILE_ACTIONS)[number]

export const FILE_STATES = ['pending', 'done', 'failed', 'archived'] as const

export type FileState = (typeof FILE_STATES)[number]

/**
 * 提交点只有 manifest 原子替换。
 * - before：manifest 还是旧的，失败可反向移回；
 * - manifest_written：manifest 已经换成新的，恢复只能补完/归档，不能假装回滚。
 */
export const COMMIT_POINTS = ['before', 'manifest_written'] as const

export type CommitPoint = (typeof COMMIT_POINTS)[number]

export interface OperationStepRecord {
  opId: string
  step: string
  seq: number
  status: StepStatus
  attempts: number
  detailJson: string | null
  startedAt: number | null
  finishedAt: number | null
}

export interface OperationFileRecord {
  opId: string
  path: string
  action: FileAction
  vaultPath: string | null
  sha256: string | null
  size: number | null
  state: FileState
}

export interface OperationRecord {
  id: string
  projectKey: string
  projectPath: string
  kind: OperationKind
  status: OperationStatus
  planJson: string
  planHash: string
  projectFingerprint: string | null
  manifestBeforeHash: string | null
  manifestAfterHash: string | null
  summaryJson: string | null
  errorCode: VpmErrorCode | null
  errorDetail: string | null
  vaultPending: boolean
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  steps: OperationStepRecord[]
  files: OperationFileRecord[]
}

export interface CreateOperationInput {
  /** 测试/重放可指定；默认生成 ULID。 */
  id?: string
  projectKey: string
  projectPath: string
  kind: OperationKind
  /** P3 计划对象；只接受主进程内部数据，不接受渲染层回传。 */
  plan: unknown
  planHash: string
  projectFingerprint?: string | null
  manifestBeforeHash?: string | null
  manifestAfterHash?: string | null
  summary?: unknown
}

export interface TransitionOptions {
  /** 未提供时保留旧值；显式 null 表示清空。 */
  errorCode?: VpmErrorCode | null
  errorDetail?: string | null
  /** 恢复扫描读不到 journal 时必须为 false：不能伪造/覆盖现场证据。 */
  journal?: boolean
}

export interface BeginStepInput {
  step: string
  seq: number
  detail?: unknown
}

export interface BeginStepResult {
  step: OperationStepRecord
  created: boolean
}

export interface OperationFileInput {
  path: string
  action: FileAction
  vaultPath?: string | null
  sha256?: string | null
  size?: number | null
  state?: FileState
}

export const JOURNAL_EVENT_TYPES = [
  'operation_created',
  'operation_status',
  'step_started',
  'step_finished',
  'file_changed',
  'commit_point',
  'legacy_paths',
  'vault_pending',
  'manifest_hashes'
] as const

export type JournalEventType = (typeof JOURNAL_EVENT_TYPES)[number]

export type JournalDetailValue = string | number | boolean | null

export interface JournalEvent {
  at: number
  /** 幂等键：同一事件重复写入时只保留第一次。 */
  key: string
  type: JournalEventType
  detail: Record<string, JournalDetailValue>
}

export interface JournalStep {
  key: string
  step: string
  seq: number
  status: StepStatus
  attempts: number
  startedAt: number | null
  finishedAt: number | null
}

export interface JournalMove {
  path: string
  action: FileAction
  state: FileState
  vaultPath: string | null
  sha256: string | null
  size: number | null
}

/**
 * `.atrium-tx/<op>/journal.json` 的磁盘快照。
 *
 * 这是数据库坏掉时仍能说明“现场是什么样”的证据：
 * - 只追加 events，不删历史；
 * - moves/steps 是当前状态的镜像；
 * - 不存 token、请求头、文件内容。
 */
export interface OperationJournalSnapshot {
  schemaVersion: 1
  opId: string
  projectKey: string
  kind: OperationKind
  phase: OperationStatus
  commitPoint: CommitPoint
  planHash: string
  projectFingerprint: string | null
  manifest: {
    relativePath: string
    beforeHash: string | null
    afterHash: string | null
  }
  steps: JournalStep[]
  moves: JournalMove[]
  legacyPaths: string[]
  vaultPending: boolean
  createdAt: number
  updatedAt: number
  events: JournalEvent[]
}

export type JournalInspection =
  | { status: 'ok'; journal: OperationJournalSnapshot }
  | { status: 'missing' }
  | { status: 'invalid' }

export type RecoveryAction = 'none' | 'rollback' | 'complete' | 'needs_attention' | 'wait'

export type RecoveryReason =
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

export interface RecoveryDecision {
  operationId: string
  projectKey: string
  projectPath: string
  status: OperationStatus
  action: RecoveryAction
  reason: RecoveryReason
  journalPhase: OperationStatus | null
}

export interface RecoveryOutcome {
  decision: RecoveryDecision
  applied: boolean
  resultStatus: OperationStatus | null
  errorCode: VpmErrorCode | null
}
