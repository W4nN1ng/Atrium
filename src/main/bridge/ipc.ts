import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import { shell } from 'electron'
import type { Db } from '../db'
import { getProject, listProjects, setProjectRunning } from '../db/repos/unity'
import { listImportLogs } from '../db/repos/journal'
import { listImportHistory } from '../db/repos/importHistory'
import { getSettings, setSettings } from '../services/settings'
import type { UnityConnections } from '../project/connections'
import type { ProjectConnection, UnityConnectionSnapshot, UnityTargetResolution } from '../../shared/unityConnection'
import { bridgeTemplateRoot, bundledBinDir } from '../services/paths'
import { setBridgeAsk } from '../db/repos/bridgeAsk'
import { bridgeAskAnswerFor } from '../../shared/bridgeAsk'
import { dropBridgeAsk, pendingBridgeAsks, silenceRestBridgeAsks } from './askQueue'
import type { IpcRegistrar } from '../ipc/types'
import type { BridgeManager } from './manager'
import {
  installBridge,
  uninstallBridge,
  uninstallBridgeFromAll,
  checkBridgeTemplate
} from './installer'
import {
  packagesOfAsset,
  importUnitypackage,
  preflight,
  rollbackImport,
  type ConflictChoice,
  type PreflightResult
} from '../import/coordinator'
import {
  IMPORT_BATCH_MAX,
  abandonMemberPlan,
  commitMemberImport,
  planMemberImport,
  rollbackMemberBatch,
  type MemberPlan,
  type PlanSource
} from '../import/memberImport'
import type {
  BatchOutcome,
  BridgeFirstSeenEvent,
  CommitResult,
  ExtractCleanOutcome,
  ExtractUsage,
  FoundPackage,
  ImportItemEvent,
  PackagesOfAssetResult,
  PlanFailure,
  PlanItemView,
  PlanView,
  RollbackBatchResult
} from '../../shared/types'
import {
  ExtractRootError,
  pruneExtractRoot,
  resolveExtractRoot,
  sizeOfTree,
  type DiskFacts
} from '../import/extractRoot'

/**
 * M5-A 的 IPC 接线：把 `BridgeManager` / `installer` / `coordinator` 接到渲染进程。
 *
 * **替换掉 `ipc/stubs.ts` 里那 7 个抛「未实现」的通道。**
 * 那个文件里写着「绝不返回假的成功状态」——这一份继承同样的纪律：
 * 做不到的事就明确报错（比如"桥接未安装 [立即安装]"），不糊一个 `ok: true`。
 *
 * ## 导入为什么要分两步
 *
 * §5.1④ 要求「有冲突 → 弹窗，列出**具体文件路径**」。所以：
 *  `preflight`（只读，算冲突）→ 界面给用户看 → `import`（带用户选的处置）→ `rollback`。
 * 一步到位的话，用户永远没机会在覆盖前看见要覆盖什么。
 */

export interface BridgeIpcDeps {
  db: Db
  manager: BridgeManager
  registrar: IpcRegistrar
  /** Main owns connection discovery; omitted by legacy integrations. */
  connections?: UnityConnections
  /**
   * "送回收站"的实现。**必须可注入**，理由和 `installer` / `coordinator` 那边一样：
   *
   *  - 生产：`shell.trashItem`（00§五-5：删除一律走回收站，不能永久删除）
   *  - 测试：注入真的 fs 实现。**不能依赖 electron 的 `shell`** ——
   *    测试环境里 `electron` 是 stub，`trashItem` 是个既不动文件也不抛错的空函数，
   *    于是"卸载成功但目录还在"会被静默放过（实测就是这么发现的：
   *    接线没被测过时，这条"成功"是假的）。
   */
  trashFn?: (p: string) => Promise<void>
  /**
   * 抽取根闸门用的**磁盘读数**（剩余空间、盘符）。生产不传 = 读真盘。
   *
   * 和 `trashFn` 同一个理由：不注入的话，用例就得依赖"这台机器的临时目录在哪个盘"。
   * 本机的 `%TEMP%` 在 C 盘，而 C 盘正是那道闸门要拒的盘 —— 于是
   * **整条 IPC 集成测试都跑不动**（一按规划就 `err.extractOnSystemDrive`）。
   * 只换读数、不换规则：三条判据本身照旧由 `extract-root.spec.ts` /
   * `member-import.spec.ts` 用默认读数测。
   */
  extractDisk?: Partial<DiskFacts>
  /** 单批上限。生产不传 = `IMPORT_BATCH_MAX`（8）；测试要造"撞闸"场景才传 */
  batchMax?: number
}

/** 预扫描结果给界面看的那份（Map 不能过 IPC，转成数组） */
export interface PreflightView {
  ok: boolean
  reasonKey: string | null
  reason: string | null
  bridgeMissing: boolean
  packagePath: string
  entryCount: number
  fresh: number
  conflictCount: number
  /** §5.1④：要列出**具体文件路径**，所以这里给全（界面自己截断展示） */
  conflicts: Array<{ guid: string; existingPath: string; incomingPath: string }>
  guids: string[]
  projectId: string
}

function toView(pre: PreflightResult, projectId: string): PreflightView {
  return {
    ok: pre.ok,
    reasonKey: pre.reasonKey,
    reason: pre.reason,
    bridgeMissing: pre.bridgeMissing,
    packagePath: pre.packagePath,
    entryCount: pre.entryCount,
    fresh: pre.fresh,
    conflictCount: pre.conflicts.length,
    conflicts: pre.conflicts.map((c) => ({
      guid: c.guid,
      existingPath: c.existingPath,
      incomingPath: c.incomingPath
    })),
    guids: pre.guids,
    projectId
  }
}

/** 桥接模板根：dev 在 `resources/unity-bridge/com.avca.bridge`，打包在 resources 下 */
function templateRoot(): string {
  return bridgeTemplateRoot()
}

// ---------------------------------------------------------------- 批量计划的界面视图
// 类型本身在 `shared/types.ts`（主进程与渲染进程共用同一份），这里只做转换。

function toItemView(p: MemberPlan['items'][number]): PlanItemView {
  return {
    relPath: p.relPath,
    sizeBytes: p.sizeBytes,
    originArchive: p.originArchive,
    extracted: p.extractDir !== null,
    entryCount: p.preflight.entryCount,
    fresh: p.preflight.fresh,
    conflictCount: p.preflight.conflicts.length,
    conflicts: p.preflight.conflicts.map((c) => ({
      guid: c.guid,
      existingPath: c.existingPath,
      incomingPath: c.incomingPath
    }))
  }
}

function toPlanView(plan: MemberPlan): PlanView {
  return {
    ok: true,
    batchId: plan.batchId,
    items: plan.items.map(toItemView),
    blocked: plan.blocked.map((b) => ({ relPath: b.relPath, reasonKey: b.reasonKey, detail: b.detail })),
    totalBytes: plan.totalBytes,
    freeBytes: plan.freeBytes,
    conflictPackages: plan.items.filter((i) => i.preflight.conflicts.length > 0).length,
    conflictEntries: plan.items.reduce((a, i) => a + i.preflight.conflicts.length, 0),
    batchMax: IMPORT_BATCH_MAX
  }
}

function planFailure(o: PlanFailure): PlanFailure {
  return { ok: false, reasonKey: o.reasonKey, reasonParams: o.reasonParams, detail: o.detail ?? null }
}

export interface BridgeIpcApi {
  targetProjectId(): string | null
  dispose(): void
}

export function registerBridgeIpc(deps: BridgeIpcDeps): BridgeIpcApi {
  const { db, manager, registrar } = deps
  const trash = deps.trashFn ?? ((p: string) => shell.trashItem(p))
  const extractDisk = deps.extractDisk
  const batchMax = deps.batchMax

  /** 当前选中的导入目标工程（顶栏切换器写的）。M5-A 只保存，不做自动切换 */
  let targetProjectId: string | null = null
  const computedTarget = (): string | null => deps.connections ? deps.connections.snapshot().targetProjectId : targetProjectId
  const preparations = new Map<string, AbortController>()
  let disposed = false

  function requestId(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error('project.connectionFailed')
    return value
  }

  function connectionProjectId(value: unknown): string {
    const id = requestId(value)
    if (!getProject(db, id)) throw new Error('project.connectionProjectMissing')
    return id
  }

  function excludeConnections(ids: string[], exclude: boolean): void {
    const current = getSettings().unityAutoConnectExcludedProjectIds
    const selected = new Set(ids)
    const next = exclude ? [...new Set([...current, ...ids])] : current.filter(id => !selected.has(id))
    if (next.length !== current.length || next.some((id, index) => id !== current[index])) {
      setSettings({ unityAutoConnectExcludedProjectIds: next })
    }
  }

  function connectionSnapshot(): UnityConnectionSnapshot {
    if (deps.connections) return deps.connections.snapshot()
    return {
      projects: listProjects(db).map<ProjectConnection>(project => {
        const st = manager.statusOf(project.path)
        return { projectId: project.id, projectPath: project.path, name: project.name,
          phase: st.bridgeReady ? 'ready' : project.is_running || st.running ? 'connecting' : 'closed',
          reasonKey: null, detail: null }
      }),
      targetProjectId: computedTarget(), targetMode: 'manual', ambiguous: false
    }
  }

  /**
   * 已经"抽好并预扫描过、等用户点确认"的批次。
   *
   * 为什么放内存不放库：这批东西**只是磁盘上的临时副本 + 一份冲突表**，
   * 程序一关就没意义了（重启后 `pruneExtractRoot()` 会把副本扫掉，冲突表也过期了）。
   * 库里要记的是"导成功了哪几个、从哪个容器抽的"，那是 `import_log` 的事（V5 三列）。
   *
   * 只留最近 4 批：每批最多 8 个包的副本躺在盘上，界面切八次容器不点确认就能攒 64 个。
   * 挤掉旧批时**立即删副本**，不然"只留 4 批"变成"内存里只留 4 批、盘上留下一地"。
   */
  const staged = new Map<string, { plan: MemberPlan; controller: AbortController }>()
  const MAX_STAGED_PLANS = 4

  async function stagePlan(plan: MemberPlan): Promise<void> {
    staged.set(plan.batchId, { plan, controller: new AbortController() })
    while (staged.size > MAX_STAGED_PLANS) {
      const oldestKey = staged.keys().next().value as string | undefined
      if (!oldestKey) break
      const old = staged.get(oldestKey)
      staged.delete(oldestKey)
      if (old) {
        const r = await abandonMemberPlan(old.plan)
        if (r.failed) log.warn(`[import] 挤掉旧批次 ${oldestKey} 时有 ${r.failed} 个副本没删掉`)
      }
    }
  }

  /** 抽取根当前占了多少（设置 → 维护那句"这里还压着 N MB"） */
  function extractRootNow(): { root: string; bytes: number } | null {
    const s = getSettings()
    try {
      const root = resolveExtractRoot(s.extractRoot, s.libraryRoot)
      return { root, bytes: sizeOfTree(root) }
    } catch {
      /** 配置不对就报"没有这个目录可管"，而不是在这里替用户猜一个 */
      return null
    }
  }

  function projectPathOf(projectId: string): string {
    const p = getProject(db, projectId)
    if (!p) throw new Error('库里没有这个工程的记录（先刷新工程列表）')
    return p.path
  }

  /** 所有已知工程路径 —— 多实例查询与"从所有工程卸载"都要用 */
  function allProjectPaths(): string[] {
    return listProjects(db).map((p) => p.path)
  }

  // ---------------------------------------------------------------- 状态

  registrar.ipc.handle('unity:instances', () => manager.instances(allProjectPaths()))

  registrar.ipc.handle('unity:connection', connectionSnapshot)
  registrar.ipc.handle('unity:resolve-target', (): UnityTargetResolution => {
    const snapshot = connectionSnapshot()
    if (snapshot.targetProjectId) {
      const project = snapshot.projects.find(item => item.projectId === snapshot.targetProjectId)
      if (project) return { kind: 'selected', projectId: project.projectId, projectName: project.name }
    }
    if (snapshot.ambiguous) return { kind: 'choose', projectIds: snapshot.projects
      .filter(project => !['closed', 'disabled', 'unsupported'].includes(project.phase) && project.reasonKey !== 'project.connectionUnsafe')
      .map(project => project.projectId) }
    return { kind: 'none' }
  })
  registrar.ipc.handle('unity:prepare-target', async (projectId: unknown, preparationId: unknown): Promise<ProjectConnection> => {
    if (disposed) throw new Error('project.connectionCancelled')
    const id = requestId(preparationId)
    if (preparations.has(id)) throw new Error('project.connectionFailed')
    const fixedProjectId = connectionProjectId(projectId)
    const controller = new AbortController()
    preparations.set(id, controller)
    try {
      const connection = deps.connections ? await deps.connections.prepare(fixedProjectId, { signal: controller.signal })
        : connectionSnapshot().projects.find(project => project.projectId === fixedProjectId)
      if (disposed || controller.signal.aborted) throw new Error('project.connectionCancelled')
      if (!connection || connection.phase !== 'ready') throw new Error(connection?.reasonKey ?? 'project.connectionFailed')
      return connection
    } finally { preparations.delete(id) }
  })
  registrar.ipc.handle('unity:cancel-target-preparation', (preparationId: unknown): void => {
    preparations.get(requestId(preparationId))?.abort()
  })
  registrar.ipc.handle('unity:retry-connection', (projectId: unknown): void => {
    if (disposed) throw new Error('project.connectionCancelled')
    const id = connectionProjectId(projectId)
    excludeConnections([id], false)
    deps.connections?.retry(id)
  })

  registrar.ipc.handle('unity:status', () => {
    const targetProjectId = computedTarget()
    /** 没选目标时报告"没有目标"而不是假装一切正常 */
    if (!targetProjectId) {
      return {
        running: false,
        bridgeReady: false,
        isPlaying: false,
        isCompiling: false,
        isUpdating: false,
        queueLength: 0,
        busyReason: null,
        targetProjectId: null,
        targetProjectPath: null,
        queue: []
      }
    }
    const project = getProject(db, targetProjectId)
    if (!project) {
      return {
        running: false,
        bridgeReady: false,
        isPlaying: false,
        isCompiling: false,
        isUpdating: false,
        queueLength: 0,
        busyReason: null,
        targetProjectId,
        targetProjectPath: null,
        queue: []
      }
    }
    const st = manager.statusOf(project.path)
    return {
      ...st,
      running: Boolean(project.is_running || st.running),
      targetProjectId,
      targetProjectPath: project.path
    }
  })

  registrar.ipc.handle('unity:set-target', (projectId: unknown) => {
    const next = typeof projectId === 'string' && projectId.trim() ? projectId : null
    if (next && !getProject(db, next)) throw new Error('库里没有这个工程的记录')
    deps.connections?.select(next)
    targetProjectId = next
    if (next) {
      const p = getProject(db, next)
      if (p) manager.watch(p.path)
    }
    log.info(`[bridge] 导入目标切到 ${next ?? '（无）'}`)
    return computedTarget()
  })

  /**
   * 已装过导入的工程（§7 反查"这个素材在哪个工程装过"）。
   * M5-A 只回传 import_log 里的成功记录，不做 GUID 反查（那是 M5-B 的活）。
   */
  registrar.ipc.handle('unity:import-history', (query: unknown) => {
    const q = query && typeof query === 'object' ? query as Record<string, unknown> : {}
    return listImportHistory(db, {
      projectId: typeof q.projectId === 'string' ? q.projectId : null,
      offset: typeof q.offset === 'number' ? q.offset : 0,
      limit: typeof q.limit === 'number' ? q.limit : 20
    })
  })
  registrar.ipc.handle('unity:import-logs', (assetId: unknown) => {
    if (typeof assetId !== 'string') return []
    return listImportLogs(db).filter((r) => r.asset_id === assetId)
  })

  // ---------------------------------------------------------------- 桥接安装

  registrar.ipc.handle('unity:bridge-template-check', () => checkBridgeTemplate(templateRoot()))

  registrar.ipc.handle('unity:install-bridge', (projectId: unknown) => {
    const id = String(projectId ?? computedTarget() ?? '')
    if (!id) throw new Error('先选一个导入目标工程')
    const projectPath = projectPathOf(id)
    excludeConnections([id], false)
    const r = installBridge(db, projectPath, templateRoot())
    // Explicit installation can also target a closed project. Its result is separate from connection readiness.
    try { deps.connections?.retry(id) } catch (error) { log.info(`[bridge] 安装后的连接尚不能重试：${String(error)}`) }
    if (r.ok) {
      /** 装上了就得开始盯它的 outbox，不然第一次导入等不到结果 */
      manager.watch(projectPath)
      /**
       * 这条"要不要装桥接"从此有着落了 → 出队。
       *
       * 第 7 轮 ④ 活体撞到的：向导第 ③ 步给两个工程装完桥接、走完向导，
       * 弹窗照旧问"这个工程还没装 A 的桥接"—— 因为队列只有"答了 / 自动装成了"两个出队时机，
       * **手动装成**这条路漏了一个。而队列的语义就是"还没有着落的问题"，装着了的工程不该还在队里。
       */
      dropBridgeAsk(id)
      log.info(`[bridge] 已为 ${path.basename(projectPath)} 安装桥接${r.alreadyInstalled ? '（本来就装着）' : ''}`)
    }
    return r
  })

  /**
   * R4 ⑦ · 记下用户对"要不要给这个工程装桥接"的回答。
   *
   * `choice`：`install-once`（这次装，下次还问）/ `always`（这个工程以后自动装）/
   * `never`（这个工程别再问了）。**"以后都自动安装"只管这一个工程**，
   * 不是开机自启 —— 措辞按 M6 Q3 那条教训写清，别再把两件事混一句话里。
   */
  registrar.ipc.handle('unity:answer-bridge-ask', (input: unknown) => {
    const i = (input ?? {}) as { projectId?: unknown; choice?: unknown }
    const id = String(i.projectId ?? '')
    if (!id) return { ok: false, error: '没给工程 id' }
    const choice = String(i.choice ?? '')
    const answer = bridgeAskAnswerFor(choice as 'install-once' | 'always' | 'never' | 'later')
    if (!['install-once', 'always', 'never', 'later'].includes(choice)) {
      return { ok: false, error: '不认识的回答：' + choice }
    }
    setBridgeAsk(db, id, answer)
    /** 用户已经当面答过了 → 队列里那条就作废（渲染层重载时不该再弹一次） */
    dropBridgeAsk(id)
    log.info(`[bridge-ask] 「${id}」记下了：${choice}`)
    return { ok: true, saved: answer }
  })

  /**
   * M7 Q10 · 「剩下这些都不再问」。
   *
   * 全新安装一次发现一批工程时会连问 N 次（第 2 轮实测：真机 8 个 → 连问 8 次）。
   * 这颗按钮把队列里**除了屏幕上正在答的那条**之外每个工程各写一行 `never`。
   *
   * ⚠ 口径：不引入"全局静音"那种第二个真相来源 —— 判据 `bridgeAskDecision` 继续只认
   *  `bridgeAsk:<projectId>` 这一行，以后"为什么这个工程不问了"还能从库里答出来。
   */
  registrar.ipc.handle('unity:bridge-ask-never-rest', (input: unknown) => {
    const i = (input ?? {}) as { exceptProjectId?: unknown }
    const except = String(i.exceptProjectId ?? '')
    const rest = silenceRestBridgeAsks(except, (id) => setBridgeAsk(db, id, 'never'))
    if (rest.length) log.info(`[bridge-ask] 「剩下都不再问」写了 ${rest.length} 条 never（屏幕上那条 ${except || '—'} 没动）`)
    return { ok: true, answered: rest.length }
  })

  /**
   * R4 ⑦ · 渲染层起来后看一眼主进程攒下的桥接决定（**不清空**）。
   *
   * 必须有这条：主进程第一轮工程发现是**同步**跑完的（`project/api.ts` 的 `void refresh()`），
   * 那时窗口和 `window.a.on('project:first-seen')` 都还不存在，广播会掉在地上。
   * 不清空是因为渲染层随时可能整页刷新（实测：活体里改一次 i18n 文案就刷），
   * 刷完拿不到就等于这个工程永远没人问了。
   */
  registrar.ipc.handle('unity:bridge-ask-pending', (): BridgeFirstSeenEvent[] => pendingBridgeAsks())

  /** R4 ⑦ · 自动装**装成了** → 这条决定有着落了，出队（不然每次刷新都重装一遍） */
  registrar.ipc.handle('unity:bridge-ask-done', (projectId: unknown) => {
    const id = String(projectId ?? '')
    if (!id) return { ok: false, error: '没给工程 id' }
    dropBridgeAsk(id)
    return { ok: true }
  })
  registrar.ipc.handle('unity:uninstall-bridge', async (projectId: unknown) => {
    const id = String(projectId ?? computedTarget() ?? '')
    if (!id) throw new Error('先选一个导入目标工程')
    const projectPath = projectPathOf(id)
    // Persist before the first asynchronous trash operation so polling cannot race a reinstall.
    excludeConnections([id], true)
    /**
     * **卸载走回收站**（00§五-5：删除一律走回收站，不能永久删除）。
     * `shell.trashItem` 只能在主进程用，所以由这里注入。
     */
    const r = await uninstallBridge(db, projectPath, trash)
    if (r.ok) manager.unwatch(projectPath)
    return r
  })

  registrar.ipc.handle('unity:uninstall-bridge-all', async () => {
    excludeConnections(listProjects(db).map(project => project.id), true)
    const r = await uninstallBridgeFromAll(db, allProjectPaths(), trash)
    for (const p of r.uninstalled) manager.unwatch(p)
    return r
  })

  // ---------------------------------------------------------------- 导入

  /**
   * 这张卡底下有什么能导的东西 —— M5-B 之后**压缩包成员也列得出来了**。
   *
   * 返回判别联合（设计 §3.10）：
   *  - `loose` 磁盘上就有（单包 / 目录型容器里的成员），路径可以直接给 Unity
   *  - `archive` 成员在压缩包里，`path: null`，必须先 `import-plan` 抽出来
   *  - `empty` 没有能导的包，`reasonKey` 说为什么；`notes` 里是"撞了上限 / 要密码 / 列不出来"
   *
   * 老实现里压缩包那一支是 `return []`（吞掉），界面只能说"这个素材没有包"。
   * 现在它如实说"有 N 个成员，还没抽"。
   */
  registrar.ipc.handle('unity:packages-of-asset', async (assetId: unknown): Promise<PackagesOfAssetResult> => {
    if (typeof assetId !== 'string') return { kind: 'empty', reasonKey: 'noRow', packages: [], notes: null }
    return packagesOfAsset(db, assetId, { extraBackendDirs: [bundledBinDir()] })
  })

  /**
   * **抽取 + 预扫描**（只读，不动工程）。界面拿到 `PlanView` 后弹**一张**汇总冲突卡片。
   *
   * 成员路径由这里**重新列一遍**再按 `relPath` 认领，不直接信界面传来的路径列表 ——
   * 界面那份清单是几分钟前那次 `packages-of-asset` 的结果，中间用户可能重新摄取过这张卡。
   * 认领不上就报 `err.memberMissing`，绝不"顺着找个差不多的"（那是拿错包导进工程）。
   *
   * R4 ② 起支持两种入参形状：
   *  - 老的 `{assetId, members[]}`：一张卡（成员面板那条路，行为一字不变）；
   *  - 新的 `{items:[{assetId, members[]}]}`：**多选卡批量**，每张卡各带自己点名的成员。
   *    逐张重新列清单、逐张认领 —— 一张卡过期不会连累别的卡，认领不上的那张进 `blocked`。
   */
  registrar.ipc.handle(
    'unity:import-plan',
    async (input: unknown): Promise<PlanView | PlanFailure> => {
      const i = (input ?? {}) as {
        assetId?: string
        members?: string[]
        projectId?: string
        password?: string
        items?: Array<{ assetId?: string; members?: string[] }>
      }
      const id = String(i.projectId ?? computedTarget() ?? '')
      if (!id) return { ok: false, reasonKey: 'unity.errNoProject' }
      const reqs =
        Array.isArray(i.items) && i.items.length
          ? i.items.map((x) => ({ assetId: String(x?.assetId ?? ''), members: (x?.members ?? []).map(String) }))
          : [{ assetId: String(i.assetId ?? ''), members: (i.members ?? []).map(String) }]
      if (reqs.some((r) => !r.assetId) || reqs.some((r) => !r.members.length)) {
        return { ok: false, reasonKey: 'err.batchEmpty' }
      }

      const s = getSettings()
      let extractRoot: string
      try {
        extractRoot = resolveExtractRoot(s.extractRoot, s.libraryRoot)
      } catch (e) {
        if (e instanceof ExtractRootError) return { ok: false, reasonKey: e.key, reasonParams: e.params, detail: null }
        throw e
      }

      const sources: PlanSource[] = []
      /** 一张卡都认领不上时才整体报错；部分认领不上交给 planMemberImport 记 blocked */
      for (const r of reqs) {
        const listed = await packagesOfAsset(db, r.assetId, {
          password: i.password,
          extraBackendDirs: [bundledBinDir()]
        })
        const picks = listed.packages.filter((p) => r.members.includes(p.relPath))
        if (!picks.length) continue
        const row = db.prepare(`SELECT library_path AS l, source_path AS s FROM asset WHERE id = ?`).get(r.assetId) as
          | { l: string | null; s: string | null }
          | undefined
        sources.push({ assetId: r.assetId, path: row?.l ?? row?.s ?? '', picks })
      }
      if (!sources.length) {
        return { ok: false, reasonKey: 'err.memberMissing', detail: reqs.map((r) => r.members.join(',')).join(' | ') }
      }

      const out = await planMemberImport(db, manager, {
        sources,
        projectId: id,
        extractRoot,
        libraryRoot: s.libraryRoot,
        password: i.password,
        extraBackendDirs: [bundledBinDir()],
        disk: extractDisk,
        maxBatch: batchMax
      })
      if (!out.ok) return planFailure(out)
      await stagePlan(out.plan)
      return toPlanView(out.plan)
    }
  )

  /**
   * 确认之后真正执行。**串行**、每条一份 `import_log`、同一个 `batch_id`。
   *
   * 这里**不看** `targetProjectId` 也不重算计划 —— 计划是 `unity:import-plan` 那次抽好的，
   * 中途换目标工程会让"用户看到的冲突"和"实际覆盖的"不是同一个工程。
   * 工程从 `plan.projectId` 取。
   */
  registrar.ipc.handle(
    'unity:import-commit',
    async (input: unknown): Promise<CommitResult> => {
      const i = (input ?? {}) as { batchId?: string; choice?: ConflictChoice }
      const batchId = String(i.batchId ?? '')
      const stagedPlan = staged.get(batchId)
      if (!stagedPlan) {
        /** 程序重启过、或者这批被新批次挤掉了：副本早没了，只能让界面重新规划一遍 */
        return { ok: false, reasonKey: 'err.planGone', detail: batchId }
      }
      const s = getSettings()
      try {
        return await commitMemberImport(db, manager, stagedPlan.plan, {
          choice: i.choice ?? (s.backupOverwritten ? 'continue-with-backup' : 'continue'),
          backupOverwritten: s.backupOverwritten,
          trashFn: trash,
          shouldStop: () => stagedPlan.controller.signal.aborted,
          /**
           * R4 ①：把这批**逐条**推给界面。
           *
           * `onItem` 这个参数从 M5-B 就在那儿了（注释写着"每包跑完一次（界面刷新进度条）"），
           * 但这里以前没传 —— 于是 §8-4 的「串行执行、**进度可见**」只有前半句成立：
           * 真跑 8 个包要两三分钟，界面上只有一行"正在导入 …"一动不动。
           * `notify()` 那层已经包了 try/catch，进度显示坏了不会把导入链带停。
           */
          onItem: (r, idx) => {
            const ev: ImportItemEvent = {
              batchId: stagedPlan.plan.batchId,
              index: idx,
              relPath: r.relPath,
              ok: r.ok,
              status: r.status,
              reasonKey: r.reasonKey,
              reasonParams: r.error ? { detail: String(r.error).slice(0, 160) } : null,
              created: r.createdGuids.length,
              overwritten: r.overwrittenGuids.length
            }
            registrar.broadcast('unity:import-item', ev)
            // onItem 在成功记录名字后触发；批量导入也要逐项刷新历史页。
            if (r.ok) registrar.broadcast('data:changed', { reason: 'unity-import', projectId: stagedPlan.plan.projectId })
          }
        })
      } finally {
        /** 跑完就把这批从内存里摘掉。剩下的副本（如果有）已在 commit 里按条删过 */
        staged.delete(batchId)
      }
    }
  )

  /** 界面关掉确认框 / 用户反悔：只删 A 自己抽的副本，库里的原件一个字节都不动 */
  registrar.ipc.handle('unity:import-abandon', async (batchId: unknown) => {
    const id = String(batchId ?? '')
    const stagedPlan = staged.get(id)
    if (!stagedPlan) return { released: 0, failed: 0, notStaged: true }
    staged.delete(id)
    return abandonMemberPlan(stagedPlan.plan)
  })

  /** 一批里逐条撤销（倒序，一条失败就停下）。单条撤销仍走 `unity:rollback-import` */
  registrar.ipc.handle('unity:rollback-batch', async (batchId: unknown) => {
    const id = String(batchId ?? '')
    if (!id) return { batchId: id, attempted: 0, rolledBack: 0, stoppedAt: null, details: [], ok: false }
    const r = await rollbackMemberBatch(db, id, (projectPath, importId) =>
      rollbackImport(db, manager, projectPath, importId)
    )
    if (r.rolledBack) registrar.broadcast('data:changed', { reason: 'unity-rollback', projectId: null })
    return r
  })

  /** 单包预扫描（只读）。界面拿到冲突列表后再决定怎么导 */
  registrar.ipc.handle('unity:preflight', async (input: unknown) => {
    const i = (input ?? {}) as { packagePath?: string; projectId?: string }
    const id = String(i.projectId ?? computedTarget() ?? '')
    if (!id) return { ok: false, reasonKey: 'unity.errNoProject', reason: '先选一个导入目标工程' }
    const projectPath = projectPathOf(id)
    const packagePath = String(i.packagePath ?? '')
    if (!packagePath) return { ok: false, reasonKey: 'unity.errPackageMissing', reason: '没给包路径' }
    const pre = await preflight(db, manager, projectPath, packagePath, id)
    return toView(pre, id)
  })

  registrar.ipc.handle('unity:import-package', async (input: unknown) => {
    const i = (input ?? {}) as {
      packagePath?: string
      projectId?: string
      assetId?: string | null
      choice?: ConflictChoice
    }
    const id = String(i.projectId ?? computedTarget() ?? '')
    if (!id) return { ok: false, error: '先选一个导入目标工程' }
    const projectPath = projectPathOf(id)
    const packagePath = String(i.packagePath ?? '')
    if (!packagePath) return { ok: false, error: '没给包路径' }

    /**
     * **重新跑一次预扫描**，不信任界面传来的冲突列表。
     * 用户可能隔了几分钟才点确认，期间工程状态会变（他自己装/删过东西）。
     * 多花一次 `resolve_guids` 换"实际覆盖的和告诉他的是一致的"。
     */
    const pre = await preflight(db, manager, projectPath, packagePath, id)
    if (!pre.ok) return { ok: false, error: pre.reason, reasonKey: pre.reasonKey }

    const s = getSettings()
    const r = await importUnitypackage(db, manager, projectPath, packagePath, id, pre, {
      assetId: i.assetId ?? null,
      choice: i.choice ?? (s.backupOverwritten ? 'continue-with-backup' : 'continue'),
      backupOverwritten: s.backupOverwritten,
      /** 清理旧备份走回收站，不永久删除 */
      trashFn: trash
    })
    if (r.ok) registrar.broadcast('data:changed', { reason: 'unity-import', projectId: id })
    return r
  })

  registrar.ipc.handle('unity:rollback-import', async (logId: unknown) => {
    const importId = String(logId ?? '')
    if (!importId) return { ok: false, error: '没给导入记录 id' }
    const row = db.prepare(`SELECT project_id FROM import_log WHERE id = ?`).get(importId) as
      | { project_id: string }
      | undefined
    if (!row) return { ok: false, error: '找不到这条导入记录' }
    const project = getProject(db, row.project_id)
    if (!project) return { ok: false, error: '这条导入指向的工程已经不在库里了' }
    const r = await rollbackImport(db, manager, project.path, importId)
    if (r.ok) registrar.broadcast('data:changed', { reason: 'unity-rollback', projectId: row.project_id })
    return r
  })

  /**
   * 「导入队列」的取消（§5.2）：**当前那一条让 Unity 做完**，不中途打断 `ImportPackage`
   * （会留下半成品），只保证后面的不再发。
   *
   * M5-B 之后这里是真的取消：`commitMemberImport` 每条**开始前**问一次
   * `shouldStop()`，标志位由这个通道置起来。`cancel-batch` 返回时批次可能还在跑 ——
   * 界面要把"已停在第 N 条"如实显示，不能假装按下去就立刻停了。
   */
  registrar.ipc.handle('unity:cancel-batch', (batchId: unknown) => {
    const id = String(batchId ?? '')
    const stagedPlan = staged.get(id)
    if (!stagedPlan) return { ok: false, reasonKey: 'err.planGone' }
    stagedPlan.controller.abort()
    log.info(`[import] 批次 ${id} 已请求取消：当前这条会跑完，后面的不再发`)
    return { ok: true, willStopAfterCurrent: true }
  })

  /** 抽取目录现在占了多少 + 手动清理（设计 §3.2 第 3 层兜底：删失败的东西等这里捞） */
  registrar.ipc.handle('unity:extract-usage', () => extractRootNow())

  registrar.ipc.handle('unity:extract-clean', async () => {
    const now = extractRootNow()
    if (!now) return { ok: false, reasonKey: 'err.extractNoRoot', removed: 0, kept: 0, bytes: 0 }
    /**
     * 只清**没有被待确认批次占用**的那一支：正在等用户点确认的那批副本还在用，
     * 删了它界面按下"导入"就会拿到一个不存在的路径。
     * 临时副本的目录名就是 `<root>/<卡id>/<seq>`，所以按顶层目录名跳过。
     * R4 ② 之后一批可以来自好几张卡，所以要跳过的是**这一批涉及的所有卡**，
     * 只记第一张会把第二张正在等确认的副本当垃圾清掉。
     */
    const busy = new Set<string>()
    for (const { plan } of staged.values()) for (const a of plan.assetIds) busy.add(a.toLowerCase())
    const r = await pruneExtractRoot(now.root, (name) => busy.has(name.toLowerCase()))
    return { ok: true, ...r, root: now.root }
  })

  // ---------------------------------------------------------------- 工程列表刷新时接上监视

  /** 发现新工程后调用：给它装上 outbox 监视（如果有桥接在跑） */
  function watchAll(): void {
    for (const p of allProjectPaths()) manager.watch(p)
  }
  watchAll()

  return {
    targetProjectId: computedTarget,
    dispose: () => {
      disposed = true
      for (const controller of preparations.values()) controller.abort()
      preparations.clear()
      for (const p of allProjectPaths()) manager.unwatch(p)
      /**
       * 退出前把待确认的批次收干净。
       * 这一条删不掉也不算错（启动 prune 会扫），但"退出即清空"让盘上少一地垃圾，
       * 而且少一批"下次开机看到目录里有个陌生的 .unitypackage"的困惑。
       */
      for (const { plan } of staged.values()) void abandonMemberPlan(plan)
      staged.clear()
    }
  }
}

/** 供 `ipc/assets.ts` 之类的地方判断"运行状态有没有变"（M5-A 只用它同步 is_running） */
export function syncRunningFlag(db: Db, projectId: string, running: boolean): void {
  setProjectRunning(db, projectId, running)
}
