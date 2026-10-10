import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bridgeAskAnswerFor } from '../../src/shared/bridgeAsk'

let answer: ReturnType<typeof vi.fn>
let install: ReturnType<typeof vi.fn>
beforeEach(() => {
  answer = vi.fn(async () => ({ ok: true }))
  install = vi.fn(async () => ({ ok: true, copied: 1 }))
  ;(globalThis as any).window = { a: { unity: { answerBridgeAsk: answer, installBridge: install } } }
  vi.resetModules()
})
async function ready() {
  const { useUi } = await import('../../src/renderer/stores/ui')
  useUi.setState({ bridgeAsk: ['P1', 'P2', 'P3'].map((projectId) => ({ projectId, name: projectId, projectPath: `C:/test/${projectId}`, decision: 'ask' })) })
  return useUi
}
describe('一次处理发现的 Unity 工程', () => {
  it('稍后连接不保存永久拒绝', () => expect(bridgeAskAnswerFor('later')).toBeNull())
  it('稍后连接清掉本次所有询问，而且不安装任何工程', async () => {
    const ui = await ready()
    await ui.getState().resolveBridgeAsks([], false)
    expect(ui.getState().bridgeAsk).toHaveLength(0)
    expect(answer.mock.calls).toEqual([['P1', 'later'], ['P2', 'later'], ['P3', 'later']])
    expect(install).not.toHaveBeenCalled()
  })
  it('只安装明确勾选的工程，未选工程只跳过本次', async () => {
    const ui = await ready()
    await ui.getState().resolveBridgeAsks(['P2'], true)
    expect(install.mock.calls).toEqual([['P2']])
    expect(answer.mock.calls).toEqual([['P1', 'later'], ['P2', 'always'], ['P3', 'later']])
    expect(ui.getState().bridgeAsk).toHaveLength(0)
  })
})
