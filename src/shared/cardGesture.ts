/**
 * 卡片手势的**纯判据**（2026-10-21 交互简化）。
 *
 * 目的只有一个：把“按住多久算长按、移动多少算取消、哪些修饰键不参与”写成能直接单测的常量与函数，
 * 不让这些决定散在 JSX 里。本仓库渲染层没有 DOM 测试环境（vitest `environment:'node'`），
 * 所以真正的指针生命周期用源码接线断言 + 打包版 CDP 活体兜住，这里只负责可测的那一半。
 */

/** 用户指定的长按时长：1 秒，不许在组件里另写字面量 */
export const LONG_PRESS_MS = 1000

/**
 * 按住后允许的手抖范围（px）。超过就取消。
 *
 * 8px 足够覆盖普通鼠标/触控板的按下抖动，又不会让“按住慢慢挪”变成打开合集。
 * 觉得手感不合适要改这个常量，**不要**在组件里写第二套阈值。
 */
export const LONG_PRESS_MOVE_CANCEL_PX = 8

export interface GesturePoint {
  x: number
  y: number
}

/** 按住后是否已经移动得太远（超过阈值才取消；正好等于阈值不取消） */
export function longPressMovedTooFar(
  start: GesturePoint,
  next: GesturePoint,
  threshold: number = LONG_PRESS_MOVE_CANCEL_PX
): boolean {
  const dx = next.x - start.x
  const dy = next.y - start.y
  return dx * dx + dy * dy > threshold * threshold
}

/**
 * 这次按下能不能进入长按。
 *
 * 只认主键、且不按任何修饰键：
 * - 右键/中键不参与（右键留给系统菜单）；
 * - Ctrl/Meta/Shift 是在改选区，长按去打开合集会和选择手势打架；
 * - Alt 可能被系统/窗口管理器占用，不抢。
 */
export function canArmLongPress(e: {
  button: number
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}): boolean {
  return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
}
