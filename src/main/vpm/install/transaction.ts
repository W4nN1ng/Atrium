import fs from 'node:fs'
import path from 'node:path'
import { sha256Hex } from '../../../shared/vpm/domain/hash'
import { buildManifest } from '../../../shared/vpm/domain/manifest'
import { normalizePackageId } from '../../../shared/vpm/domain/packageId'
import type { ChangePlan, ChangePlanChange } from '../../../shared/vpm/domain/plan'
import { projectSlugOf, type ProjectSnapshot } from '../../../shared/vpm/domain/project'
import { VpmError, type VpmErrorCode, type VpmWarningCode } from '../../../shared/vpm/errors'
import {
  hashFile,
  lstatOrNull,
  removeEmptyDirectory,
  removeTree,
  renameWithRetry,
  writeFileAtomic
} from '../fsUtil'
import type { VaultStore } from '../vault'
import {
  extractPackageZip,
  type ExtractPackageZipInput,
  type ExtractedPackage
} from './archive'
import {
  MANIFEST_RELATIVE_PATH,
  ensureTransactionLayout,
  type TransactionLayout
} from './journal'
import { cleanupLegacyAssets, type LegacyGuardPort } from './legacy'
import {
  PROTECTED_PACKAGE_ID,
  collectPreflightFacts,
  evaluatePreflight,
  type PreflightActivity,
  type PreflightResult
} from './preflight'
import type { OperationStore } from './state'
import type { OperationKind, OperationRecord, OperationStatus } from './types'

const COMMIT_POINT_RETRIES = 3
const TOTAL_STEPS = 9

export interface TransactionProjectPort {
  load(projectKey: string): { projectPath: string; snapshot: ProjectSnapshot } | null
}

export interface PackageSourcePort {
  ensurePackage(input: {
    url: string
    sha256: string
    size?: number | null
    signal?: AbortSignal
  }): Promise<{ path: string; sha256: string; size: number; reused: boolean }>
}

export interface PlanSourcePort {
  get(planId: string): ChangePlan
}

export interface ProjectActivityPort {
  state(projectPath: string): PreflightActivity
}

export interface InstallTransactionOptions {
  operations: OperationStore
  plans: PlanSourcePort
  projects: TransactionProjectPort
  packages: PackageSourcePort
  vault: VaultStore
  /** 已校验的非 C 数据根；预检探测缓存卷空间用。 */
  dataRoot: string
  activity?: ProjectActivityPort
  legacyGuard?: LegacyGuardPort
  /** 测试注入；默认 `extractPackageZip`。 */
  extract?: (input: ExtractPackageZipInput) => Promise<ExtractedPackage>
  freeBytes?: (directory: string) => number | null
  renameRetries?: number
  renameDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  protectedPackages?: readonly string[]
  maxLegacyEntries?: number
}

export interface TransactionWarning {
  code: VpmErrorCode | VpmWarningCode
  params?: Record<string, string | number>
  detail: string | null
}

export interface ApplyPlanInput {
  projectKey: string
  /** 只接受主进程缓存里的 planId；不接受渲染层回传的计划内容。 */
  planId: string
  signal?: AbortSignal
  onProgress?: (progress: TransactionProgress) => void
}

export interface TransactionProgress {
  operationId: string
  step: string
  phase: 'start' | 'done' | 'failed'
  index: number
  total: number
}

export interface ApplyPlanResult {
  operationId: string
  status: OperationStatus
  errorCode: VpmErrorCode | null
  errorDetail: string | null
  warnings: TransactionWarning[]
  installed: string[]
  removed: string[]
  kept: string[]
  vaultPending: boolean
  elapsedMs: number
}

interface MovedOut {
  name: string
  relativePath: string
  trashRelativePath: string
}

interface MovedIn {
  name: string
  relativePath: string
}

interface LegacyMoved {
  path: string
  trashRelativePath: string
  kind: 'file' | 'dir'
}

interface TxContext {
  op: OperationRecord
  plan: ChangePlan
  snapshot: ProjectSnapshot
  projectPath: string
  /** prepare 步建好；建之前为 null，失败时不假装有现场。 */
  layout: TransactionLayout | null
  cached: Map<string, { path: string; sha256: string; size: number }>
  extracted: Map<string, ExtractedPackage>
  movedOut: MovedOut[]
  movedIn: MovedIn[]
  legacyMoved: LegacyMoved[]
  warnings: TransactionWarning[]
  /** manifest rename 已经发生；此后只能补完，不能假装回滚。 */
  manifestRenamed: boolean
  startedAt: number
  onProgress?: (progress: TransactionProgress) => void
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.slice(0, 480)
}

function kindOf(plan: ChangePlan): OperationKind {
  const actions = new Set(plan.changes.map((change) => change.action))
  if (actions.has('upgrade') || actions.has('downgrade') || actions.has('reinstall')) return 'upgrade'
  if (actions.size > 0 && [...actions].every((action) => action === 'remove' || action === 'keep')) {
    return 'remove'
  }
  return 'install'
}

function summarize(plan: ChangePlan): Record<string, number> {
  const count = (action: ChangePlanChange['action']): number =>
    plan.changes.filter((change) => change.action === action).length
  return {
    changes: plan.changes.length,
    install: count('install'),
    upgrade: count('upgrade') + count('downgrade') + count('reinstall'),
    remove: count('remove'),
    keep: count('keep'),
    downloads: plan.downloads.length,
    downloadBytes: Math.max(0, Math.trunc(plan.disk?.downloadBytes ?? 0))
  }
}

function needsMoveOut(change: ChangePlanChange): boolean {
  if (!change.from) return false
  return (
    change.action === 'remove' ||
    change.action === 'upgrade' ||
    change.action === 'downgrade' ||
    change.action === 'reinstall'
  )
}

function needsMoveIn(change: ChangePlanChange): boolean {
  return (
    change.action === 'install' ||
    change.action === 'upgrade' ||
    change.action === 'downgrade' ||
    change.action === 'reinstall'
  )
}

/**
 * 单计划安装事务（P4-C）。
 *
 * 顺序固定：
 *   prepare → download → extract → move-out → move-in → manifest（提交点）→
 *   legacy → vault → cleanup
 *
 * 不变量：
 * - **manifest 是最后一步原子写**：rename 成功前任何失败都必须能回到旧状态；
 * - rename 成功之后不再假装回滚，只允许补完或 `needs_attention`；
 * - 旧包/旧 Assets 只移动不删除；vault 归档失败保留事务区并标 `vault_pending`；
 * - Unity 运行中、素材导入中、工程被外部改动、受保护包、缺 hash、空间不足都在预检拒绝；
 * - 只消费 `PackageCacheService` 给的 `{path, sha256}`，不自己写缓存。
 */
export class InstallTransactionService {
  private readonly operations: OperationStore
  private readonly plans: PlanSourcePort
  private readonly projects: TransactionProjectPort
  private readonly packages: PackageSourcePort
  private readonly vault: VaultStore
  private readonly dataRoot: string
  private readonly activity?: ProjectActivityPort
  private readonly legacyGuard?: LegacyGuardPort
  private readonly extract: (input: ExtractPackageZipInput) => Promise<ExtractedPackage>
  private readonly freeBytes?: (directory: string) => number | null
  private readonly renameRetries?: number
  private readonly renameDelayMs?: number
  private readonly sleep?: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly protectedPackages: readonly string[]
  private readonly maxLegacyEntries?: number

  constructor(options: InstallTransactionOptions) {
    this.operations = options.operations
    this.plans = options.plans
    this.projects = options.projects
    this.packages = options.packages
    this.vault = options.vault
    this.dataRoot = options.dataRoot
    this.activity = options.activity
    this.legacyGuard = options.legacyGuard
    this.extract = options.extract ?? extractPackageZip
    this.freeBytes = options.freeBytes
    this.renameRetries = options.renameRetries
    this.renameDelayMs = options.renameDelayMs
    this.sleep = options.sleep
    this.now = options.now ?? Date.now
    this.protectedPackages = options.protectedPackages ?? [PROTECTED_PACKAGE_ID]
    this.maxLegacyEntries = options.maxLegacyEntries
  }

  async apply(input: ApplyPlanInput): Promise<ApplyPlanResult> {
    const plan = this.plans.get(input.planId)
    if (!plan || typeof plan !== 'object') throw new VpmError('vpmPlanNotFound')
    if (plan.projectKey !== input.projectKey) {
      throw new VpmError('vpmPlanChanged', { field: 'projectKey' })
    }
    const loaded = this.projects.load(input.projectKey)
    if (!loaded) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })

    const operation = this.operations.create({
      projectKey: input.projectKey,
      projectPath: loaded.projectPath,
      kind: kindOf(plan),
      plan,
      planHash: plan.planHash,
      projectFingerprint: loaded.snapshot.fingerprint,
      manifestBeforeHash: plan.manifestHashBefore || null,
      summary: summarize(plan)
    })

    const context: TxContext = {
      op: operation,
      plan,
      snapshot: loaded.snapshot,
      projectPath: loaded.projectPath,
      layout: null,
      cached: new Map(),
      extracted: new Map(),
      movedOut: [],
      movedIn: [],
      legacyMoved: [],
      warnings: [],
      manifestRenamed: false,
      startedAt: this.now(),
      onProgress: input.onProgress
    }

    try {
      this.operations.transition(operation.id, 'preflight')
      const preflight = this.runPreflight(context)
      context.warnings.push(
        ...preflight.warnings.map((issue) => ({
          code: issue.code,
          params: issue.params,
          detail: issue.detail ?? null
        }))
      )
      if (!preflight.ok) {
        const first = preflight.issues[0]
        const code = first.code as VpmErrorCode
        this.operations.transition(operation.id, 'failed', {
          errorCode: code,
          errorDetail: first.detail ?? null
        })
        return this.result(context, 'failed', code, first.detail ?? null)
      }

      this.operations.transition(operation.id, 'applying')
      await this.execute(context, input)
      const committed = this.operations.transition(operation.id, 'committed')
      return this.result(context, committed.status, null, null)
    } catch (error) {
      return await this.fail(context, error)
    }
  }

  private runPreflight(context: TxContext): PreflightResult {
    const facts = collectPreflightFacts({
      plan: context.plan,
      expectedPlanHash: context.plan.planHash,
      snapshot: context.snapshot,
      projectPath: context.projectPath,
      dataRoot: this.dataRoot,
      activity: this.activityOf(context.projectPath),
      vault: this.vault,
      freeBytes: this.freeBytes,
      protectedPackages: this.protectedPackages
    })
    return evaluatePreflight(facts)
  }

  private async execute(context: TxContext, input: ApplyPlanInput): Promise<void> {
    const layout = ensureTransactionLayout(context.projectPath, context.op.id)
    context.layout = layout

    const changes = context.plan.changes.filter((change) => change.action !== 'keep')
    const installs = changes.filter(needsMoveIn)
    const removals = changes.filter(needsMoveOut)

    await this.runStep(context, 'prepare', 1, async () => {
      this.assertNotAborted(input)
      const manifestPath = path.join(context.projectPath, MANIFEST_RELATIVE_PATH)
      const stat = lstatOrNull(manifestPath)
      if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
        throw new VpmError('vpmManifestInvalid', { field: MANIFEST_RELATIVE_PATH })
      }
      const original = fs.readFileSync(manifestPath, 'utf8')
      if (sha256Hex(original) !== context.plan.manifestHashBefore) {
        throw new VpmError('vpmProjectChanged', { field: 'manifest' })
      }
      writeFileAtomic(layout.manifestOriginal, original)
      return { changes: changes.length, installs: installs.length, removals: removals.length }
    })

    await this.runStep(context, 'download', 2, async () => {
      for (const download of context.plan.downloads) {
        this.assertNotAborted(input)
        const name = normalizePackageId(download.name)
        const cached = await this.packages.ensurePackage({
          url: download.url,
          sha256: download.sha256,
          size: download.size,
          signal: input.signal
        })
        if (cached.sha256.toLowerCase() !== download.sha256.toLowerCase()) {
          throw new VpmError('vpmCacheHashMismatch', { name })
        }
        context.cached.set(name, { path: cached.path, sha256: cached.sha256, size: cached.size })
      }
      return { packages: context.cached.size }
    })

    await this.runStep(context, 'extract', 3, async () => {
      for (const download of context.plan.downloads) {
        this.assertNotAborted(input)
        const name = normalizePackageId(download.name)
        const cached = context.cached.get(name)
        if (!cached) throw new VpmError('vpmCacheHashMissing', { name })
        const targetDir = path.join(layout.install, name)
        if (lstatOrNull(targetDir)) {
          throw new VpmError('vpmTransactionFailed', { step: 'extract' })
        }
        const extracted = await this.extract({
          zipPath: cached.path,
          targetDir,
          expected: { name, version: download.version }
        })
        context.extracted.set(name, extracted)
      }
      return { packages: context.extracted.size }
    })

    await this.runStep(context, 'move-out', 4, async () => {
      for (const change of removals) {
        this.assertNotAborted(input)
        const name = normalizePackageId(change.name)
        const relativePath = `Packages/${name}`
        const source = path.join(context.projectPath, relativePath)
        const stat = lstatOrNull(source)
        if (!stat) {
          context.warnings.push({
            code: 'vpmProjectMissingPackage',
            params: { name },
            detail: null
          })
          continue
        }
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
          throw new VpmError('vpmProjectPathUnsafe', { path: relativePath })
        }
        const trashRelativePath = `packages/${name}`
        const target = path.join(layout.trash, trashRelativePath)
        if (lstatOrNull(target)) throw new VpmError('vpmTransactionFailed', { step: 'move-out' })
        this.operations.upsertFile(context.op.id, {
          path: relativePath,
          action: 'move-out',
          vaultPath: trashRelativePath,
          state: 'pending'
        })
        await this.rename(source, target)
        this.operations.upsertFile(context.op.id, {
          path: relativePath,
          action: 'move-out',
          vaultPath: trashRelativePath,
          state: 'done'
        })
        context.movedOut.push({ name, relativePath, trashRelativePath })
      }
      return { moved: context.movedOut.length }
    })

    await this.runStep(context, 'move-in', 5, async () => {
      for (const change of installs) {
        this.assertNotAborted(input)
        const name = normalizePackageId(change.name)
        const extracted = context.extracted.get(name)
        if (!extracted) throw new VpmError('vpmTransactionFailed', { step: 'move-in' })
        const relativePath = `Packages/${name}`
        const target = path.join(context.projectPath, relativePath)
        if (lstatOrNull(target)) {
          throw new VpmError('vpmProjectChanged', { field: relativePath })
        }
        this.operations.upsertFile(context.op.id, {
          path: relativePath,
          action: 'move-in',
          state: 'pending'
        })
        await this.rename(extracted.rootDir, target)
        this.operations.upsertFile(context.op.id, {
          path: relativePath,
          action: 'move-in',
          state: 'done'
        })
        context.movedIn.push({ name, relativePath })
      }
      return { moved: context.movedIn.length }
    })

    await this.runStep(context, 'manifest', 6, async () => {
      this.assertNotAborted(input)
      const manifestPath = path.join(context.projectPath, MANIFEST_RELATIVE_PATH)
      const currentText = fs.readFileSync(manifestPath, 'utf8')
      if (sha256Hex(currentText) !== context.plan.manifestHashBefore) {
        // 提交前再比一次：Unity/用户/别的工具在事务期间改过 manifest。
        throw new VpmError('vpmProjectChanged', { field: 'manifest' })
      }

      const built = buildManifest({
        before: context.snapshot.manifest.data ?? {},
        roots: context.plan.roots,
        finalPackages: context.plan.finalPackages,
        removed: changes.filter((change) => change.action === 'remove').map((change) => change.name),
        dependenciesOf: this.dependenciesOf(context)
      })
      writeFileAtomic(layout.manifestNew, built.text)
      const written = await hashFile(layout.manifestNew)
      if (written.sha256 !== built.hash) {
        throw new VpmError('vpmTransactionFailed', { step: 'manifest' })
      }
      this.operations.setManifestHashes(context.op.id, {
        beforeHash: context.plan.manifestHashBefore,
        afterHash: built.hash
      })
      // 提交点：同卷 rename 覆盖 Packages/vpm-manifest.json。
      await this.rename(layout.manifestNew, manifestPath)
      context.manifestRenamed = true
      this.markCommitPoint(context.op.id)
      return { afterHash: built.hash, packages: context.plan.finalPackages.length }
    })

    await this.runStep(context, 'legacy', 7, async () => {
      const removed = changes
        .filter((change) => change.action === 'remove')
        .map((change) => change.name)
      if (removed.length === 0) return { skipped: true }
      try {
        const result = await cleanupLegacyAssets({
          projectPath: context.projectPath,
          trashDir: layout.trash,
          snapshot: context.snapshot,
          removedPackages: removed,
          guard: this.legacyGuard,
          maxEntries: this.maxLegacyEntries,
          renameRetries: this.renameRetries,
          sleep: this.sleep
        })
        context.legacyMoved.push(...result.moved)
        for (const moved of result.moved) {
          this.operations.upsertFile(context.op.id, {
            path: moved.path,
            action: 'legacy',
            vaultPath: moved.trashRelativePath,
            state: 'done'
          })
        }
        if (result.moved.length > 0) {
          this.operations.setLegacyPaths(
            context.op.id,
            result.moved.map((moved) => moved.path)
          )
        }
        if (result.skipped.length > 0) {
          context.warnings.push({
            code: 'vpmLegacyCleanupSkipped',
            params: { count: result.skipped.length },
            detail: result.skipped
              .map((item) => `${item.reason}:${item.path}`)
              .join('\n')
              .slice(0, 1000)
          })
        }
        return { moved: result.moved.length, skipped: result.skipped.length }
      } catch (error) {
        // 旧 Assets 清理发生在提交点之后：失败不回滚包，只报告“旧文件还在”。
        context.warnings.push({
          code: 'vpmLegacyCleanupFailed',
          detail: messageOf(error)
        })
        return { failed: true }
      }
    })

    await this.runStep(context, 'vault', 8, async () => {
      const entries = [
        ...context.movedOut.map((moved) => ({
          relativePath: moved.trashRelativePath,
          kind: 'dir' as const,
          originalPath: moved.relativePath
        })),
        ...context.legacyMoved.map((moved) => ({
          relativePath: moved.trashRelativePath,
          kind: moved.kind,
          originalPath: moved.path
        }))
      ]
      if (entries.length === 0) return { skipped: true }

      this.operations.setVaultPending(context.op.id, true)
      try {
        const archived = await this.vault.archive({
          projectSlug: projectSlugOf(context.projectPath),
          opId: context.op.id,
          sourceDir: layout.trash,
          entries: entries.map((entry) => ({ relativePath: entry.relativePath, kind: entry.kind }))
        })
        const byRelative = new Map(entries.map((entry) => [entry.relativePath, entry] as const))
        for (const item of archived.entries) {
          const original = byRelative.get(item.relativePath)
          if (!original) continue
          this.operations.upsertFile(context.op.id, {
            path: original.originalPath,
            action: 'vault',
            vaultPath: item.vaultPath,
            sha256: item.sha256,
            size: item.size,
            state: 'archived'
          })
        }
        this.operations.setVaultPending(context.op.id, false)
        return { archived: archived.entries.length, bytes: archived.bytes }
      } catch (error) {
        // 工程已经可用；事务区保留，vault_pending=1，可重试归档。
        context.warnings.push({ code: 'vpmVaultArchiveFailed', detail: messageOf(error) })
        context.warnings.push({ code: 'vpmVaultPending', detail: null })
        return { failed: true }
      }
    })

    await this.runStep(context, 'cleanup', 9, async () => {
      // 只清应用自己的暂存区；journal 与 manifest.original.json 留着当证据。
      try {
        if (lstatOrNull(layout.install)) removeTree(layout.install)
      } catch (error) {
        context.warnings.push({ code: 'vpmTransactionFailed', detail: messageOf(error) })
      }
      removeEmptyDirectory(layout.trashPackages)
      removeEmptyDirectory(layout.trashLegacy)
      removeEmptyDirectory(layout.trash)
      removeEmptyDirectory(layout.rolledback)
      return { cleaned: true }
    })
  }

  private async fail(context: TxContext, error: unknown): Promise<ApplyPlanResult> {
    const code = error instanceof VpmError ? error.code : 'vpmTransactionFailed'
    const detail = messageOf(error)
    const commitPoint = this.commitPointOf(context.op.id)

    if (context.manifestRenamed || commitPoint === 'manifest_written') {
      // manifest 已经换成新的：包目录也已就位，不能“回滚成旧的”。
      const status = this.tryTransition(context.op.id, 'needs_attention', code, detail)
      return this.result(context, status, code, detail)
    }

    if (context.movedIn.length === 0 && context.movedOut.length === 0) {
      const status = this.tryTransition(context.op.id, 'failed', code, detail)
      return this.result(context, status, code, detail)
    }

    const layout = context.layout
    if (!layout) {
      const status = this.tryTransition(context.op.id, 'needs_attention', 'vpmRollbackFailed', detail)
      return this.result(context, status, 'vpmRollbackFailed', detail)
    }

    try {
      await this.runStep(context, 'rollback', TOTAL_STEPS, async () => {
        for (const moved of [...context.movedIn].reverse()) {
          const current = path.join(context.projectPath, moved.relativePath)
          if (lstatOrNull(current)) {
            const target = path.join(layout.rolledback, moved.name)
            if (lstatOrNull(target)) {
              throw new VpmError('vpmRollbackFailed', { path: moved.relativePath })
            }
            await this.rename(current, target)
          }
          this.operations.setFileState(context.op.id, moved.relativePath, 'move-in', 'failed')
        }
        for (const moved of [...context.movedOut].reverse()) {
          const trash = path.join(layout.trash, moved.trashRelativePath)
          const target = path.join(context.projectPath, moved.relativePath)
          if (!lstatOrNull(trash)) {
            throw new VpmError('vpmRollbackFailed', { path: moved.relativePath })
          }
          if (lstatOrNull(target)) {
            throw new VpmError('vpmRollbackFailed', { path: moved.relativePath })
          }
          await this.rename(trash, target)
          this.operations.setFileState(context.op.id, moved.relativePath, 'move-out', 'failed')
        }
        return { rolledBack: true }
      })
      const status = this.tryTransition(context.op.id, 'rolled_back', code, detail)
      return this.result(context, status, code, detail)
    } catch (rollbackError) {
      const status = this.tryTransition(
        context.op.id,
        'needs_attention',
        'vpmRollbackFailed',
        `${detail}\n${messageOf(rollbackError)}`.slice(0, 900)
      )
      return this.result(context, status, 'vpmRollbackFailed', messageOf(rollbackError))
    }
  }

  private async runStep(
    context: TxContext,
    step: string,
    index: number,
    run: () => Promise<unknown>
  ): Promise<void> {
    const seq = this.operations.nextStepSequence(context.op.id)
    this.operations.beginStep(context.op.id, { step, seq })
    this.emit(context, step, index, 'start')
    try {
      const detail = await run()
      this.operations.finishStep(context.op.id, step, 'done', detail)
      this.emit(context, step, index, 'done')
    } catch (error) {
      try {
        this.operations.finishStep(context.op.id, step, 'failed')
      } catch {
        /* 状态已落盘/步骤已结束：不掩盖主错误 */
      }
      this.emit(context, step, index, 'failed')
      throw error
    }
  }

  private emit(
    context: TxContext,
    step: string,
    index: number,
    phase: TransactionProgress['phase']
  ): void {
    if (!context.onProgress) return
    try {
      context.onProgress({
        operationId: context.op.id,
        step,
        phase,
        index,
        total: TOTAL_STEPS
      })
    } catch {
      /* UI 回调异常不能中断事务 */
    }
  }

  private async rename(from: string, to: string): Promise<void> {
    await renameWithRetry(from, to, {
      retries: this.renameRetries,
      delayMs: this.renameDelayMs,
      sleep: this.sleep
    })
  }

  private dependenciesOf(context: TxContext): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {}
    for (const pkg of context.snapshot.packages) {
      out[pkg.name.toLowerCase()] = { ...pkg.vpmDependencies }
    }
    for (const [name, extracted] of context.extracted) {
      const deps = extracted.manifest.vpmDependencies
      if (deps && typeof deps === 'object' && !Array.isArray(deps)) {
        const map: Record<string, string> = {}
        for (const [key, value] of Object.entries(deps)) {
          if (typeof value === 'string') map[key] = value
        }
        out[name] = map
      }
    }
    return out
  }

  private markCommitPoint(opId: string): void {
    let last: unknown = null
    for (let attempt = 0; attempt < COMMIT_POINT_RETRIES; attempt++) {
      try {
        this.operations.markCommitPoint(opId)
        return
      } catch (error) {
        last = error
      }
    }
    throw new VpmError('vpmJournalWriteFailed', undefined, last)
  }

  private commitPointOf(opId: string): 'before' | 'manifest_written' {
    try {
      return this.operations.commitPoint(opId)
    } catch {
      return 'before'
    }
  }

  private tryTransition(
    opId: string,
    status: OperationStatus,
    code: VpmErrorCode | null,
    detail: string | null
  ): OperationStatus {
    try {
      return this.operations.transition(opId, status, {
        errorCode: code,
        errorDetail: detail
      }).status
    } catch {
      const current = this.operations.get(opId)
      return current?.status ?? status
    }
  }

  private activityOf(projectPath: string): PreflightActivity {
    if (!this.activity) return { unityRunning: false, importing: false }
    try {
      const state = this.activity.state(projectPath)
      return {
        unityRunning: state?.unityRunning === true,
        importing: state?.importing === true
      }
    } catch {
      // 活动闸门自己坏了：按“Unity 可能在用”拒绝，绝不猜。
      return { unityRunning: true, importing: false }
    }
  }

  private assertNotAborted(input: ApplyPlanInput): void {
    if (input.signal?.aborted) throw new VpmError('vpmHttpAborted')
  }

  private result(
    context: TxContext,
    status: OperationStatus,
    errorCode: VpmErrorCode | null,
    errorDetail: string | null
  ): ApplyPlanResult {
    const current = this.operations.get(context.op.id)
    return {
      operationId: context.op.id,
      status,
      errorCode,
      errorDetail,
      warnings: context.warnings,
      installed: context.movedIn.map((moved) => moved.name),
      removed: context.movedOut.map((moved) => moved.name),
      kept: context.plan.changes
        .filter((change) => change.action === 'keep')
        .map((change) => change.name),
      vaultPending: current?.vaultPending === true,
      elapsedMs: Math.max(0, this.now() - context.startedAt)
    }
  }
}
