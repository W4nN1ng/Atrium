import { useCallback, useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import {
  LONG_PRESS_MS,
  canArmLongPress,
  longPressMovedTooFar,
  type GesturePoint
} from '../../shared/cardGesture'

/**
 * 长按 1 秒的指针生命周期（2026-10-21 交互简化）。
 *
 * 判据（时长、移动阈值、修饰键）在 `shared/cardGesture.ts`，这里只负责：
 * - 计时与清理；
 * - 以下任一情况取消：松手、移出、移动超阈值、滚动、失焦、Esc、右键菜单、原生拖拽；
 * - 触发后抑制紧随其后的 click/dblclick（导航通常会卸载卡片，但这里仍要兜住）。
 *
 * 为什么不把长按和双击都塞进 `onClick`：
 * 双击的判定由浏览器给（click detail），长按必须自己计时；两套混在一起就会出现
 * “双击的前半段被当成一次长按的起点”这类时序事故。
 */

export interface LongPressHandlers {
  onPointerDown: React.PointerEventHandler<HTMLElement>
  onPointerMove: React.PointerEventHandler<HTMLElement>
  onPointerUp: React.PointerEventHandler<HTMLElement>
  onPointerLeave: React.PointerEventHandler<HTMLElement>
  onPointerCancel: React.PointerEventHandler<HTMLElement>
  onContextMenu: React.MouseEventHandler<HTMLElement>
  onClickCapture: React.MouseEventHandler<HTMLElement>
  onDoubleClickCapture: React.MouseEventHandler<HTMLElement>
}

export interface UseLongPressResult {
  /** 正在按住且尚未取消 —— 用来画 1 秒进度条 */
  pressing: boolean
  handlers: LongPressHandlers
}

export function useLongPress(opts: { enabled: boolean; onFire: () => void }): UseLongPressResult {
  const { enabled, onFire } = opts
  const [pressing, setPressing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<GesturePoint | null>(null)
  const fired = useRef(false)
  /** onFire 每次渲染可能换引用；计时器只认最新的那个，不因父组件重渲染而失效 */
  const onFireRef = useRef(onFire)

  useEffect(() => {
    onFireRef.current = onFire
  }, [onFire])

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    clearTimer()
    start.current = null
    setPressing(false)
  }, [clearTimer])

  const fire = useCallback(() => {
    timer.current = null
    start.current = null
    setPressing(false)
    fired.current = true
    onFireRef.current()
  }, [])

  useEffect(() => {
    if (!enabled) cancel()
  }, [enabled, cancel])

  /**
   * 只在按住期间挂 window 级监听。
   * `scroll` 必须用 capture：容器滚动时指针可能没动，等冒泡到 window 已经晚了。
   */
  useEffect(() => {
    if (!pressing) return
    const onWindowUp = (): void => cancel()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
    }
    const onDrag = (): void => cancel()
    window.addEventListener('pointerup', onWindowUp, true)
    window.addEventListener('pointercancel', onWindowUp, true)
    window.addEventListener('blur', onWindowUp)
    window.addEventListener('scroll', onWindowUp, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('dragstart', onDrag, true)
    return () => {
      window.removeEventListener('pointerup', onWindowUp, true)
      window.removeEventListener('pointercancel', onWindowUp, true)
      window.removeEventListener('blur', onWindowUp)
      window.removeEventListener('scroll', onWindowUp, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('dragstart', onDrag, true)
    }
  }, [pressing, cancel])

  /** 组件卸载（例如长按触发后立刻 setNav）时别把定时器留下 */
  useEffect(() => () => clearTimer(), [clearTimer])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled || !canArmLongPress(e)) return
      clearTimer()
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      setPressing(true)
      timer.current = setTimeout(fire, LONG_PRESS_MS)
    },
    [enabled, clearTimer, fire]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!start.current) return
      if (longPressMovedTooFar(start.current, { x: e.clientX, y: e.clientY })) cancel()
    },
    [cancel]
  )

  /**
   * 长按已经触发后，浏览器仍可能补一个 click/dblclick。
   * 用 capture 在目标元素上先吃掉一次，避免“打开合集的同时又把这张卡选了/导了”。
   */
  const suppressFiredClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!fired.current) return
    fired.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return {
    pressing,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: cancel,
      onClickCapture: suppressFiredClick,
      onDoubleClickCapture: suppressFiredClick
    }
  }
}
