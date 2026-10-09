import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface DropHandlers {
  onDragOver(e: React.DragEvent): void
  onDragEnter(e: React.DragEvent): void
  onDragLeave(e: React.DragEvent): void
  onDrop(e: React.DragEvent): void
}

/**
 * 窗口任意位置都可接收拖放（第 1 份 F5 硬性要求）。
 * Electron 32+ 里 File.path 已删除，绝对路径只能由 preload 的 webUtils 取。
 */
export function useDropZone(onPaths: (paths: string[]) => void): { active: boolean; handlers: DropHandlers } {
  const depth = useRef(0)
  const [active, setActive] = useState(false)

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    depth.current += 1
    setActive(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setActive(false)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      depth.current = 0
      setActive(false)
      const dt = e.dataTransfer
      if (!dt) return
      const paths: string[] = []
      for (const file of Array.from(dt.files)) {
        try {
          const p = window.a.system.pathForFile(file)
          if (p) paths.push(p)
        } catch {
          /* 非本地文件（比如从浏览器拖来的链接）拿不到路径，忽略 */
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
      if (paths.length) onPaths(paths)
    },
    [onPaths]
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
