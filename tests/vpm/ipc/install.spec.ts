import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcEvent, IpcInvoke } from '../../../src/shared/ipc'
import type { VpmOperationDto, VpmOperationRecoveryResultDto } from '../../../src/shared/vpm/dto'
import { registerInstallIpc } from '../../../src/main/vpm/ipc/install'
import type { VpmRuntime } from '../../../src/main/vpm'
import type {
  ApplyPlanInput,
  ApplyPlanResult,
  OperationRecord,
  RecoveryDecision,
  RecoveryOutcome
} from '../../../src/main/vpm/install'
import type { IpcApi } from '../../../src/main/ipc/types'

const OP_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const OTHER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW'
const PROJECT = 'c:\\demo'
const PLAN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX'

let handlers: Map<string, (...args: unknown[]) => unknown>
let broadcast: ReturnType<typeof vi.fn>
let records: Map<string, OperationRecord>
let commitPoints: Map<string, 'before' | 'manifest_written'>
let applyImpl: (input: ApplyPlanInput) => Promise<ApplyPlanResult>
let inspectDecision: RecoveryDecision | null
let recoverOutcome: RecoveryOutcome | null
let runtime: VpmRuntime

function operation(overrides: Partial<OperationRecord> = {}): OperationRecord {
  const base: OperationRecord = {
    id: OP_ID,
    projectKey: PROJECT,
    projectPath: 'C:\\demo',
    kind: 'install',
    status: 'committed',
    planJson: JSON.stringify({
      changes: [{ name: 'com.example.a', action: 'install', from: null, to: '1.0.0' }]
    }),
    planHash: 'a'.repeat(64),
    projectFingerprint: null,
    manifestBeforeHash: 'b'.repeat(64),
    manifestAfterHash: 'c'.repeat(64),
    summaryJson: JSON.stringify({ changes: 1 }),
    errorCode: null,
    errorDetail: null,
    vaultPending: false,
    createdAt: 100,
    startedAt: 100,
    finishedAt: 1_600,
    steps: [],
    files: [
      {
        opId: OP_ID,
        path: 'Packages/com.example.a',
        action: 'move-in',
        vaultPath: null,
        sha256: null,
        size: null,
        state: 'done'
      },
      {
        opId: OP_ID,
        path: 'Packages/com.example.old',
        action: 'move-out',
        vaultPath: 'packages/com.example.old',
        sha256: null,
        size: null,
        state: 'done'
      }
    ]
  }
  return { ...base, ...overrides }
}

function result(overrides: Partial<ApplyPlanResult> = {}): ApplyPlanResult {
  return {
    operationId: OP_ID,
    status: 'committed',
    errorCode: null,
    errorDetail: null,
    warnings: [],
    installed: ['com.example.a'],
    removed: [],
    kept: [],
    vaultPending: false,
    elapsedMs: 1_500,
    ...overrides
  }
}

function call<T>(channel: string, ...args: unknown[]): T {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`missing handler ${channel}`)
  return handler(...args) as T
}

beforeEach(() => {
  handlers = new Map()
  broadcast = vi.fn()
  records = new Map([[OP_ID, operation()], [OTHER_ID, operation({ id: OTHER_ID, status: 'failed' })]])
  commitPoints = new Map([[OP_ID, 'manifest_written'], [OTHER_ID, 'before']])
  applyImpl = async (input) => {
    input.onStarted?.(OP_ID)
    input.onProgress?.({ operationId: OP_ID, step: 'prepare', phase: 'start', index: 1, total: 9 })
    input.onProgress?.({ operationId: OP_ID, step: 'manifest', phase: 'done', index: 6, total: 9 })
    return result()
  }
  inspectDecision = null
  recoverOutcome = null

  runtime = {
    operations: {
      get: (id: string) => records.get(id) ?? null,
      list: (projectKey: string) => [...records.values()].filter((item) => item.projectKey === projectKey),
      findActive: () => null,
      commitPoint: (id: string) => commitPoints.get(id) ?? 'before'
    },
    recovery: {
      inspect: (id: string) => (id === OP_ID ? inspectDecision : null),
      recover: async (id: string) => {
        if (!recoverOutcome) throw new Error('unexpected recovery')
        if (recoverOutcome.resultStatus) {
          records.set(
            id,
            operation({
              id,
              status: recoverOutcome.resultStatus,
              errorCode: recoverOutcome.errorCode ?? null
            })
          )
        }
        return recoverOutcome
      }
    },
    transactions: {
      apply: (input: ApplyPlanInput) => applyImpl(input)
    },
    undo: {
      canUndo: (item: OperationRecord) =>
        item.status === 'committed' ? { ok: true, reason: null } : { ok: false, reason: 'notCommitted' },
      undo: async () => result({ operationId: OTHER_ID })
    },
    projects: {
      detail: () => ({
        snapshot: {
          packages: [
            { name: 'com.example.a', source: 'embedded', state: 'installed' },
            { name: 'com.avca.bridge', source: 'embedded', state: 'protected' }
          ]
        }
      })
    },
    catalog: {
      getPackage: (name: string) =>
        name === 'com.example.a'
          ? {
              latestVersion: '2.0.0',
              hasConflict: false,
              versions: [
                { version: '2.0.0', yanked: false, deprecated: false, unityMin: '2022.3', sources: [{ repoName: 'Official' }] },
                { version: '1.0.0', yanked: false, deprecated: false, unityMin: null, sources: [] }
              ]
            }
          : null
    }
  } as unknown as VpmRuntime

  const ipc: IpcApi = {
    handle(channel, fn) {
      handlers.set(channel, fn as unknown as (...args: unknown[]) => unknown)
    }
  }
  registerInstallIpc({ ipc, getRuntime: () => runtime, broadcast })
})

describe('install IPC: apply', () => {
  it('rejects malformed input instead of trusting the renderer', async () => {
    await expect(
      call<Promise<VpmOperationDto>>(IpcInvoke.Vpm.PlanApply, { planId: PLAN_ID })
    ).rejects.toMatchObject({ code: 'vpmProjectInvalid' })
    await expect(
      call<Promise<VpmOperationDto>>(IpcInvoke.Vpm.PlanApply, { projectKey: PROJECT })
    ).rejects.toMatchObject({ code: 'vpmOperationNotFound' })
    await expect(
      call<Promise<VpmOperationDto>>(IpcInvoke.Vpm.PlanApply, 'nope')
    ).rejects.toMatchObject({ code: 'vpmOperationInvalid' })
  })

  it('broadcasts started/progress/done and returns the final DTO', async () => {
    const dto = await call<Promise<VpmOperationDto>>(IpcInvoke.Vpm.PlanApply, {
      projectKey: PROJECT,
      planId: PLAN_ID
    })

    expect(dto).toMatchObject({
      operationId: OP_ID,
      projectKey: PROJECT,
      status: 'committed',
      commitPoint: 'manifest_written',
      installed: ['com.example.a']
    })
    const events = broadcast.mock.calls.map((entry) => entry[0])
    expect(events).toEqual([
      IpcEvent.VpmOperationStarted,
      IpcEvent.VpmOperationProgress,
      IpcEvent.VpmOperationProgress,
      IpcEvent.VpmOperationDone
    ])
    expect(broadcast.mock.calls[1][1]).toMatchObject({ step: 'prepare', index: 1, total: 9 })
  })

  it('passes only the plan id through to the transaction', async () => {
    let seen: ApplyPlanInput | null = null
    applyImpl = async (input) => {
      seen = input
      return result()
    }
    await call<Promise<VpmOperationDto>>(IpcInvoke.Vpm.PlanApply, {
      projectKey: PROJECT,
      planId: PLAN_ID
    })
    expect(seen).toMatchObject({ projectKey: PROJECT, planId: PLAN_ID })
    expect(seen && 'plan' in seen).toBe(false)
  })
})

describe('install IPC: cancel', () => {
  it('aborts a running operation before the commit point', async () => {
    let aborted = false
    records.set(OP_ID, operation({ status: 'applying' }))
    commitPoints.set(OP_ID, 'before')
    applyImpl = (input) =>
      new Promise((resolve) => {
        input.onStarted?.(OP_ID)
        input.signal?.addEventListener('abort', () => {
          aborted = true
          resolve(result({ status: 'rolled_back', errorCode: 'vpmHttpAborted' }))
        })
      })

    const pending = call<Promise<VpmOperationDto>>(IpcInvoke.Vpm.PlanApply, {
      projectKey: PROJECT,
      planId: PLAN_ID
    })
    await Promise.resolve()
    const cancelled = call<{ ok: boolean; tooLate: boolean }>(IpcInvoke.Vpm.OperationCancel, OP_ID)
    expect(cancelled).toEqual({ ok: true, tooLate: false })
    const dto = await pending
    expect(aborted).toBe(true)
    expect(dto.status).toBe('rolled_back')
  })

  it('refuses to cancel after the commit point or for unknown ids', () => {
    expect(call<{ ok: boolean; tooLate: boolean }>(IpcInvoke.Vpm.OperationCancel, OP_ID)).toEqual({
      ok: false,
      tooLate: true
    })
    expect(() => call(IpcInvoke.Vpm.OperationCancel, 'missing')).toThrow()
  })
})

describe('install IPC: status and history', () => {
  it('maps a stored operation to a DTO', () => {
    const dto = call<VpmOperationDto>(IpcInvoke.Vpm.OperationStatus, OP_ID)
    expect(dto).toMatchObject({
      operationId: OP_ID,
      status: 'committed',
      installed: ['com.example.a'],
      removed: ['com.example.old'],
      commitPoint: 'manifest_written'
    })
    expect(() => call(IpcInvoke.Vpm.OperationStatus, 'missing')).toThrow()
  })

  it('returns history with undo availability and change counts', () => {
    const history = call<Array<{ operationId: string; canUndo: boolean; changeCount: number; undoBlockedReason: string | null }>>(
      IpcInvoke.Vpm.OperationHistory,
      PROJECT
    )
    expect(history).toHaveLength(2)
    const committed = history.find((item) => item.operationId === OP_ID)
    expect(committed).toMatchObject({ canUndo: true, changeCount: 1, undoBlockedReason: null })
    const failed = history.find((item) => item.operationId === OTHER_ID)
    expect(failed).toMatchObject({ canUndo: false, undoBlockedReason: 'notCommitted' })
  })

  it('explains a needs_attention operation in both status and history', () => {
    records.set(
      OP_ID,
      operation({
        status: 'needs_attention',
        errorCode: 'vpmRecoveryRequired',
        errorDetail: 'project_changed'
      })
    )
    inspectDecision = {
      operationId: OP_ID,
      projectKey: PROJECT,
      projectPath: 'C:\\demo',
      status: 'needs_attention',
      action: 'rollback',
      reason: 'before_commit',
      journalPhase: 'applying'
    }

    const dto = call<VpmOperationDto>(IpcInvoke.Vpm.OperationStatus, OP_ID)
    expect(dto.recovery).toEqual({
      operationId: OP_ID,
      action: 'rollback',
      reason: 'before_commit',
      journalPhase: 'applying',
      canApply: true
    })
    expect(dto.commitPoint).toBe('manifest_written')

    const history = call<Array<{ operationId: string; recovery: unknown }>>(
      IpcInvoke.Vpm.OperationHistory,
      PROJECT
    )
    expect(history.find((item) => item.operationId === OP_ID)?.recovery).toMatchObject({
      action: 'rollback',
      reason: 'before_commit'
    })
  })

  it('runs a manual recovery and broadcasts the resulting terminal state', async () => {
    records.set(
      OP_ID,
      operation({ status: 'needs_attention', errorCode: 'vpmRecoveryRequired' })
    )
    inspectDecision = {
      operationId: OP_ID,
      projectKey: PROJECT,
      projectPath: 'C:\\demo',
      status: 'needs_attention',
      action: 'rollback',
      reason: 'before_commit',
      journalPhase: 'applying'
    }
    recoverOutcome = {
      decision: inspectDecision,
      applied: true,
      resultStatus: 'rolled_back',
      errorCode: null
    }

    const dto = await call<Promise<VpmOperationRecoveryResultDto>>(
      IpcInvoke.Vpm.OperationRecover,
      OP_ID
    )
    expect(dto).toMatchObject({
      applied: true,
      resultStatus: 'rolled_back',
      decision: { action: 'rollback', canApply: true }
    })
    expect(dto.operation.status).toBe('rolled_back')
    expect(dto.operation.recovery).toBeNull()
    expect(broadcast.mock.calls.map((entry) => entry[0])).toContain(IpcEvent.VpmOperationDone)
    expect(broadcast.mock.calls.at(-1)?.[1]).toMatchObject({
      operationId: OP_ID,
      status: 'rolled_back'
    })
  })

  it('refuses recovery while the same operation is running in this process', async () => {
    const gate: { release: ((value: ApplyPlanResult) => void) | null } = { release: null }
    records.set(OP_ID, operation({ status: 'applying' }))
    applyImpl = (input) => {
      input.onStarted?.(OP_ID)
      return new Promise((resolve) => {
        gate.release = resolve
      })
    }

    const pending = call<Promise<VpmOperationDto>>(IpcInvoke.Vpm.PlanApply, {
      projectKey: PROJECT,
      planId: PLAN_ID
    })
    await Promise.resolve()
    await expect(
      call<Promise<VpmOperationRecoveryResultDto>>(IpcInvoke.Vpm.OperationRecover, OP_ID)
    ).rejects.toMatchObject({ code: 'vpmProjectBusy' })
    gate.release?.(result())
    await pending
  })

  it('rejects unknown recovery ids', async () => {
    await expect(
      call<Promise<VpmOperationRecoveryResultDto>>(IpcInvoke.Vpm.OperationRecover, 'missing')
    ).rejects.toMatchObject({ code: 'vpmOperationNotFound' })
  })

  it('runs undo through the service and broadcasts a done event', async () => {
    const dto = await call<Promise<VpmOperationDto>>(IpcInvoke.Vpm.OperationUndo, OP_ID)
    expect(dto.operationId).toBe(OTHER_ID)
    expect(broadcast.mock.calls.map((entry) => entry[0])).toContain(IpcEvent.VpmOperationDone)
  })
})

describe('install IPC: project catalog', () => {
  it('returns versions for installed packages and skips protected ones', () => {
    const dto = call<{ packages: Array<{ name: string; latestVersion: string | null; versions: unknown[] }>; truncated: boolean }>(
      IpcInvoke.Vpm.ProjectCatalog,
      PROJECT
    )
    expect(dto.truncated).toBe(false)
    expect(dto.packages).toHaveLength(1)
    expect(dto.packages[0]).toMatchObject({ name: 'com.example.a', latestVersion: '2.0.0' })
    expect(dto.packages[0].versions).toHaveLength(2)
  })
})
