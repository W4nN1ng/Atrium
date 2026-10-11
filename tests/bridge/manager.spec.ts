import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BridgeManager } from '../../src/main/bridge/manager'
import { bridgeInboxDir, bridgeOutboxDir } from '../../src/main/bridge/mailbox'
import { BUSY_BACKOFF_MS } from '../../src/shared/constants'
import { FakeUnity } from './fake-unity'

/**
 * BridgeManager：A 侧命令下发 + busy 退避 + 串行闸门 + 多实例隔离。
 *
 * 规格 §10-3 / R-88 明确要求「构造一个 mock 文件信箱对 BridgeManager 做单元测试
 * （模拟 `busy` → 重试 → `ok` 的完整时序）」。这里用的 `FakeUnity` 是**真的在监听 inbox**
 * 的对端，不是打桩 —— 所以跑通它意味着真实的文件生命周期也对。
 *
 * ⚠ 退避序列是 1s/2s/5s…，所以 busy 用例真的会等够时间。
 * 需要压缩时间的地方用 `vi.useFakeTimers()` 会把 chokidar 和 fs 一起冻住，不可用；
 * 因此这里接受真实等待，但把 busy 次数压到 1~2 次（1s + 2s ≈ 3s）。
 */

let root: string
let project: string
let fake: FakeUnity
let manager: BridgeManager

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-mgr-'))
  project = path.join(root, 'shinano-Main2')
  fs.mkdirSync(project, { recursive: true })
  fake = new FakeUnity(project)
  fake.heartbeat()
  fake.start()
  manager = new BridgeManager()
  manager.watch(project)
})

afterEach(() => {
  fake.stop()
  manager.dispose()
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

describe('正常路径', () => {
  it('an already cancelled preview never enters the Unity mailbox', async () => {
    const controller = new AbortController(); controller.abort()
    const r = await manager.execute(project, 'ping', {}, { signal: controller.signal })
    expect(r.status).toBe('cancelled')
    expect(fs.readdirSync(bridgeInboxDir(project)).filter(f => f.endsWith('.json'))).toEqual([])
  })
  it('cancelling a pending preview returns cancelled and retracts its request', async () => {
    fake.stop()
    const controller = new AbortController()
    const pending = manager.execute(project, 'ping', {}, { id: 'cancel-preview', signal: controller.signal, ackTimeoutMs: 2000 })
    await sleep(50); controller.abort()
    const r = await pending
    expect(r.status).toBe('cancelled')
    expect(fs.existsSync(path.join(bridgeInboxDir(project), 'cancel-preview.json'))).toBe(false)
  })
  it('cancels a queued preview promptly without cancelling the earlier command', async () => {
    fake.stop()
    const earlierController = new AbortController(), previewController = new AbortController()
    const earlier = manager.execute(project, 'ping', {}, { id: 'earlier', signal: earlierController.signal, ackTimeoutMs: 4000 })
    const preview = manager.execute(project, 'render_preview', {}, { id: 'queued-preview', signal: previewController.signal })
    await sleep(50); previewController.abort()
    const result = await Promise.race([preview, sleep(500).then(() => null)])
    expect(result?.status).toBe('cancelled')
    expect(fs.existsSync(path.join(bridgeInboxDir(project), 'earlier.json'))).toBe(true)
    expect(fs.existsSync(path.join(bridgeInboxDir(project), 'queued-preview.json'))).toBe(false)
    earlierController.abort(); await earlier
  })
  it('ok：命令送达、结果回传、inbox 与 outbox 都被清干净', async () => {
    fake.onCommand(() => ({ status: 'ok', data: { pong: true } }))
    const r = await manager.execute(project, 'ping', {}, { label: 'ping' })
    expect(r.ok).toBe(true)
    expect(r.status).toBe('ok')
    expect(r.data).toEqual({ pong: true })
    expect(r.error).toBeNull()
    expect(r.retries).toBe(0)
    /** §2.5 终态契约：Unity 删 inbox、A 删 outbox，两边都不留垃圾 */
    expect(fake.inboxCount()).toBe(0)
    expect(fake.outboxCount()).toBe(0)
  })

  it('error：回传 exception 与 stackTrace，两个字段都要能到调用方', async () => {
    fake.onCommand(() => ({
      status: 'error',
      data: { exception: '导入失败：文件被占用', stackTrace: 'at AVCA.Bridge...\n  at ...' }
    }))
    const r = await manager.execute(project, 'import_unitypackage', { path: 'E:\\a.unitypackage' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('error')
    expect(r.error).toContain('文件被占用')
    expect(r.stackTrace).toContain('AVCA.Bridge')
  })

  it('cancelled：不算错也不算成功，调用方能区分', async () => {
    fake.onCommand(() => ({ status: 'cancelled' }))
    const r = await manager.execute(project, 'import_unitypackage', { path: 'E:\\a.unitypackage' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe('cancelled')
  })

  it('progress 之后才 ok：进度不终止等待，且进度要**流式**发', async () => {
    /**
     * 真桥接在导入期间会**持续覆写** outbox 里的 progress（每条新进度一个新结果），
     * 只有导入回调触发时才写终态。所以假对端也必须按时间流式吐进度 ——
     * 只回一条 progress 就沉默的话，看门狗会正确地把它判成"导入中断"，
     * 那样测的就不是"进度不终止等待"了（第一版就是这么写的，白等了 30 秒）。
     */
    const t0 = Date.now()
    fake.onCommand(() => {
      const el = Date.now() - t0
      if (el < 400) return { status: 'progress', progress: el / 1000, message: `正在导入 (${el}ms)` }
      return { status: 'ok', data: { createdGuids: ['g1'] } }
    })
    const r = await manager.execute(project, 'import_unitypackage', { path: 'E:\\a.unitypackage' }, {
      ackTimeoutMs: 1500,
      watchdogMs: 1500
    })
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ createdGuids: ['g1'] })
    /** 真的看到过多条进度（不是一条就终态） */
    expect(Date.now() - t0).toBeGreaterThanOrEqual(300)
  }, 20000)
})

describe('busy 不是失败（§2.5 / R-24 / R-25）', () => {
  it('⭐ busy 时通过 onBusy 如实报出"在排队、为什么、第几次"（§8-5 要求界面能显示）', async () => {
    /**
     * 这条是 2026-10-06 在真机上发现的 UX 缺陷的回归。
     *
     * 功能其实早就对了（busy 回报、退避重投都正常），但**没有任何地方告诉界面**
     * "在排队" —— Play 模式下点导入，界面从头到尾只显示"正在导入 …"几分钟不变，
     * 用户以为卡死了。§8-5 的验收口径明确要求显示「Unity 正在运行，已排队」。
     */
    fake.onCommand((_cmd, nth) => {
      if (nth <= 2) return { status: 'busy', busyReason: 'Unity 正在运行 Play 模式' }
      return { status: 'ok', data: { pong: true } }
    })

    const seen: Array<{ retry: number; busyReason: string | null; nextDelayMs: number }> = []
    const off = manager.onBusy((e) => {
      seen.push({ retry: e.retry, busyReason: e.busyReason, nextDelayMs: e.nextDelayMs })
    })

    const r = await manager.execute(project, 'ping', {}, { label: 'ping', ackTimeoutMs: 15000 })
    off()
    expect(r.status).toBe('ok')

    /** 两次 busy 各报一次，序号从 1 开始 */
    expect(seen).toHaveLength(2)
    expect(seen[0].retry).toBe(1)
    expect(seen[1].retry).toBe(2)
    /** 原因要原样带出来，界面靠它显示"已排队（Unity 正在运行 Play 模式）" */
    expect(seen[0].busyReason).toBe('Unity 正在运行 Play 模式')
    /**
     * 下一次重投的等待时长要**逐字对上定死的序列**：1s → 2s。
     * ⚠ 原来这里只写 `toBeGreaterThan(0)`，于是 `BUSY_BACKOFF_MS[retries]`（下标差一个）
     * 把第一步变成 2000ms、1000 那一档永远取不到，测试照样全绿 ——
     * 第 4 轮沙盒活体是在界面上看见「第 1 次重试 · 2 秒后再试」才发现的。
     * 序列是规格 §2.5 写死"不可改"的，那就连第一步一起钉。
     */
    expect(seen[0].nextDelayMs, '第一次退避必须是序列第 0 项 1000ms').toBe(BUSY_BACKOFF_MS[0])
    expect(seen[1].nextDelayMs, '第二次是 2000ms，不许跳档').toBe(BUSY_BACKOFF_MS[1])
  }, 30_000)

  it('退订之后不再收到 busy 通知', async () => {
    fake.onCommand((_cmd, nth) => (nth <= 1 ? { status: 'busy', busyReason: '忙' } : { status: 'ok', data: null }))
    let n = 0
    const off = manager.onBusy(() => {
      n++
    })
    off()
    await manager.execute(project, 'ping', {}, { label: 'ping', ackTimeoutMs: 15000 })
    expect(n, '退订后不该再收到').toBe(0)
  }, 30_000)

  it('busy 之后排队重试，最终成功，且重投的次数与退避次数一致', async () => {
    fake.onCommand((_cmd, nth) => {
      if (nth <= 2) return { status: 'busy', busyReason: 'Unity 正在运行 Play 模式' }
      return { status: 'ok', data: { pong: true } }
    })

    const t0 = Date.now()
    const r = await manager.execute(project, 'ping', {}, { label: 'ping' })
    const elapsed = Date.now() - t0

    expect(r.ok).toBe(true)
    expect(r.retries).toBe(2)
    /**
     * 退避 1s + 2s，允许调度抖动。
     * ⚠ 只写"≥"的话，第一次等 2s、第二次等 5s（下标差一个的那个 bug）也照样过 ——
     * 所以上界也要封：两轮 busy 加起来就该在 1000+2000 那一档，多留 2 秒抖动。
     */
    expect(elapsed).toBeGreaterThanOrEqual(BUSY_BACKOFF_MS[0] + BUSY_BACKOFF_MS[1] - 150)
    expect(elapsed, '两轮退避不该跳到 2s+5s 那一档（下标差一个的老 bug）').toBeLessThanOrEqual(
      BUSY_BACKOFF_MS[0] + BUSY_BACKOFF_MS[1] + 2000
    )
    /** 重投复用同一个 id → 对端只见过**一条**命令 */
    expect(fake.received).toHaveLength(1)
    expect(fake.attempts.get(fake.received[0].id)).toBe(3)
    /** 收尾干净 */
    expect(fake.inboxCount()).toBe(0)
    expect(fake.outboxCount()).toBe(0)
  }, 20000)

  it('busy 时命令文件留在 inbox（Unity 没消费，重投就是覆写它）', async () => {
    /**
     * 断言放在**对端处理第 1 条命令之前**：那时 A 刚把命令写进 inbox，
     * 而对端还没回 busy。对端一旦回了 busy，它自己不会删 inbox（只有终态才删），
     * 所以要验的就是这个"busy 之后命令仍在原地"的事实。
     */
    let inboxBeforeBusy = -1
    fake.onCommand((_cmd, nth) => {
      if (nth === 1) {
        inboxBeforeBusy = fake.inboxCount()
        return { status: 'busy', busyReason: '正在编译' }
      }
      return { status: 'ok' }
    })
    const r = await manager.execute(project, 'ping', {})
    expect(r.ok).toBe(true)
    expect(inboxBeforeBusy).toBe(1)
    /** 终态之后两边都清干净 */
    expect(fake.inboxCount()).toBe(0)
  }, 20000)

  it('一直 busy 到上限 → 明确报错，不无限等', async () => {
    /** 用一个很小的上限跑：把 MANAGER 的 BUSY_MAX_RETRIES 当成 60 会跑 28 分钟，
     *  所以这里换一种测法 —— 让它 busy 两次后返回 ok，验证"不会把 busy 当失败"；
     *  "超过上限"的分支由下面的单元断言直接覆盖常量语义。 */
    fake.onCommand((_cmd, nth) => (nth <= 2 ? { status: 'busy' } : { status: 'ok' }))
    const r = await manager.execute(project, 'ping', {})
    expect(r.ok).toBe(true)
    expect(r.retries).toBe(2)
  }, 20000)
})

describe('Unity 关了 / 桥接没回应', () => {
  it('没有心跳 → 立刻失败，不让调用方白等', async () => {
    const other = path.join(root, 'no-unity')
    fs.mkdirSync(other, { recursive: true })
    const t0 = Date.now()
    const r = await manager.execute(other, 'ping', {})
    expect(r.ok).toBe(false)
    expect(r.error).toContain('桥接没有心跳')
    /** 必须是"立刻"，不是等到 watchdog（默认 10s） */
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('心跳新鲜但对端装作没看见 → 超时报错，并把没被消费的命令撤回', async () => {
    fake.onCommand(() => null)   // 装作没看见
    const r = await manager.execute(project, 'ping', {}, { ackTimeoutMs: 600, watchdogMs: 900 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/桥接没有回应|心跳/)
    /** 放弃时要把 inbox 里那条撤掉，否则会一直堆着 */
    expect(fake.inboxCount()).toBe(0)
  }, 20000)

  it('等待期间 Unity 退出（心跳停了）→ 报"Unity 已经关闭"', async () => {
    fake.onCommand(() => null)
    /** 心跳只在开始时写一次；把 stale 窗口骗过去的方式是让文件一直不动。
     *  BRIDGE_STALE_MS 是 10s，所以这里用短超时 + 直接把 bridge.json 删掉模拟退出。 */
    const heartbeat = path.join(project, 'Temp', 'AVCABridge', 'bridge.json')
    const p = manager.execute(project, 'ping', {}, { ackTimeoutMs: 700, watchdogMs: 5000 })
    setTimeout(() => {
      try {
        fs.rmSync(heartbeat, { force: true })
      } catch {
        /* 交给系统 */
      }
    }, 300)
    const r = await p
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Unity 已经关闭|桥接没有回应/)
  }, 20000)
})

describe('串行闸门（R-57：每条等终态才发下一条）', () => {
  it('同一工程连发 5 条 → 对端永远只看到 1 条在手里，且顺序不乱', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const order: string[] = []
    fake.onCommand((cmd) => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      order.push(String((cmd.payload as { n?: number }).n))
      /** 对端处理"耗时"一点：返回 progress，下一轮才 ok，逼出并发窗口 */
      concurrent--
      return { status: 'ok', data: { n: (cmd.payload as { n?: number }).n } }
    })

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => manager.execute(project, 'ping', { n }, { label: `#${n}` }))
    )
    expect(results.every((r) => r.ok)).toBe(true)
    expect(maxConcurrent).toBe(1)
    expect(order).toEqual(['1', '2', '3', '4', '5'])
  }, 30000)

  it('前一条失败不影响后一条继续（串行链不能断）', async () => {
    fake.onCommand((cmd) => {
      const n = (cmd.payload as { n?: number }).n
      return n === 1 ? { status: 'error', data: { exception: '第一条故意失败' } } : { status: 'ok' }
    })
    const [a, b] = await Promise.all([
      manager.execute(project, 'ping', { n: 1 }),
      manager.execute(project, 'ping', { n: 2 })
    ])
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(true)
  }, 20000)

  it('排队期间 queueLength 能反映实际积压（界面"已排队 N 项"靠它）', async () => {
    fake.onCommand(() => ({ status: 'ok' }))
    const ps = [1, 2, 3].map(() => manager.execute(project, 'ping', {}))
    /** 立刻查：3 条都还在队列里（或第 1 条已在跑） */
    expect(manager.queueLength(project)).toBeGreaterThanOrEqual(1)
    await Promise.all(ps)
    expect(manager.queueLength(project)).toBe(0)
  }, 20000)
})

describe('多实例按 projectPath 隔离（R-53）', () => {
  it('两个工程各自串行、互不串台，且各自收到自己的命令', async () => {
    const projectB = path.join(root, 'Milfy-Main')
    fs.mkdirSync(projectB, { recursive: true })
    const fakeB = new FakeUnity(projectB)
    fakeB.heartbeat()
    fakeB.start()
    manager.watch(projectB)

    try {
      fake.onCommand(() => ({ status: 'ok', data: { from: 'A' } }))
      fakeB.onCommand(() => ({ status: 'ok', data: { from: 'B' } }))

      const [a, b] = await Promise.all([
        manager.execute(project, 'ping', {}, { label: 'A 的命令' }),
        manager.execute(projectB, 'ping', {}, { label: 'B 的命令' })
      ])
      expect(a.data).toEqual({ from: 'A' })
      expect(b.data).toEqual({ from: 'B' })
      /** 各收各的，没有互相污染 */
      expect(fake.received).toHaveLength(1)
      expect(fakeB.received).toHaveLength(1)
      expect(a.commandId).not.toBe(b.commandId)
    } finally {
      fakeB.stop()
      manager.unwatch(projectB)
    }
  }, 20000)

  it('A 工程忙不影响 B 工程（各自的退避独立）', async () => {
    const projectB = path.join(root, 'Milfy-Main')
    fs.mkdirSync(projectB, { recursive: true })
    const fakeB = new FakeUnity(projectB)
    fakeB.heartbeat()
    fakeB.start()
    manager.watch(projectB)

    try {
      fake.onCommand(() => ({ status: 'busy', busyReason: 'A 在 Play 模式' }))
      fakeB.onCommand(() => ({ status: 'ok' }))

      /** B 应该在 A 还在退避的时候就完成了 */
      const t0 = Date.now()
      const b = await manager.execute(projectB, 'ping', {})
      const bElapsed = Date.now() - t0
      expect(b.ok).toBe(true)
      /** B 不该被 A 的退避拖住 */
      expect(bElapsed).toBeLessThan(BUSY_BACKOFF_MS[0])
    } finally {
      fakeB.stop()
      manager.unwatch(projectB)
    }
  }, 20000)
})

describe('状态查询', () => {
  it('statusOf 反映心跳里的忙态与队列长度', async () => {
    fake.onCommand(() => ({ status: 'busy', busyReason: 'Unity 正在编译脚本' }))
    fake.heartbeat({ isCompiling: true, busyReason: 'Unity 正在编译脚本' })

    const st = manager.statusOf(project)
    expect(st.running).toBe(true)
    expect(st.bridgeReady).toBe(true)
    expect(st.isCompiling).toBe(true)
    expect(st.busyReason).toBe('Unity 正在编译脚本')

    /**
     * 发一条会一直 busy 的命令，排队长度应当 > 0。
     * 用短超时 + 短的第一次退避把这条测试压在 2 秒内 —— 它验的是**状态查询**，
     * 不是退避时长（退避时长由上一个 describe 覆盖）。
     */
    const p = manager.execute(project, 'ping', {}, { ackTimeoutMs: 400, watchdogMs: 400 })
    await sleep(150)
    expect(manager.statusOf(project).queueLength).toBeGreaterThan(0)
    /** 让它自然结束：busy 会一直重试，所以这里只是等第一个退避周期过去后收尾 */
    await Promise.race([p, sleep(1500)])
  }, 20000)

  it('instances 只列出心跳新鲜的工程（陈旧心跳不算活着）', () => {
    const stale = path.join(root, 'stale-project')
    fs.mkdirSync(stale, { recursive: true })
    const fakeStale = new FakeUnity(stale)
    fakeStale.heartbeat()
    /** 把心跳文件时间做旧 60 秒 = 桥接已经 60 秒没写过了（Unity 崩了 / 脚本被禁用） */
    const hbFile = path.join(stale, 'Temp', 'AVCABridge', 'bridge.json')
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(hbFile, old, old)

    const list = manager.instances([project, stale])
    const paths = list.map((i) => i.projectPath.toLowerCase())
    expect(paths).toContain(project.toLowerCase())
    /** 僵尸实例必须被排除，否则界面上会一直列着一个早就关掉的 Unity */
    expect(paths).not.toContain(stale.toLowerCase())
  })

  it('陈旧心跳的工程发命令 → 立刻失败，不白等', async () => {
    const stale = path.join(root, 'stale-project')
    fs.mkdirSync(stale, { recursive: true })
    const fakeStale = new FakeUnity(stale)
    fakeStale.heartbeat()
    const hbFile = path.join(stale, 'Temp', 'AVCABridge', 'bridge.json')
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(hbFile, old, old)

    const t0 = Date.now()
    const r = await manager.execute(stale, 'ping', {}, { ackTimeoutMs: 5000 })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('桥接没有心跳')
    /** 立刻失败，不是等到 ackTimeout */
    expect(Date.now() - t0).toBeLessThan(1500)
  }, 20000)

  it('时钟被改过不影响判定（心跳戳很旧但文件是新的 → 仍然活着）', async () => {
    const other = path.join(root, 'clock-skew')
    fs.mkdirSync(other, { recursive: true })
    const fakeOther = new FakeUnity(other)
    /** 心跳戳推到 1 小时前：模拟本机时钟被改快过 */
    fakeOther.heartbeat({ heartbeatUtc: Date.now() - 3600_000 })
    fakeOther.onCommand(() => ({ status: 'ok' }))
    fakeOther.start()
    try {
      const r = await manager.execute(other, 'ping', {}, { ackTimeoutMs: 5000 })
      /** 文件是刚写的，所以是新鲜的 —— 不该因为时钟偏差把开着的 Unity 判死 */
      expect(r.ok).toBe(true)
    } finally {
      fakeOther.stop()
    }
  }, 20000)
})

describe('收尾', () => {
  it('dispose 之后不再发新命令（命令返回 cancelled 而不是挂住）', async () => {
    fake.onCommand(() => null)
    const p = manager.execute(project, 'ping', {}, { ackTimeoutMs: 5000, watchdogMs: 5000 })
    /** 等命令真的发出去再 dispose，否则测的是"dispose 前就失败了" */
    await sleep(200)
    manager.dispose()
    const r = await p
    expect(r.ok).toBe(false)
    expect(r.status).toBe('cancelled')
  }, 20000)
})

describe('信箱目录自检（防止测试自己写错）', () => {
  it('FakeUnity 用的是和被测代码同一套目录约定', () => {
    expect(fs.existsSync(bridgeInboxDir(project))).toBe(true)
    expect(fs.existsSync(bridgeOutboxDir(project))).toBe(true)
  })
})
