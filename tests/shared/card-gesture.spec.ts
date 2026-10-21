import { describe, expect, it } from 'vitest'
import {
  LONG_PRESS_MOVE_CANCEL_PX,
  LONG_PRESS_MS,
  canArmLongPress,
  longPressMovedTooFar
} from '../../src/shared/cardGesture'

/**
 * 2026-10-21 · 卡片长按判据。
 *
 * 渲染层没有 DOM 测试环境，所以这里只钉“能决定行为的那几个数”：
 * 1000ms、8px、主键、无修饰键。真正的指针生命周期由 `gesture-wiring.spec.ts`
 * 的源码接线断言 + 打包版 CDP 活体兜住。
 */
describe('长按判据', () => {
  it('用户指定 1 秒，常量就是 1000ms（不许在组件里另写字面量）', () => {
    expect(LONG_PRESS_MS).toBe(1000)
  })

  it('移动取消阈值是 8px', () => {
    expect(LONG_PRESS_MOVE_CANCEL_PX).toBe(8)
  })

  it('没动 / 在阈值内 → 不取消', () => {
    expect(longPressMovedTooFar({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false)
    expect(longPressMovedTooFar({ x: 10, y: 10 }, { x: 18, y: 10 })).toBe(false)
    expect(longPressMovedTooFar({ x: 10, y: 10 }, { x: 10, y: 2 })).toBe(false)
  })

  it('超过阈值 → 取消（任一方向、斜向都算）', () => {
    expect(longPressMovedTooFar({ x: 10, y: 10 }, { x: 18.1, y: 10 })).toBe(true)
    expect(longPressMovedTooFar({ x: 10, y: 10 }, { x: 10, y: 1 })).toBe(true)
    expect(longPressMovedTooFar({ x: 10, y: 10 }, { x: 16, y: 16 })).toBe(true)
  })

  it('只认主键、不认修饰键（Ctrl/Shift 是在改选区，不该打开合集）', () => {
    const base = { button: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }
    expect(canArmLongPress(base)).toBe(true)
    expect(canArmLongPress({ ...base, button: 1 })).toBe(false)
    expect(canArmLongPress({ ...base, button: 2 })).toBe(false)
    expect(canArmLongPress({ ...base, ctrlKey: true })).toBe(false)
    expect(canArmLongPress({ ...base, metaKey: true })).toBe(false)
    expect(canArmLongPress({ ...base, altKey: true })).toBe(false)
    expect(canArmLongPress({ ...base, shiftKey: true })).toBe(false)
  })
})
