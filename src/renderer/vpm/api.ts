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
  VpmCreateProjectInput,
  VpmCreateProjectResultDto,
  VpmLaunchResultDto,
  VpmProjectCatalogDto,
  VpmProjectDetailDto,
  VpmProjectSummaryDto,
  VpmRepoDoneEvent,
  VpmBackupDto,
  VpmCopyResultDto,
  VpmMigrateCandidateInput,
  VpmMigrateResultDto,
  VpmRecentLocationDto,
  VpmRepoDto,
  VpmRepoHeadersDto,
  VpmRepoTestDto,
  VpmVersionChangeResultDto,
  VpmRepoProgressEvent,
  VpmTemplateDto,
  VpmUnityInstallDto,
  VpmPreferencesDto,
  VpmPreferencesPatch,
  VpmUpdateCheckDto,
  VpmUpdateDownloadDto
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
  repoUpdate(input: { id: string; name?: string; url?: string; enabled?: boolean }): Promise<VpmRepoDto> {
    return window.a.vpm.repoUpdate(input)
  },
  repoReorder(ids: string[]): Promise<VpmRepoDto[]> {
    return window.a.vpm.repoReorder(ids)
  },
  repoImport(text: string): Promise<{ added: VpmRepoDto[]; skipped: Array<{ url: string; reason: 'duplicate' | 'invalid' }> }> {
    return window.a.vpm.repoImport(text)
  },
  repoExport(): Promise<string> {
    return window.a.vpm.repoExport()
  },
  repoHeaders(id: string): Promise<VpmRepoHeadersDto> {
    return window.a.vpm.repoHeaders(id)
  },
  repoHeadersSet(input: { id: string; headers: Record<string, string> }): Promise<VpmRepoHeadersDto> {
    return window.a.vpm.repoHeadersSet(input)
  },
  repoHeadersClear(id: string): Promise<{ ok: boolean }> {
    return window.a.vpm.repoHeadersClear(id)
  },
  repoTest(id: string): Promise<VpmRepoTestDto> {
    return window.a.vpm.repoTest(id)
  },
  backupCreate(input: {
    projectKey: string
    compression?: 'store' | 'fast' | 'normal'
    excludeVpmPackages?: boolean
  }): Promise<VpmBackupDto> {
    return window.a.vpm.backupCreate(input)
  },
  backupList(projectKey: string): Promise<VpmBackupDto[]> {
    return window.a.vpm.backupList(projectKey)
  },
  backupReveal(id: string): Promise<{ ok: boolean }> {
    return window.a.vpm.backupReveal(id)
  },
  projectCopy(input: { projectKey: string; targetDir: string }): Promise<VpmCopyResultDto> {
    return window.a.vpm.projectCopy(input)
  },
  projectVersionChange(input: {
    projectKey: string
    unityVersion: string
    backupFirst?: boolean
  }): Promise<VpmVersionChangeResultDto> {
    return window.a.vpm.projectVersionChange(input)
  },
  projectParentCheck(path: string): Promise<{ parent: string; adjustedFrom: string | null }> {
    return window.a.vpm.projectParentCheck(path)
  },
  projectScanRoot(path: string): Promise<{
    root: string
    candidates: Array<{ path: string; name: string; unityVersion: string | null; added: boolean }>
  }> {
    return window.a.vpm.projectScanRoot(path)
  },
  projectMigrate(input: {
    projectKey: string
    candidates: VpmMigrateCandidateInput[]
  }): Promise<VpmMigrateResultDto> {
    return window.a.vpm.projectMigrate(input)
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
  projectsEnsureLedgers(): Promise<{ created: number; failed: string[] }> {
    return window.a.vpm.projectsEnsureLedgers()
  },
  projectTrash(projectKey: string): Promise<{ ok: boolean; mode?: 'recycle' | 'atrium' }> {
    return window.a.vpm.projectTrash(projectKey)
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
  unityInstalls(): Promise<VpmUnityInstallDto[]> {
    return window.a.vpm.unityInstalls()
  },
  unityRefresh(): Promise<VpmUnityInstallDto[]> {
    return window.a.vpm.unityRefresh()
  },
  projectLaunch(input: {
    projectKey: string
    editorPath?: string | null
    extraArgs?: string[]
  }): Promise<VpmLaunchResultDto> {
    return window.a.vpm.projectLaunch(input)
  },
  projectLaunchArgs(input: { projectKey: string; extraArgs?: string[] }): Promise<string[]> {
    return window.a.vpm.projectLaunchArgs(input)
  },
  projectCreate(input: VpmCreateProjectInput): Promise<VpmCreateProjectResultDto> {
    return window.a.vpm.projectCreate(input)
  },
  localRoots(): Promise<
    Array<{ id: string; path: string; label: string | null; lastScanAt: number | null; packageCount: number }>
  > {
    return window.a.vpm.localRoots()
  },
  localAdd(input: { path: string; label?: string }): Promise<{ id: string; path: string; label: string | null; packageCount: number }> {
    return window.a.vpm.localAdd(input)
  },
  localRemove(id: string): Promise<{ ok: boolean }> {
    return window.a.vpm.localRemove(id)
  },
  localScan(): Promise<Array<{ name: string; version: string; path: string; unity: string | null; rootId: string }>> {
    return window.a.vpm.localScan()
  },
  localInstall(input: { projectKey: string; packageName: string }): Promise<{
    name: string
    version: string
    installedAt: string
  }> {
    return window.a.vpm.localInstall(input)
  },
  logRecent(limit = 20): Promise<
    Array<{
      id: string
      projectName: string
      kind: string
      status: string
      createdAt: number
      finishedAt: number | null
      errorCode: string | null
      failedStep: string | null
      stepCount: number
    }>
  > {
    return window.a.vpm.logRecent(limit)
  },
  usageSnapshot(): Promise<{
    cache: { bytes: number; files: number }
    vault: { bytes: number; files: number }
    backups: { bytes: number; files: number }
    totalBytes: number
  }> {
    return window.a.vpm.usageSnapshot()
  },
  cacheClear(): Promise<{ removedBytes: number }> {
    return window.a.vpm.cacheClear()
  },
  diagnosticsExport(): Promise<{ path: string }> {
    return window.a.vpm.diagnosticsExport()
  },
  interopVccPeek(): Promise<{
    path: string
    exists: boolean
    parseError: boolean
    repos: Array<{ url: string; name: string | null }>
    packageFolders: string[]
    unityHint: string | null
    skipped: Array<{ value: string; reason: string }>
  }> {
    return window.a.vpm.interopVccPeek()
  },
  interopVccApply(input: { repos: boolean; folders: boolean }): Promise<{
    addedRepos: number
    addedFolders: number
    skipped: Array<{ value: string; reason: string }>
  }> {
    return window.a.vpm.interopVccApply(input)
  },
  templateImport(input?: { path?: string }): Promise<
    { cancelled: true } | { cancelled: false; id: string; name: string; source: 'atrium' | 'foreign' }
  > {
    return window.a.vpm.templateImport(input ?? {})
  },
  templateExport(input: { id: string }): Promise<{ cancelled: true } | { cancelled: false; path: string }> {
    return window.a.vpm.templateExport(input)
  },
  templateList(): Promise<VpmTemplateDto[]> {
    return window.a.vpm.templateList()
  },
  templateFavorite(input: { id: string; favorite: boolean }): Promise<VpmTemplateDto> {
    return window.a.vpm.templateFavorite(input)
  },
  templateRecent(): Promise<VpmRecentLocationDto[]> {
    return window.a.vpm.templateRecent()
  },
  /** P8-C：偏好设置。写回整份 DTO，界面直接 setState 即可。 */
  settingsGet(): Promise<VpmPreferencesDto> {
    return window.a.vpm.settingsGet()
  },
  settingsPatch(patch: VpmPreferencesPatch): Promise<VpmPreferencesDto> {
    return window.a.vpm.settingsPatch(patch)
  },
  updateCheck(force = false): Promise<VpmUpdateCheckDto> {
    return window.a.vpm.updateCheck({ force })
  },
  updateDownload(): Promise<VpmUpdateDownloadDto> {
    return window.a.vpm.updateDownload()
  },
  updateInstall(path: string): Promise<{ ok: boolean; errorCode: string | null }> {
    return window.a.vpm.updateInstall({ path })
  },
  pickProjectDirectory(title: string): Promise<string | null> {
    return window.a.system.pickDirectory({ title })
  },
  /** 深链（P7-E）：组件不直接碰 `window.a`，一律走这里。 */
  onDeepLink(callback: (intent: unknown) => void): () => void {
    return window.a.on('vpm:deeplink', (payload) => callback(payload))
  },
  /** 备份进度（R2）。 */
  onBackupProgress(
    callback: (progress: {
      projectKey?: string
      phase?: 'collect' | 'zip'
      files?: number
      bytes?: number
      percent?: number | null
    }) => void
  ): () => void {
    return window.a.on('vpm:backup-progress', (payload) => callback(payload as never))
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
