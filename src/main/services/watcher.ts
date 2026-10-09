/**
 * 监视文件夹（第 1 份 F1 入口 3）。
 *
 * 用户把文件丢进一个已登记的目录，程序自己发现并排队摄取 —— 不用开窗口。
 * 三条实测出来的注意事：
 * 1. 浏览器/下载工具会先落 `.part`/`.crdownload`/`~$xxx`，必须等它变成完整文件；
 * 2. 同一个文件 chokidar 常常连发 add + change，得合并去重；
 * 3. 库目录本身不能监视，否则"入库→监视器看到新文件→再入库"套娃。
 */
import fs from 'node:fs'
import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import log from 'electron-log'
import { isJunkAbsPath } from '../../shared/junk'

const DEBOUNCE_MS = 3000
/** 同一条路径在这段时间内只投一次 */
const DEDUPE_MS = 10 * 60 * 1000
/**
 * 垃圾判定统一走 shared/junk（增量改动单 2 §A1 要求三处口径一致：
 * 游离扫描 / 监视文件夹 / 解压后清单）。这里只留监视器独有的两条：
 * 点开头的一律不碰（macOS 的 `._*` 也在里面），`.lock` 是下载器/同步盘的占位。
 */
const WATCHER_ONLY_RE = /\.(lock)$/i

export interface WatcherDeps {
  /** 当前要监视的目录（可为空） */
  getFolders(): string[]
  /** 这些目录及其内部一律忽略：库根、暂存、缩略图、备份 */
  getExcludes(): string[]
  onPaths(paths: string[]): void
}

export interface FolderWatcher {
  /** 设置里改了监视目录就调一次，内部决定要不要重启 chokidar */
  sync(): void
  watching(): string[]
  /**
   * chokidar 的 watch() 是立刻返回、过一会儿才真的开始盯。
   * 这中间丢进去的文件收不到（单测第一条就是这么扑空的），所以给个 ready 钩子。
   */
  whenReady(): Promise<void>
  dispose(): void
}

export function startFolderWatcher(deps: WatcherDeps): FolderWatcher {
  let watcher: FSWatcher | null = null
  let watchedKey = ''
  let timer: NodeJS.Timeout | null = null
  const batch = new Set<string>()
  const recentlySent = new Map<string, number>()
  let readyResolve: (() => void) | null = null
  let readyPromise = new Promise<void>((r) => {
    readyResolve = r
  })
  let isReady = false

  const whenReady = (): Promise<void> => (isReady ? Promise.resolve() : readyPromise)

  const normalize = (p: string): string => path.win32.normalize(p).replace(/[\\/]+$/, '').toLowerCase()

  function excluded(p: string): boolean {
    const n = normalize(p)
    return deps.getExcludes().some((e) => {
      const en = normalize(e)
      return !!en && (n === en || n.startsWith(en + '\\'))
    })
  }

  function shouldIgnore(p: string): boolean {
    const base = path.basename(p)
    if (base.startsWith('.')) return true
    if (WATCHER_ONLY_RE.test(base)) return true
    if (isJunkAbsPath(p)) return true
    return excluded(p)
  }

  function flush(): void {
    timer = null
    const paths = Array.from(batch)
    batch.clear()
    if (!paths.length) return
    const now = Date.now()
    const fresh = paths.filter((p) => {
      const key = normalize(p)
      const last = recentlySent.get(key)
      if (last !== undefined && now - last < DEDUPE_MS) return false
      recentlySent.set(key, now)
      return true
    })
    // 清掉过期记录，别让它无限长
    if (recentlySent.size > 500) {
      for (const [k, t] of recentlySent) if (now - t > DEDUPE_MS) recentlySent.delete(k)
    }
    if (!fresh.length) return
    log.info(`监视文件夹发现 ${fresh.length} 个新条目，排队摄取`)
    try {
      deps.onPaths(fresh)
    } catch (e) {
      log.error('监视文件夹回调失败：' + (e instanceof Error ? e.message : String(e)))
    }
  }

  function schedule(p: string): void {
    // 刚出现的文件可能还在写：等 debounce 过去再 stat 一次，大小没变才算写完
    batch.add(p)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const settled = Array.from(batch).filter((x) => {
        try {
          return fs.statSync(x).size > 0
        } catch {
          return false
        }
      })
      batch.clear()
      for (const s of settled) batch.add(s)
      flush()
    }, DEBOUNCE_MS)
  }

  function sync(): void {
    const folders = deps.getFolders().filter((f) => {
      try {
        return fs.statSync(f).isDirectory()
      } catch {
        return false
      }
    })
    const key = folders.join('|')
    if (key === watchedKey) return
    watchedKey = key
    if (watcher) {
      void watcher.close()
      watcher = null
    }
    // 换目录 = 换 watcher，ready 要重新等
    isReady = false
    readyPromise = new Promise<void>((r) => {
      readyResolve = r
    })
    if (!folders.length) {
      log.info('监视文件夹：没有已登记的目录，监视器停着')
      isReady = true
      readyResolve?.()
      return
    }
    watcher = watch(folders, {
      ignoreInitial: true,
      persistent: true,
      depth: 0, // 只认顶层丢进来的东西；子目录变动多半是解压/同步在搞
      awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 }
    })
    watcher
      .on('ready', () => {
        isReady = true
        readyResolve?.()
        log.info(`监视文件夹已启动：${folders.length} 个目录`)
      })
      .on('add', (p) => {
        if (!shouldIgnore(p)) schedule(p)
      })
      .on('change', (p) => {
        // 只有还没投过胎的才补一次，避免下载器边下边改反复触发
        if (!shouldIgnore(p) && !recentlySent.has(normalize(p))) schedule(p)
      })
      .on('error', (e) => log.warn('监视文件夹出错：' + (e instanceof Error ? e.message : String(e))))
  }

  sync()

  return {
    sync,
    whenReady,
    watching(): string[] {
      return watchedKey ? watchedKey.split('|') : []
    },
    dispose(): void {
      if (timer) clearTimeout(timer)
      timer = null
      batch.clear()
      if (watcher) void watcher.close()
      watcher = null
      watchedKey = ''
    }
  }
}
