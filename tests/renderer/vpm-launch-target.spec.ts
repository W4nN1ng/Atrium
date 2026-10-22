import { describe, expect, it } from 'vitest'
import { targetBadge } from '../../src/renderer/vpm/lib/target'

describe('import target badge', () => {
  it('shows nothing when the project is not the current target', () => {
    expect(targetBadge({ coreId: 'a', running: true }, null, false)).toBeNull()
    expect(targetBadge({ coreId: 'a', running: true }, 'b', false)).toBeNull()
    expect(targetBadge({ coreId: null, running: true }, 'b', false)).toBeNull()
  })

  it('shows "waiting" while the target is still starting or connecting', () => {
    expect(targetBadge({ coreId: 'a', running: false }, 'a', true)).toEqual({
      key: 'targetWaiting',
      tone: 'warn'
    })
    // 即使已经开始 running，pending 仍优先（连接还没完成）
    expect(targetBadge({ coreId: 'a', running: true }, 'a', true)).toEqual({
      key: 'targetWaiting',
      tone: 'warn'
    })
  })

  it('shows the steady target badge once pending clears', () => {
    expect(targetBadge({ coreId: 'a', running: true }, 'a', false)).toEqual({
      key: 'isTarget',
      tone: 'accent'
    })
  })
})
