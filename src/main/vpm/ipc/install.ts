import { IpcEvent, IpcInvoke } from '../../../shared/ipc'
import type {
  VpmOperationCancelResult,
  VpmOperationDto,
  VpmOperationSummaryDto,
  VpmProjectCatalogDto,
  VpmUndoBlockedReason
} from '../../../shared/vpm/dto'
import { VpmError } from '../../../shared/vpm/errors'
import type { IpcApi } from '../../ipc/types'
import type { VpmRuntime } from '../index'
import type { ApplyPlanResult, OperationRecord } from '../install'

export interface InstallIpcOptions {
  ipc: IpcApi
  getRuntime: () => VpmRuntime | null
  broadcast?: (event: string, payload?: unknown) => void
}

function requireKey(value: unknown, field = 'projectKey'): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    throw new VpmError('vpmProjectInvalid', { field })
  }
  return value.trim()
}

function requireId(value: unknown, field = 'operationId'): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 80) {
    throw new VpmError('vpmOperationNotFound', { field })
  }
  return value.trim()
}

function warningDto(warning: { code: string; params?: Record<string, string | number>; detail: string | null }) {
  return {
    code: warning.code,
    ...(warning.params ? { params: warning.params } : {}),
    detail: warning.detail
  }
}

function commitPointOf(runtime: VpmRuntime, operationId: string): 'before' | 'manifest_written' {
  try {
    return runtime.operations.commitPoint(operationId)
  } catch {
    return 'before'
  }
}

function resultDto(runtime: VpmRuntime, result: ApplyPlanResult): VpmOperationDto {
  const operation = runtime.operations.get(result.operationId)
  return {
    operationId: result.operationId,
    projectKey: operation?.projectKey ?? '',
    kind: operation?.kind ?? 'install',
    status: result.status,
    errorCode: result.errorCode,
    errorDetail: result.errorDetail,
    warnings: result.warnings.map(warningDto),
    installed: result.installed,
    removed: result.removed,
    kept: result.kept,
    vaultPending: result.vaultPending,
    elapsedMs: result.elapsedMs,
    commitPoint: commitPointOf(runtime, result.operationId)
  }
}

function recordDto(runtime: VpmRuntime, operation: OperationRecord): VpmOperationDto {
  const installed = operation.files
    .filter((file) => file.action === 'move-in' && file.state === 'done')
    .map((file) => file.path.replace(/^Packages\//, ''))
  const removed = operation.files
    .filter((file) => file.action === 'move-out' && file.state === 'done')
    .map((file) => file.path.replace(/^Packages\//, ''))
  return {
    operationId: operation.id,
    projectKey: operation.projectKey,
    kind: operation.kind,
    status: operation.status,
    errorCode: operation.errorCode,
    errorDetail: operation.errorDetail,
    warnings: [],
    installed,
    removed,
    kept: [],
    vaultPending: operation.vaultPending,
    elapsedMs:
      operation.finishedAt && operation.startedAt
        ? Math.max(0, operation.finishedAt - operation.startedAt)
        : 0,
    commitPoint: commitPointOf(runtime, operation.id)
  }
}

function changeCountOf(operation: OperationRecord): number {
  try {
    const parsed = JSON.parse(operation.summaryJson ?? '{}') as { changes?: number }
    return typeof parsed.changes === 'number' ? parsed.changes : 0
  } catch {
    return 0
  }
}

/**
 * 安装/操作相关的 IPC。
 *
 * 规矩：
 * - 只接受 `planId`，不接受渲染层回传的计划内容；
 * - 进度事件只是加速，`OperationStatus` 必须能独立恢复；
 * - 取消只在提交点之前有效，提交点之后返回 `tooLate`；
 * - 错误只给 code + 参数，文案在渲染层。
 */
export function registerInstallIpc(options: InstallIpcOptions): void {
  const { ipc } = options
  const runtime = (): VpmRuntime => {
    const value = options.getRuntime()
    if (!value) throw new VpmError('vpmRuntimeNotReady')
    return value
  }
  /** 正在跑的操作 → 取消句柄；进程重启后这里为空，取消会返回 tooLate。 */
  const controllers = new Map<string, AbortController>()

  ipc.handle(IpcInvoke.Vpm.PlanApply, async (input: unknown): Promise<VpmOperationDto> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VpmError('vpmOperationInvalid', { field: 'input' })
    }
    const raw = input as Record<string, unknown>
    const projectKey = requireKey(raw.projectKey)
    const planId = requireId(raw.planId, 'planId')
    const current = runtime()
    const controller = new AbortController()
    let operationId: string | null = null

    try {
      const result = await current.transactions.apply({
        projectKey,
        planId,
        signal: controller.signal,
        onStarted: (id) => {
          operationId = id
          controllers.set(id, controller)
          options.broadcast?.(IpcEvent.VpmOperationStarted, { operationId: id, projectKey })
        },
        onProgress: (progress) => {
          options.broadcast?.(IpcEvent.VpmOperationProgress, {
            operationId: progress.operationId,
            projectKey,
            step: progress.step,
            phase: progress.phase,
            index: progress.index,
            total: progress.total
          })
        }
      })
      options.broadcast?.(IpcEvent.VpmOperationDone, {
        operationId: result.operationId,
        projectKey,
        status: result.status,
        errorCode: result.errorCode
      })
      return resultDto(current, result)
    } finally {
      if (operationId) controllers.delete(operationId)
    }
  })

  ipc.handle(IpcInvoke.Vpm.OperationStatus, (operationId: unknown): VpmOperationDto => {
    const current = runtime()
    const operation = current.operations.get(requireId(operationId))
    if (!operation) throw new VpmError('vpmOperationNotFound')
    return recordDto(current, operation)
  })

  ipc.handle(IpcInvoke.Vpm.OperationCancel, (operationId: unknown): VpmOperationCancelResult => {
    const current = runtime()
    const id = requireId(operationId)
    const operation = current.operations.get(id)
    if (!operation) throw new VpmError('vpmOperationNotFound')

    const commitPoint = commitPointOf(current, id)
    const active =
      operation.status === 'planned' ||
      operation.status === 'preflight' ||
      operation.status === 'applying'
    if (!active || commitPoint === 'manifest_written') {
      return { ok: false, tooLate: true }
    }
    const controller = controllers.get(id)
    if (!controller) return { ok: false, tooLate: true }
    controller.abort()
    return { ok: true, tooLate: false }
  })

  ipc.handle(IpcInvoke.Vpm.OperationHistory, (projectKey: unknown): VpmOperationSummaryDto[] => {
    const current = runtime()
    const key = requireKey(projectKey)
    const rows = current.operations.list(key, 20)
    return rows.map((operation) => {
      const gate = current.undo.canUndo(operation)
      return {
        operationId: operation.id,
        projectKey: operation.projectKey,
        kind: operation.kind,
        status: operation.status,
        createdAt: operation.createdAt,
        finishedAt: operation.finishedAt,
        errorCode: operation.errorCode,
        changeCount: changeCountOf(operation),
        canUndo: gate.ok,
        undoBlockedReason: gate.reason as VpmUndoBlockedReason | null
      }
    })
  })

  ipc.handle(IpcInvoke.Vpm.OperationUndo, async (operationId: unknown): Promise<VpmOperationDto> => {
    const current = runtime()
    const id = requireId(operationId)
    const controller = new AbortController()
    let nextId: string | null = null
    try {
      const result = await current.undo.undo(id)
      nextId = result.operationId
      controllers.set(result.operationId, controller)
      options.broadcast?.(IpcEvent.VpmOperationDone, {
        operationId: result.operationId,
        projectKey: current.operations.get(result.operationId)?.projectKey ?? '',
        status: result.status,
        errorCode: result.errorCode
      })
      return resultDto(current, result)
    } finally {
      if (nextId) controllers.delete(nextId)
    }
  })

  ipc.handle(IpcInvoke.Vpm.ProjectCatalog, (projectKey: unknown): VpmProjectCatalogDto => {
    const current = runtime()
    const detail = current.projects.detail(requireKey(projectKey))
    if (!detail?.snapshot) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })

    const eligible = detail.snapshot.packages.filter(
      (pkg) => pkg.source === 'embedded' && pkg.state !== 'protected'
    )
    const names = eligible.map((pkg) => pkg.name).slice(0, 80)

    const packages = names.map((name) => {
      const pkg = current.catalog.getPackage(name)
      if (!pkg) return { name, latestVersion: null, versions: [], hasConflict: false }
      return {
        name,
        latestVersion: pkg.latestVersion ?? null,
        versions: pkg.versions.slice(0, 200).map((version) => ({
          version: version.version,
          latest: version.version === pkg.latestVersion,
          yanked: version.yanked,
          deprecated: version.deprecated,
          unityMin: version.unityMin,
          repoName: version.sources[0]?.repoName ?? null
        })),
        hasConflict: pkg.hasConflict
      }
    })
    return { packages, truncated: eligible.length > names.length }
  })
}
