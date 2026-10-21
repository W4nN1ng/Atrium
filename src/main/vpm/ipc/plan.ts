import { VpmError } from '../../../shared/vpm/errors'
import { IpcInvoke } from '../../../shared/ipc'
import type {
  VpmPlanDto,
  VpmPlanExplainDto,
  VpmPlanResolveInput
} from '../../../shared/vpm/dto'
import type { IpcApi } from '../../ipc/types'
import type { VpmRuntime } from '../index'

function requireKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
  }
  return value.trim()
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new VpmError('vpmResolutionFailed', { field })
  }
  return value.trim()
}

function resolveInput(value: unknown): VpmPlanResolveInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VpmError('vpmResolutionFailed', { field: 'input' })
  }
  const obj = value as Record<string, unknown>
  const projectKey = requireKey(obj.projectKey)
  if (obj.preset !== undefined && obj.preset !== 'upgradeAll') {
    throw new VpmError('vpmResolutionFailed', { field: 'preset' })
  }
  if (obj.allowPrerelease !== undefined && typeof obj.allowPrerelease !== 'boolean') {
    throw new VpmError('vpmResolutionFailed', { field: 'allowPrerelease' })
  }
  if (obj.freeBytes !== undefined && (typeof obj.freeBytes !== 'number' || !Number.isFinite(obj.freeBytes) || obj.freeBytes < 0)) {
    throw new VpmError('vpmResolutionFailed', { field: 'freeBytes' })
  }
  const rawRequests = obj.requests
  if (rawRequests !== undefined && !Array.isArray(rawRequests)) {
    throw new VpmError('vpmResolutionFailed', { field: 'requests' })
  }
  const requests = (rawRequests ?? []).map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new VpmError('vpmResolutionFailed', { field: `requests.${index}` })
    }
    const request = raw as Record<string, unknown>
    if (typeof request.name !== 'string' || !request.name.trim() || request.name.length > 214) {
      throw new VpmError('vpmPackageIdInvalid', { field: `requests.${index}.name` })
    }
    const kind = request.kind
    if (kind !== 'install' && kind !== 'upgrade' && kind !== 'downgrade' && kind !== 'reinstall' && kind !== 'remove') {
      throw new VpmError('vpmResolutionFailed', { field: `requests.${index}.kind` })
    }
    return {
      kind: kind as 'install' | 'upgrade' | 'downgrade' | 'reinstall' | 'remove',
      name: request.name.trim(),
      ...(request.range === undefined ? {} : { range: optionalText(request.range, `requests.${index}.range`, 500) }),
      ...(request.version === undefined ? {} : { version: optionalText(request.version, `requests.${index}.version`, 200) })
    }
  })
  if (requests.length > 100) throw new VpmError('vpmResolutionFailed', { field: 'requests' })
  return {
    projectKey,
    ...(obj.preset === undefined ? {} : { preset: 'upgradeAll' as const }),
    requests,
    ...(obj.allowPrerelease === undefined ? {} : { allowPrerelease: obj.allowPrerelease }),
    ...(obj.freeBytes === undefined ? {} : { freeBytes: obj.freeBytes })
  }
}

export interface PlanIpcOptions {
  ipc: IpcApi
  getRuntime: () => VpmRuntime | null
}

export function registerPlanIpc(options: PlanIpcOptions): void {
  const { ipc } = options
  const runtime = (): VpmRuntime => {
    const value = options.getRuntime()
    if (!value) throw new VpmError('vpmRuntimeNotReady')
    return value
  }

  ipc.handle(IpcInvoke.Vpm.PlanResolve, (input: unknown): VpmPlanDto => {
    return runtime().plans.resolve(resolveInput(input))
  })

  ipc.handle(IpcInvoke.Vpm.PlanExplain, (planId: unknown, name: unknown): VpmPlanExplainDto => {
    if (typeof planId !== 'string' || !planId.trim() || planId.length > 80) {
      throw new VpmError('vpmPlanNotFound')
    }
    if (name !== undefined && name !== null && (typeof name !== 'string' || name.length > 214)) {
      throw new VpmError('vpmResolutionFailed', { field: 'name' })
    }
    return runtime().plans.explain(planId.trim(), typeof name === 'string' ? name : null)
  })
}
