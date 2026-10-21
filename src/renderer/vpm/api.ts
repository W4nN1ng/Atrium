import type { VpmDataRootPick, VpmStatus } from '../../shared/vpm/types'
import type {
  VpmCatalogPage,
  VpmCatalogPackageDetail,
  VpmCatalogQuery,
  VpmCatalogVersionDto,
  VpmNetworkStatus,
  VpmOperationStart,
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
  onRepoProgress(callback: (event: VpmRepoProgressEvent) => void): () => void {
    return window.a.on('vpm:repo-progress', (payload) => callback(payload as VpmRepoProgressEvent))
  },
  onRepoDone(callback: (event: VpmRepoDoneEvent) => void): () => void {
    return window.a.on('vpm:repo-done', (payload) => callback(payload as VpmRepoDoneEvent))
  },
  openExternal(url: string): Promise<void> {
    return window.a.system.openExternal(url)
  }
}
