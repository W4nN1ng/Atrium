import fs from 'node:fs'
import path from 'node:path'
import { sha256Hex } from '../../../shared/vpm/domain/hash'
import { projectSlugOf } from '../../../shared/vpm/domain/project'
import { VpmError, type VpmErrorCode } from '../../../shared/vpm/errors'
import { lstatOrNull, renameSyncWithRetry, writeFileAtomic } from '../fsUtil'
import type { VaultStore } from '../vault'
import { MANIFEST_RELATIVE_PATH, OperationJournalStore, transactionLayout } from './journal'
import type { OperationStore } from './state'
import type {
  OperationJournalSnapshot,
  OperationRecord,
  OperationStatus,
  RecoveryDecision,
  RecoveryOutcome
} from './types'

export interface RecoveryServiceOptions {
  operations: OperationStore
  journals?: OperationJournalStore
  /**
   * 回滚仓：已过提交点的操作在恢复时补完归档。
   * 不传时只改状态、不碰文件（P4-A 行为）。
   */
  vault?: VaultStore
  /**
   * Unity 运行/素材导入中的活动闸门（P4-F 注入）。
   * 返回 true 时只报告 wait，不自动改状态、不碰文件。
   */
  isProjectActive?: (projectPath: string) => boolean
  /**
   * 其它占用：同进程事务、素材导入、备份/复制/迁移/换版本的维护租约。
   * 恢复同样只 wait；回调自己抛错按“占用”处理（fail closed）。
   */
  isProjectBusy?: (projectKey: string, projectPath: string) => boolean
  /** 恢复时的 rename 重试次数；默认 3（同步、不睡眠）。 */
  renameRetries?: number
}

type ManifestState = 'before' | 'after' | 'other'

function projectExists(projectPath: string): boolean {
  try {
    return fs.statSync(projectPath).isDirectory()
  } catch {
    return false
  }
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 900)
}

function hashOfFile(file: string): string | null {
  try {
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink() || !stat.isFile()) return null
    return sha256Hex(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function isTerminalStatus(status: OperationStatus): boolean {
  return status === 'committed' || status === 'failed' || status === 'rolled_back'
}

/**
 * 启动恢复扫描与执行。
 *
 * 判定（`scan`，只读）：
 * - 工程不存在 / journal 缺失 / journal 损坏 / 工程键不符 → `needs_attention`；
 * - Unity/导入正在使用工程 → `wait`，保持原状态；
 * - journal 已过提交点 → `complete`；
 * - **journal 还写 `before`，但磁盘 manifest 的 hash 已经是 `afterHash`** → `complete`
 *   （rename 与 markCommitPoint 之间的崩溃窗口，P4-C 交接里的第一条建议）；
 * - 磁盘 manifest 既不是 before 也不是 after（被外部改过）→ `needs_attention`；
 * - 其余 → `rollback`。
 *
 * 执行（`apply`，会动文件）：
 * - `complete`：补写提交点（如果缺）→ `committed` → 补完 vault 归档；
 * - `rollback`：撤销 move-in → 恢复 move-out → 恢复 legacy → 还原 manifest，
 *   然后 `rolled_back`（没有任何移动时 `failed`）；
 * - 回滚失败 → `needs_attention` + `vpmRollbackFailed`，**不删任何文件**。
 *
 * 恢复是幂等的：重复执行同一判定不会产生新的移动（每步都先看磁盘现状）。
 */
export class RecoveryService {
  private readonly operations: OperationStore
  private readonly journals: OperationJournalStore
  private readonly vault?: VaultStore
  private readonly isProjectActive?: (projectPath: string) => boolean
  private readonly isProjectBusy?: (projectKey: string, projectPath: string) => boolean
  private readonly renameRetries: number
  /** 同一操作不允许两路恢复同时动文件（启动恢复 + 用户重试可能撞车）。 */
  private readonly inFlight = new Set<string>()

  constructor(options: RecoveryServiceOptions) {
    this.operations = options.operations
    this.journals = options.journals ?? new OperationJournalStore()
    this.vault = options.vault
    this.isProjectActive = options.isProjectActive
    this.isProjectBusy = options.isProjectBusy
    this.renameRetries = Math.max(1, Math.trunc(options.renameRetries ?? 3))
  }

  scan(): RecoveryDecision[] {
    return this.operations.listActive().map((operation) => this.decide(operation))
  }

  /**
   * 单个操作的只读判定，给 UI 解释"为什么停在这里、能不能恢复"。
   *
   * - 终态返回 `action:'none' / reason:'terminal'`；
   * - `needs_attention` 也重新按磁盘/journal 判定，不迷信数据库里的旧结论；
   * - 读失败不抛异常，交给 UI 当"暂时无法判定"处理。
   */
  inspect(operationId: string): RecoveryDecision | null {
    let operation: OperationRecord | null
    try {
      operation = this.operations.get(operationId)
    } catch {
      return null
    }
    if (!operation) return null
    if (isTerminalStatus(operation.status)) return this.terminalDecision(operation)
    try {
      return this.decide(operation)
    } catch {
      return null
    }
  }

  /**
   * 用户手动重试恢复。
   *
   * 与启动扫描的区别：
   * - 允许 `needs_attention`（给人工修好证据后重试的机会）；
   * - 证据不足时只返回判定，不改状态、不动文件；
   * - Unity 占用时返回 `wait`，不强行恢复；
   * - 同一操作并发调用直接拒绝，避免两路同时 rename。
   */
  async recover(operationId: string): Promise<RecoveryOutcome> {
    const operation = this.operations.get(operationId)
    if (!operation) throw new VpmError('vpmOperationNotFound', { operationId })

    if (isTerminalStatus(operation.status)) {
      return {
        decision: this.terminalDecision(operation),
        applied: false,
        resultStatus: operation.status,
        errorCode: null
      }
    }

    const decision = this.decide(operation)
    if (decision.action === 'wait') {
      return { decision, applied: false, resultStatus: operation.status, errorCode: null }
    }
    if (decision.action === 'needs_attention') {
      if (operation.status === 'needs_attention') {
        return {
          decision,
          applied: false,
          resultStatus: operation.status,
          errorCode: this.errorCodeFor(decision)
        }
      }
      // 活动操作被判定为不可恢复：补写 needs_attention，释放"活动操作"名额；
      // 证据缺失时不写 journal，绝不伪造现场。
      return this.applyOne(decision, false)
    }
    return this.applyOne(decision, true)
  }

  async apply(decisions: readonly RecoveryDecision[]): Promise<RecoveryOutcome[]> {
    const outcomes: RecoveryOutcome[] = []
    for (const decision of decisions) outcomes.push(await this.applyOne(decision))
    return outcomes
  }

  async scanAndApply(): Promise<RecoveryOutcome[]> {
    return this.apply(this.scan())
  }

  private terminalDecision(operation: OperationRecord): RecoveryDecision {
    return {
      operationId: operation.id,
      projectKey: operation.projectKey,
      projectPath: operation.projectPath,
      status: operation.status,
      action: 'none',
      reason: 'terminal',
      journalPhase: null
    }
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

    let busy = false
    if (this.isProjectBusy) {
      try {
        busy = this.isProjectBusy(operation.projectKey, operation.projectPath) === true
      } catch {
        // 占用检查自己坏了，按“正在用”处理，绝不自动改现场。
        busy = true
      }
    }
    if (busy) {
      return { ...base, action: 'wait', reason: 'project_busy' }
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

    const manifest = this.manifestState(operation.projectPath, journal)
    if (manifest === 'after') {
      // rename 成功但 journal 还没标提交点：磁盘是真相，按已提交处理。
      return { ...withPhase, action: 'complete', reason: 'manifest_committed' }
    }
    if (manifest === 'other') {
      return { ...withPhase, action: 'needs_attention', reason: 'project_changed' }
    }
    return { ...withPhase, action: 'rollback', reason: 'before_commit' }
  }

  /** 磁盘 manifest 相对 journal 的位置；读不到/不是常规文件按“被改过”处理。 */
  private manifestState(projectPath: string, journal: OperationJournalSnapshot): ManifestState {
    const file = path.join(projectPath, MANIFEST_RELATIVE_PATH)
    const hash = hashOfFile(file)
    if (hash === null) {
      // 本来就没有 manifest（beforeHash 为空）→ 没有可回滚的 manifest，按 before 处理。
      return journal.manifest.beforeHash ? 'other' : 'before'
    }
    if (journal.manifest.afterHash && hash === journal.manifest.afterHash) return 'after'
    if (journal.manifest.beforeHash && hash === journal.manifest.beforeHash) return 'before'
    return 'other'
  }

  private async applyOne(decision: RecoveryDecision, manual = false): Promise<RecoveryOutcome> {
    if (decision.action === 'wait') {
      return { decision, applied: false, resultStatus: decision.status, errorCode: null }
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
      isTerminalStatus(current.status) ||
      (current.status === 'needs_attention' && !manual)
    ) {
      return {
        decision,
        applied: false,
        resultStatus: current.status,
        errorCode: null
      }
    }

    if (decision.action === 'needs_attention') {
      if (current.status === 'needs_attention') {
        // 已经在这个状态：只报告判定，不要假装"又恢复了一次"。
        return {
          decision,
          applied: false,
          resultStatus: current.status,
          errorCode: this.errorCodeFor(decision)
        }
      }
      const status = this.tryTransition(
        current.id,
        'needs_attention',
        this.errorCodeFor(decision),
        decision.reason,
        // journal 缺失/损坏/对不上时不能伪造证据，只能改 DB 状态。
        decision.reason !== 'journal_missing' &&
          decision.reason !== 'journal_invalid' &&
          decision.reason !== 'journal_mismatch' &&
          decision.reason !== 'project_missing'
      )
      return { decision, applied: true, resultStatus: status, errorCode: null }
    }

    const inspection = this.journals.inspect(current.projectPath, current.id)
    if (inspection.status !== 'ok') {
      if (current.status === 'needs_attention') {
        // 判定后被外部删/改坏：不重复"成功"，只报告证据已丢失。
        return {
          decision,
          applied: false,
          resultStatus: current.status,
          errorCode: 'vpmJournalInvalid'
        }
      }
      const status = this.tryTransition(
        current.id,
        'needs_attention',
        'vpmJournalInvalid',
        inspection.status
      )
      return { decision, applied: true, resultStatus: status, errorCode: null }
    }
    const journal = inspection.journal

    if (this.inFlight.has(current.id)) {
      throw new VpmError('vpmProjectBusy', { operationId: current.id })
    }
    this.inFlight.add(current.id)
    try {
      return decision.action === 'complete'
        ? await this.complete(current, journal, decision)
        : await this.rollback(current, journal, decision)
    } finally {
      this.inFlight.delete(current.id)
    }
  }

  /** 已过提交点：补写提交点（如果缺）→ committed → 补完归档。 */
  private async complete(
    operation: OperationRecord,
    journal: OperationJournalSnapshot,
    decision: RecoveryDecision
  ): Promise<RecoveryOutcome> {
    this.closeDanglingSteps(operation)
    try {
      if (journal.commitPoint !== 'manifest_written') {
        // 磁盘已经是新 manifest，但 journal 还写 before：先补证据再标 committed。
        this.operations.markCommitPoint(operation.id)
      }
    } catch (error) {
      const status = this.tryTransition(
        operation.id,
        'needs_attention',
        'vpmJournalWriteFailed',
        messageOf(error)
      )
      return { decision, applied: true, resultStatus: status, errorCode: null }
    }

    const status = this.tryTransition(operation.id, 'committed', null, null)
    // 归档补完是尽力而为：失败保留 vault_pending，工程仍可用。
    await this.finishArchive(operation, journal)
    return { decision, applied: true, resultStatus: status, errorCode: null }
  }

  /** 未过提交点：反向恢复；失败进 needs_attention，不删现场。 */
  private async rollback(
    operation: OperationRecord,
    journal: OperationJournalSnapshot,
    decision: RecoveryDecision
  ): Promise<RecoveryOutcome> {
    this.closeDanglingSteps(operation)
    let moved = 0
    try {
      moved = this.rollbackFiles(operation, journal)
    } catch (error) {
      const status = this.tryTransition(
        operation.id,
        'needs_attention',
        'vpmRollbackFailed',
        messageOf(error)
      )
      return { decision, applied: true, resultStatus: status, errorCode: 'vpmRollbackFailed' }
    }

    const target: OperationStatus = moved > 0 ? 'rolled_back' : 'failed'
    const status = this.tryTransition(operation.id, target, null, 'recovered')
    return { decision, applied: true, resultStatus: status, errorCode: null }
  }

  /**
   * 反向移动文件。每一步都先看磁盘现状，所以重复执行是安全的：
   * - move-in 的包还在 `Packages/` → 移到 `rolledback/`；
   * - move-out 的包还在 `trash/` → 移回 `Packages/`；
   * - legacy 的旧文件还在 `trash/legacy/` → 移回 `Assets/`；
   * - manifest 与 journal 的 beforeHash 不一致 → 用 `manifest.original.json` 还原。
   */
  private rollbackFiles(operation: OperationRecord, journal: OperationJournalSnapshot): number {
    const layout = transactionLayout(operation.projectPath, operation.id)
    const projectPath = operation.projectPath
    let moved = 0

    for (const move of journal.moves.filter((item) => item.action === 'move-in')) {
      const current = path.join(projectPath, move.path)
      if (!lstatOrNull(current)) continue
      const target = path.join(layout.rolledback, path.posix.basename(move.path))
      if (lstatOrNull(target)) {
        throw new VpmError('vpmRollbackFailed', { path: move.path })
      }
      this.rename(current, target)
      moved++
    }

    for (const move of journal.moves.filter((item) => item.action === 'move-out')) {
      if (!move.vaultPath) throw new VpmError('vpmRollbackFailed', { path: move.path })
      const trash = path.join(layout.trash, move.vaultPath)
      if (!lstatOrNull(trash)) continue
      const target = path.join(projectPath, move.path)
      if (lstatOrNull(target)) {
        throw new VpmError('vpmRollbackFailed', { path: move.path })
      }
      this.rename(trash, target)
      moved++
    }

    for (const move of journal.moves.filter((item) => item.action === 'legacy')) {
      if (!move.vaultPath) continue
      const trash = path.join(layout.trash, move.vaultPath)
      if (!lstatOrNull(trash)) continue
      const target = path.join(projectPath, move.path)
      if (lstatOrNull(target)) {
        throw new VpmError('vpmRollbackFailed', { path: move.path })
      }
      this.rename(trash, target)
      moved++
    }

    const manifestPath = path.join(projectPath, MANIFEST_RELATIVE_PATH)
    const currentHash = hashOfFile(manifestPath)
    if (journal.manifest.beforeHash && currentHash !== journal.manifest.beforeHash) {
      const stat = lstatOrNull(layout.manifestOriginal)
      if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
        throw new VpmError('vpmRollbackFailed', { path: MANIFEST_RELATIVE_PATH })
      }
      const original = fs.readFileSync(layout.manifestOriginal, 'utf8')
      if (sha256Hex(original) !== journal.manifest.beforeHash) {
        throw new VpmError('vpmRollbackFailed', { path: MANIFEST_RELATIVE_PATH })
      }
      writeFileAtomic(manifestPath, original)
      moved++
    }

    return moved
  }

  /** 已提交但没归档完：把 trash 里还在的条目补进回滚仓。 */
  private async finishArchive(
    operation: OperationRecord,
    journal: OperationJournalSnapshot
  ): Promise<boolean> {
    if (!this.vault) return false
    try {
      let layout: ReturnType<typeof transactionLayout>
      try {
        layout = transactionLayout(operation.projectPath, operation.id)
      } catch {
        return false
      }

      const entries: Array<{ relativePath: string; kind: 'file' | 'dir' }> = []
      for (const move of journal.moves) {
        if (move.action !== 'move-out' && move.action !== 'legacy') continue
        if (!move.vaultPath) continue
        const stat = lstatOrNull(path.join(layout.trash, move.vaultPath))
        if (!stat || stat.isSymbolicLink()) continue
        entries.push({
          relativePath: move.vaultPath,
          kind: stat.isDirectory() ? 'dir' : 'file'
        })
      }

      if (entries.length === 0) {
        this.trySetVaultPending(operation, false)
        return true
      }

      this.trySetVaultPending(operation, true)
      try {
        await this.vault.archive({
          projectSlug: projectSlugOf(operation.projectPath),
          opId: operation.id,
          sourceDir: layout.trash,
          entries
        })
        this.trySetVaultPending(operation, false)
        return true
      } catch {
        // 归档失败：保留事务区与 vault_pending，工程仍然可用。
        return false
      }
    } catch {
      // 提交后任何意外都不能把启动恢复/工程卡死；保留 pending，留给后续重试。
      this.trySetVaultPending(operation, true)
      return false
    }
  }

  /** 崩溃会留下 running 步骤；先关掉它们，否则后续步骤/人工操作都会被挡住。 */
  private closeDanglingSteps(operation: OperationRecord): void {
    for (const step of operation.steps) {
      if (step.status !== 'running') continue
      try {
        this.operations.finishStep(operation.id, step.step, 'failed', {
          reason: 'interrupted'
        })
      } catch {
        /* journal 已坏时无法记账；判定层会把它送进 needs_attention */
      }
    }
  }

  private rename(from: string, to: string): void {
    renameSyncWithRetry(from, to, this.renameRetries)
  }

  private trySetVaultPending(operation: OperationRecord, pending: boolean): void {
    try {
      // 不要用 operation 快照判断：它在 applyOne 开头读到，归档过程中已经变了。
      this.operations.setVaultPending(operation.id, pending)
    } catch {
      /* 状态记账失败不掩盖文件结果 */
    }
  }

  private tryTransition(
    opId: string,
    status: OperationStatus,
    code: VpmErrorCode | null,
    detail: string | null,
    writeJournal = true
  ): OperationStatus {
    try {
      return this.operations.transition(opId, status, {
        errorCode: code,
        errorDetail: detail,
        journal: writeJournal
      }).status
    } catch {
      const current = this.operations.get(opId)
      return current?.status ?? status
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
