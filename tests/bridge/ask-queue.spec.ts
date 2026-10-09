import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BridgeFirstSeenEvent } from '../../src/shared/types'
import {
  __resetBridgeAsk,
  pendingBridgeAsks,
  pushBridgeAsk,
  silenceRestBridgeAsks
} from '../../src/main/bridge/askQueue'

/**
 * M7 Q10 · 「剩下这些都不再问」的队列语义。
 *
 * 这一档最容易做错成"加一个全局静音开关" —— 那样"为什么这个工程不问了"就没法从库里答出来。
 * 所以这里除了行为，还钉一条**结构**的：静音过之后，新出现的工程照样要问。
 */

function ev(projectId: string): BridgeFirstSeenEvent {
  return {
    projectId,
    projectPath: 'D:\\projects\\' + projectId,
    name: projectId,
    decision: 'ask',
    detected: 'vcc'
  } as BridgeFirstSeenEvent
}

beforeEach(() => {
  __resetBridgeAsk()
})

afterEach(() => {
  __resetBridgeAsk()
})

describe('silenceRestBridgeAsks', () => {
  it('⭐ 只处理"屏幕上这条之外"的：其余每条 write 一次并出队，队首留着', () => {
    for (const id of ['P1', 'P2', 'P3']) pushBridgeAsk(ev(id))
    const written: string[] = []
    const rest = silenceRestBridgeAsks('P1', (id) => written.push(id))

    expect(rest.sort()).toEqual(['P2', 'P3'])
    expect(written.sort()).toEqual(['P2', 'P3'])
    /** 屏幕上那条还在问，不会被顺手替用户答掉 */
    expect(pendingBridgeAsks().map((e) => e.projectId)).toEqual(['P1'])
  })

  it('⭐ 写失败的那条不许悄悄出队（用户看到报错，问题却消失了 = 假答过）', () => {
    for (const id of ['P1', 'P2']) pushBridgeAsk(ev(id))
    expect(() =>
      silenceRestBridgeAsks('P1', (id) => {
        throw new Error('库写不进去 ' + id)
      })
    ).toThrow(/库写不进去/)
    expect(pendingBridgeAsks().map((e) => e.projectId).sort()).toEqual(['P1', 'P2'])
  })

  it('再点一次不会重复写（队列已经空了就是空了）', () => {
    pushBridgeAsk(ev('P1'))
    pushBridgeAsk(ev('P2'))
    const first: string[] = []
    silenceRestBridgeAsks('P1', (id) => first.push(id))
    const second: string[] = []
    expect(silenceRestBridgeAsks('P1', (id) => second.push(id))).toEqual([])
    expect(second).toEqual([])
    expect(first).toEqual(['P2'])
  })

  it('⭐ 没有"从此都不问"那种全局标志：之后新发现的工程照样进队、照样要问', () => {
    pushBridgeAsk(ev('P1'))
    pushBridgeAsk(ev('P2'))
    silenceRestBridgeAsks('P1', () => undefined)
    pushBridgeAsk(ev('P9'))
    expect(pendingBridgeAsks().map((e) => e.projectId)).toEqual(['P1', 'P9'])
  })

  it('队里只剩一条时按下去什么都不写（这颗按钮本来也不该出现）', () => {
    pushBridgeAsk(ev('P1'))
    const written: string[] = []
    expect(silenceRestBridgeAsks('P1', (id) => written.push(id))).toEqual([])
    expect(written).toEqual([])
    expect(pendingBridgeAsks().map((e) => e.projectId)).toEqual(['P1'])
  })
})
