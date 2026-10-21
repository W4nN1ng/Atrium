import { ulid } from '../../../shared/ulid'
import { VpmError, type VpmErrorCode } from '../../../shared/vpm/errors'
import { IpcInvoke } from '../../../shared/ipc'
import type {
  VpmCatalogConflictDto,
  VpmCatalogPackageDetail,
  VpmCatalogPackageSummary,
  VpmCatalogPage,
  VpmCatalogQuery,
  VpmCatalogVersionDto,
  VpmNetworkStatus,
  VpmOperationStart,
  VpmRepoDto,
  VpmRepoDoneEvent,
  VpmRepoProgressEvent,
  VpmRepoRefreshResult
} from '../../../shared/vpm/dto'
import type { IpcApi } from '../../ipc/types'
import type { CatalogPackageDetail, CatalogPackageSummary } from '../catalog'
import { isNetworkEnabled, readNetworkConsent, setNetworkEnabled } from '../config'
import type { VpmRuntime } from '../index'
import type { RepoDto, RepoRefreshResult } from '../reposService'
import { registerProjectIpc } from './projects'
import { registerPlanIpc } from './plan'

export interface VpmIpcOptions {
  ipc: IpcApi
  broadcast?: (event: string, payload?: unknown) => void
  getRuntime: () => VpmRuntime | null
}

function repoDto(repo: RepoDto): VpmRepoDto {
  return { ...repo }
}

function refreshResult(result: RepoRefreshResult): VpmRepoRefreshResult {
  return {
    repo: repoDto(result.repo),
    status: result.status,
    packageCount: result.packageCount,
    errorCode: result.errorCode
  }
}

function summaryDto(summary: CatalogPackageSummary): VpmCatalogPackageSummary {
  return {
    ...summary,
    sources: summary.sources.map((source) => ({ ...source })),
    keywords: [...summary.keywords],
    aliases: [...summary.aliases]
  }
}

function versionDto(version: CatalogPackageDetail['versions'][number]): VpmCatalogVersionDto {
  return {
    ...version,
    sources: version.sources.map((source) => ({ ...source }))
  }
}

function conflictDto(conflict: CatalogPackageDetail['conflicts'][number]): VpmCatalogConflictDto {
  return {
    version: conflict.version,
    hashes: [...conflict.hashes],
    sources: [...conflict.sources]
  }
}

function detailDto(detail: CatalogPackageDetail): VpmCatalogPackageDetail {
  return {
    ...summaryDto(detail),
    versions: detail.versions.map(versionDto),
    conflicts: detail.conflicts.map(conflictDto)
  }
}

function pageDto(page: ReturnType<VpmRuntime['catalog']['query']>): VpmCatalogPage {
  return {
    items: page.items.map(summaryDto),
    total: page.total,
    limit: page.limit,
    offset: page.offset
  }
}

function errorCodeOf(error: unknown): VpmErrorCode {
  return error instanceof VpmError ? error.code : 'vpmInternal'
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) {
    throw new VpmError('vpmRepoNotFound')
  }
  return value.trim()
}

/**
 * P1 只读仓库/目录 IPC。
 *
 * 在 gate 注册一次，通过 getRuntime() 取当前运行时；runtime 未就绪时返回
 * `vpmRuntimeNotReady`，不会静态依赖任何重模块。
 */
export function registerVpmIpc(options: VpmIpcOptions): { dispose(): void } {
  const { ipc } = options
  const broadcast = options.broadcast ?? (() => {})
  const operations = new Map<string, VpmOperationStart>()
  const byRepo = new Map<string, string>()
  let activeAll: VpmOperationStart | null = null
  let disposed = false
  let lastProgressAt = 0
  let pendingProgress: VpmRepoProgressEvent | null = null
  let progressTimer: ReturnType<typeof setTimeout> | null = null

  const sendProgress = (payload: VpmRepoProgressEvent): void => {
    if (!disposed) broadcast('vpm:repo-progress', payload)
  }
  const sendDone = (payload: VpmRepoDoneEvent): void => {
    if (!disposed) broadcast('vpm:repo-done', payload)
  }

  const flushProgress = (): void => {
    if (progressTimer) {
      clearTimeout(progressTimer)
      progressTimer = null
    }
    if (!pendingProgress || disposed) return
    const event = pendingProgress
    pendingProgress = null
    lastProgressAt = Date.now()
    sendProgress(event)
  }

  const emitProgress = (event: VpmRepoProgressEvent, immediate = false): void => {
    if (disposed) return
    const now = Date.now()
    if (immediate) {
      flushProgress()
      lastProgressAt = now
      sendProgress(event)
      return
    }
    const wait = 100 - (now - lastProgressAt)
    if (wait <= 0) {
      flushProgress()
      lastProgressAt = now
      sendProgress(event)
      return
    }
    pendingProgress = event
    if (!progressTimer) {
      progressTimer = setTimeout(() => {
        progressTimer = null
        flushProgress()
      }, wait)
    }
  }

  const finish = (operationId: string, results: VpmRepoRefreshResult[]): void => {
    flushProgress()
    sendDone({ operationId, results })
    operations.delete(operationId)
  }

  const errorResult = (runtime: VpmRuntime, repoId: string, error: unknown): VpmRepoRefreshResult | null => {
    try {
      const repo = runtime.repos.listRepos().find((item) => item.id === repoId)
      if (!repo) return null
      return {
        repo,
        status: 'error',
        packageCount: repo.packageCount,
        errorCode: errorCodeOf(error)
      }
    } catch {
      return null
    }
  }

  const startSingle = (repoId: string): VpmOperationStart => {
    const runtime = requireRuntime()
    const existingId = byRepo.get(repoId)
    if (existingId) return { operationId: existingId, repoIds: [repoId] }
    if (!runtime.repos.listRepos().some((repo) => repo.id === repoId)) {
      throw new VpmError('vpmRepoNotFound')
    }

    const operation: VpmOperationStart = { operationId: ulid(), repoIds: [repoId] }
    operations.set(operation.operationId, operation)
    byRepo.set(repoId, operation.operationId)
    emitProgress(
      { operationId: operation.operationId, phase: 'start', repoId, repoIds: [repoId] },
      true
    )

    void (async () => {
      let result: VpmRepoRefreshResult | null = null
      try {
        result = refreshResult(await runtime.repos.refreshRepo(repoId))
      } catch (error) {
        result = errorResult(runtime, repoId, error)
      }
      if (disposed) return
      if (result) {
        emitProgress({
          operationId: operation.operationId,
          phase: 'repo',
          repoId,
          result
        })
      }
      byRepo.delete(repoId)
      finish(operation.operationId, result ? [result] : [])
    })()

    return operation
  }

  const startAll = (): VpmOperationStart => {
    const runtime = requireRuntime()
    if (activeAll) return activeAll
    const repoIds = runtime.repos.listRepos().filter((repo) => repo.enabled).map((repo) => repo.id)
    const operation: VpmOperationStart = { operationId: ulid(), repoIds }
    operations.set(operation.operationId, operation)
    activeAll = operation
    emitProgress({ operationId: operation.operationId, phase: 'start', repoIds }, true)

    void (async () => {
      let results: VpmRepoRefreshResult[] = []
      try {
        const final = await runtime.repos.refreshAll((result) => {
          const mapped = refreshResult(result)
          emitProgress({
            operationId: operation.operationId,
            phase: 'repo',
            repoId: mapped.repo.id,
            result: mapped
          })
        })
        results = final.map(refreshResult)
      } catch {
        // ReposService.refreshAll 按仓库隔离错误；走到这里通常是 DB/编程错误。
        // 用当前仓库状态生成 error 结果，UI 至少能看到 lastErrorCode。
        try {
          results = runtime.repos.listRepos().map((repo) => ({
            repo,
            status: 'error' as const,
            packageCount: repo.packageCount,
            errorCode: 'vpmInternal' as const
          }))
        } catch {
          results = []
        }
      }
      activeAll = null
      finish(operation.operationId, results)
    })()

    return operation
  }

  const requireRuntime = (): VpmRuntime => {
    const runtime = options.getRuntime()
    if (!runtime) throw new VpmError('vpmRuntimeNotReady')
    return runtime
  }

  const networkStatus = (): VpmNetworkStatus => {
    try {
      const consentAt = readNetworkConsent()
      return { consentAt, allowed: isNetworkEnabled() }
    } catch {
      return { consentAt: null, allowed: false }
    }
  }

  ipc.handle(IpcInvoke.Vpm.ReposList, () => requireRuntime().repos.listRepos().map(repoDto))
  ipc.handle(IpcInvoke.Vpm.RepoAdd, async (input: unknown) => {
    const runtime = requireRuntime()
    if (!input || typeof input !== 'object') throw new VpmError('vpmRepoInvalid', { field: 'repo' })
    const value = input as { url?: unknown; name?: unknown }
    if (typeof value.url !== 'string') throw new VpmError('vpmRepoInvalid', { field: 'url' })
    if (value.name !== undefined && typeof value.name !== 'string') {
      throw new VpmError('vpmRepoInvalid', { field: 'name' })
    }
    return repoDto(await runtime.repos.addRepo({ url: value.url, name: value.name }))
  })
  ipc.handle(IpcInvoke.Vpm.RepoRemove, (id: unknown) => {
    requireRuntime().repos.removeRepo(requireId(id))
    return { ok: true }
  })
  ipc.handle(IpcInvoke.Vpm.RepoRefresh, (id: unknown) => startSingle(requireId(id)))
  ipc.handle(IpcInvoke.Vpm.RepoRefreshAll, () => startAll())

  ipc.handle(IpcInvoke.Vpm.NetworkStatus, () => networkStatus())
  ipc.handle(IpcInvoke.Vpm.NetworkConsent, async (input: unknown) => {
    if (!input || typeof input !== 'object' || typeof (input as { allow?: unknown }).allow !== 'boolean') {
      throw new VpmError('vpmInternal')
    }
    const allow = (input as { allow: boolean }).allow
    setNetworkEnabled(allow)
    if (allow) {
      const runtime = options.getRuntime()
      if (runtime) await runtime.repos.seedIfEmpty()
    }
    return networkStatus()
  })

  ipc.handle(IpcInvoke.Vpm.CatalogQuery, (query: unknown) => {
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
      throw new VpmError('vpmInternal')
    }
    return pageDto(requireRuntime().catalog.query(query as VpmCatalogQuery))
  })
  ipc.handle(IpcInvoke.Vpm.PackageDetail, (name: unknown) => {
    if (typeof name !== 'string') throw new VpmError('vpmInternal')
    const detail = requireRuntime().catalog.getPackage(name)
    return detail ? detailDto(detail) : null
  })
  ipc.handle(IpcInvoke.Vpm.PackageVersions, (name: unknown) => {
    if (typeof name !== 'string') throw new VpmError('vpmInternal')
    const detail = requireRuntime().catalog.getPackage(name)
    return detail ? detail.versions.map(versionDto) : []
  })

  registerProjectIpc({ ipc, getRuntime: options.getRuntime })
  registerPlanIpc({ ipc, getRuntime: options.getRuntime })

  return {
    dispose(): void {
      disposed = true
      if (progressTimer) clearTimeout(progressTimer)
      progressTimer = null
      pendingProgress = null
      operations.clear()
      byRepo.clear()
      activeAll = null
    }
  }
}
