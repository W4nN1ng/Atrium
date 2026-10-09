import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  bridgeDirOf,
  bridgeInboxDir,
  bridgeOutboxDir,
  writeJsonAtomic
} from '../../src/main/bridge/mailbox'
import { BRIDGE_PROTOCOL_VERSION, type BridgeHeartbeat } from '../../src/shared/types'

/**
 * 假 Unity：一个**真的在监听 `inbox/`** 的对端，用来在没有 Unity 的情况下
 * 完整跑通桥接协议的时序（规格 §10-3 / R-88 明确要求构造 mock 文件信箱）。
 *
 * 它严格照 §2.5 的 ack 契约行事：
 *  - 取命令 → 可选先回一条 `busy`（**命令文件留在 inbox**）
 *  - 终态 → 写 `outbox/<id>.json` **并且删掉 `inbox/<id>.json`**
 *
 * 刻意不复用被测代码的写入逻辑以外的东西：结果文件用 `writeJsonAtomic` 写，
 * 和真桥接一样是 tmp+rename，这样"读到半截"这类竞态在测试里也能暴露出来。
 */

export interface FakeCommand {
  id: string
  type: string
  protocolVersion: number
  payload: unknown
}

export type FakeReply = {
  status: 'ok' | 'error' | 'busy' | 'cancelled' | 'progress'
  data?: unknown
  message?: string
  busyReason?: string
  progress?: number
}

/** 收到命令后返回什么。返回 null = **装作没看见**（用于测"桥接没回应"） */
export type FakeHandler = (cmd: FakeCommand, nth: number) => FakeReply | null

export class FakeUnity {
  readonly projectPath: string
  private timer: NodeJS.Timeout | null = null
  private readonly seen = new Set<string>()
  /** 每条命令被处理过几次（测重投用）。按"命令内容变化"计次，不按轮询次数 */
  readonly attempts = new Map<string, number>()
  /** poll 被调了几次（调试用） */
  pollCount = 0
  /** 命令 id → 上次读到的文件指纹，用来判断 A 有没有重投 */
  private readonly lastFingerprint = new Map<string, string>()
  /** 正在推流的进度定时器（模拟导入期间的持续 progress） */
  private readonly streams = new Map<string, NodeJS.Timeout>()
  /** 收到的全部命令，按顺序（测串行用） */
  readonly received: FakeCommand[] = []
  private handler: FakeHandler = () => ({ status: 'ok' })

  constructor(projectPath: string) {
    this.projectPath = projectPath
    fs.mkdirSync(bridgeInboxDir(projectPath), { recursive: true })
    fs.mkdirSync(bridgeOutboxDir(projectPath), { recursive: true })
  }

  onCommand(h: FakeHandler): void {
    this.handler = h
  }

  /** 写一份新鲜心跳，让 A 侧认为桥接活着 */
  heartbeat(over: Partial<BridgeHeartbeat> = {}): void {
    const hb: BridgeHeartbeat = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      pid: 4242,
      projectPath: this.projectPath,
      projectName: path.basename(this.projectPath),
      unityVersion: '2022.3.22f1',
      bridgeVersion: '1.0.0',
      isPlaying: false,
      isCompiling: false,
      isUpdating: false,
      isPlayingOrWillChangePlaymode: false,
      activeScene: null,
      busyReason: null,
      queueLength: 0,
      heartbeatUtc: Date.now(),
      ...over
    }
    writeJsonAtomic(path.join(bridgeDirOf(this.projectPath), 'bridge.json'), hb)
  }

  /** 起轮询。间隔比被测代码的 250ms 还密，避免测试因为对端慢而抖动 */
  start(intervalMs = 40): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      try {
        this.poll()
      } catch (e) {
        /** 定时器回调里抛异常会静默丢掉一整轮，调试时非常难看出来 —— 显式打出来 */
        console.error('[FakeUnity] poll 抛异常：', e)
      }
    }, intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const t of this.streams.values()) clearInterval(t)
    this.streams.clear()
  }

  /**
   * ⚠ 每次处理前先清掉上一次的 outbox 结果、**并且只在 inbox 文件内容真的变了时才当成新命令**。
   *
   * 这两条都是被测试逼出来的，而且都对应真实语义：
   *
   *  1. 不清 outbox 的话对端每轮都会重写同一个文件：`progress` 被反复覆盖永远走不到 `ok`；
   *     终态被 A 消费删除后又会被这里重新写出来 —— 表现是 `outboxCount` 永远不降。
   *
   *  2. **不能按"轮询次数"计次**。真 Unity 是每 500ms Tick 读一次 inbox，读到**同一条**
   *     命令不会重复执行；只有 A 侧退避重投（覆写同一个文件）才算"又一次尝试"。
   *     第一版用轮询次数计次，结果 busy 用例里对端 40ms 就把同一份文件当成 3 次尝试，
   *     第二次就返回 ok —— Busy 退避路径根本没被测到（`retries` 恒为 0）。
   *     所以这里用文件指纹判断"内容变了没有"。
   */
  /**
   * 内容指纹。**必须基于内容本身**（md5），不能用 `size:mtime`：
   * A 侧每次重投都会重建命令对象、`createdAt` 变新，但**字节长度完全一样**；
   * 而重投发生在毫秒级，`mtime` 也可能落在同一毫秒 —— 两个字段都撞车，
   * 于是重投被判成"内容没变"，Busy 退避路径根本没被测到（实测 `retries` 恒为 0）。
   */
  private fingerprintOf(file: string): string | null {
    try {
      return createHash('md5').update(fs.readFileSync(file)).digest('hex')
    } catch {
      return null
    }
  }

  /** 手动跑一轮（需要精确控制时序时用它，不用 start） */
  poll(): void {
    this.pollCount++
    let names: string[]
    try {
      names = fs.readdirSync(bridgeInboxDir(this.projectPath))
    } catch {
      return
    }
    for (const n of names) {
      // §6.6：跳过 .tmp（A 还没写完）
      if (!n.toLowerCase().endsWith('.json')) continue
      const id = n.slice(0, -'.json'.length)
      const abs = path.join(bridgeInboxDir(this.projectPath), n)

      /** 内容没变 = A 没重投 = 真 Unity 不会重新执行。镜像它，不做任何事 */
      const fp = this.fingerprintOf(abs)
      if (fp !== null && this.lastFingerprint.get(id) === fp) continue
      if (fp !== null) this.lastFingerprint.set(id, fp)

      let cmd: FakeCommand
      try {
        cmd = JSON.parse(fs.readFileSync(abs, 'utf8')) as FakeCommand
      } catch {
        continue
      }
      if (!this.seen.has(id)) {
        this.seen.add(id)
        this.received.push(cmd)
      }
      const nth = (this.attempts.get(id) ?? 0) + 1
      this.attempts.set(id, nth)

      /** 清掉上一轮的结果，避免旧 progress/终态一直盖着 */
      try {
        fs.rmSync(path.join(bridgeOutboxDir(this.projectPath), `${id}.json`), { force: true })
      } catch {
        /* 交给系统 */
      }

      const reply = this.handler(cmd, nth)
      if (!reply) continue   // 装作没看见

      this.stopStream(id)
      if (reply.status === 'progress') {
        /**
         * **按时间推流**，而不是等下一次轮询。
         *
         * 真桥接在导入期间是 Unity 主动持续覆写 progress 的，不被轮询驱动；
         * 如果这里只写一条就沉默，A 侧会正确地判定"导入中断"——
         * 那条测试就永远测不到"进度不终止等待"（第一版就是这么白等了 30 秒）。
         */
        this.writeResult(id, reply)
        this.streamInto(id)
        continue
      }

      this.writeResult(id, reply)

      /**
       * §2.5：只有**终态**才删 inbox 里的命令文件。
       * busy 留着 —— 那正是 A 侧"退避重投"能生效的前提。
       */
      if (reply.status === 'ok' || reply.status === 'error' || reply.status === 'cancelled') {
        try {
          fs.rmSync(abs, { force: true })
        } catch {
          /* 交给系统 */
        }
        this.lastFingerprint.delete(id)
      }
    }
  }

  /**
   * 模拟导入中的进度推流：每 120ms 覆写一次 progress，直到 handler 给出终态。
   * 次数上限防止测试写错时无限跑下去。
   */
  private streamInto(id: string): void {
    let seq = 1
    const timer = setInterval(() => {
      seq++
      const next = this.handler(
        { id, type: 'stream', protocolVersion: 1, payload: null },
        seq
      )
      if (!next || next.status !== 'progress') {
        this.stopStream(id)
        if (next) {
          this.writeResult(id, next)
          try {
            fs.rmSync(path.join(bridgeInboxDir(this.projectPath), `${id}.json`), { force: true })
          } catch {
            /* 交给系统 */
          }
          this.lastFingerprint.delete(id)
        }
        return
      }
      this.writeResult(id, next)
      if (seq > 200) this.stopStream(id)
    }, 120)
    this.streams.set(id, timer)
  }

  private stopStream(id: string): void {
    const t = this.streams.get(id)
    if (t) clearInterval(t)
    this.streams.delete(id)
  }

  private writeResult(id: string, reply: FakeReply): void {
    const body: Record<string, unknown> = { id, status: reply.status }
    if (reply.progress !== undefined) body.progress = reply.progress
    if (reply.message) body.message = reply.message
    if (reply.busyReason) body.busyReason = reply.busyReason
    if (reply.data !== undefined) body.data = reply.data
    writeJsonAtomic(path.join(bridgeOutboxDir(this.projectPath), `${id}.json`), body)
  }

  /** 还剩几条没被消费的命令 */
  inboxCount(): number {
    try {
      return fs.readdirSync(bridgeInboxDir(this.projectPath)).filter((n) => n.endsWith('.json')).length
    } catch {
      return 0
    }
  }

  outboxCount(): number {
    try {
      return fs.readdirSync(bridgeOutboxDir(this.projectPath)).filter((n) => n.endsWith('.json')).length
    } catch {
      return 0
    }
  }
}
