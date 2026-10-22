import { IpcInvoke } from '../../../shared/ipc'
import type {
  VpmCreateProjectInput,
  VpmCreateProjectResultDto,
  VpmLaunchResultDto,
  VpmRecentLocationDto,
  VpmTemplateDto,
  VpmUnityInstallDto
} from '../../../shared/vpm/dto'
import { VpmError } from '../../../shared/vpm/errors'
import type { IpcApi } from '../../ipc/types'
import type { VpmRuntime } from '../index'
import type { TemplateListEntry } from '../templates'

export interface UnityIpcOptions {
  ipc: IpcApi
  getRuntime: () => VpmRuntime | null
}

function requireKey(value: unknown, field = 'projectKey'): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    throw new VpmError('vpmProjectInvalid', { field })
  }
  return value.trim()
}

function optionalPath(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 4096 || /[\0\r\n]/.test(value)) {
    throw new VpmError('vpmUnityLaunchFailed', { reason: field })
  }
  return value
}

function args(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new VpmError('vpmUnityLaunchFailed', { reason: 'args' })
  return value as string[]
}

function templateDto(entry: TemplateListEntry): VpmTemplateDto {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    source: entry.source,
    base: entry.base,
    unity: entry.unity,
    dependencies: entry.dependencies,
    unitypackages: entry.unitypackages,
    favorite: entry.favorite,
    visible: entry.visible,
    lastUsedAt: entry.lastUsedAt,
    builtin: entry.builtin,
    broken: entry.broken,
    issues: entry.issues
  }
}

function installDto(install: {
  id: string
  path: string
  version: string | null
  versionWithRevision: string | null
  source: 'hub' | 'manual' | 'scan'
  missing: boolean
  versionUnknown: boolean
}): VpmUnityInstallDto {
  return {
    id: install.id,
    path: install.path,
    version: install.version,
    versionWithRevision: install.versionWithRevision,
    source: install.source,
    missing: install.missing,
    versionUnknown: install.versionUnknown
  }
}

/**
 * 新建工程 / 模板 / 启动 Unity 的 IPC（P5-D）。
 *
 * - 启动前先 `bindLaunchTarget`，失败 `clearLaunchTarget`（在 service 里做，这里只给闭包）；
 * - 创建只接受路径 + 名称 + 模板 id，不接受计划内容；
 * - 模板列表直接回 DTO，不把主进程类型透给渲染层。
 */
export function registerUnityIpc(options: UnityIpcOptions): void {
  const { ipc } = options
  const runtime = (): VpmRuntime => {
    const value = options.getRuntime()
    if (!value) throw new VpmError('vpmRuntimeNotReady')
    return value
  }

  ipc.handle(IpcInvoke.Vpm.UnityInstalls, (): VpmUnityInstallDto[] => {
    return runtime().unity.list().map(installDto)
  })

  ipc.handle(IpcInvoke.Vpm.ProjectLaunchArgs, (input: unknown): string[] => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VpmError('vpmProjectInvalid', { field: 'input' })
    }
    const raw = input as Record<string, unknown>
    const projectKey = requireKey(raw.projectKey)
    const current = runtime()
    const item = current.projects.get(projectKey)
    if (!item) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    return current.launch.buildArgs(item.path, args(raw.extraArgs))
  })

  ipc.handle(IpcInvoke.Vpm.ProjectLaunch, async (input: unknown): Promise<VpmLaunchResultDto> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VpmError('vpmProjectInvalid', { field: 'input' })
    }
    const raw = input as Record<string, unknown>
    const projectKey = requireKey(raw.projectKey)
    const current = runtime()
    const item = current.projects.get(projectKey)
    if (!item) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    const coreId = item.coreId
    const result = await current.launch.launch({
      projectPath: item.path,
      editorPath: optionalPath(raw.editorPath, 'editorPath'),
      extraArgs: args(raw.extraArgs),
      bindTarget: () => {
        if (coreId) current.linkage?.bindLaunchTarget(coreId)
      },
      clearTarget: () => {
        if (coreId) current.linkage?.clearLaunchTarget(coreId)
      }
    })
    return {
      status: result.status,
      exePath: result.exePath,
      version: result.version,
      args: result.args,
      pid: result.pid
    }
  })

  ipc.handle(IpcInvoke.Vpm.ProjectCreate, async (input: unknown): Promise<VpmCreateProjectResultDto> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VpmError('vpmCreateRejected', { reason: 'input' })
    }
    const raw = input as Record<string, unknown>
    if (typeof raw.parentDir !== 'string' || typeof raw.name !== 'string' || typeof raw.unityVersion !== 'string') {
      throw new VpmError('vpmCreateRejected', { reason: 'fields' })
    }
    const payload: VpmCreateProjectInput = {
      parentDir: raw.parentDir,
      name: raw.name,
      unityVersion: raw.unityVersion,
      ...(typeof raw.unityRevision === 'string' ? { unityRevision: raw.unityRevision } : {}),
      ...(typeof raw.templateId === 'string' ? { templateId: raw.templateId } : {})
    }
    const result = await runtime().create.create(payload)
    return {
      projectPath: result.projectPath,
      projectKey: result.projectKey,
      templateId: result.templateId,
      dependencyStatus: result.dependencyStatus,
      operationId: result.operationId,
      errorCode: result.errorCode,
      warnings: result.warnings.map((item) => ({ code: item.code, detail: item.detail }))
    }
  })

  ipc.handle(IpcInvoke.Vpm.TemplateList, (): VpmTemplateDto[] => {
    return runtime().templates.list().map(templateDto)
  })

  ipc.handle(
    IpcInvoke.Vpm.TemplateFavorite,
    (input: unknown): VpmTemplateDto => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new VpmError('vpmTemplateInvalid', { reason: 'input' })
      }
      const raw = input as Record<string, unknown>
      if (typeof raw.id !== 'string' || typeof raw.favorite !== 'boolean') {
        throw new VpmError('vpmTemplateInvalid', { reason: 'fields' })
      }
      const entry = runtime().templates.setFavorite(raw.id, raw.favorite)
      return templateDto(entry)
    }
  )

  ipc.handle(IpcInvoke.Vpm.TemplateRecent, (): VpmRecentLocationDto[] => {
    return runtime().templates.recentLocations(8)
  })
}
