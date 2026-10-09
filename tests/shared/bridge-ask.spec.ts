import { describe, it, expect } from 'vitest'
import {
  bridgeAskAnswerFor,
  bridgeAskDecision,
  bridgeAskKey,
  canSilenceRestBridgeAsks,
  parseBridgeAskAnswer,
  restBridgeAskCount,
  type BridgeAskInput
} from '../../src/shared/bridgeAsk'

/**
 * R4 ⑦ · "要不要给这个工程装桥接"的判据。
 *
 * 本仓库渲染层零 DOM 测试，所以判据必须在纯函数里、由这里逐条钉住。
 * 六个输入、四种出口，手工点很难凑齐（已装过的 / 答过的 / 全局开关开着的…）。
 */

/** 除被测的那一项外，其余都取"最普通的默认值" */
function input(over: Partial<BridgeAskInput>): BridgeAskInput {
  return {
    installed: false,
    answer: null,
    autoInstallSetting: false,
    firstSighting: true,
    running: false,
    ...over
  }
}

describe('bridgeAskKey / parseBridgeAskAnswer / bridgeAskAnswerFor', () => {
  it('键名带工程 id 前缀，且不与别的 setting 撞车', () => {
    expect(bridgeAskKey('01JABC')).toBe('bridgeAsk:01JABC')
    /** 和 `projectGuids:<id>` 同一个路子（裁定 Q7：不为这件事动 schema） */
    expect(bridgeAskKey('01JABC')).not.toBe('projectGuids:01JABC')
  })

  it('脏值一律收成 null（当成"没答过"，不许抛）', () => {
    expect(parseBridgeAskAnswer('always')).toBe('always')
    expect(parseBridgeAskAnswer('never')).toBe('never')
    /** 大小写和空格容错：手改过库的人不该被算成"没答过"以外的第三种状态 */
    expect(parseBridgeAskAnswer(' ALWAYS ')).toBe('always')
    expect(parseBridgeAskAnswer('Never')).toBe('never')
    for (const dirty of ['', 'auto', 'true', null, undefined, 1, {}, [], 'alwaysx']) {
      expect(parseBridgeAskAnswer(dirty), `脏值 ${JSON.stringify(dirty)} 必须当没答过`).toBeNull()
    }
  })

  it('三个按钮各存什么：「这次装」不写答案，所以下次第一次发现还会问', () => {
    expect(bridgeAskAnswerFor('install-once')).toBeNull()
    expect(bridgeAskAnswerFor('always')).toBe('always')
    expect(bridgeAskAnswerFor('never')).toBe('never')
  })
})

describe('bridgeAskDecision：先看出声条件，再看出声方式', () => {
  it('⭐ 已经装了桥接 → 无论如何都 quiet（不许打扰用户，也不许覆盖他改过的桥接）', () => {
    for (const firstSighting of [true, false]) {
      for (const running of [true, false]) {
        for (const answer of [null, 'always', 'never'] as const) {
          for (const autoInstallSetting of [true, false]) {
            expect(
              bridgeAskDecision(input({ installed: true, firstSighting, running, answer, autoInstallSetting })),
              `installed=true 时其它输入不该改变结论（${JSON.stringify({ firstSighting, running, answer, autoInstallSetting })}）`
            ).toBe('quiet')
          }
        }
      }
    }
  })

  it('⭐ 第一次发现、没答过、全局开关关着 → ask（这就是 R4 ⑦ 的那个弹窗）', () => {
    expect(bridgeAskDecision(input({}))).toBe('ask')
  })

  it('答过「暂不」→ quiet（同一工程不再弹）', () => {
    expect(bridgeAskDecision(input({ answer: 'never' }))).toBe('quiet')
  })

  it('答过「以后都自动安装」→ auto（不是 ask：不再问，直接装）', () => {
    expect(bridgeAskDecision(input({ answer: 'always' }))).toBe('auto')
  })

  it('⭐ 全局 `bridgeAutoInstall` 打开 → auto（这条就是"死设置真被读"的判据侧证据）', () => {
    expect(bridgeAskDecision(input({ autoInstallSetting: true }))).toBe('auto')
  })

  it('全局开关开着时，答过「暂不」也仍然自动装：两个是不同层的意愿', () => {
    /**
     * `bridgeAutoInstall` 是设置页里"为新工程自动装"的总开关（R-14），
     * 用户在弹窗里点「暂不」只表示**这一次**这个工程不装。
     * 若把 `never` 当成能压住总开关，等于让弹窗覆盖设置页 —— 界面与设置互相矛盾。
     */
    expect(bridgeAskDecision(input({ answer: 'never', autoInstallSetting: true }))).toBe('auto')
  })

  it('⭐ 不在任何边沿上 → quiet（三路探测每 3 秒一轮，否则问到用户关软件）', () => {
    expect(bridgeAskDecision(input({ firstSighting: false, running: false }))).toBe('quiet')
    expect(bridgeAskDecision(input({ firstSighting: false, running: false, answer: 'always' }))).toBe('quiet')
    expect(bridgeAskDecision(input({ firstSighting: false, running: false, autoInstallSetting: true }))).toBe('quiet')
  })

  it('⭐ 「开始运行」这个边沿只自动装、**不弹窗**', () => {
    /** 没答过、也没开全局开关：Unity 开一下就要弹窗，等于每次开 Unity 都打断用户 */
    expect(bridgeAskDecision(input({ firstSighting: false, running: true }))).toBe('quiet')
    /** 答过 always / 开关开着 → 在这个时机真的执行自动装 */
    expect(bridgeAskDecision(input({ firstSighting: false, running: true, answer: 'always' }))).toBe('auto')
    expect(bridgeAskDecision(input({ firstSighting: false, running: true, autoInstallSetting: true }))).toBe('auto')
    /** 答过 never：既不弹也不装 */
    expect(bridgeAskDecision(input({ firstSighting: false, running: true, answer: 'never' }))).toBe('quiet')
  })

  it('为什么需要第二个时机：always 只挂在第一次发现上会永远不被执行', () => {
    /**
     * 真实顺序是这样的：第一次发现工程时 Unity 常常**还没开**（从 ALCOM 清单/盘扫发现的），
     * 那一刻存下 `always`；此后这个工程的行已在库里，第一次发现的边沿再也亮不起来。
     * 于是没有 `running` 这条边沿的话，"以后都自动安装"这个答案就**永远不会被执行** ——
     * `bridgeAskDecision` 只看 `firstSighting` 的旧写法正是这样，所以这条单独钉住。
     */
    const afterAlways = input({ firstSighting: false, running: true, answer: 'always' })
    expect(bridgeAskDecision(afterAlways)).toBe('auto')
    expect(bridgeAskDecision(input({ firstSighting: false, running: false, answer: 'always' }))).toBe('quiet')
  })

  it('已装桥接 + 第一次发现也 quiet（幂等：重复复制会把用户自己改过的桥接覆盖回去）', () => {
    expect(bridgeAskDecision(input({ installed: true, autoInstallSetting: true }))).toBe('quiet')
  })
})

/**
 * M7 Q10 · 「剩下这些都不再问」那颗按钮该不该出现、N 是几。
 *
 * 判据只有"队列里不止一条"这一句，但它画在弹窗上 —— 组件里写 `waiting > 1` 就等于没测
 * （本仓渲染层零 DOM 测试），所以照 `bridgeAskDecision` 的规矩放进纯函数。
 */
describe('canSilenceRestBridgeAsks / restBridgeAskCount', () => {
  it('只剩正在答的这一条时不出现（没有"剩下"可言）', () => {
    expect(canSilenceRestBridgeAsks(0)).toBe(false)
    expect(canSilenceRestBridgeAsks(1)).toBe(false)
  })

  it('两条以上才出现，N 不含屏幕上这条', () => {
    expect(canSilenceRestBridgeAsks(2)).toBe(true)
    expect(restBridgeAskCount(2)).toBe(1)
    expect(restBridgeAskCount(8)).toBe(7)
    /** 第 2 轮实测：他真机一次发现 8 个 → 按钮上该写"剩下 7 个" */
    expect(restBridgeAskCount(0)).toBe(0)
  })
})
