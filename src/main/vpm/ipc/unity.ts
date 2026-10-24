import fs from 'node:fs'
import path from 'node:path'
import { IpcEvent, IpcInvoke } from '../../../shared/ipc'
import type {
  VpmBackupDto,
  VpmCopyResultDto,
  VpmCreateProjectInput,
  VpmCreateProjectResultDto,
  VpmLaunchResultDto,
  VpmMigrateCandidateInput,
  VpmMigrateResultDto,
  VpmRecentLocationDto,
  VpmTemplateCreateInput,
  VpmTemplateDto,
  VpmTemplateDuplicateInput,
  VpmTemplateListInput,
  VpmTemplatePatch,
  VpmUnityInstallDto,
  VpmVersionChangeResultDto
} from '../../../shared/vpm/dto'
import { VpmError } from '../../../shared/vpm/errors'
import { isValidTemplateId, normalizeAttachmentPath } from '../../../shared/vpm/domain/template'
import { normalizePackageId } from '../../../shared/vpm/domain/packageId'
import { tryParseVpmRange } from '../../../shared/vpm/domain/range'
import type { IpcApi } from '../../ipc/types'
import type { VpmRuntime } from '../index'
import { parseUnityArgs, readVpmSettings } from '../config'
import type { TemplateListEntry } from '../templates'

export interface UnityIpcOptions {
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
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw new VpmError('vpmUnityLaunchFailed', { reason: 'args' })
    // 换行/空字节会把一条参数拆成两条，直接拒绝。
    if (!item || item.length > 512 || /[\0\r\n]/.test(item)) {
      throw new VpmError('vpmUnityLaunchFailed', { reason: 'args' })
    }
    out.push(item)
    if (out.length >= 32) break
  }
  return out
}

/**
 * 实际传给 Unity 的参数：工程显式给了就用工程的（"每工程可覆盖"），
 * 否则用设置里的默认参数。
 */
function effectiveArgs(value: unknown): string[] {
  const explicit = args(value)
  if (explicit.length > 0) return explicit
  try {
    return parseUnityArgs(readVpmSettings().settings.defaultUnityArgs)
  } catch {
    return []
  }
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

function templateRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new VpmError('vpmTemplateInvalid', { reason: 'input' })
  }
  return value as Record<string, unknown>
}

function templateId(value: unknown): string {
  if (!isValidTemplateId(value)) {
    throw new VpmError('vpmTemplateInvalid', { reason: 'id' })
  }
  return value
}

function templateText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new VpmError('vpmTemplateInvalid', { reason: field })
  const text = value.trim()
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new VpmError('vpmTemplateInvalid', { reason: field })
  }
  return text
}

function templateOptionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new VpmError('vpmTemplateInvalid', { reason: field })
  const text = value.trim()
  if (!text) return null
  if (text.length > max || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new VpmError('vpmTemplateInvalid', { reason: field })
  }
  return text
}

/** 只把白名单字段交给服务层；id/路径/builtin 等渲染层不能指定。 */
function templatePatch(value: unknown, requireName: boolean): VpmTemplatePatch {
  const raw = templateRecord(value)
  const patch: VpmTemplatePatch = {}
  if (requireName || raw.name !== undefined) {
    patch.name = templateText(raw.name, 'name', 120)
  }
  if (raw.description !== undefined) {
    patch.description = templateOptionalText(raw.description, 'description', 2000)
  }
  if (raw.base !== undefined) {
    if (raw.base !== null && !isValidTemplateId(raw.base)) {
      throw new VpmError('vpmTemplateInvalid', { reason: 'base' })
    }
    patch.base = raw.base as string | null
  }
  if (raw.unity !== undefined) {
    const unity = templateRecord(raw.unity)
    const out: NonNullable<VpmTemplatePatch['unity']> = {}
    if (unity.min !== undefined) out.min = templateText(unity.min, 'unityMin', 64)
    if (unity.max !== undefined) out.max = templateOptionalText(unity.max, 'unityMax', 64)
    if (unity.recommended !== undefined) {
      out.recommended = templateOptionalText(unity.recommended, 'unityRecommended', 64)
    }
    patch.unity = out
  }
  if (raw.dependencies !== undefined) {
    const dependencies = templateRecord(raw.dependencies)
    const out: Record<string, string> = {}
    for (const [name, range] of Object.entries(dependencies)) {
      let normalized: string
      try {
        normalized = normalizePackageId(name)
      } catch {
        throw new VpmError('vpmTemplateInvalid', { reason: 'dependencyName' })
      }
      if (typeof range !== 'string' || !tryParseVpmRange(range)) {
        throw new VpmError('vpmTemplateInvalid', { reason: 'dependencyRange' })
      }
      out[normalized] = range.trim()
    }
    patch.dependencies = out
  }
  if (raw.unitypackages !== undefined) {
    if (!Array.isArray(raw.unitypackages) || raw.unitypackages.length > 32) {
      throw new VpmError('vpmTemplateInvalid', { reason: 'unitypackages' })
    }
    patch.unitypackages = raw.unitypackages.map((item) => {
      const entry = templateRecord(item)
      const pathValue = normalizeAttachmentPath(entry.path)
      if (!pathValue) throw new VpmError('vpmTemplateInvalid', { reason: 'unitypackagePath' })
      const name = templateOptionalText(entry.name, 'unitypackages.name', 120)
      return { path: pathValue, name }
    })
  }
  if (raw.settings !== undefined) {
    const settings = templateRecord(raw.settings)
    if (JSON.stringify(settings).length > 64 * 1024) {
      throw new VpmError('vpmTemplateInvalid', { reason: 'settings' })
    }
    patch.settings = settings
  }
  return patch
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

  // 重新扫描编辑器（新建工程对话框里"没探测到"时用）。
  ipc.handle(IpcInvoke.Vpm.UnityRefresh, (): VpmUnityInstallDto[] => {
    const current = runtime()
    try {
      current.unity.refresh()
    } catch {
      /* 扫描失败就回旧列表 */
    }
    return current.unity.list().map(installDto)
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
    return current.launch.buildArgs(item.path, effectiveArgs(raw.extraArgs))
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
      extraArgs: effectiveArgs(raw.extraArgs),
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
      pid: result.pid,
      verified: result.verified
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

  ipc.handle(IpcInvoke.Vpm.TemplateList, (input?: unknown): VpmTemplateDto[] => {
    const options: VpmTemplateListInput = { includeHidden: false }
    if (input !== undefined && input !== null) {
      const raw = templateRecord(input)
      if (raw.includeHidden !== undefined && typeof raw.includeHidden !== 'boolean') {
        throw new VpmError('vpmTemplateInvalid', { reason: 'includeHidden' })
      }
      options.includeHidden = raw.includeHidden === true
    }
    return runtime().templates.list(options).map(templateDto)
  })

  ipc.handle(IpcInvoke.Vpm.TemplateCreate, (input: unknown): VpmTemplateDto => {
    const patch = templatePatch(input, true)
    if (!patch.name) throw new VpmError('vpmTemplateInvalid', { reason: 'name' })
    const payload: VpmTemplateCreateInput = { ...patch, name: patch.name }
    return templateDto(runtime().templates.create(payload))
  })

  ipc.handle(IpcInvoke.Vpm.TemplateUpdate, (input: unknown): VpmTemplateDto => {
    const raw = templateRecord(input)
    const id = templateId(raw.id)
    const patch = templatePatch(raw, false)
    return templateDto(runtime().templates.update(id, patch))
  })

  ipc.handle(IpcInvoke.Vpm.TemplateDuplicate, (input: unknown): VpmTemplateDto => {
    const raw = templateRecord(input)
    const payload: VpmTemplateDuplicateInput = { id: templateId(raw.id) }
    if (raw.name !== undefined) payload.name = templateText(raw.name, 'name', 120)
    return templateDto(runtime().templates.duplicate(payload.id, payload.name))
  })

  ipc.handle(IpcInvoke.Vpm.TemplateRemoveReference, (input: unknown): VpmTemplateDto => {
    const id = templateId(templateRecord(input).id)
    return templateDto(runtime().templates.removeReference(id))
  })

  ipc.handle(IpcInvoke.Vpm.TemplateRestore, (input: unknown): VpmTemplateDto => {
    const id = templateId(templateRecord(input).id)
    return templateDto(runtime().templates.restore(id))
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

function backupDto(record: {
  id: string
  projectKey: string
  projectName: string
  filePath: string
  size: number | null
  sha256: string | null
  unityVersion: string | null
  packageCount: number | null
  status: 'running' | 'ok' | 'failed' | 'cancelled'
  createdAt: number
  finishedAt: number | null
  errorCode: string | null
}): VpmBackupDto {
  return {
    id: record.id,
    projectKey: record.projectKey,
    projectName: record.projectName,
    filePath: record.filePath,
    size: record.size,
    sha256: record.sha256,
    unityVersion: record.unityVersion,
    packageCount: record.packageCount,
    status: record.status,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt,
    errorCode: record.errorCode
  }
}

/** 备份 / 复制 / 换版本 / 迁移（P6-B/C/D）。 */
export function registerMaintenanceIpc(options: UnityIpcOptions): void {
  const { ipc } = options
  const runtime = (): VpmRuntime => {
    const value = options.getRuntime()
    if (!value) throw new VpmError('vpmRuntimeNotReady')
    return value
  }

  ipc.handle(IpcInvoke.Vpm.BackupCreate, async (input: unknown): Promise<VpmBackupDto> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VpmError('vpmProjectInvalid', { field: 'input' })
    }
    const raw = input as Record<string, unknown>
    const projectKey = requireKey(raw.projectKey)
    const record = await runtime().backup.create({
      projectKey,
      onProgress: (progress) => {
        options.broadcast?.(IpcEvent.VpmBackupProgress, { projectKey, ...progress })
      },
      ...(typeof raw.excludeVpmPackages === 'boolean'
        ? { excludeVpmPackages: raw.excludeVpmPackages }
        : {}),
      ...(raw.compression === 'store' || raw.compression === 'fast' || raw.compression === 'normal'
        ? { compression: raw.compression }
        : {})
    })
    return backupDto(record)
  })

  ipc.handle(IpcInvoke.Vpm.BackupList, (projectKey: unknown): VpmBackupDto[] => {
    return runtime()
      .backup.list(requireKey(projectKey))
      .map(backupDto)
  })

  ipc.handle(IpcInvoke.Vpm.BackupReveal, (id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) throw new VpmError('vpmBackupInvalid', { field: 'id' })
    return { ok: runtime().backup.reveal(id.trim()) }
  })

  ipc.handle(IpcInvoke.Vpm.ProjectCopy, async (input: unknown): Promise<VpmCopyResultDto> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VpmError('vpmProjectInvalid', { field: 'input' })
    }
    const raw = input as Record<string, unknown>
    if (typeof raw.targetDir !== 'string' || !raw.targetDir.trim()) {
      throw new VpmError('vpmProjectInvalid', { field: 'targetDir' })
    }
    const result = await runtime().copy.copy({
      sourceKey: requireKey(raw.projectKey),
      targetDir: raw.targetDir.trim()
    })
    return { projectPath: result.projectPath, files: result.files, bytes: result.bytes }
  })

  ipc.handle(IpcInvoke.Vpm.ProjectVersionChange, async (input: unknown): Promise<VpmVersionChangeResultDto> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VpmError('vpmProjectInvalid', { field: 'input' })
    }
    const raw = input as Record<string, unknown>
    if (typeof raw.unityVersion !== 'string' || !raw.unityVersion.trim()) {
      throw new VpmError('vpmUnityVersionInvalid', { field: 'version' })
    }
    const result = await runtime().version.change({
      projectKey: requireKey(raw.projectKey),
      unityVersion: raw.unityVersion.trim(),
      backupFirst: raw.backupFirst !== false
    })
    return {
      previous: result.previous.version,
      next: result.next.version,
      downgrade: result.downgrade,
      backupId: result.backupId,
      backupSkipped: result.backupSkipped
    }
  })

  ipc.handle(IpcInvoke.Vpm.ProjectMigrate, async (input: unknown): Promise<VpmMigrateResultDto> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new VpmError('vpmProjectInvalid', { field: 'input' })
    }
    const raw = input as Record<string, unknown>
    const candidates: VpmMigrateCandidateInput[] = Array.isArray(raw.candidates)
      ? (raw.candidates as VpmMigrateCandidateInput[]).filter(
          (item) =>
            item &&
            typeof item === 'object' &&
            (item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low')
        )
      : []
    const result = await runtime().migrate.migrate({
      projectKey: requireKey(raw.projectKey),
      candidates: candidates.map((item) => ({
        packageId: typeof item.packageId === 'string' ? item.packageId : null,
        relativePath: typeof item.relativePath === 'string' ? item.relativePath : null,
        confidence: item.confidence
      }))
    })
    return {
      backupId: result.backupId,
      installed: result.installed,
      skipped: result.skipped,
      failed: result.failed
    }
  })
}

/** 一个目录是不是 Unity 工程（只认 ProjectSettings/ProjectVersion.txt）。 */
function isUnityProject(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt')).isFile()
  } catch {
    return false
  }
}

function readVersion(dir: string): string | null {
  try {
    const text = fs.readFileSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    const match = /m_EditorVersion:\s*(\S+)/.exec(text)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * 新建工程的位置归一化（R14）。
 *
 * 用户很容易把"某个工程目录"当成"工程根"选进来（ALCOM 用户尤其：
 * `E:\ALCOMProjects\22` 本身就是一个工程）。这里不报错，直接上移一级，
 * 并把"我改了什么"告诉界面。
 */
export function registerProjectLocationIpc(options: UnityIpcOptions): void {
  const { ipc } = options

  ipc.handle(IpcInvoke.Vpm.ProjectParentCheck, (input: unknown) => {
    if (typeof input !== 'string' || !input.trim()) {
      throw new VpmError('vpmProjectInvalid', { field: 'path' })
    }
    const dir = path.resolve(input.trim())
    if (!isUnityProject(dir)) return { parent: dir, adjustedFrom: null as string | null }
    const parent = path.dirname(dir)
    return { parent, adjustedFrom: dir }
  })

  ipc.handle(IpcInvoke.Vpm.ProjectScanRoot, (input: unknown) => {
    if (typeof input !== 'string' || !input.trim()) {
      throw new VpmError('vpmProjectInvalid', { field: 'path' })
    }
    const root = path.resolve(input.trim())
    const runtime = options.getRuntime()
    const known = new Set(
      (runtime?.projects.list() ?? []).map((item) => item.path.toLowerCase())
    )
    const candidates: Array<{
      path: string
      name: string
      unityVersion: string | null
      added: boolean
    }> = []
    // 选到的目录本身就是工程：直接作为唯一候选
    if (isUnityProject(root)) {
      return {
        root,
        candidates: [
          {
            path: root,
            name: path.basename(root),
            unityVersion: readVersion(root),
            added: known.has(root.toLowerCase())
          }
        ]
      }
    }
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      throw new VpmError('vpmProjectInvalid', { field: 'path' })
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const child = path.join(root, entry.name)
      if (!isUnityProject(child)) continue
      candidates.push({
        path: child,
        name: entry.name,
        unityVersion: readVersion(child),
        added: known.has(child.toLowerCase())
      })
    }
    candidates.sort((a, b) => a.name.localeCompare(b.name))
    return { root, candidates }
  })
}
