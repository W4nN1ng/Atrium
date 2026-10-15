import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import log from 'electron-log'
import type { BridgeFirstSeenEvent, ProjectInfo } from '../../shared/types'
import { PROJECT_POLL_MS } from '../../shared/constants'
import type { MatchableCollection, ProjectFingerprint } from '../../shared/projectMatch'
import { getDb, isDbOpen } from '../db'
import { listCollections, parseRule } from '../db/repos/meta'
import { getBridgeAsk } from '../db/repos/bridgeAsk'
import { bridgeAskDecision } from '../../shared/bridgeAsk'
import { listProjects, autoSwitchAtOf, getProjectByPath, markAutoSwitched, toProjectInfo, upsertProject } from '../db/repos/unity'
import { isBridgeInstalled } from '../bridge/mailbox'
import { pushBridgeAsk } from '../bridge/askQueue'
import { getSettings } from '../services/settings'
import type { IpcRegistrar } from '../ipc/types'
import { createAutoSwitcher } from './autoSwitch'
import { bridgeWorthAsking, collectFingerprint, saveFingerprint, storedFingerprint, type FingerprintBridge } from './fingerprint'
import { applyDetection, detectRunning } from './running'
import type { WmiProbeResult } from './wmi'

const SKIP_DIR_NAMES = /^(library|temp|obj|logs|usersettings\.dat|\.git|\.vs|\.idea)$/i
const SKIP_PREFIX = /^(_backup|backup|~\$)/i

/** Owned preview workers never become user projects, even when a VCC entry or scan root includes them. */
export function isInternalPreviewProject(dir: string): boolean {
  try {
    const file = path.join(dir, '.atrium-cover-preview.json')
    if (fs.statSync(file).size > 4096) return false
    return JSON.parse(fs.readFileSync(file, 'utf8')).kind === 'atrium-package-preview'
  } catch { return false }
}

export function vccSettingsPath(): string {
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
  return path.join(local, 'VRChatCreatorCompanion', 'settings.json')
}

export interface VccManifest {
  projects: string[]
  defaultRoot: string | null
  error: string | null
}

/** 第 3 份 §4.1 路径 1：ALCOM / VCC 的工程清单，最可靠、零成本 */
export function readVccManifest(file = vccSettingsPath()): VccManifest {
  try {
    if (!fs.existsSync(file)) {
      return { projects: [], defaultRoot: null, error: '没有 VCC/ALCOM 配置文件：' + file }
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    const list = Array.isArray(raw.userProjects) ? raw.userProjects : []
    const projects = list
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .map((p) => path.win32.normalize(p))
      .filter((p) => !isInternalPreviewProject(p))
    const def = typeof raw.defaultProjectPath === 'string' ? path.win32.normalize(raw.defaultProjectPath) : null
    return { projects, defaultRoot: def, error: null }
  } catch (e) {
    return { projects: [], defaultRoot: null, error: e instanceof Error ? e.message : String(e) }
  }
}

export function isUnityProject(dir: string): boolean {
  try {
    return !isInternalPreviewProject(dir) && fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'))
  } catch {
    return false
  }
}

export function readUnityVersion(dir: string): string | null {
  try {
    const txt = fs.readFileSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8')
    const m = /m_EditorVersion:\s*([0-9a-zA-Z.]+)/.exec(txt)
    return m ? m[1] : null
  } catch {
    return null
  }
}

/** 第 3 份 §4.1 路径 2：扫工程根目录，深度 ≤3，跳过备份/缓存/压缩包 */
export function scanProjectRoots(roots: string[], maxDepth = 3): string[] {
  const found = new Set<string>()
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue
      if (SKIP_DIR_NAMES.test(e.name) || SKIP_PREFIX.test(e.name)) continue
      const full = path.join(dir, e.name)
      if (isInternalPreviewProject(full)) continue
      if (isUnityProject(full)) found.add(path.win32.normalize(full))
      else walk(full, depth + 1)
    }
  }
  for (const r of roots) {
    try {
      if (isInternalPreviewProject(r)) continue
      if (!fs.statSync(r).isDirectory()) continue
      if (isUnityProject(r)) found.add(path.win32.normalize(r))
      else walk(r, 1)
    } catch {
      /* 盘没插就不扫 */
    }
  }
  return Array.from(found)
}

export interface ProjectWatcherOptions {
  /**
   * 轮询间隔。传 `0` **关掉定时器** —— 只给测试用。
   *
   * 为什么需要这个开关：定时器会在测试执行到一半时插进来跑一轮探测，
   * 把"状态变化 → 广播"的时序搅乱（而且多实例会共享 `previous` 这个模块级状态）。
   * 测试里关掉它、改为**显式**调 `refresh()` 驱动，时序才是确定的。
   */
  pollMs?: number
  /**
   * M6 ③ · 采指纹时要不要问桥接。给一个取当前 `BridgeManager` 的函数
   * （它比工程发现晚一点建好，所以必须是 lazy 的，不能启动时抓引用）。
   * 不给就只用磁盘那半边 —— 指纹照样有，只是 `avatarDescriptors` 永远空。
   */
  bridgeForFingerprint?: () => FingerprintBridge | null
  /**
   * M6 ⑥ · 从托盘里叫醒主窗口。
   *
   * ⚠ **必须注入，不许在这里直接 import `../window`**：`window.ts` 在模块顶层读
   * `app.isPackaged`，而 node 测试环境里 electron 的 `app` 是 undefined ——
   * 一旦静态引它，`tests/project/running-wiring.spec.ts` 整个文件加载就炸
   * （实测就是这么红的）。和 `bridgeForFingerprint` 同一个理由：这层只依赖接口。
   */
  wake?: () => Promise<unknown>
}

export interface ProjectApi {
  refresh(): Promise<ProjectInfo[]>
  /**
   * 跑一轮探测但**不重新扫盘**（不读 ALCOM 清单、不扫工程根）。
   * 给测试用来"显式推进一步"；生产走定时器。
   */
  detect(): Promise<ProjectInfo[]>
  dispose(): void
}

/**
 * 工程发现 + **运行状态探测**。
 *
 * 发现这一层只负责回答"有哪些工程"（ALCOM 清单 + 扫盘）。
 * "哪个工程现在开着 Unity"由 `project/running.ts` 的三路取并集回答 ——
 * 这里**必须把那个模块接进来**。
 *
 * ⚠ 曾经的坑（2026-10-06 实测抓到）：`running.ts` 写好了，
 * 但**没有任何地方 import 它**，于是 `refresh()` 直接
 * `return listProjects(db).map(toProjectInfo)`，运行状态永远来自
 * `project.is_running` 这个陈旧列 —— 用户明明开着 `shinano-Main2`，
 * 界面上却是"未运行"，而工程页上还写着"三路取并集判定"。
 * 那次是在真 Unity 上验的时候才发现的（单测全绿，因为单测直接调 `detectRunning`，
 * 没人验"它有没有被接上"）。所以下面这个函数的存在本身就是那条教训的产物。
 */
export function startProjectWatcher(
  registrar: IpcRegistrar,
  opts: ProjectWatcherOptions = {}
): ProjectApi {
  const db = getDb()
  /** 上一次的运行状态，用来只在**真的变了**时写库 + 广播 */
  let previous = new Map<string, boolean>()
  let lastWmi: { at: number; result: WmiProbeResult } | null = null
  let timer: NodeJS.Timeout | null = null

  /**
   * M6 ③ · 自动切换集合。
   *
   * 依赖全部在这里现取（`db` / 设置 / 集合表），**不在启动时快照**：
   * 用户改了 `autoSwitchBehavior` 或新建了集合，下一次边沿就该按新值走 ——
   * 这个设置从 M1 起就是"有默认值、有类型、没人读"的死设置，别再把它读一次存住。
   */
  const autoSwitch = createAutoSwitcher({
    behavior: () => getSettings().autoSwitchBehavior,
    lastAutoSwitchAt: (id) => autoSwitchAtOf(db, id),
    markSwitched: (id, at) => markAutoSwitched(db, id, at),
    fingerprint: async (_id, projectPath) => {
      const bridge = opts.bridgeForFingerprint?.() ?? null
      /** 桥接没装着 / 心跳停了就别去问 —— 白等 5 秒，而且磁盘那半边已经够用 */
      const ask = bridge && bridgeWorthAsking(projectPath) ? bridge : null
      const r = await collectFingerprint(projectPath, ask)
      saveFingerprint(db, projectPath, r.fp)
      if (r.notes.length) {
        log.info(`[fingerprint] ${path.basename(projectPath)}：取自 ${r.sources.join('/')} · ${r.notes.join('/')}`)
      }
      return r.fp
    },
    collections: (): MatchableCollection[] =>
      listCollections(db)
        .map((row) => ({ row, rule: parseRule(row) }))
        .filter((x) => !!x.rule)
        .map((x) => ({ id: x.row.id, name: x.row.name, rule: x.rule as MatchableCollection['rule'], priority: x.row.priority })),
    knownProjects: (): ProjectFingerprint[] =>
      listProjects(db).filter(row => !isInternalPreviewProject(row.path))
        .map((row) => storedFingerprint(db, row.path) ?? { dirName: row.name, topFolders: [], installedPackages: [], avatarDescriptors: [] }),
    notify: (event) => {
      registrar.broadcast('unity:auto-switch', event)
      /**
       * M6 ⑥：只有"要切/要弹"这两种才去碰窗口焦点。
       * `skip`（含 busy）一律不抢焦点 —— 用户正在别的窗口里干活，
       * 凭一条"检测到 Unity 启动"去把 A 提到最前面是骚扰，也是 R-51 要避免的那件事。
       */
      if (event.action === 'switch' || event.action === 'wake-only') void opts.wake?.()
    }
  })

  function candidateRoots(): string[] {
    const s = getSettings()
    const manifest = readVccManifest()
    const roots = new Set<string>(s.projectRoots ?? [])
    if (manifest.defaultRoot) roots.add(manifest.defaultRoot)
    for (const p of manifest.projects) roots.add(path.dirname(p))
    return Array.from(roots)
  }

  /**
   * R4 ⑦ · 把"这个工程要不要装桥接"的结论发给界面。
   *
   * 两个时机，都是**边沿**不是状态（三路探测每 3 秒一轮，拿"没装桥接"当条件会问到用户关软件）：
   *  - `firstSighting`：这一轮真的插了一条新行（第一次发现这个工程）→ 可以问，也可以直接装；
   *  - `running`：这一轮发现它从"没开"变成"开着"→ **只自动装，不问**。
   *    加第二个时机是因为「以后都自动安装」如果只挂在第一次发现上，用户答完那句话
   *    边沿就再也亮不起来了，那个答案永远不会被执行。
   *
   * 判据本身在 `shared/bridgeAsk.ts`（纯函数、有逐条用例）。这里只负责把边沿和三项事实
   * 交给界面，动作（弹窗、调 `installBridge`）由渲染层做，免得工程发现这条链去依赖安装器。
   */
  function maybeAskAboutBridge(
    row: { id: string; path: string; name: string },
    edge: { firstSighting: boolean; running: boolean; detected?: 'vcc' | 'scan' }
  ): void {
    const decision = bridgeAskDecision({
      installed: isBridgeInstalled(row.path),
      answer: getBridgeAsk(db, row.id),
      autoInstallSetting: !!getSettings().bridgeAutoInstall,
      firstSighting: edge.firstSighting,
      running: edge.running
    })
    if (decision === 'quiet') {
      if (edge.firstSighting) log.info(`[bridge-ask] 第一次发现「${row.name}」（来源 ${edge.detected}）→ quiet`)
      return
    }
    log.info(
      `[bridge-ask] ${edge.firstSighting ? `第一次发现「${row.name}」（来源 ${edge.detected}）` : `「${row.name}」开始运行`} → ${decision}`
    )
    const event: BridgeFirstSeenEvent = {
      projectId: row.id,
      projectPath: row.path,
      name: row.name,
      decision,
      ...(edge.detected ? { detected: edge.detected } : {})
    }
    /**
     * 两条路都走：**攒进队列** + **当场广播**。
     * 只广播会在"主进程第一轮工程发现早于窗口就绪"时把事件丢掉（那条链是同步的），
     * 只攒队列则界面早就开着的人会等下一次重载才看到。见 `main/bridge/askQueue.ts`。
     */
    pushBridgeAsk(event)
    registrar.broadcast('project:first-seen', event)
  }

  function register(pathList: string[], detected: 'vcc' | 'scan'): void {
    for (const p of pathList) {
      if (isInternalPreviewProject(p)) continue
      const name = path.basename(p)
      const unityVersion = readUnityVersion(p)
      const existing = getProjectByPath(db, p)
      /**
       * ⚠ `isRunning` 传 undefined 而不是 `false`：
       * `upsertProject` 对 undefined 会**保留库里已有的值**，传 false 则会把
       * 探测刚写进去的"已打开"抹掉。曾经的写法就是硬写 `isRunning: false`，
       * 每轮 refresh 都把运行状态清一次。
       */
      const row = upsertProject(db, {
        path: p,
        name,
        unityVersion,
        bridgeVersion: existing?.bridge_version ?? null
      })
      /**
       * R4 ⑦ · **"第一次发现这个工程"是边沿，不是状态** —— 只有 `!existing`
       * （这一轮真的插了一条新行）才算。口径见 `maybeAskAboutBridge` 上那段注释。
       */
      if (!existing) maybeAskAboutBridge({ id: row.id, path: p, name }, { firstSighting: true, running: false, detected })
    }
  }

  /**
   * 跑一轮三路探测并把结论落库。
   *
   * 两条纪律：
   *  - 只有状态**真的变了**才写库（`applyDetection` 内部保证）——
   *    这个函数每 3 秒被调一次，无条件 UPDATE 会把 SQLite 写爆，
   *    而且 `last_seen` 会退化成"最后一次轮询时间"
   *  - 变化时广播 `project:running-changed`，否则界面会一直显示旧状态
   *
   * `detectRunning` 是 async 的唯一原因是 WMI 要起子进程；它内部按
   * `wmiIntervalMs`（5 秒）节流，没到点就复用上次结论，所以**多数轮次是立即 resolve**。
   * 这里不做同步化的"聪明"改写 —— 第一版我为了同步把三步逻辑抄了一遍，
   * 那样等于把 `running.ts` 维护两份，迟早分叉。宁可让 handler 是 async。
   */
  async function runDetection(): Promise<ProjectInfo[]> {
    const { evidence, wmi } = await detectRunning({ lastWmi })
    lastWmi = { at: Date.now(), result: wmi }
    const { changed, list } = applyDetection(evidence, previous)
    previous = new Map(evidence.map((e) => [e.projectId, e.running]))
    if (changed.length) {
      registrar.broadcast('project:running-changed', { changed })
      /**
       * M6 ③：只有**"未运行 → 运行中"这条边沿**才触发自动切换（§4.3 触发时机）。
       * 关掉的（`running:false`）一律不管；每 3 秒的轮询里同一个工程只会命中一次，
       * 因为 `changed` 本身就是"和上一轮不一样"的那批。
       *
       * `onProjectStarted` 内部不抛错（决策失败只记日志），这里再加一层 `catch`
       * 是防它哪天被人改成会抛 —— 这条链上挂着工程发现，不能被自动切换带停。
       */
      for (const c of changed) {
        if (!c.running) continue
        if (isInternalPreviewProject(c.path)) continue
        const row = getProjectByPath(db, c.path)
        if (row) {
          void autoSwitch
            .onProjectStarted({ id: row.id, path: row.path, name: row.name })
            .catch((e: unknown) => log.warn(`[auto-switch] 触发失败：${String((e as Error)?.message ?? e)}`))
          /**
           * R4 ⑦ 的第二个时机：这一轮它**开始运行**了。
           * 只有答过"以后都自动安装"或全局开关开着才会出声（`bridgeAskDecision`
           * 在这种情况下不会返回 `ask`），所以这里不用重复判断该不该弹窗。
           */
          maybeAskAboutBridge({ id: row.id, path: row.path, name: row.name }, { firstSighting: false, running: true })
        }
      }
    }
    return list.filter(project => !isInternalPreviewProject(project.path))
  }

  async function refresh(): Promise<ProjectInfo[]> {
    const manifest = readVccManifest()
    if (manifest.error) log.warn('读 ALCOM/VCC 清单失败：' + manifest.error)
    register(manifest.projects, 'vcc')
    register(scanProjectRoots(candidateRoots()), 'scan')
    return runDetection()
  }

  /**
   * 界面拉列表时**也要跑探测**，不能只读库。
   *
   * 理由：`unity:list-projects` 是顶栏切换器与工程页刷新时最常走的那条路。
   * 如果它只 `map(toProjectInfo)`，那用户按"刷新"之后看到的仍是上一次轮询的结论 ——
   * 观感上就是"点了刷新还是未运行"。
   */
  registrar.ipc.handle('unity:list-projects', (): Promise<ProjectInfo[]> => runDetection())
  registrar.ipc.handle('unity:refresh-projects', (): Promise<ProjectInfo[]> => refresh())

  void refresh()
    .then((list) => {
      const running = list.filter((p) => p.running)
      log.info(
        `工程发现：登记 ${list.length} 个；运行中 ${running.length} 个` +
          (running.length ? `（${running.map((p) => `${p.name}:${p.detectedBy.join('+')}`).join('、')}）` : '')
      )
    })
    .catch((e: unknown) => log.error('工程发现失败：' + (e instanceof Error ? e.message : String(e))))

  /**
   * 轮询：桥接心跳本身是事件驱动，但**没装桥接时**只能靠锁文件，
   * 所以必须有个轻量定时器兜住"Unity 被关掉了"这件事（§8-2：10 秒内标记退出）。
   * `pollMs: 0` 时不起（测试用）。
   */
  const pollMs = opts.pollMs ?? PROJECT_POLL_MS
  if (pollMs > 0) {
    timer = setInterval(() => {
      /** 库还没开（启动最初几毫秒）时安静跳过，不刷错误日志 */
      if (!isDbOpen()) return
      void runDetection().catch((e: unknown) =>
        log.warn('工程状态轮询失败：' + (e instanceof Error ? e.message : String(e)))
      )
    }, pollMs)
    /** 不要让这个定时器吊住进程退出 */
    timer.unref?.()
  }

  return {
    refresh,
    detect: runDetection,
    dispose: () => {
      if (timer) clearInterval(timer)
      timer = null
    }
  }
}
