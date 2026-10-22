import fs from 'node:fs'
import { VpmError, type VpmErrorCode } from '../../../shared/vpm/errors'
import { OperationJournalStore } from './journal'
import type { OperationStore } from './state'
import type {
  OperationRecord,
  OperationStatus,
  RecoveryDecision,
  RecoveryOutcome
} from './types'

export interface RecoveryServiceOptions {
  operations: OperationStore
  journals?: OperationJournalStore
  /**
   * Unity 运行/素材导入中的活动闸门（P4-F 注入）。
   * 返回 true 时只报告 wait，不自动改状态、不碰文件。
   */
  isProjectActive?: (projectPath: string) => boolean
}

function projectExists(projectPath: string): boolean {
  try {
    return fs.statSync(projectPath).isDirectory()
  } catch {
    return false
  }
}

/**
 * 启动恢复扫描骨架。
 *
 * P4-A 只做判定和“保守落状态”，绝不移动/删除工程文件：
 * - journal 缺失/损坏/对不上 → needs_attention（保留现场，不伪造 journal）；
 * - 未过提交点 → rollback 判定；真正回滚留给 P4-D，当前先把操作标成
 *   needs_attention，避免假装成功或继续写；
 * - 已过提交点 → 可以安全标 committed（归档留给后续阶段）；
 * - Unity/导入正在运行 → wait，保持原状态，下次关闭后再扫。
 *
 * 判定的核心原则：无法证明安全，就 needs_attention。
 */
export class RecoveryService {
  private readonly operations: OperationStore
  private readonly journals: OperationJournalStore
  private readonly isProjectActive?: (projectPath: string) => boolean

  constructor(options: RecoveryServiceOptions) {
    this.operations = options.operations
    this.journals = options.journals ?? new OperationJournalStore()
    this.isProjectActive = options.isProjectActive
  }

  scan(): RecoveryDecision[] {
    return this.operations.listActive().map((operation) => this.decide(operation))
  }

  apply(decisions: readonly RecoveryDecision[]): RecoveryOutcome[] {
    return decisions.map((decision) => this.applyOne(decision))
  }

  scanAndApply(): RecoveryOutcome[] {
    return this.apply(this.scan())
  }

  private decide(operation: OperationRecord): RecoveryDecision {
    const base = {
      operationId: operation.id,
      projectKey: operation.projectKey,
      projectPath: operation.projectPath,
      status: operation.status,
      journalPhase: null
    }

    if (!projectExists(operation.projectPath)) {
      return { ...base, action: 'needs_attention', reason: 'project_missing' }
    }

    let active = false
    if (this.isProjectActive) {
      try {
        active = this.isProjectActive(operation.projectPath) === true
      } catch {
        // 活动闸门自己坏了，按“可能在用”处理，绝不自动改现场。
        active = true
      }
    }
    if (active) {
      return { ...base, action: 'wait', reason: 'unity_running' }
    }

    const inspection = this.journals.inspect(operation.projectPath, operation.id)
    if (inspection.status === 'missing') {
      return { ...base, action: 'needs_attention', reason: 'journal_missing' }
    }
    if (inspection.status === 'invalid') {
      return { ...base, action: 'needs_attention', reason: 'journal_invalid' }
    }

    const journal = inspection.journal
    const withPhase = { ...base, journalPhase: journal.phase }
    if (
      journal.opId !== operation.id ||
      journal.projectKey !== operation.projectKey ||
      journal.kind !== operation.kind
    ) {
      return { ...withPhase, action: 'needs_attention', reason: 'journal_mismatch' }
    }

    if (journal.commitPoint === 'manifest_written') {
      return { ...withPhase, action: 'complete', reason: 'manifest_committed' }
    }
    return { ...withPhase, action: 'rollback', reason: 'before_commit' }
  }

  private applyOne(decision: RecoveryDecision): RecoveryOutcome {
    if (decision.action !== 'complete' && decision.action !== 'rollback' && decision.action !== 'needs_attention') {
      return {
        decision,
        applied: false,
        resultStatus: decision.status,
        errorCode: null
      }
    }

    const current = this.operations.get(decision.operationId)
    if (!current) {
      return {
        decision,
        applied: false,
        resultStatus: null,
        errorCode: 'vpmOperationNotFound'
      }
    }
    if (
      current.status === 'committed' ||
      current.status === 'failed' ||
      current.status === 'rolled_back' ||
      current.status === 'needs_attention'
    ) {
      return {
        decision,
        applied: false,
        resultStatus: current.status,
        errorCode: null
      }
    }

    const target: OperationStatus =
      decision.action === 'complete' ? 'committed' : 'needs_attention'
    const writeJournal =
      decision.reason !== 'journal_missing' &&
      decision.reason !== 'journal_invalid' &&
      decision.reason !== 'journal_mismatch' &&
      decision.reason !== 'project_missing'
    const errorCode: VpmErrorCode | null =
      target === 'needs_attention'
        ? this.errorCodeFor(decision)
        : null

    try {
      const updated = this.operations.transition(decision.operationId, target, {
        journal: writeJournal,
        errorCode,
        errorDetail: target === 'needs_attention' ? decision.reason : null
      })
      return {
        decision,
        applied: true,
        resultStatus: updated.status,
        errorCode: null
      }
    } catch (error) {
      return {
        decision,
        applied: false,
        resultStatus: null,
        errorCode: error instanceof VpmError ? error.code : 'vpmInternal'
      }
    }
  }

  private errorCodeFor(decision: RecoveryDecision): VpmErrorCode {
    if (
      decision.reason === 'journal_missing' ||
      decision.reason === 'journal_invalid' ||
      decision.reason === 'journal_mismatch'
    ) {
      return 'vpmJournalInvalid'
    }
    return 'vpmRecoveryRequired'
  }
}
