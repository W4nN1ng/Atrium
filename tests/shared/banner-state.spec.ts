import { describe, it, expect } from 'vitest'
import { bannerRenderState, shouldAskAutoLaunch, BANNER_AUTO_HIDE_MS } from '../../src/shared/bannerState'
import type { AutoSwitchEvent } from '../../src/shared/types'

/**
 * M6 ⑤ · 横幅的"该不该出现、出现成什么样"。
 *
 * 这里管的是**判据**，不是像素：哪些事件值得占一条横幅、固定之后还淡不淡、
 * 搜索框里的字要不要在横幅上交代一句。组件（`ProjectBanner.tsx`）里没有 if，
 * 所以判据错了这里就会红 —— 这正是"不引 DOM 依赖也要有回归保护"的那条路。
 */

const ev = (over: Partial<AutoSwitchEvent> = {}): AutoSwitchEvent => ({
  projectId: 'P1',
  projectPath: 'E:\\ALCOMprojects\\shinano-Main2',
  projectName: 'shinano-Main2',
  action: 'switch',
  reason: 'switched',
  collectionId: 'C1',
  collectionName: 'Shinano',
  candidates: [],
  at: 1000,
  ...over
})
const input = (over: Partial<Parameters<typeof bannerRenderState>[0]> = {}) => ({
  event: ev(),
  search: '',
  pinned: false,
  ignoredProjects: [] as string[],
  otherCollections: [{ id: 'C2', name: 'Milfy' }],
  ...over
})

describe('什么时候该出现', () => {
  it('没有事件 → 不出现', () => {
    expect(bannerRenderState(input({ event: null })).shown).toBe(false)
  })

  it('cooldown / never 这两种 skip 不打扰用户（每 5 分钟弹一次"我没切"就是骚扰）', () => {
    for (const reason of ['cooldown', 'never']) {
      const v = bannerRenderState(input({ event: ev({ action: 'skip', reason, collectionId: null, collectionName: null }) }))
      expect(v.shown, reason).toBe(false)
    }
  })

  it('被"这次忽略"过的工程不再出现（§4.3「关闭横幅，本次不再提示」）', () => {
    expect(bannerRenderState(input({ ignoredProjects: ['P1'] })).shown).toBe(false)
    expect(bannerRenderState(input({ ignoredProjects: ['别的'] })).shown).toBe(true)
  })

  it('切了集合 → 出现，tone=ok，四个按钮齐全（不是这个集合 / 以后都这样 / 固定 / 这次忽略）', () => {
    const v = bannerRenderState(input())
    expect(v.shown).toBe(true)
    if (!v.shown) return
    expect(v.tone).toBe('ok')
    expect(v.titleKey).toBe('project.bannerSwitched')
    expect(v.titleParams).toEqual({ project: 'shinano-Main2', collection: 'Shinano' })
    expect(v.buttons).toEqual(['not-this', 'remember', 'pin', 'ignore'])
    expect(v.choices).toEqual([{ id: 'C2', name: 'Milfy' }])
  })
})

describe('淡出与固定', () => {
  it('默认 10 秒后自动淡出；点了固定就不淡', () => {
    const a = bannerRenderState(input())
    const b = bannerRenderState(input({ pinned: true }))
    expect(a.shown && a.autoHide).toBe(true)
    expect(b.shown && b.autoHide).toBe(false)
  })

  /**
   * 上面那条只看 `autoHide` 这个**布尔**，把 10 秒改成 0 或 10 分钟都不会红 ——
   * `verify-red-m6` 的 E6 就是这么暴露的，所以数字单独钉一条。
   * 组件里的定时器用的就是这个常量。
   */
  it('淡出时长就是规格那个 10 秒（布尔用例挡不住改数字）', () => {
    expect(BANNER_AUTO_HIDE_MS).toBe(10_000)
  })
})

describe('R-52：搜索框一个字都不许清，所以要说明白', () => {
  it('搜索框非空 → 横幅多一句「仍在搜索「…」」', () => {
    const v = bannerRenderState(input({ search: '  liltoon  ' }))
    expect(v.shown && v.bodyKey).toBe('project.bannerStillSearching')
    expect(v.shown && v.bodyParams).toEqual({ q: 'liltoon' })
  })

  it('搜索框是空的 → 不多这句（废话会挤掉真正的信息）', () => {
    const v = bannerRenderState(input({ search: '   ' }))
    expect(v.shown && v.bodyKey).toBe(null)
  })
})

describe('Q3：那条"要不要开机常驻托盘"的提示该不该出现', () => {
  it('没自启 + 没问过 + 真的遇到过一次 Unity 启动 → 问', () => {
    expect(shouldAskAutoLaunch({ autoLaunch: false, alreadyAsked: false, sawUnityStart: true })).toBe(true)
  })

  it('三个前提缺一个都不问（尤其：从没遇到过 Unity 启动时不该凭空冒出来）', () => {
    expect(shouldAskAutoLaunch({ autoLaunch: true, alreadyAsked: false, sawUnityStart: true })).toBe(false)
    expect(shouldAskAutoLaunch({ autoLaunch: false, alreadyAsked: true, sawUnityStart: true })).toBe(false)
    expect(shouldAskAutoLaunch({ autoLaunch: false, alreadyAsked: false, sawUnityStart: false })).toBe(false)
  })
})

describe('平手与"没切"也要看得见（Q1 留痕的另一半）', () => {
  it('ambiguous → warn + 把候选名单写进文案参数', () => {
    const v = bannerRenderState(
      input({ event: ev({ action: 'skip', reason: 'ambiguous', collectionId: null, collectionName: null, candidates: ['Shinano A', 'Shinano B'] }) })
    )
    expect(v.shown).toBe(true)
    if (!v.shown) return
    expect(v.tone).toBe('warn')
    expect(v.titleParams).toEqual({ project: 'shinano-Main2', count: 2, names: 'Shinano A、Shinano B' })
    expect(v.buttons).toEqual(['choose', 'ignore'])
  })

  it('busy（用户正忙，命中了但没打断）→ 给一个"现在切过去"，不闷声不响', () => {
    const v = bannerRenderState(input({ event: ev({ action: 'skip', reason: 'busy' }) }))
    expect(v.shown).toBe(true)
    if (!v.shown) return
    expect(v.tone).toBe('info')
    expect(v.titleKey).toBe('project.bannerDeferred')
    expect(v.buttons).toContain('switch-now')
  })

  it('wake-only（没匹配到集合）→ R5 之后什么都不显示', () => {
    const v = bannerRenderState(input({ event: ev({ action: 'wake-only', reason: 'no-match-always', collectionId: null, collectionName: null }) }))
    // 用户明确要求删掉"没匹配到集合"这条提示：视图没动就不该通知。
    expect(v.shown).toBe(false)
  })
})
