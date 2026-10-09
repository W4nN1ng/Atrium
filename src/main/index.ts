import { app, BrowserWindow, globalShortcut } from 'electron'
import log from 'electron-log'
import path from 'node:path'
import { DEFAULT_HOTKEY, APP_DISPLAY_NAME } from '../shared/constants'
import { createRegistrar } from './ipc/util'
import { registerSystem } from './ipc/system'
import { registerSettings } from './ipc/settings'
import { registerSecrets } from './ipc/secrets'
import { registerAssets } from './ipc/assets'
import { registerStubs } from './ipc/stubs'
import { registerIntegration } from './ipc/integration'
import { startIngest, type IngestApi } from './ingest/api'
import { BridgeManager } from './bridge/manager'
import { registerBridgeIpc, type BridgeIpcApi } from './bridge/ipc'
import { parseIngestArgs } from './ingest/args'
import { startFolderWatcher, type FolderWatcher } from './services/watcher'
import { assetIndex, rebuildIndexChunked, setCategoryConfig } from './search'
import { loadCategories } from './services/categories'
import { startProjectWatcher, type ProjectApi } from './project/api'
import { closeDatabase, getDb, openDatabase } from './db'
import { ensureRuntimeDirs, initAppPaths, P } from './services/paths'
import { installThumbProtocol, registerThumbSchemePrivileges } from './services/thumb-protocol'
import { backfillThumbs } from './library/thumbs'
import { getSettings, onSettingsChanged } from './services/settings'
import { createMainWindow, getMainWindow, markQuitting, showMiniDropAtCursor, wakeForProject } from './window'
import { createTray, destroyTray, refreshTray } from './tray'

const APP_USER_MODEL_ID = 'com.avca.a-manager'

/** 解析 `A.exe --ingest <路径> [<路径>…]`，支持重复出现 --ingest */

function setupLogging(): void {
  log.transports.file.level = 'info'
  log.transports.file.maxSize = 8 * 1024 * 1024
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
  log.transports.console.level = process.env.AVCA_DEBUG ? 'debug' : 'info'
  // electron-log 默认按应用名找目录 → 打包后写去 %APPDATA%\Atrium\logs，
  // 而我们所有数据（含 README 里承诺的日志路径）都在 %APPDATA%\A 下。
  log.transports.file.resolvePathFn = () => path.join(P.logs(), 'main.log')
  log.initialize()
  log.info(`启动 ${APP_DISPLAY_NAME} ` + app.getVersion() + ' / Electron ' + process.versions.electron)
}

function bootstrap(): void {
  // 先定目录再开日志，否则第一行日志会掉进 TEMP 兜底路径
  initAppPaths()
  setupLogging()
  // 自定义协议的特权必须在 ready 之前登记，晚一步 <img> 就当非法 URL
  registerThumbSchemePrivileges()
  void app.setAppUserModelId(APP_USER_MODEL_ID)

  if (!app.requestSingleInstanceLock()) {
    log.info('已有实例在运行，本次退出')
    app.quit()
    return
  }

  ensureRuntimeDirs()

  app.on('second-instance', (_event, argv) => {
    const paths = parseIngestArgs(argv)
    log.info(`second-instance：收到 ${paths.length} 个路径（argv=${JSON.stringify(argv.slice(1))}）`)
    const win = createMainWindow()
    if (win.isMinimized()) win.restore()
    win.focus()
    if (paths.length) void ingestFromPaths(paths)
  })

  const registrar = createRegistrar()
  let ingestApi: IngestApi | null = null
  let projectApi: ProjectApi | null = null
  let folderWatcher: FolderWatcher | null = null
  /**
   * 桥接管理器：**整个进程一个**（不是每个工程一个）——
   * 它内部按 `projectPath` 分开状态（§9-13：不能用全局单例，但"一个管理器管多个工程"
   * 正是为了满足这一条；每个工程有各自的队列与退避）。
   */
  let bridge: BridgeManager | null = null
  let bridgeIpc: BridgeIpcApi | null = null

  const isPrimary = (): boolean => true

  registerSystem(registrar.ipc, () => getMainWindow(), isPrimary)
  registerSettings(registrar)
  registerSecrets(registrar)
  registerAssets(registrar)
  registerStubs(registrar)
  registerIntegration(registrar, () => folderWatcher)

  async function ingestFromPaths(list: string[]): Promise<void> {
    if (!ingestApi) {
      registrar.broadcast('ui:toast', { tone: 'warn', textKey: 'ingest.apiNotReady', text: '摄取引擎还没起来' })
      return
    }
    const r = await ingestApi.enqueue(list)
    log.info(`摄取请求：接受 ${r.accepted.length} / 拒绝 ${r.rejected.length}${r.rejected.length ? ' → ' + r.rejected.map((x) => x.code ?? x.reason).join(', ') : ''}`)
    if (r.rejected.length) {
      for (const bad of r.rejected) {
        // 只给 key + 参数，文案由渲染进程出；text 是兜底原文
        registrar.broadcast('ui:toast', {
          tone: 'bad',
          textKey: bad.code,
          textParams: bad.params,
          text: `${path.basename(bad.path)}：${bad.reason}`
        })
      }
    }
  }

  void app.whenReady().then(() => {
    installThumbProtocol()
    try {
      openDatabase(P.db())
      log.info('数据库就绪 ' + P.db())
    } catch (e) {
      log.error('数据库打开失败：' + (e instanceof Error ? e.message : String(e)))
      throw e
    }

    ingestApi = startIngest(registrar)
    /**
     * M5-A：桥接管理器 + 真实 IPC。
     * 必须在 `startProjectWatcher` 之前起来 —— 工程发现之后要立刻给每个工程挂上 outbox 监视。
     */
    bridge = new BridgeManager()
    bridgeIpc = registerBridgeIpc({ db: getDb(), manager: bridge, registrar })
    /** 结果到达就推给界面（进度、终态都要看得见） */
    bridge.onResult((projectPath, result) => {
      registrar.broadcast('unity:import-progress', {
        projectPath,
        id: result.id,
        status: result.status,
        progress: result.progress ?? null,
        message: result.message ?? null,
        busyReason: result.busyReason ?? null
      })
      void projectPath
    })
    /**
     * Unity 说忙 → 推给界面。
     *
     * ⚠ 这条**必须有**：预扫描要发 `resolve_guids`，而 Play 模式下 Unity 不接命令、
     * 只回 `busy`，A 会按 1s→2s→5s→10s→30s 退避重投到用户退出 Play 为止。
     * 没有这个事件时界面从头到尾只显示"正在导入 …"，用户会以为卡死了，
     * 而 §8-5 的验收口径明确要求显示「Unity 正在运行，已排队」。
     * （2026-10-06 在真机上点了 Play 模式导入才发现。）
     */
    bridge.onBusy((e) => {
      registrar.broadcast('unity:command-busy', {
        projectPath: e.projectPath,
        id: e.id,
        type: e.type,
        label: e.label,
        busyReason: e.busyReason,
        retry: e.retry,
        nextDelayMs: e.nextDelayMs
      })
    })
    /**
     * 收件箱恢复：上次没确认完的卡片重新入队（`jobs` 是内存态，不恢复就凭空消失）。
     * 刻意等 3 秒 + 逐条错开，别和"启动到可用 ≤2 秒"（§7）抢 IO 和 CPU。
     */
    setTimeout(() => {
      void ingestApi
        ?.restoreQueue()
        .then((r) => {
          if (r.recovered > 0) {
            registrar.broadcast('ingest:restored', { recovered: r.recovered, missing: r.missing.length })
          }
        })
        .catch((e: unknown) => log.warn('收件箱恢复失败：' + (e instanceof Error ? e.message : String(e))))
    }, 3000)
    folderWatcher = startFolderWatcher({
      getFolders: () => getSettings().watchedFolders ?? [],
      // 库根 / 暂存 / 缩略图 / 备份都在自己手里，监视它们就是套娃入库
      getExcludes: () => {
        const s = getSettings()
        return [s.libraryRoot, P.staging(), P.thumbs(), P.backups()].filter((x): x is string => !!x)
      },
      onPaths: (paths) => void ingestFromPaths(paths)
    })
    /**
     * M6 ③：工程发现顺带驱动自动切换（"未运行 → 运行中"那条边沿）。
     * 桥接管理器要 lazy 传 —— 它比这个 watcher 早建好，但 `execute` 得按当前实例拿。
     * `wake` 同理不能静态 import `window.ts`（那文件顶层读 `app.isPackaged`，
     * node 测试环境里会炸），见 `ProjectWatcherOptions.wake` 的注释。
     */
    projectApi = startProjectWatcher(registrar, {
      bridgeForFingerprint: () => bridge,
      wake: wakeForProject
    })

    createMainWindow()
    // §7：启动到可用 ≤2 秒，UI 先出、索引进后台。这里刻意不 await，
    // 建索引期间搜索会退回 LIKE，几秒后自动切到内存索引（assets:list 里判断 ready）。
    setImmediate(async () => {
      try {
        const cfg = loadCategories()
        setCategoryConfig(cfg)
        // 分片建：一片之间让出事件循环，界面不会被 5 万素材的索引按死十几秒
        const r = await rebuildIndexChunked(getDb(), cfg, assetIndex, { chunk: 800 })
        log.info(
          `检索索引就绪：${r.docs} 条素材、${r.aliases} 条别名、共 ${r.ms}ms（${r.chunks} 片，第一片 ${r.firstChunkMs}ms 后就能搜）`
        )
        registrar.broadcast('data:changed', {})
      } catch (e) {
        log.error('检索索引构建失败（搜索退回 LIKE）：' + (e instanceof Error ? e.message : String(e)))
      }
      // 封面补一批就走（有预算），剩下的等下次启动 / 维护页手动跑
      try {
        const t = await backfillThumbs(getDb(), 150, { deadlineMs: 1500 })
        if (t.made) {
          log.info(`缩略图补齐：查了 ${t.checked} 条，新出 ${t.made} 张封面`)
          registrar.broadcast('data:changed', {})
        }
      } catch (e) {
        log.warn('缩略图补批失败：' + (e instanceof Error ? e.message : String(e)))
      }
    })
    createTray({
      showMain: () => void createMainWindow(),
      showMiniDrop: () => showMiniDropAtCursor(),
      quit: () => {
        markQuitting()
        app.quit()
      }
    })

    const s = getSettings()
    const hotkey = s.globalHotkey || DEFAULT_HOTKEY
    const ok = globalShortcut.register(hotkey, () => showMiniDropAtCursor())
    if (!ok) log.warn('全局热键 ' + hotkey + ' 注册失败（可能被别的程序占用）')

    onSettingsChanged((next) => {
      refreshTray()
      folderWatcher?.sync()
      if (next.globalHotkey !== hotkey) {
        globalShortcut.unregisterAll()
        if (!globalShortcut.register(next.globalHotkey, () => showMiniDropAtCursor())) {
          log.warn('新热键 ' + next.globalHotkey + ' 注册失败')
        }
      }
    })

    // 命令行摄取：资源管理器右键"发送到 A"走的就是这条路
    const cli = parseIngestArgs(process.argv)
    if (cli.length) void ingestFromPaths(cli)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    // 关掉所有窗口不退出：托盘常驻才能感知 Unity 启动（第 3 份 §4.3）
    if (!getSettings().minimizeToTray) {
      markQuitting()
      app.quit()
    }
  })

  app.on('before-quit', () => {
    markQuitting()
    globalShortcut.unregisterAll()
    ingestApi?.dispose()
    /**
     * 工程发现的轮询定时器必须先停：它每 3 秒跑一轮探测并**写库**（`is_running` /
     * `bridge_version` / M6 的指纹与冷却时间戳），而下面两行就要关库了。
     * 顺序错了的症状是退出时偶发 "The database connection was not open"。
     */
    projectApi?.dispose()
    destroyTray()
    closeDatabase()
    log.info('已退出')
  })
}

bootstrap()
