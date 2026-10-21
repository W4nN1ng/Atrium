import { CatalogService } from './catalog'
import { VpmCacheStore } from './cache'
import { closeVpmDb, openVpmDb, type VpmDb } from './db'
import { createElectronHttpTransport, createVpmHttpClient, type VpmHttpPort } from './http'
import { RepoStore } from './repos'
import { ReposService } from './reposService'
import {
  UnityEditorService,
  UnityInstallStore,
  type UnityDiscoveryOptions
} from './unity'

export interface InitVpmOptions {
  /** gate 已校验过的非 C 数据根；runtime 仍会用 cache 的路径检查兜底。 */
  dataRoot: string
  userAgent: string
  /** 必须读实时联网开关；关闭时 HTTP 端口 fail closed。 */
  isNetworkAllowed: () => boolean
  now?: () => number
  fetchConcurrency?: number
  /** 测试/沙盒可注入 Hub/安装根；生产默认读当前用户的 Unity Hub。 */
  unityDiscovery?: UnityDiscoveryOptions
}

export interface VpmRuntime {
  store: RepoStore
  http: VpmHttpPort
  cache: VpmCacheStore
  repos: ReposService
  catalog: CatalogService
  unity: UnityEditorService
  dispose(): void
}

/**
 * VPM 组合根：只组装服务，不注册 IPC/UI。
 *
 * 顺序：cache 路径校验/建目录 → 打开 vpm.db → 组装 store/http/cache/repos/catalog →
 * 需要时种子官方仓库（只建条目，不联网刷新）。
 *
 * 任一步失败都关闭已打开的 DB；调用方（gate）负责把错误转成 degraded。
 */
export async function initVpm(options: InitVpmOptions): Promise<VpmRuntime> {
  const cache = new VpmCacheStore({ dataRoot: options.dataRoot })
  let db: VpmDb | null = null
  let runtime: VpmRuntime | null = null

  try {
    db = await openVpmDb()
    const store = new RepoStore(db, options.now)
    const http = createVpmHttpClient({
      transport: createElectronHttpTransport(),
      isNetworkAllowed: options.isNetworkAllowed,
      userAgent: options.userAgent
    })
    const repos = new ReposService({
      store,
      http,
      hasConsent: options.isNetworkAllowed,
      now: options.now,
      concurrency: options.fetchConcurrency
    })
    const catalog = new CatalogService(store)
    const unity = new UnityEditorService(
      new UnityInstallStore(db, options.now),
      options.unityDiscovery
    )
    await repos.seedIfEmpty()

    let disposed = false
    runtime = {
      store,
      http,
      cache,
      repos,
      catalog,
      unity,
      dispose(): void {
        if (disposed) return
        disposed = true
        repos.dispose()
        closeVpmDb(db)
      }
    }
    return runtime
  } catch (error) {
    if (runtime) runtime.dispose()
    else if (db) closeVpmDb(db)
    throw error
  }
}
