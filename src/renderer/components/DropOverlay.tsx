import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DropEmptyInfo } from '../../shared/dropDiagnostics'

export interface DropHandlers {
  onDragOver(e: React.DragEvent): void
  onDragEnter(e: React.DragEvent): void
  onDragLeave(e: React.DragEvent): void
  onDrop(e: React.DragEvent): void
}

/** 指针在窗口里停着不动时 `dragover` 也大约每 350ms 来一次；400ms 没消息就当离开了 */
export const DROP_IDLE_MS = 400

/**
 * 窗口任意位置都可接收拖放（第 1 份 F5 硬性要求）。
 * Electron 32+ 里 File.path 已删除，绝对路径只能由 preload 的 webUtils 取。
 *
 * ## 第 10 轮 E 改了什么，为什么
 *
 * 他报「有时文件夹拖进来一点反应也没有」，录屏里那段拖拽在他窗口内停了 6 秒以上，
 * 而那层"松手即读内容并分类"的全屏高亮**一次都没出现**。老写法是
 * `dragenter` 计数 +1 / `dragleave` 计数 −1，归零就熄灭 —— 跨子元素时这套记账很容易
 * 早一步归零（而且它一旦错了是**静默**的，没人看得出来）。改成：
 *
 *  1. **`dragover` 也点亮**（指针还在窗口里它就持续来），高亮不可能"灭着"；
 *  2. 熄灭只看**安静了 400ms**，不再依赖 enter/leave 配对；
 *  3. `drop` 拿到 0 个本地路径时**必须说一句**（老写法是完全静默，那正是他看到的现象）。
 *
 * ⚠ 根因还没定死：也可能是 OS 层事件根本没送进来（录屏看不出这两种的区别）。
 * 所以第 3 条那句提示里带上计数 —— 下次他撞上，一眼能看出是"没事件"还是"有事件没路径"。
 */
export function useDropZone(
  onPaths: (paths: string[]) => void,
  onEmpty?: (info: DropEmptyInfo) => void
): { active: boolean; handlers: DropHandlers } {
  const [active, setActive] = useState(false)
  const on = useRef(false)
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * 只给诊断用（console），不进任何用户看得见的数字。
   * `over` 是"点亮次数"，`dragenter` 也算一次 —— 所以 `over>0` 就等于"事件确实送进来了"，
   * 这正是根因还没定死的那两种情况（事件没来 / 来了没路径）唯一的区分手段。
   */
  const seen = useRef({ enter: 0, over: 0, leave: 0, drop: 0, files: 0 })

  const light = useCallback(() => {
    seen.current.over++
    if (!on.current) {
      on.current = true
      setActive(true)
    }
    if (idle.current) clearTimeout(idle.current)
    idle.current = setTimeout(() => {
      on.current = false
      setActive(false)
    }, DROP_IDLE_MS)
  }, [])

  useEffect(
    () => () => {
      if (idle.current) clearTimeout(idle.current)
    },
    []
  )

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      /** ⭐ 点亮的主路径：以前这里只 preventDefault，高亮灭着也没人管 */
      light()
    },
    [light]
  )

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      seen.current.enter++
      light()
    },
    [light]
  )

  /**
   * 故意**不**在这里熄灭。
   * 老写法靠 enter/leave 配对，而一次真实拖拽在窗口内部跨元素时 leave 会先到、
   * 下一拍 enter 才来 —— 中间那一拍就是"高亮闪一下没了"，用户读到的就是"没反应"。
   */
  const onDragLeave = useCallback((e: React.DragEvent) => {
    seen.current.leave++
    e.preventDefault()
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      seen.current.drop++
      if (idle.current) clearTimeout(idle.current)
      on.current = false
      setActive(false)
      const dt = e.dataTransfer
      if (!dt) {
        /** 连 dataTransfer 都没有：也要说一句，不许静默 */
        /* eslint-disable-next-line no-console */
        console.info('[drag] ' + JSON.stringify({ ...seen.current, noDataTransfer: true }))
        onEmpty?.({ files: 0, localPaths: 0 })
        return
      }
      const paths: string[] = []
      const seenPaths = new Set<string>()
      const push = (p: string | null | undefined): void => {
        if (!p || seenPaths.has(p)) return
        seenPaths.add(p)
        paths.push(p)
      }
      /**
       * R6：**先走 `dataTransfer.items`**。
       * 拖文件夹时 `dataTransfer.files` 在 Chromium 里经常是空的，
       * 只有 `items[i].webkitGetAsEntry()` 才能看出这是个目录；
       * 但拿路径还是得靠 `getAsFile()` + `pathForFile`（Electron 对目录也返回真实路径）。
       */
      const items = Array.from(dt.items ?? [])
      for (const item of items) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (!file) continue
        try {
          push(window.a.system.pathForFile(file))
        } catch {
          /* 非本地文件（从浏览器拖来的链接）拿不到路径 */
        }
      }
      const files = Array.from(dt.files ?? [])
      seen.current.files = files.length
      for (const file of files) {
        try {
          push(window.a.system.pathForFile(file))
        } catch {
          /* 同上 */
        }
      }
      if (!paths.length) {
        const uri = dt.getData('text/uri-list')
        for (const line of uri.split(/\r?\n/)) {
          if (line.startsWith('file://')) {
            try {
              paths.push(decodeURIComponent(new URL(line).pathname.replace(/^\/([A-Za-z]:)/, '$1')))
            } catch {
              /* 忽略解析失败的行 */
            }
          }
        }
      }
      /* eslint-disable-next-line no-console */
      console.info('[drag] ' + JSON.stringify({ ...seen.current, paths: paths.length }))
      if (paths.length) onPaths(paths)
      /** ⭐ 以前这一句都没有：拿到 0 个路径就当无事发生，用户只能看到"没反应" */
      else onEmpty?.({ files: files.length, localPaths: paths.length })
    },
    [onPaths, onEmpty]
  )

  return { active, handlers: { onDragOver, onDragEnter, onDragLeave, onDrop } }
}

export function DropOverlay({ active }: { active: boolean }): JSX.Element | null {
  const { t } = useTranslation()
  if (!active) return null
  return (
    <div
      className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center"
      style={{ background: 'rgba(124,108,242,0.10)', boxShadow: 'inset 0 0 0 2px var(--accent)' }}
    >
      <div
        className="rounded-lg border px-6 py-4 text-[15px] font-medium shadow-overlay"
        style={{ background: 'var(--panel)', borderColor: 'var(--accent)', color: 'var(--accent)' }}
      >
        {t('library.dropHint')}
      </div>
    </div>
  )
}
