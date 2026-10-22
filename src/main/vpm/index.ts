import { ProjectBackupService } from './backup'
import { CatalogService } from './catalog'
import { CacheEntryStore, PackageCacheService, VpmCacheStore } from './cache'
import { closeVpmDb, openVpmDb, type VpmDb } from './db'
import { createElectronHttpTransport, createVpmHttpClient, type VpmHttpPort } from './http'
import {
  InstallTransactionService,
  OperationStore,
  RecoveryService,
  type LegacyGuardPort,
  type ProjectActivityPort
} from './install'
import { PlanService } from './planService'
import { RepoStore } from './repos'
import { ReposService } from './reposService'
import { TemplateService } from './templates'

import { UndoService } from './undoService'
import { VaultStore } from './vault'
import {
  ProjectLedgerStore,
  ProjectsService,
  type ProjectCorePort,
  type VccProjectSource
} from './projects'
import { projectKeyOf, type ProjectReaderPort } from '../../shared/vpm/domain/project'
import type { ProjectLinkagePort } from '../../shared/vpm/linkage'
import {
  ProjectCreateService,
  UnityEditorService,
  UnityInstallStore,
  UnityLaunchService,
  createTemplateAttachmentPort,
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
  /** 核心工程发现/运行的只读端口；由主进程注入，VPM 不直接 import 核心。 */
  coreProjects?: ProjectCorePort
  /** VCC userProjects 的只读来源；由主进程注入。 */
  vccProjects?: VccProjectSource
  /** 测试可替换 fs reader；默认使用 ProjectFsReader。 */
  projectReader?: (projectPath: string) => ProjectReaderPort
  /** 核心导入目标/启动绑定；P5-D 启动工程前调用。 */
  projectLinkage?: ProjectLinkagePort
  /** 恢复扫描用：工程是否正在 Unity 中/导入中；默认未知=false。P4-F 接入。 */
  isProjectActive?: (projectPath: string) => boolean
  /** 包事务的工程活动闸门（Unity 运行 / 素材导入）；P4-F 注入真实实现。 */
  projectActivity?: ProjectActivityPort
  /** 旧 Assets 清理的保护集合（`import_log` 已知资产）；P4-F 注入。 */
  legacyGuard?: LegacyGuardPort
  /** 包缓存配额；默认 20 GiB。P8 再接到设置/用量 UI。 */
  cacheQuotaBytes?: number
  /** 打开备份所在位置（Electron shell），由 gate 注入。 */
  revealPath?: (target: string) => void
}

export interface VpmRuntime {
  store: RepoStore
  http: VpmHttpPort
  cache: VpmCacheStore
  cacheEntries: CacheEntryStore
  packageCache: PackageCacheService
  repos: ReposService
  catalog: CatalogService
  unity: UnityEditorService
  projects: ProjectsService
  plans: PlanService
  operations: OperationStore
  recovery: RecoveryService
  vault: VaultStore
  transactions: InstallTransactionService
  undo: UndoService
  templates: TemplateService
  create: ProjectCreateService
  launch: UnityLaunchService
  backup: ProjectBackupService
  linkage?: ProjectLinkagePort
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
    const cacheEntries = new CacheEntryStore(db, options.now)
    const packageCache = new PackageCacheService({
      store: cache,
      entries: cacheEntries,
      http,
      quotaBytes: options.cacheQuotaBytes,
      now: options.now
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
    const projects = new ProjectsService({
      ledger: new ProjectLedgerStore(db, options.now),
      core: options.coreProjects,
      vcc: options.vccProjects,
      reader: options.projectReader
    })
    const plans = new PlanService({ projects, catalog, now: options.now })
    const operations = new OperationStore(db, options.now)
    const vault = new VaultStore({ dataRoot: options.dataRoot })
    const recovery = new RecoveryService({
      operations,
      vault,
      isProjectActive: options.isProjectActive
    })
    const transactions = new InstallTransactionService({
      operations,
      plans,
      packages: packageCache,
      vault,
      dataRoot: options.dataRoot,
      activity: options.projectActivity,
      legacyGuard: options.legacyGuard,
      now: options.now,
      projects: {
        // 工程快照永远从磁盘现读：事务不相信任何缓存的 manifest。
        load: (projectKey: string) => {
          const item = projects.get(projectKey)
          if (!item) return null
          return { projectPath: item.path, snapshot: projects.scan(item.path) }
        }
      }
    })
    const templates = new TemplateService({
      db,
      dataRoot: options.dataRoot,
      now: options.now
    })
    const create = new ProjectCreateService({
      templates,
      dataRoot: options.dataRoot,
      vault,
      projects,
      plans,
      transactions,
      activity: options.projectActivity,
      // P5-C：模板附件（unitypackage）解到临时工程的 Assets/。
      attachments: createTemplateAttachmentPort({ templates }),
      // 数据根里不允许建工程（会和模板/缓存/回滚仓混在一起）。
      forbiddenRoots: () => [options.dataRoot],
      installedUnityVersions: () => {
        try {
          return unity
            .list()
            .map((install) => install.version)
            .filter((version): version is string => typeof version === 'string' && version.length > 0)
        } catch {
          return []
        }
      }
    })
    const launch = new UnityLaunchService({
      installs: () => unity.list(),
      projectExePath: (projectPath: string) => {
        try {
          return projects.get(projectKeyOf(projectPath))?.ledger?.unityExePath ?? null
        } catch {
          return null
        }
      },
      isRunning: (projectPath: string) => {
        try {
          return options.isProjectActive?.(projectPath) === true
        } catch {
          return false
        }
      }
    })
    const backup = new ProjectBackupService({
      db,
      dataRoot: options.dataRoot,
      projects,
      activity: options.projectActivity,
      ...(options.revealPath ? { revealPath: options.revealPath } : {}),
      now: options.now,
      installer: async (projectPath: string) => {
        // 从备份新建后的"按 manifest 补装"：和建工程用同一条计划 + 事务。
        try {
          const snapshot = projects.scan(projectPath)
          const names = snapshot.packages
            .filter((pkg) => pkg.source === 'embedded' && pkg.state !== 'protected')
            .map((pkg) => pkg.name)
          if (names.length === 0) return 'none'
          const plan = plans.resolve({
            projectKey: projectKeyOf(projectPath),
            preset: 'upgradeAll'
          })
          const result = await transactions.apply({
            projectKey: projectKeyOf(projectPath),
            planId: plan.planId
          })
          return result.status === 'committed' ? 'installed' : 'failed'
        } catch {
          return 'failed'
        }
      }
    })
    const undo = new UndoService({
      operations,
      plans,
      projects,
      transactions,
      activity: options.projectActivity
    })
    // 启动先处理崩溃现场：能证明安全的自动回滚/补完归档，判不了的落 needs_attention。
    await recovery.scanAndApply()
    await repos.seedIfEmpty()

    let disposed = false
    runtime = {
      store,
      http,
      cache,
      cacheEntries,
      packageCache,
      repos,
      catalog,
      unity,
      projects,
      plans,
      operations,
      recovery,
      vault,
      transactions,
      undo,
      templates,
      create,
      launch,
      backup,
      linkage: options.projectLinkage,
      dispose(): void {
        if (disposed) return
        disposed = true
        plans.dispose()
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
