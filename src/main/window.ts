import { app, BrowserWindow, screen, shell } from 'electron'
import log from 'electron-log'
import fs from 'node:fs'
import path from 'node:path'
import { MINI_DROP_SIZE, MINIMUM_WINDOW, APP_DISPLAY_NAME, WAKE_TOPMOST_MS } from '../shared/constants'
import { getSettings } from './services/settings'

const isDev = !app.isPackaged

let main: BrowserWindow | null = null
let mini: BrowserWindow | null = null
let quitting = false

export function isQuitting(): boolean {
  return quitting
}
export function markQuitting(): void {
  quitting = true
}

export function getMainWindow(): BrowserWindow | null {
  return main && !main.isDestroyed() ? main : null
}

export function getMiniWindow(): BrowserWindow | null {
  return mini && !mini.isDestroyed() ? mini : null
}

/**
 * M6 ⑥ · 从托盘里把主窗口叫醒（第 3 份 §4.3 步骤 3「弹出主窗口并置顶」）。
 *
 * 三条实测/裁定留下的规矩：
 *  1. **置顶必须自己取消**。`setAlwaysOnTop(true)` 忘了关，A 就永远压在 Unity 上面，
 *     用户连点到自己工程都费劲 —— 所以取消放在 `finally`，中途抛错也要关。
 *  2. 时长 `WAKE_TOPMOST_MS`（1.2 秒）是裁定值（Q6），规格原文只说"短暂闪烁"。
 *     ⚠ 这条只能算"写完了"：**Windows 焦点保护下 `focus()` 抢不抢得到前台未验证**
 *     （M5-B 那轮实测 `SetForegroundWindow` 从外部调是失败的，只有进程自己这套才作数）。
 *  3. 窗口本来就开着的时候**不闪置顶** —— 用户正在用别的东西，凭一条"检测到 Unity"
 *     去抢焦点是骚扰。这种情况只返回 `already-visible`，横幅照画。
 */
export async function wakeForProject(): Promise<'woken' | 'already-visible' | 'no-window'> {
  /**
   * ⚠ 顺序不能反：**先问"窗口是不是藏着的"，再去拿窗口**。
   * `createMainWindow()` 在窗口已存在时会顺手 `show() + focus()`（那是"第二次实例启动"那条路要的语义），
   * 所以先调它、再读 `isVisible()`，得到的永远是"本来就开着" —— `wasHidden` 恒为 false，
   * 下面那段置顶与那句日志**一次都没执行过**。
   * 第 5 轮活体量出来的就是这个：托盘里点 X 之后开工程，窗口确实弹出来了（那是上面那个副作用的巧合），
   * 但 `WS_EX_TOPMOST` 全程为 false、日志里也没有"已从托盘唤醒主窗口"。
   * 回归保护见 `tests/project/wake-order.spec.ts`（静态查顺序 —— 这条没有 Electron 环境可跑）。
   */
  const existing = getMainWindow()
  const wasHidden = !existing || existing.isDestroyed() || !existing.isVisible() || existing.isMinimized()
  const win = createMainWindow()
  if (!win || win.isDestroyed()) return 'no-window'
  if (!wasHidden) return 'already-visible'

  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.setAlwaysOnTop(true)
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, WAKE_TOPMOST_MS))
  } finally {
    try {
      if (!win.isDestroyed()) win.setAlwaysOnTop(false)
    } catch (e) {
      /** 关不掉置顶只可能是窗口正好被销毁了；真留着的话下次启动会照旧 */
      log.warn(`[window] 取消置顶失败：${String((e as Error)?.message ?? e)}`)
    }
  }
  log.info('[window] 检测到 Unity 工程启动，已从托盘唤醒主窗口')
  return 'woken'
}

function preloadPath(): string {
  return path.join(__dirname, '../preload/index.js')
}

export function iconPath(): string | undefined {
  const candidates = isDev
    ? [path.resolve(app.getAppPath(), 'build', 'icon.png'), path.resolve(app.getAppPath(), 'build', 'icon.ico')]
    : [path.join(process.resourcesPath, 'icon.png')]
  for (const c of candidates) if (fs.existsSync(c)) return c
  return undefined
}

function loadRoute(win: BrowserWindow, query: Record<string, string>): void {
  // AVCA_NAV=settings 之类只用于开发期逐屏截图核对，打包后不存在这个环境变量
  const startNav = process.env.AVCA_NAV
  if (startNav && query.view === 'main') query.nav = startNav
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    const qs = new URLSearchParams(query).toString()
    void win.loadURL(qs ? `${devUrl}/?${qs}` : devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  }
}

/** 渲染进程不许跳外链，也不许开新窗口（第 1 份 §7 安全） */
function harden(win: BrowserWindow): void {
  // 把渲染进程的 console 转到 electron-log，黑屏时能看到真因
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const text = `[renderer] ${message} (${sourceId}:${line})`
    if (level >= 3) log.error(text)
    else if (level === 2) log.warn(text)
    else log.info(text)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log.error(`[renderer] did-fail-load ${code} ${desc} ${url}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('[renderer] 进程消失：' + JSON.stringify(details))
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const allowed = (isDev && devUrl && url.startsWith(devUrl)) || url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })
  // 拖放外部文件时，Chromium 默认会导航到 file://，这里兜住
  win.webContents.on('will-frame-navigate', (event) => {
    if (event.url.startsWith('file://') && !isDev) event.preventDefault()
  })
}

export function createMainWindow(): BrowserWindow {
  const existing = getMainWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }
  const s = getSettings()
  const win = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: MINIMUM_WINDOW.width,
    minHeight: MINIMUM_WINDOW.height,
    show: false,
    title: APP_DISPLAY_NAME,
    backgroundColor: s.theme === 'dark' ? '#101014' : '#f4f4f6',
    icon: iconPath(),
    // 无边框 + 原生最小/最大/关闭按钮叠在右上角，顶栏留给我们自己的搜索框与工程指示器
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: s.theme === 'dark' ? '#101014' : '#f4f4f6',
      symbolColor: s.theme === 'dark' ? '#e8e8ee' : '#20202a',
      height: 38
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })
  main = win
  harden(win)
  loadRoute(win, { view: 'main' })

  win.once('ready-to-show', () => {
    log.info('ready-to-show 触发')
    win.show()
  })
  win.webContents.once('did-finish-load', () => {
    log.info('did-finish-load 触发')
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) {
        log.warn('窗口仍不可见，兜底 show()')
        win.show()
      }
    }, 1200)
  })
  setTimeout(() => {
    if (!win.isDestroyed()) {
      log.info(`4 秒后窗口状态：visible=${win.isVisible()} minimized=${win.isMinimized()}`)
    }
  }, 4000)
  win.on('close', (event) => {
    const cur = getSettings()
    if (!quitting && cur.minimizeToTray) {
      event.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    if (main === win) main = null
  })
  return win
}

/** 全局热键唤起的迷你投放窗（第 1 份 F1 入口 2：约 360×160，半透明置顶） */
export function showMiniDropAtCursor(): BrowserWindow {
  const existing = getMiniWindow()
  if (existing) {
    const p = screen.getCursorScreenPoint()
    existing.setPosition(clampX(p.x), clampY(p.y))
    existing.show()
    existing.focus()
    return existing
  }
  const p = screen.getCursorScreenPoint()
  const win = new BrowserWindow({
    width: MINI_DROP_SIZE.width,
    height: MINI_DROP_SIZE.height,
    x: clampX(p.x),
    y: clampY(p.y),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    opacity: 0.95,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mini = win
  harden(win)
  loadRoute(win, { view: 'mini' })
  win.on('blur', () => {
    if (mini === win) setTimeout(() => !win.isDestroyed() && win.hide(), 200)
  })
  win.on('closed', () => {
    if (mini === win) mini = null
  })
  win.once('ready-to-show', () => win.show())
  return win
}

export function hideMiniDrop(): void {
  getMiniWindow()?.hide()
}

function clampX(x: number): number {
  const b = screen.getPrimaryDisplay().bounds
  return Math.max(b.x, Math.min(x, b.x + b.width - MINI_DROP_SIZE.width - 8))
}

function clampY(y: number): number {
  const b = screen.getPrimaryDisplay().bounds
  return Math.max(b.y, Math.min(y, b.y + b.height - MINI_DROP_SIZE.height - 8))
}
