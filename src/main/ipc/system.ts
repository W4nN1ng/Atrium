import { app, BrowserWindow, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppInfo, PathInfo } from '../../shared/api'
import type { DirectoryProbe } from '../../shared/wizardState'
import { getSettings } from '../services/settings'
import { P, resourceRoot } from '../services/paths'
import { isForbiddenTarget } from '../security/paths'
import { libraryRootProblem } from '../security/libraryRoot'
import { freeBytesOf } from '../import/extractRoot'
import { isSupportedInputName } from '../unpack/magic'
import type { IpcRegistrar } from './types'
import { getDb } from '../db'
import { createDatabaseBackup } from '../db/backup'

/** 探测的三道上限（M7 ③）：判定只需要"有没有"，不需要走完整棵树 */
const PROBE_DEPTH = 3
const PROBE_VISIT_CAP = 8000
const PROBE_FILE_CAP = 500

function abs(input: unknown, what = '路径'): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error(`${what}无效`)
  const p = path.win32.normalize(input.trim())
  if (!path.isAbsolute(p)) throw new Error(`${what}必须是绝对路径：${input}`)
  return p
}

export function registerSystem(ipc: IpcRegistrar['ipc'], getWindow: () => BrowserWindow | null, isPrimary: () => boolean): void {
  let backupBusy = false
  ipc.handle('system:backup-database', async (title: unknown) => {
    if (backupBusy) throw new Error('i18n:settings.backupBusy')
    backupBusy = true
    try {
      const now = new Date()
      const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
        .map(n => String(n).padStart(2, '0')).join('-')
      const options: Electron.SaveDialogOptions = {
        title: typeof title === 'string' ? title.slice(0, 200) : 'Atrium — Database backup',
        defaultPath: path.join(app.getPath('documents'), `Atrium-database-${stamp}.db`),
        filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      }
      const win = getWindow()
      const chosen = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (chosen.canceled || !chosen.filePath) return { cancelled: true, path: null, bytes: 0 }
      const result = await createDatabaseBackup(getDb(), P.db(), chosen.filePath)
      return { cancelled: false, ...result }
    } finally { backupBusy = false }
  })
  /**
   * 截图专用：把主窗口"顶到最前"。
   *
   * 为什么需要：Chromium 在窗口被挡住/不在前台时会**跳过绘制**，
   * `Page.captureScreenshot` 就永远等不到下一帧（实测直接超时），
   * PowerShell 那套 PrintWindow 又拿回上一帧旧画面。
   * 而 `SetForegroundWindow` 从外部调被系统的焦点保护挡掉（foreground=False），
   * 只有进程自己能 `win.setAlwaysOnTop(true) + show() + focus()`。
   *
   * 只在带着 `--remote-debugging-port` 起来的时候注册 —— 正常使用时这个通道根本不存在，
   * 不给产品面添一个"能让窗口盖住别的窗口"的后门。
   */
  if (app.commandLine.hasSwitch('remote-debugging-port')) {
    ipc.handle('system:nudge-front', (on: unknown) => {
      const win = getWindow()
      if (!win) return false
      const want = on !== false
      if (want) {
        win.setAlwaysOnTop(true)
        win.show()
        win.focus()
      } else {
        win.setAlwaysOnTop(false)
      }
      return true
    })
  }

  ipc.handle('system:info', (): AppInfo => {
    const s = getSettings()
    return {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      node: process.versions.node ?? '',
      chrome: process.versions.chrome ?? '',
      platform: process.platform,
      locale: s.language,
      isPrimary: isPrimary()
    }
  })

  ipc.handle('system:paths', (): PathInfo => {
    const s = getSettings()
    let accessible = false
    let problem: string | null = null
    if (s.libraryRoot) {
      try {
        fs.accessSync(s.libraryRoot, fs.constants.R_OK | fs.constants.W_OK)
        accessible = true
      } catch (e) {
        problem = e instanceof Error ? e.message : String(e)
      }
    }
    return {
      libraryRoot: s.libraryRoot,
      appData: P.root(),
      dbPath: P.db(),
      staging: P.staging(),
      thumbs: P.thumbs(),
      backups: P.importBackups(),
      logs: P.logs(),
      resourceRoot: resourceRoot(),
      libraryAccessible: accessible,
      libraryProblem: problem
    }
  })

  /**
   * M7 ③ · 首启向导第 ① 步的**只读**探测：这个目录像不像已经有素材了（Q3 那条二选一的前提）。
   *
   * ## 三条硬要求
   *
   *  1. **只读。** 不建目录、不写文件、不动任何时间戳 —— 这一步的输入可能是用户 24 GB 的真库，
   *     探测把它弄脏了就是事故。判定本身在 `shared/wizardState.ts` 的纯函数里，这里只填事实。
   *  2. **有封顶。** 递归到底会把 2289 个文件的库走一遍，而判定只需要"有没有 ≥1 个"。
   *     所以：深度 ≤ 3、访问条目 ≤ 8000、数到 500 个就停（`capped` 带回去，界面写"500+"，
   *     不许把封顶值当精确值报给用户）。
   *  3. **数不到要说"数不到"。** 中途有目录读不动（权限、坏链接）就把 `supportedFileCount` 置 -1，
   *     判定那边一律当"像有素材"处理（`adoptOrFresh` 的宁松不紧）——
   *     误判成"空的"的代价是把一个有货的库当空库用，比多问一句严重得多。
   */
  ipc.handle('system:probe-directory', (input: unknown): DirectoryProbe => {
    const target = abs(input, '库位置')
    const probe: DirectoryProbe = {
      path: target,
      exists: false,
      dirCount: 0,
      supportedFileCount: 0,
      drive: /^([a-z]):/i.test(target) ? target[0].toLowerCase() : '',
      freeBytes: -1,
      capped: false,
      skipped: 0
    }
    probe.problemKey = libraryRootProblem(target)
    if (probe.problemKey) return probe
    try {
      if (!fs.statSync(target).isDirectory()) return probe
      probe.exists = true
    } catch {
      return probe
    }
    probe.freeBytes = freeBytesOf(target)

    const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git'])
    const stack: Array<{ dir: string; depth: number }> = [{ dir: target, depth: 0 }]
    let visited = 0
    let unknown = false
    while (stack.length) {
      const cur = stack.pop() as { dir: string; depth: number }
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(cur.dir, { withFileTypes: true })
      } catch {
        unknown = true
        probe.skipped++
        continue
      }
      for (const e of entries) {
        if (++visited > PROBE_VISIT_CAP) {
          probe.capped = true
          break
        }
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
        if (e.isDirectory()) {
          if (cur.depth === 0) probe.dirCount++
          if (cur.depth < PROBE_DEPTH) stack.push({ dir: path.join(cur.dir, e.name), depth: cur.depth + 1 })
          continue
        }
        if (!isSupportedInputName(e.name)) continue
        probe.supportedFileCount++
        if (probe.supportedFileCount >= PROBE_FILE_CAP) {
          probe.capped = true
          break
        }
      }
      if (probe.capped) break
    }
    if (unknown && probe.supportedFileCount === 0) probe.supportedFileCount = -1
    return probe
  })

  ipc.handle('system:pick-directory', (opts?: { title?: string; defaultPath?: string }) => {    const win = getWindow()
    const options = {
      title: opts?.title ?? '选择目录',
      defaultPath: opts?.defaultPath,
      properties: ['openDirectory', 'createDirectory'] as Electron.OpenDialogOptions['properties']
    }
    const r = win ? dialog.showOpenDialogSync(win, options) : dialog.showOpenDialogSync(options)
    return r?.[0] ?? null
  })

  ipc.handle('system:pick-files', (opts?: { title?: string; filters?: Electron.FileFilter[]; multiple?: boolean }) => {
    const win = getWindow()
    const options = {
      title: opts?.title ?? '选择文件',
      buttonLabel: '加入摄取队列',
      properties: (opts?.multiple === false ? ['openFile'] : ['openFile', 'multiSelections']) as Electron.OpenDialogOptions['properties'],
      filters: opts?.filters
    }
    const r = win ? dialog.showOpenDialogSync(win, options) : dialog.showOpenDialogSync(options)
    return r ?? []
  })

  ipc.handle('system:reveal', (input: unknown) => {
    const p = abs(input)
    if (isForbiddenTarget(p)) throw new Error('不允许打开该位置')
    if (!fs.existsSync(p)) throw new Error('路径不存在：' + p)
    shell.showItemInFolder(p)
  })

  /** 第 1 份 F4 安全约束 1：删除一律走回收站，绝不做永久删除 */
  ipc.handle('system:trash', async (input: unknown) => {
    const list = Array.isArray(input) ? input : []
    const ok: string[] = []
    const failed: Array<{ path: string; error: string }> = []
    for (const raw of list) {
      try {
        const p = abs(raw)
        if (isForbiddenTarget(p)) throw new Error('系统目录，拒绝删除')
        if (!fs.existsSync(p)) throw new Error('不存在')
        await shell.trashItem(p)
        ok.push(p)
      } catch (e) {
        failed.push({ path: String(raw), error: e instanceof Error ? e.message : String(e) })
      }
    }
    return { ok, failed }
  })

  ipc.handle('system:open-external', async (url: unknown) => {
    if (typeof url !== 'string') throw new Error('URL 无效')
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('URL 解析失败：' + url)
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('只允许打开 http/https 链接')
    }
    await shell.openExternal(parsed.href)
  })

  ipc.handle('system:win-minimize', () => getWindow()?.minimize())
  ipc.handle('system:win-toggle-maximize', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipc.handle('system:win-close', () => getWindow()?.close())
  ipc.handle('system:win-is-maximized', () => getWindow()?.isMaximized() ?? false)
  ipc.handle('system:restart', () => {
    app.relaunch()
    app.exit(0)
  })
}
