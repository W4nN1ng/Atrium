import type { VpmDataRootPick, VpmStatus } from '../../shared/vpm/types'
import type {
  VpmCatalogPage,
  VpmCatalogPackageDetail,
  VpmCatalogQuery,
  VpmCatalogVersionDto,
  VpmNetworkStatus,
  VpmOperationCancelResult,
  VpmOperationDoneEvent,
  VpmOperationDto,
  VpmOperationProgressEvent,
  VpmOperationStart,
  VpmOperationStartInput,
  VpmOperationSummaryDto,
  VpmPlanDto,
  VpmPlanExplainDto,
  VpmPlanResolveInput,
  VpmProjectCatalogDto,
  VpmProjectDetailDto,
  VpmProjectSummaryDto,
  VpmRepoDoneEvent,
  VpmRepoDto,
  VpmRepoProgressEvent
} from '../../shared/vpm/dto'

/**
 * 渲染进程访问 VPM 的唯一入口。
 *
 * 只做类型化转发，不放业务规则：
 * - 数据根校验、快照、开关状态都由主进程决定；
 * - 组件/hook 不要直接摸 `window.a.vpm`，后续换传输/加错误包装只改这里；
 * - 新增通道时在这里补方法，并同步 `shared/vpm/dto` 与 preload。
 */
export const vpmApi = {
  status(): Promise<VpmStatus> {
    return window.a.vpm.status()
  },
  enable(dataRoot: string): Promise<VpmStatus> {
    return window.a.vpm.enable(dataRoot)
  },
  disable(): Promise<VpmStatus> {
    return window.a.vpm.disable()
  },
  pickDataRoot(): Promise<VpmDataRootPick> {
    return window.a.vpm.pickDataRoot()
  },
  reposList(): Promise<VpmRepoDto[]> {
    return window.a.vpm.reposList()
  },
  repoAdd(input: { url: string; name?: string }): Promise<VpmRepoDto> {
    return window.a.vpm.repoAdd(input)
  },
  repoRemove(id: string): Promise<{ ok: boolean }> {
    return window.a.vpm.repoRemove(id)
  },
  repoRefresh(id: string): Promise<VpmOperationStart> {
    return window.a.vpm.repoRefresh(id)
  },
  repoRefreshAll(): Promise<VpmOperationStart> {
    return window.a.vpm.repoRefreshAll()
  },
  networkStatus(): Promise<VpmNetworkStatus> {
    return window.a.vpm.networkStatus()
  },
  networkConsent(allow: boolean): Promise<VpmNetworkStatus> {
    return window.a.vpm.networkConsent(allow)
  },
  catalogQuery(query: VpmCatalogQuery): Promise<VpmCatalogPage> {
    return window.a.vpm.catalogQuery(query)
  },
  packageDetail(name: string): Promise<VpmCatalogPackageDetail | null> {
    return window.a.vpm.packageDetail(name)
  },
  packageVersions(name: string): Promise<VpmCatalogVersionDto[]> {
    return window.a.vpm.packageVersions(name)
  },
  projectsList(): Promise<VpmProjectSummaryDto[]> {
    return window.a.vpm.projectsList()
  },
  projectDetail(projectKey: string): Promise<VpmProjectDetailDto> {
    return window.a.vpm.projectDetail(projectKey)
  },
  projectAdd(input: { path: string }): Promise<VpmProjectDetailDto> {
    return window.a.vpm.projectAdd(input)
  },
  projectRemove(projectKey: string): Promise<{ ok: boolean }> {
    return window.a.vpm.projectRemove(projectKey)
  },
  projectRescan(projectKey: string): Promise<VpmProjectDetailDto> {
    return window.a.vpm.projectRescan(projectKey)
  },
  projectOpenFolder(projectKey: string): Promise<{ ok: boolean }> {
    return window.a.vpm.projectOpenFolder(projectKey)
  },
  planResolve(input: VpmPlanResolveInput): Promise<VpmPlanDto> {
    return window.a.vpm.planResolve(input)
  },
  planExplain(planId: string, name?: string): Promise<VpmPlanExplainDto> {
    return window.a.vpm.planExplain(planId, name)
  },
  planApply(input: VpmOperationStartInput): Promise<VpmOperationDto> {
    return window.a.vpm.planApply(input)
  },
  operationStatus(operationId: string): Promise<VpmOperationDto> {
    return window.a.vpm.operationStatus(operationId)
  },
  operationCancel(operationId: string): Promise<VpmOperationCancelResult> {
    return window.a.vpm.operationCancel(operationId)
  },
  operationHistory(projectKey: string): Promise<VpmOperationSummaryDto[]> {
    return window.a.vpm.operationHistory(projectKey)
  },
  operationUndo(operationId: string): Promise<VpmOperationDto> {
    return window.a.vpm.operationUndo(operationId)
  },
  projectCatalog(projectKey: string): Promise<VpmProjectCatalogDto> {
    return window.a.vpm.projectCatalog(projectKey)
  },
  pickProjectDirectory(title: string): Promise<string | null> {
    return window.a.system.pickDirectory({ title })
  },
  onRepoProgress(callback: (event: VpmRepoProgressEvent) => void): () => void {
    return window.a.on('vpm:repo-progress', (payload) => callback(payload as VpmRepoProgressEvent))
  },
  onRepoDone(callback: (event: VpmRepoDoneEvent) => void): () => void {
    return window.a.on('vpm:repo-done', (payload) => callback(payload as VpmRepoDoneEvent))
  },
  onOperationStarted(
    callback: (event: { operationId: string; projectKey: string }) => void
  ): () => void {
    return window.a.on('vpm:operation-started', (payload) =>
      callback(payload as { operationId: string; projectKey: string })
    )
  },
  onOperationProgress(callback: (event: VpmOperationProgressEvent) => void): () => void {
    return window.a.on('vpm:operation-progress', (payload) =>
      callback(payload as VpmOperationProgressEvent)
    )
  },
  onOperationDone(callback: (event: VpmOperationDoneEvent) => void): () => void {
    return window.a.on('vpm:operation-done', (payload) => callback(payload as VpmOperationDoneEvent))
  },
  openExternal(url: string): Promise<void> {
    return window.a.system.openExternal(url)
  }
}
