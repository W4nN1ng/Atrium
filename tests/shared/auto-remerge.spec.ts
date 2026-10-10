import { describe, it, expect } from 'vitest'
import {
  NOTICE_AUTO_DISMISS_MS,
  NOTICE_DETAIL_MAX,
  noticeLines,
  noticeText,
  remergeAlreadyRun,
  shouldApplyAutoRemerge,
  shouldProbeAutoRemerge,
  type AutoRemergeGateInput
} from '../../src/shared/autoRemerge'

/**
 * 第 9 轮 ⑥ · 「自动并完 + 事后告知」的判据。
 *
 * 这一轮的产品裁定是他 2026-10-10 拍的：历史遗留**自动并完 + 事后告知**，
 * 新入库的东西**保持现状**（入库那一刻就并，不弹任何东西）。
 * 本仓库零 DOM 测试，所以"这次到底该不该自动跑、该说什么"必须落在这份纯函数里才可测。
 */

const OK: AutoRemergeGateInput = {
  alreadyRun: false,
  booted: true,
  libraryReady: true,
  wizardOpen: false,
  miniView: false
}

describe('shouldProbeAutoRemerge · 该不该去问主进程', () => {
  it('全新一次（从没跑过、库已配好、不在向导和小窗里）→ 去问', () => {
    expect(shouldProbeAutoRemerge(OK)).toBe(true)
  })

  it('⭐ 刹车：这台机器已经跑过一次，就永远不再自动跑（哪怕用户后来手动撤销了）', () => {
    /**
     * 这条是整个设计里最要紧的一条。少了它，"撤销 → 下次开机"会把同一批卡又并一遍，
     * 用户会看到程序跟他抢方向盘 —— 那比原来那四步确认糟得多。
     */
    expect(shouldProbeAutoRemerge({ ...OK, alreadyRun: true })).toBe(false)
  })

  it('四种"此刻不该抢注意力"的情形各自都不问', () => {
    expect(shouldProbeAutoRemerge({ ...OK, booted: false }), '设置还没读回来就动库 = 抢在 boot 前面').toBe(false)
    expect(shouldProbeAutoRemerge({ ...OK, libraryReady: false }), '还没配库').toBe(false)
    expect(shouldProbeAutoRemerge({ ...OK, wizardOpen: true }), '首启向导还开着').toBe(false)
    expect(shouldProbeAutoRemerge({ ...OK, miniView: true }), '拖放小窗只负责收文件').toBe(false)
  })

  it('刹车排在最前：别的条件再完美也拦不住 alreadyRun', () => {
    const perfect = { ...OK, alreadyRun: true }
    expect(shouldProbeAutoRemerge(perfect)).toBe(false)
    expect(shouldProbeAutoRemerge({ ...perfect, booted: false })).toBe(false)
  })

  it('判据不吃"簇数"：簇数要问过主进程才知道，混进来就会有人为它填假值', () => {
    /**
     * 第一版我把 `clusters` 塞进这个输入里，于是 store 只能传 `clusters: 1` 这种假值先过闸，
     * 那个参数就成了摆设、还骗人。分成两步之后，这一步只允许用**本地就知道的事实**。
     */
    const names = Object.keys(OK)
    expect(names).not.toContain('clusters')
    expect(names).toEqual(['alreadyRun', 'booted', 'libraryReady', 'wizardOpen', 'miniView'])
  })
})

describe('shouldApplyAutoRemerge · 问回来了要不要动库', () => {
  it('0 簇不动，1 簇也要动', () => {
    expect(shouldApplyAutoRemerge(0)).toBe(false)
    /** ⭐ 别顺手写成 `>= 2`：真库实测就是**只有一处**要并（Libero 那一簇），拦掉等于本轮白做 */
    expect(shouldApplyAutoRemerge(1)).toBe(true)
    expect(shouldApplyAutoRemerge(12)).toBe(true)
  })
})

describe('noticeText · 有没有得说', () => {
  it('说了几张 = 执行结果里的 moved，不是预览里的总卡数', () => {
    const r = noticeText(1, 12)
    expect(r).not.toBeNull()
    expect(r?.key).toBe('remerge.autoDone')
    expect(r?.params).toEqual({ clusters: 1, moved: 12 })
  })

  it('⭐ 只修了归并键、一张卡都没挪 → 不告', () => {
    /**
     * 界面上完全看不出来那次变更，弹条只会让人满库找"哪里变了"。
     * 它照样记进操作账本、照样能撤销，只是不打扰。
     */
    expect(noticeText(1, 0)).toBeNull()
  })

  it('簇数 0、或任何负数（上游算坏了）都不许显示出来', () => {
    expect(noticeText(0, 12)).toBeNull()
    expect(noticeText(-1, 12)).toBeNull()
    expect(noticeText(1, -3)).toBeNull()
    expect(noticeText(0, 0)).toBeNull()
  })

  it('key 不许改名：翻译文件里没有的 key 会让界面直接显示英文原文', () => {
    expect(noticeText(2, 7)?.key).toBe('remerge.autoDone')
  })
})

describe('noticeLines · 展开那几行', () => {
  const merged = { name: 'Libero', moved: 12, rows: 20 }
  const keyfix = { name: 'Grimoire', moved: 0, rows: 3 }

  it('每行只说该说的数：并进来的用 moved，只修键的用 rows', () => {
    const { lines } = noticeLines([merged, keyfix])
    expect(lines[0]).toEqual({ name: 'Libero', key: 'remerge.autoLineMerged', count: 12 })
    /**
     * ⭐ 这里若是 20，界面会写"并进来 20 张"而实际只少了 12 张。
     * 若是把 moved=0 那簇也标成 autoLineMerged，界面会出现"并进来 0 张"。
     */
    expect(lines[1]).toEqual({ name: 'Grimoire', key: 'remerge.autoLineKeyfix', count: 3 })
  })

  it('⭐ 能看见的排在前面，只修键的沉底（输入顺序反过来也一样）', () => {
    const { lines } = noticeLines([keyfix, merged])
    expect(lines.map((l) => l.key)).toEqual(['remerge.autoLineMerged', 'remerge.autoLineKeyfix'])
  })

  it('同类之间按并进来的张数从多到少', () => {
    const { lines } = noticeLines([
      { name: 'A', moved: 2, rows: 5 },
      { name: 'B', moved: 9, rows: 12 }
    ])
    expect(lines.map((l) => l.name)).toEqual(['B', 'A'])
  })

  it('超过上限就折起来，more 是**没列出来的条数**而不是总数', () => {
    const many = Array.from({ length: NOTICE_DETAIL_MAX + 3 }, (_, i) => ({ name: `N${i}`, moved: 10 - i, rows: 11 - i }))
    const { lines, more } = noticeLines(many)
    expect(lines.length).toBe(NOTICE_DETAIL_MAX)
    expect(more).toBe(3)
    /** 恰好等于上限时不许谎报"还有 0 处" */
    expect(noticeLines(many.slice(0, NOTICE_DETAIL_MAX)).more).toBe(0)
  })

  it('空清单给空行、more 0（组件靠这个决定展不展开）', () => {
    expect(noticeLines([])).toEqual({ lines: [], more: 0 })
  })

  it('不改调用方传进来的那个数组（store 里的 items 还要留着别用）', () => {
    const input = [merged, keyfix]
    noticeLines(input)
    expect(input[0]).toBe(merged)
    expect(input[1]).toBe(keyfix)
  })
})

describe('告知条自己收起的时间', () => {
  it('比"读完一句中文再想一想"长，但也不许挂成半个常驻横幅', () => {
    /** 原来写 5 秒不够：这条消息里有"我动了你什么"和一个撤销入口 */
    expect(NOTICE_AUTO_DISMISS_MS).toBeGreaterThanOrEqual(8000)
    expect(NOTICE_AUTO_DISMISS_MS).toBeLessThanOrEqual(30000)
  })
})

/**
 * 第 10 轮 #112 · 那道刹车的**归属**。
 *
 * ⑥ 原来记的是"这台机器跑过没有"，可它要防的是"同一批卡被并两遍"。
 * 他把整包素材从 `E:\vrc\A` 换到别的盘/别的目录之后，新库里那份旧账
 * 会永远撞在旧时间戳上 —— 那不是刹车，那是一脚刹车管所有轮子。
 */
describe('remergeAlreadyRun · 刹车按库判，不按机器判', () => {
  const T = '2026-10-10T08:00:00.000Z'

  it('⭐ 同一套库 → 仍然算跑过（⑥ 的安全垫没变：不重复动库）', () => {
    expect(remergeAlreadyRun({ runAt: T, runRoot: 'E:/vrc/A' }, 'E:/vrc/A')).toBe(true)
  })

  it('⭐ 换了一套库 → 松开刹车，新库那份旧账还能被收拾一次', () => {
    expect(remergeAlreadyRun({ runAt: T, runRoot: 'E:/vrc/A' }, 'D:/素材')).toBe(false)
  })

  it('分隔符与大小写不算"换了库"（Windows 路径本来就大小写不敏感）', () => {
    expect(remergeAlreadyRun({ runAt: T, runRoot: 'E:\\vrc\\A' }, 'e:/vrc/a/')).toBe(true)
    expect(remergeAlreadyRun({ runAt: T, runRoot: 'E:/vrc/A/' }, 'e:\\vrc\\a')).toBe(true)
  })

  it('尾部斜杠的有无也不该判成两套库（否则改个设置就会重跑一遍）', () => {
    expect(remergeAlreadyRun({ runAt: T, runRoot: 'E:/vrc/A' }, 'E:/vrc/A/')).toBe(true)
  })

  it('没有时间戳 = 从没跑过，跟库根是什么无关', () => {
    expect(remergeAlreadyRun({ runAt: null, runRoot: 'E:/vrc/A' }, 'D:/x')).toBe(false)
    expect(remergeAlreadyRun({ runAt: null, runRoot: null }, null)).toBe(false)
  })

  it('⭐ 老数据（有时间戳、没库根）维持"已跑过" —— 这一列是新加的，不许因此给旧用户多写一次库', () => {
    expect(remergeAlreadyRun({ runAt: T, runRoot: null }, 'E:/vrc/A')).toBe(true)
  })

  it('库根还没配（null）而时间戳带着别的库 → 不重复跑（真跑也有 libraryReady 那道闸，这里只是不自相矛盾）', () => {
    expect(remergeAlreadyRun({ runAt: T, runRoot: 'E:/vrc/A' }, null)).toBe(false)
    /** 上面这条返回 false 的意思是"该跑"，而 `shouldProbeAutoRemerge` 会用 libraryReady 拦住它 */
    expect(shouldProbeAutoRemerge({ alreadyRun: false, booted: true, libraryReady: false, wizardOpen: false, miniView: false })).toBe(false)
  })

  it('串起来看：换库 + 库配好了 → 会去问主进程；同一套库第二次开机 → 不问', () => {
    const gate = (alreadyRun: boolean): boolean =>
      shouldProbeAutoRemerge({ alreadyRun, booted: true, libraryReady: true, wizardOpen: false, miniView: false })
    expect(gate(remergeAlreadyRun({ runAt: T, runRoot: 'E:/vrc/A' }, 'D:/新库'))).toBe(true)
    expect(gate(remergeAlreadyRun({ runAt: T, runRoot: 'E:/vrc/A' }, 'E:/vrc/A'))).toBe(false)
  })
})
