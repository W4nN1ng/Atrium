import { reverseRequests } from '../../shared/vpm/domain/undo'
import type { ChangePlan } from '../../shared/vpm/domain/plan'
import { VpmError } from '../../shared/vpm/errors'
import type { VpmUndoBlockedReason } from '../../shared/vpm/dto'
import type { ApplyPlanResult, InstallTransactionService, OperationRecord, OperationStore } from './install'
import type { PlanService } from './planService'
import type { ProjectsService } from './projects'
import type { ProjectActivityPort } from './install'

export interface UndoServiceOptions {
  operations: OperationStore
  plans: PlanService
  projects: ProjectsService
  transactions: InstallTransactionService
  activity?: ProjectActivityPort
}

export interface UndoGate {
  ok: boolean
  reason: VpmUndoBlockedReason | null
}

/**
 * 撤销上一次操作（P4 §7.5）。
 *
 * 只允许：
 * - 该工程**最后一次**操作，且状态是 `committed`；
 * - 当前 manifest hash == 那次操作的 `manifestAfterHash`（工程之后没被改过）；
 * - 没有正在进行的操作、Unity 没在跑；
 * - 能从计划里推导出反向请求。
 *
 * 撤销本身也是操作：生成反向计划 → 走同一个事务（kind='undo'）→ 有 journal 记录，
 * 因此可以再撤销（如果仍然安全）。
 */
export class UndoService {
  private readonly operations: OperationStore
  private readonly plans: PlanService
  private readonly projects: ProjectsService
  private readonly transactions: InstallTransactionService
  private readonly activity?: ProjectActivityPort

  constructor(options: UndoServiceOptions) {
    this.operations = options.operations
    this.plans = options.plans
    this.projects = options.projects
    this.transactions = options.transactions
    this.activity = options.activity
  }

  /** 判定能不能撤销；不抛异常，给 UI 直接显示原因。 */
  canUndo(operation: OperationRecord): UndoGate {
    if (operation.status !== 'committed') return { ok: false, reason: 'notCommitted' }
    if (this.operations.findActive(operation.projectKey)) return { ok: false, reason: 'busy' }

    const latest = this.operations.list(operation.projectKey, 1)[0]
    if (!latest || latest.id !== operation.id) return { ok: false, reason: 'notLatest' }

    let manifestHash: string | null = null
    try {
      manifestHash = this.projects.scan(operation.projectPath).manifestHash
    } catch {
      return { ok: false, reason: 'projectChanged' }
    }
    if (!operation.manifestAfterHash || manifestHash !== operation.manifestAfterHash) {
      return { ok: false, reason: 'projectChanged' }
    }

    if (this.isActive(operation.projectPath)) return { ok: false, reason: 'unityRunning' }
    if (this.reverseOf(operation).length === 0) return { ok: false, reason: 'noReverse' }
    return { ok: true, reason: null }
  }

  /** 执行撤销：生成反向计划并走同一事务。失败抛 `vpmUndoUnsafe`（带 reason）。 */
  async undo(operationId: string): Promise<ApplyPlanResult> {
    const operation = this.operations.get(operationId)
    if (!operation) throw new VpmError('vpmOperationNotFound', { operationId })

    const gate = this.canUndo(operation)
    if (!gate.ok) throw new VpmError('vpmUndoUnsafe', { reason: gate.reason ?? 'unsupported' })

    const plan = this.plans.resolve({
      projectKey: operation.projectKey,
      requests: this.reverseOf(operation)
    })
    return this.transactions.apply({
      projectKey: operation.projectKey,
      planId: plan.planId,
      kind: 'undo'
    })
  }

  private reverseOf(operation: OperationRecord) {
    const plan = this.planOf(operation)
    return plan ? reverseRequests(plan.changes) : []
  }

  private planOf(operation: OperationRecord): ChangePlan | null {
    try {
      const parsed: unknown = JSON.parse(operation.planJson)
      if (!parsed || typeof parsed !== 'object') return null
      const changes = (parsed as { changes?: unknown }).changes
      if (!Array.isArray(changes)) return null
      return parsed as ChangePlan
    } catch {
      return null
    }
  }

  private isActive(projectPath: string): boolean {
    if (!this.activity) return false
    try {
      const state = this.activity.state(projectPath)
      return state?.unityRunning === true
    } catch {
      // 闸门自己坏了：按"可能在用"处理，不允许撤销。
      return true
    }
  }
}
