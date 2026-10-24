import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { PROTECTED_PROJECT_PACKAGE } from '../../../shared/vpm/domain/project'
import { VpmError } from '../../../shared/vpm/errors'
import { IpcInvoke } from '../../../shared/ipc'
import type {
  VpmProjectDetailDto,
  VpmProjectLegacyDto,
  VpmProjectPackageDto,
  VpmProjectPackageState,
  VpmProjectSummaryDto,
  VpmProjectWarningDto
} from '../../../shared/vpm/dto'
import type { IpcApi } from '../../ipc/types'
import type { VpmRuntime } from '../index'
import type { ProjectListItem, ProjectPackageRow } from '../projects'
import type { ProjectSnapshot } from '../../../shared/vpm/domain/project'

function requireKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
  }
  return value.trim()
}

function requirePath(input: unknown): string {
  if (!input || typeof input !== 'object') {
    throw new VpmError('vpmProjectInvalid', { field: 'path' })
  }
  const path = (input as { path?: unknown }).path
  if (typeof path !== 'string' || !path.trim() || path.length > 4096) {
    throw new VpmError('vpmProjectInvalid', { field: 'path' })
  }
  return path.trim()
}

function stateOf(value: string): VpmProjectPackageState {
  if (value === 'installed' || value === 'missing' || value === 'unlisted' || value === 'mismatch' || value === 'protected') {
    return value
  }
  return 'unlisted'
}

function ledgerPackage(row: ProjectPackageRow): VpmProjectPackageDto {
  return {
    name: row.name,
    displayName: null,
    version: row.version,
    source: row.source,
    state: stateOf(row.state),
    isLegacy: row.isLegacy,
    protected: row.name === PROTECTED_PROJECT_PACKAGE || row.state === 'protected',
    path: null,
    unity: null
  }
}

function snapshotPackage(pkg: ProjectSnapshot['packages'][number]): VpmProjectPackageDto {
  return {
    name: pkg.name,
    displayName: pkg.displayName,
    version: pkg.version,
    source: pkg.source,
    state: stateOf(pkg.state),
    isLegacy: false,
    protected: pkg.name === PROTECTED_PROJECT_PACKAGE || pkg.state === 'protected',
    path: pkg.path,
    unity: pkg.unity
  }
}

function storedLegacy(row: ProjectPackageRow): VpmProjectLegacyDto {
  let parsed: Record<string, unknown> = {}
  try {
    const value = row.dependencyJson ? JSON.parse(row.dependencyJson) : null
    if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>
  } catch {
    /* 坏缓存不阻止详情 */
  }
  const match = row.source === 'legacyFolder' || row.source === 'legacyFile' || row.source === 'legacyPackage'
    ? row.source
    : row.source === 'packageJson'
      ? 'packageJson'
      : 'legacyPackage'
  const confidence = parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
    ? parsed.confidence
    : 'medium'
  return {
    name: row.name,
    relativePath: typeof parsed.relativePath === 'string' ? parsed.relativePath : null,
    match,
    confidence
  }
}

function packageWarnings(packages: VpmProjectPackageDto[]): VpmProjectWarningDto[] {
  return packages
    .filter((pkg) => pkg.state === 'missing' || pkg.state === 'mismatch')
    .map((pkg) => ({
      code: pkg.state === 'missing' ? 'vpmProjectMissingPackage' : 'vpmProjectVersionMismatch',
      path: pkg.path ?? `Packages/${pkg.name}`,
      detail: pkg.version
    }))
}

function summaryDto(item: ProjectListItem): VpmProjectSummaryDto {
  const ledger = item.ledger
  const embedded = ledger?.packages.filter((pkg) => !pkg.isLegacy) ?? []
  const legacy = ledger?.packages.filter((pkg) => pkg.isLegacy) ?? []
  return {
    projectKey: item.projectKey,
    coreId: item.coreId,
    path: item.path,
    name: item.name,
    unityVersion: item.unityVersion ?? ledger?.unityVersion ?? null,
    unityRevision: ledger?.unityRevision ?? null,
    running: item.running,
    detectedBy: [...item.detectedBy],
    bridgeVersion: item.bridgeVersion,
    busyReason: item.busyReason,
    linked: item.linked,
    hasLedger: Boolean(ledger),
    lastScanAt: ledger?.lastScanAt ?? null,
    packageCount: embedded.length,
    legacyCount: legacy.length,
    hasVpmManifest: Boolean(ledger?.manifestHash)
  }
}

function detailDto(item: ProjectListItem, snapshot: ProjectSnapshot | null): VpmProjectDetailDto {
  const base = summaryDto(item)
  const ledger = item.ledger
  if (!ledger) return { ...base, manifestHash: null, manifestMtime: null, unityExePath: null, unityArgsJson: null, packages: [], warnings: [], legacy: { readOnly: true, truncated: false, candidates: [] } }

  const packages = snapshot
    ? snapshot.packages.map(snapshotPackage)
    : ledger.packages.filter((pkg) => !pkg.isLegacy).map(ledgerPackage)
  const legacy = snapshot
    ? {
        readOnly: true as const,
        truncated: snapshot.legacy.truncated,
        candidates: snapshot.legacy.candidates.map((candidate) => ({
          name: candidate.name,
          relativePath: candidate.relativePath,
          match: candidate.match,
          confidence: candidate.confidence
        }))
      }
    : {
        readOnly: true as const,
        truncated: false,
        candidates: ledger.packages.filter((pkg) => pkg.isLegacy).map(storedLegacy)
      }
  const warnings: VpmProjectWarningDto[] = []
  const seen = new Set<string>()
  for (const warning of snapshot?.warnings ?? []) {
    const key = `${warning.code}\0${warning.path ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    warnings.push({ code: warning.code, path: warning.path, detail: warning.detail })
  }
  for (const warning of packageWarnings(packages)) {
    const key = `${warning.code}\0${warning.path ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    warnings.push(warning)
  }

  return {
    ...base,
    packageCount: packages.length,
    legacyCount: legacy.candidates.length,
    manifestHash: ledger.manifestHash,
    manifestMtime: ledger.manifestMtime,
    unityExePath: ledger.unityExePath,
    unityArgsJson: ledger.unityArgsJson,
    packages,
    warnings,
    legacy
  }
}

export interface ProjectIpcOptions {
  ipc: IpcApi
  getRuntime: () => VpmRuntime | null
}

/**
 * P2-D 只读工程台账 IPC。
 *
 * 所有参数在主进程重新校验；路径不来自渲染层的“可打开任意目录”输入，
 * 打开文件夹只接受台账里已有的 projectKey。
 */
export function registerProjectIpc(options: ProjectIpcOptions): void {
  const { ipc } = options
  const requireRuntime = (): VpmRuntime => {
    const runtime = options.getRuntime()
    if (!runtime) throw new VpmError('vpmRuntimeNotReady')
    return runtime
  }
  const detailFor = (runtime: VpmRuntime, key: string, snapshot?: ProjectSnapshot | null): VpmProjectDetailDto => {
    const item = runtime.projects.get(key)
    if (!item) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    return detailDto(item, snapshot ?? null)
  }

  ipc.handle(IpcInvoke.Vpm.ProjectsList, () => requireRuntime().projects.list().map(summaryDto))

  ipc.handle(IpcInvoke.Vpm.ProjectDetail, (key: unknown) => {
    const projectKey = requireKey(key)
    const runtime = requireRuntime()
    const result = runtime.projects.detail(projectKey)
    if (!result) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    return detailDto(result.item, result.snapshot)
  })

  ipc.handle(IpcInvoke.Vpm.ProjectAdd, (input: unknown) => {
    const path = requirePath(input)
    const runtime = requireRuntime()
    const result = runtime.projects.addExisting(path)
    return detailFor(runtime, result.ledger.projectKey, result.snapshot)
  })

  ipc.handle(IpcInvoke.Vpm.ProjectRemove, (key: unknown) => {
    const projectKey = requireKey(key)
    return { ok: requireRuntime().projects.remove(projectKey) }
  })

  /**
   * 删除工程（R16）：先把整个文件夹移进**回收站**，再从台账移除。
   * 不提供永久删除——用户随时能从回收站还原。
   */
  /**
   * R18：给"在核心表里、但还没有 VPM 台账"的老工程补建台账。
   * 这些工程是早先接桥时进的，列表以前按 hasLedger 过滤所以看不见。
   */
  ipc.handle(IpcInvoke.Vpm.ProjectsEnsureLedgers, () => {
    const runtime = requireRuntime()
    let created = 0
    const failed: string[] = []
    for (const item of runtime.projects.list()) {
      if (item.ledger) continue
      try {
        runtime.projects.addExisting(item.path)
        created += 1
      } catch {
        failed.push(item.path)
      }
    }
    return { created, failed }
  })

  ipc.handle(IpcInvoke.Vpm.ProjectTrash, async (key: unknown) => {
    const projectKey = requireKey(key)
    const runtime = requireRuntime()
    const item = runtime.projects.get(projectKey)
    if (!item) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    if (!runtime.trashPath) throw new VpmError('vpmInternal')
    // 文件夹已经不在了（被手动删/挪走）：没什么可回收的，直接清台账。
    if (!fs.existsSync(item.path)) {
      runtime.projects.remove(projectKey)
      runtime.forgetCoreProject?.(item.path)
      return { ok: true, mode: 'missing' as const }
    }
    let mode: 'recycle' | 'atrium' | 'missing' = 'recycle'
    try {
      await runtime.trashPath(item.path)
    } catch {
      /**
       * 有些盘（移动盘/网络盘/没有 $Recycle.Bin 的分区）上 `shell.trashItem` 会直接失败
       * （实测 E: 盘报 "Failed to parse path"）。这时退到 **Atrium 自己的回收站**：
       * 把整个文件夹挪到 `<数据根>/trash/<时间>-<名字>`，同样可恢复、不永久删。
       */
      // 放到 C 盘的 Atrium 目录（系统回收站不可用的盘上，这里是唯一能"可恢复删除"的地方）。
      const dest = path.join(
        app.getPath('appData'),
        'Atrium',
        'trash',
        `${Date.now()}-${path.basename(item.path)}`
      )
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      try {
        fs.renameSync(item.path, dest)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // 挪的过程中发现已经不在了：同样只清台账。
          runtime.projects.remove(projectKey)
          runtime.forgetCoreProject?.(item.path)
          return { ok: true, mode: 'missing' as const }
        }
        fs.cpSync(item.path, dest, { recursive: true })
        fs.rmSync(item.path, { recursive: true, force: true })
      }
      mode = 'atrium'
    }
    runtime.projects.remove(projectKey)
    // 关键：台账里可能本来就没有这一行（早先接桥进的是核心表），
    // 所以必须同时把核心工程表里的那一行也删掉，列表才会真的消失。
    runtime.forgetCoreProject?.(item.path)
    return { ok: true, mode }
  })

  ipc.handle(IpcInvoke.Vpm.ProjectRescan, (key: unknown) => {
    const projectKey = requireKey(key)
    const runtime = requireRuntime()
    const result = runtime.projects.refresh(projectKey)
    return detailFor(runtime, result.ledger.projectKey, result.snapshot)
  })

  ipc.handle(IpcInvoke.Vpm.ProjectOpenFolder, async (key: unknown) => {
    const projectKey = requireKey(key)
    const runtime = requireRuntime()
    const item = runtime.projects.get(projectKey)
    if (!item) throw new VpmError('vpmProjectInvalid', { field: 'projectKey' })
    const error = await shell.openPath(item.path)
    if (error) throw new VpmError('vpmProjectAccessDenied', { field: 'folder' }, new Error(error))
    return { ok: true }
  })
}
