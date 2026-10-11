import { watch, type FSWatcher } from 'chokidar'
import log from 'electron-log'
import type { BridgeCommand, BridgeResult, UnityInstance, UnityStatus } from '../../shared/types'
import { BRIDGE_STALE_MS, BUSY_BACKOFF_MS, BUSY_MAX_RETRIES } from '../../shared/constants'
import { ulid } from '../../shared/ulid'
import {
  bridgeOutboxDir,
  cancelCommandFile,
  consumeResult,
  isTerminal,
  readHeartbeat,
  readResult,
  sendCommand
} from './mailbox'

/**
 * 桥接管理器：A 侧与 Unity 之间所有命令的**唯一**出入口。
 *
 * ## 三条硬性纪律（写错就表现为"偶尔成功偶尔失败"）
 *
 * 1. **`busy` 不是失败，必须排队重试**（§2.5 / R-24 / R-25 / R-27）。
 *    退避序列固定 `1s → 2s → 5s → 10s → 30s → 30s → …`，最多 60 次。
 *    用户可能一整晚开着 Play 模式，所以「重试上限很小」是明确禁止的。
 *    重投**复用同一个命令 id**：Unity 忙时压根没消费命令，`inbox/<id>.json` 还在原地，
 *    换新 id 会在 inbox 里堆一串没人认领的副本。
 *
 * 2. **逐条等待终态才发下一条**（R-57）。按 `projectPath` 各持一条 promise 链实现：
 *    第 N+1 条命令的 promise 只有等第 N 条的 resolve 之后才开始发。
 *
 * 3. **所有状态按 `projectPath` 区分，不用全局单例**（R-53）。
 *    两个 Unity 工程同开时，谁排队、谁在导入、各自重试到第几次，必须互不串台。
 *
 * ## 结果等待用"事件 + 轮询"双通道
 *
 * chokidar 盯着 `outbox/`，结果落盘立刻兑现等待者；同时每 250ms 兜一次 `readResult()`，
 * 防 chokidar 漏事件（Windows 上文件监视被编辑器/杀毒软件干扰并不罕见）。
 * 250ms 比 Unity 的 500ms Tick 还密一点，不会拖慢感知。
 *
 * 心跳（`bridge.json`）不在这里轮询 —— 那是 `project/running.ts` 每 3~5 秒的活。
 *
 * ## 为什么命令结果不能只靠 chokidar 就完事
 *
 * 一次等待可能跨几十次 busy 退避（分钟级）。期间必须能及时回答两个问题：
 * 「这个 id 是不是早就了结了」「Unity 是不是已经退出了」。文件事件回答不了第二个问题，
 * 而它恰好是"用户把 Unity 关了"这个最常见场景的判据。
 */

export interface BridgeExecOptions {
  /** 大包导入用更宽的看门狗（默认 60 秒没有新动静就认为丢了） */
  watchdogMs?: number
  /** 从发命令到收到**第一个**结果的额外上限（默认 10 秒）。超时 = 桥接装着但没在跑 */
  ackTimeoutMs?: number
  /** 这条命令是干什么的，进日志与界面文案 */
  label?: string
  /** 复用调用方的 id（重投、以及"同一条导入重试"场景） */
  id?: string
  /** Cancel one request without interrupting another project's work. */
  signal?: AbortSignal
}

export interface BridgeExecResult {
  ok: boolean
  status: BridgeResult['status']
  data: unknown
  error: string | null
  stackTrace: string | null
  /** 从开始到结束一共多久（含退避等待） */
  elapsedMs: number
  /** busy 退避了几次 */
  retries: number
  /** 命令 id，调用方写 import_log 用 */
  commandId: string
}

export interface QueuedCommand {
  id: string
  type: BridgeCommand['type']
  label: string
  enqueuedAt: number
}

/** 一次"Unity 说忙，我在排队等"的通知（见 `onBusy`） */
export interface BusyEvent {
  projectPath: string
  /** 那条被 Unity 拒了的命令 */
  id: string
  type: BridgeCommand['type']
  label: string
  /** Unity 给的原因，例："Unity 正在运行 Play 模式" */
  busyReason: string | null
  /** 这是第几次重试（从 1 开始） */
  retry: number
  /** 下一次重投还要等多久（毫秒） */
  nextDelayMs: number
}

interface ProjectState {
  running: { id: string; type: BridgeCommand['type']; label: string; startedAt: number } | null
  /** 排队中的（界面显示"已排队 N 项"） */
  queue: QueuedCommand[]
  /** 串行闸门：每条命令的 promise 挂在上一条后面 */
  chain: Promise<unknown>
  watcher: FSWatcher | null
}

/** 一个等待者：chokidar 或轮询任一方拿到终态就兑现它 */
interface Waiter {
  resolve: (r: BridgeResult) => void
}

export class BridgeManager {
  private readonly states = new Map<string, ProjectState>()
  /** 命令 id → 等待者。chokidar 收到结果时用它立刻唤醒 `waitForResult` */
  private readonly waiters = new Map<string, Waiter>()
  private listeners = new Set<(projectPath: string, result: BridgeResult) => void>()
  private busyListeners = new Set<(e: BusyEvent) => void>()
  private disposed = false
  /** `dispose()` 时立刻兑现，用来打断正在等待的循环 */
  private disposedPromise: Promise<'disposed'> | null = null
  private resolveDisposed: (() => void) | null = null

  private get disposedSignal(): Promise<'disposed'> {
    if (!this.disposedPromise) {
      this.disposedPromise = new Promise<'disposed'>((resolve) => {
        this.resolveDisposed = () => resolve('disposed')
      })
    }
    return this.disposedPromise
  }

  private stateOf(projectPath: string): ProjectState {
    let s = this.states.get(projectPath)
    if (!s) {
      s = { running: null, queue: [], chain: Promise.resolve(), watcher: null }
      this.states.set(projectPath, s)
    }
    return s
  }

  // ---------------------------------------------------------------- 订阅

  onResult(cb: (projectPath: string, result: BridgeResult) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /**
   * 订阅"命令被 Unity 回了一记 `busy`、正在排队重试"。
   *
   * ## 为什么需要这个（2026-10-06 在真机上发现的 UX 缺陷）
   *
   * 用户进 Play 模式后点导入，界面显示的是 **"正在导入 SLAW.unitypackage"** ——
   * 一直显示，几分钟不变。而实际发生的是：
   *
   * 1. 预扫描要发 `resolve_guids`（§5.1④ 的冲突检测）
   * 2. Unity 在 Play 模式不接命令，回 `busy` + `busyReason: "Unity 正在运行 Play 模式"`
   * 3. A 按 1s→2s→5s→10s→30s 退避重投，**可能持续到用户退出 Play 为止**
   *
   * 问题在于：这整段时间里**没有任何地方告诉用户"在排队、为什么"**。
   * §8-5 的验收口径是「A 显示"Unity 正在运行，已排队"」——
   * 功能是好的（busy 回报、退避重投都对），但**界面没把它说出来**。
   *
   * 所以这个回调把每次 busy 如实广播出去，让界面显示
   * "已排队（Unity 正在运行 Play 模式）· 第 N 次重试"。
   */
  onBusy(cb: (e: BusyEvent) => void): () => void {
    this.busyListeners.add(cb)
    return () => this.busyListeners.delete(cb)
  }

  // ---------------------------------------------------------------- 监视

  /**
   * 开始盯一个工程的 `Temp/AVCABridge/outbox`。
   *
   * `awaitWriteFinish` 是必须的：Unity 也是 tmp+rename 写结果，rename 落地瞬间
   * chokidar 可能先报 `add` 再报 `change`，稳定窗口能把"读到半截/读两次"压掉。
   * `ignoreInitial: true` 让我们只关心**新的**结果。
   */
  watch(projectPath: string): void {
    const s = this.stateOf(projectPath)
    if (s.watcher || this.disposed) return
    try {
      const watcher = watch(bridgeOutboxDir(projectPath), {
        ignoreInitial: true,
        depth: 0,
        awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 }
      })
      watcher.on('add', (p: string) => this.onOutboxFile(projectPath, p))
      watcher.on('change', (p: string) => this.onOutboxFile(projectPath, p))
      watcher.on('error', (e: unknown) => {
        /** 目录可能被 Unity 关掉时清理。不抛。 */
        log.debug(`[bridge] ${projectPath} 的 outbox 监视出错：` + (e instanceof Error ? e.message : String(e)))
      })
      s.watcher = watcher
    } catch (e) {
      log.warn(`[bridge] 起不了 ${projectPath} 的 outbox 监视：` + (e instanceof Error ? e.message : String(e)))
    }
  }

  unwatch(projectPath: string): void {
    const s = this.states.get(projectPath)
    if (!s?.watcher) return
    void s.watcher.close().catch(() => undefined)
    s.watcher = null
  }

  /** 文件事件入口：读结果 → 通知订阅者 → 唤醒等待者 → 终态则消费掉 */
  private onOutboxFile(projectPath: string, file: string): void {
    const base = file.replace(/\\/g, '/').split('/').pop() ?? ''
    if (!base.toLowerCase().endsWith('.json')) return
    const id = base.slice(0, -'.json'.length)
    this.ingestResult(projectPath, id)
  }

  /**
   * 处理一条已经落盘的结果。
   *
   * **终态才删 outbox 文件**（R-23：删除权归读方）；`progress` 留着不动 ——
   * 它马上会被下一条 progress 覆写，提前删掉只会让等待者少看到一次进度。
   */
  private ingestResult(projectPath: string, id: string): BridgeResult | null {
    const result = readResult(projectPath, id)
    if (!result) return null

    for (const cb of this.listeners) {
      try {
        cb(projectPath, result)
      } catch {
        /* 订阅者出错不影响主流程 */
      }
    }

    if (!isTerminal(result.status)) return result

    consumeResult(projectPath, id)
    const waiter = this.waiters.get(id)
    if (waiter) {
      this.waiters.delete(id)
      waiter.resolve(result)
    }
    return result
  }

  // ---------------------------------------------------------------- 状态查询

  /**
   * 某个工程的桥接状态。**读心跳 + 本轮内存队列**，不做磁盘扫描。
   * `bridgeReady` 的口径是"心跳新鲜且协议对得上"——也就是"能马上发命令"。
   */
  statusOf(projectPath: string): UnityStatus & { queue: QueuedCommand[] } {
    const s = this.stateOf(projectPath)
    const probe = readHeartbeat(projectPath)
    const fresh = !!probe.heartbeat && !probe.invalid && Date.now() - probe.seenAt <= BRIDGE_STALE_MS
    const hb = probe.heartbeat
    return {
      running: fresh,
      bridgeReady: fresh,
      isPlaying: hb?.isPlaying ?? false,
      isCompiling: hb?.isCompiling ?? false,
      isUpdating: hb?.isUpdating ?? false,
      queueLength: s.queue.length + (s.running ? 1 : 0),
      busyReason: hb?.busyReason ?? null,
      queue: s.queue.slice()
    }
  }

  /**
   * 最近还活着的心跳实例（多开时会有多个）。只读，不扫盘 ——
   * 工程的**发现**在 `project/api.ts`，这里只回答"桥接在哪些工程里活着"。
   */
  instances(projectPaths: string[]): UnityInstance[] {
    const now = Date.now()
    const out: UnityInstance[] = []
    for (const p of projectPaths) {
      const probe = readHeartbeat(p)
      const hb = probe.heartbeat
      if (!hb || probe.invalid) continue
      if (now - probe.seenAt > BRIDGE_STALE_MS) continue
      out.push({
        projectPath: p.replace(/\//g, '\\'),
        projectId: '',
        pid: hb.pid,
        heartbeat: hb,
        seenAt: probe.seenAt
      })
    }
    return out
  }

  /** 同一工程是否还有没跑完的东西（界面"已排队 N 项"） */
  queueLength(projectPath: string): number {
    const s = this.stateOf(projectPath)
    return s.queue.length + (s.running ? 1 : 0)
  }

  // ---------------------------------------------------------------- 发命令

  /**
   * 发一条命令并等终态。**同一个工程串行**：调用会排在上一条后面。
   *
   * 刻意返回"永远 resolve 的 BridgeExecResult"而不是抛异常：失败信息（栈、busy 超时、
   * Unity 关了）都是要落进 `import_log` 并展示给用户的数据，用异常传递会让每个调用点
   * 都得套一层 try/catch 才能记账。
   */
  execute(
    projectPath: string,
    type: BridgeCommand['type'],
    payload: unknown,
    opts: BridgeExecOptions = {}
  ): Promise<BridgeExecResult> {
    const s = this.stateOf(projectPath)
    const id = opts.id ?? ulid()
    const label = opts.label ?? type
    if (this.disposed || opts.signal?.aborted) return Promise.resolve(this.fail(id, 'cancelled', 'covers.cancelled', Date.now(), 0))
    s.queue.push({ id, type, label, enqueuedAt: Date.now() })

    const run = async (): Promise<BridgeExecResult> => {
      const idx = s.queue.findIndex((q) => q.id === id)
      if (idx >= 0) s.queue.splice(idx, 1)
      const startedAt = Date.now()
      s.running = { id, type, label, startedAt }
      try {
        return await this.attemptLoop(projectPath, type, payload, id, label, opts, startedAt)
      } finally {
        s.running = null
      }
    }

    /** 串行闸门：挂在上一条后面，且**无论上一条成功失败都要继续**（失败分支同一个 run） */
    const next = s.chain.then(run, run)
    s.chain = next.catch(() => undefined)
    if (opts.signal) {
      const signal = opts.signal
      return new Promise<BridgeExecResult>((resolve, reject) => {
        const abort = (): void => {
          const index = s.queue.findIndex(item => item.id === id)
          if (index >= 0) s.queue.splice(index, 1)
          cancelCommandFile(projectPath, id)
          resolve(this.fail(id, 'cancelled', 'covers.cancelled', Date.now(), 0))
        }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        void next.then(result => { signal.removeEventListener('abort', abort); resolve(result) }, error => { signal.removeEventListener('abort', abort); reject(error) })
      })
    }
    return next
  }

  private async attemptLoop(
    projectPath: string,
    type: BridgeCommand['type'],
    payload: unknown,
    id: string,
    label: string,
    opts: BridgeExecOptions,
    startedAt: number
  ): Promise<BridgeExecResult> {
    const watchdogMs = opts.watchdogMs ?? 60_000
    const ackTimeoutMs = opts.ackTimeoutMs ?? 10_000
    let retries = 0

    if (this.disposed || opts.signal?.aborted) {
      return this.fail(id, 'cancelled', 'covers.cancelled', startedAt, retries)
    }

    /** 先确认桥接在跑。没心跳就直接失败 —— 不要让调用方白等到超时 */
    if (!this.isFresh(projectPath)) {
      return this.fail(id, 'error', '桥接没有心跳：这个工程没开着 Unity，或者桥接没装', startedAt, retries)
    }

    for (;;) {
      if (this.disposed || opts.signal?.aborted) {
        cancelCommandFile(projectPath, id)
        return this.fail(id, 'cancelled', 'covers.cancelled', startedAt, retries)
      }

      /**
       * 发送前先把手上前一轮的结果**清干净**。
       *
       * 不清就会读到"回声"：上一轮的 `busy` 刚被我们处理完、文件还在原地，
       * 重投之后第一次 `readResult` 立刻又读到它 —— 于是重试次数凭空多算一次，
       * 而且可能在真结果到达前就提前收工（实测 `retries` 报 3 而真值是 2）。
       * 结果文件的生命周期归读方，读掉就该删掉。
       */
      consumeResult(projectPath, id)
      /** 重投复用同一个 id（幂等覆写 inbox/<id>.json） */
      try {
        sendCommand(projectPath, type, payload, { id })
      } catch (e) {
        return this.fail(
          id,
          'error',
          '写不进命令文件（Temp 可能被清理、或被杀毒软件锁住）：' +
            (e instanceof Error ? e.message : String(e)),
          startedAt,
          retries
        )
      }

      const waited = await this.waitForResult(projectPath, id, ackTimeoutMs, watchdogMs, opts.signal)

      /** 被 dispose 打断：这是"取消"，不是"桥接没回应" */
      if (waited.aborted) {
        cancelCommandFile(projectPath, id)
        return this.fail(id, 'cancelled', 'covers.cancelled', startedAt, retries)
      }

      if (waited.result) {
        const r = waited.result
        if (r.status === 'busy') {
          /**
           * **busy 不是失败。** 排队重试，退避序列固定：
           * 第 5 项起恒为 30s（`BUSY_BACKOFF_MS` 最后一个值重复使用）。
           *
           * 注意 `busy` 结果在 `ingestResult` 里已经被消费掉了，
           * 所以下一轮重投时不会读到这条旧 busy。
           */
          retries++
          if (retries > BUSY_MAX_RETRIES) {
            return this.fail(
              id,
              'error',
              `Unity 连续忙了 ${BUSY_MAX_RETRIES} 次都没空（${r.busyReason ?? r.message ?? '原因不明'}）。` +
                'Play 模式可能一直开着 —— 先退出 Play 或关掉 Unity 再试。',
              startedAt,
              retries
            )
          }
          /**
           * ⚠ 下标是 `retries - 1`：`retries` 在上面刚自增过，它是"第几次重试"（从 1 起），
           * 而数组是从 0 数的那份序列。写成 `retries` 会让第一次等 2000ms，
           * **数组第 0 项 1000 永远取不到** —— 规格 §2.5 定死的 "1s→2s→5s→10s→30s" 从第二步开始走。
           * 这一条是第 4 轮沙盒活体抓出来的：界面上写着「第 1 次重试 · 2 秒后再试」，
           * 日志四行也是 [2000,5000,10000,30000]。老用例 `manager.spec.ts:164` 那句
           * "elapsed ≥ 1000+2000-150" 在 7 秒也照样绿，注释写着"退避 1s + 2s"却没人查第一步。
           */
          const delay = BUSY_BACKOFF_MS[Math.min(retries - 1, BUSY_BACKOFF_MS.length - 1)]
          log.info(
            `[bridge] ${label} 排队中（Unity 忙：${r.busyReason ?? '原因不明'}），` +
              `第 ${retries} 次重试，等 ${delay}ms`
          )
          /** 如实报给界面：否则用户只看到"正在导入"几分钟不变，以为卡死了 */
          for (const cb of this.busyListeners) {
            try {
              cb({
                projectPath,
                id,
                type,
                label,
                busyReason: r.busyReason ?? r.message ?? null,
                retry: retries,
                nextDelayMs: delay
              })
            } catch {
              /* 监听方自己出错不该影响桥接主流程 */
            }
          }
          await sleep(delay, opts.signal)
          continue
        }
        /** ok / error / cancelled 都是终态，直接回 */
        return {
          ok: r.status === 'ok',
          status: r.status,
          data: r.data ?? null,
          error: (r.data as { exception?: string } | null)?.exception ?? r.message ?? null,
          stackTrace: (r.data as { stackTrace?: string } | null)?.stackTrace ?? null,
          elapsedMs: Date.now() - startedAt,
          retries,
          commandId: id
        }
      }

      /**
       * 等超时了。三种可能，必须分开处理 —— 混在一起就会给出误导性的报错：
       *  1. Unity 已经关了（心跳停了）→ 明确说"没执行"
       *  2. 收到过 progress 但太久没新动静 → 大包导入卡住了
       *  3. 从没收到任何结果 → 桥接装着但没在跑（被禁用 / 编译失败）
       */
      if (!this.isFresh(projectPath)) {
        cancelCommandFile(projectPath, id)
        return this.fail(id, 'error', 'Unity 已经关闭（心跳停了），这条命令没有执行', startedAt, retries)
      }
      cancelCommandFile(projectPath, id)
      if (waited.everProgressed) {
        return this.fail(
          id,
          'error',
          `导入过程中断了：最后一条进度是「${waited.lastMessage ?? '（无说明）'}」，` +
            `之后 ${Math.round(watchdogMs / 1000)} 秒没有新动静`,
          startedAt,
          retries
        )
      }
      return this.fail(
        id,
        'error',
        `桥接没有回应（等了 ${Math.round((Date.now() - startedAt) / 1000)} 秒）。` +
          '心跳是新鲜的，所以 Unity 应该开着 —— 检查桥接是否被禁用或编译失败。',
        startedAt,
        retries
      )
    }
  }

  private fail(
    commandId: string,
    status: BridgeResult['status'],
    error: string,
    startedAt: number,
    retries: number
  ): BridgeExecResult {
    log.warn(`[bridge] 命令失败（${status}）：${error}`)
    return {
      ok: false,
      status,
      data: null,
      error,
      stackTrace: null,
      elapsedMs: Date.now() - startedAt,
      retries,
      commandId
    }
  }

  /** 心跳新鲜 = 这个工程的桥接能马上干活 */
  private isFresh(projectPath: string): boolean {
    const probe = readHeartbeat(projectPath)
    if (!probe.heartbeat || probe.invalid) return false
    return Date.now() - probe.seenAt <= BRIDGE_STALE_MS
  }

  /**
   * 等一条结果：**chokidar 事件 + 250ms 轮询双通道**，谁先拿到算谁的。
   *
   * 双通道不是多余的保险，两边各管一段：
   *  - chokidar：结果落盘后毫秒级唤醒（正常路径，感觉"立刻"）
   *  - 轮询：兜住 chokidar 漏事件；而且**只有轮询能在等待期间发现"Unity 已经退出"**
   *    —— 文件事件永远不会因为"对方进程死了"而触发，这是双通道存在的根本理由。
   *
   * 超时口径只有一个：`idleDeadline`。每收到一次 `progress` 就把它往后推 `watchdogMs`
   * （大包导入可以很久），从没收到过任何动静时它就是 `ackTimeoutMs`。
   */
  private async waitForResult(
    projectPath: string,
    id: string,
    ackTimeoutMs: number,
    watchdogMs: number,
    signal?: AbortSignal
  ): Promise<{
    result: BridgeResult | null
    everProgressed: boolean
    lastMessage: string | null
    aborted: boolean
  }> {
    let everProgressed = false
    let lastMessage: string | null = null
    let idleDeadline = Date.now() + ackTimeoutMs
    /** 上一次处理过的 progress 指纹，避免同一条进度被反复当成"新动静" */
    let lastProgressFingerprint: string | null = null

    const waiterPromise = new Promise<BridgeResult | null>((resolve) => {
      this.waiters.set(id, { resolve })
    })

    try {
      for (;;) {
        if (this.disposed || signal?.aborted) {
          return { result: null, everProgressed, lastMessage, aborted: true }
        }

        /**
         * 已经落盘但事件还没来（或事件丢了的）结果，这里主动捞一次。
         */
        const direct = readResult(projectPath, id)
        if (direct) {
          if (isTerminal(direct.status) || direct.status === 'busy') {
            /**
             * ⚠ **必须消费掉**（删掉 outbox 文件）。
             *
             * 第一版 busy 分支没删，于是"退避重投"之后 A 立刻又读到自己刚刚处理过的
             * **同一条旧 busy** —— 重试次数会凭空多算一次（实测 `retries` 报了 3 而真值是 2），
             * 更糟的是这个循环会因为旧结果而提前结束。
             * 文件里那条结果的使命已经完成，读方负责清掉它。
             */
            this.ingestResult(projectPath, id)
            return { result: direct, everProgressed, lastMessage, aborted: false }
          }
          /** progress：记下说明，把看门狗往后推（大包导入可以很久） */
          const fp = `${direct.progress ?? ''}|${direct.message ?? ''}`
          if (fp !== lastProgressFingerprint) {
            lastProgressFingerprint = fp
            everProgressed = true
            if (direct.message) lastMessage = direct.message
            idleDeadline = Date.now() + watchdogMs
          }
          consumeResult(projectPath, id)
        }

        if (Date.now() > idleDeadline) {
          return { result: null, everProgressed, lastMessage, aborted: false }
        }

        /**
         * 等 250ms，或等 chokidar 唤醒，或等 dispose —— **三者取先到的那个**。
         *
         * ⚠ 这里**绝对不能**写成上一版那样：
         * ```ts
         * await Promise.race([waiterPromise, this.disposedPromise, sleep(250)])
         * ```
         * 那个 getter 每次迭代都参与竞争，而 `disposedPromise` 在正常情况下永远不 resolve；
         * 三个 promise 混在 `race` 里会让这个循环退化成**微任务空转** ——
         * 实测 `execute` 期间整个事件循环被饿死：400ms 里测试自己的
         * `setInterval` 只 tick 了 1 次（正常 8 次），对端 `FakeUnity` 因此永远拿不到 CPU、
         * 命令永远等不到回应。所以必须让 sleep 是**唯一**的定时器来源。
         *
         * ⚠ 「超时」与「被 dispose 打断」必须能区分：上一版两者都返回 `undefined`，
         * 以至于 `dispose()` 会把命令报成"桥接没有回应"（实测 elapsed 只有 210ms），
         * 而正确答案是 `cancelled`。
         */
        const raced = await this.waitForAny(waiterPromise, signal)
        if (signal?.aborted) return { result: null, everProgressed, lastMessage, aborted: true }
        if (raced.kind === 'value') {
          return { result: raced.value, everProgressed, lastMessage, aborted: false }
        }
        if (raced.kind === 'disposed') {
          return { result: null, everProgressed, lastMessage, aborted: true }
        }
        /** kind === 'timeout'：继续下一轮 */
      }
    } finally {
      this.waiters.delete(id)
    }
  }

  /**
   * 等 chokidar 唤醒、或 250ms 到点、或被 `dispose()` 打断。
   * 三种结果分开回报，调用方才能给出正确的终态（尤其 dispose → cancelled）。
   */
  private waitForAny(
    wakeup: Promise<BridgeResult | null>,
    signal?: AbortSignal
  ): Promise<{ kind: 'value'; value: BridgeResult } | { kind: 'timeout' } | { kind: 'disposed' }> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (
        r: { kind: 'value'; value: BridgeResult } | { kind: 'timeout' } | { kind: 'disposed' }
      ): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(r)
      }
      const onAbort = (): void => finish({ kind: 'disposed' })
      const timer = setTimeout(() => finish({ kind: 'timeout' }), 250)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
      void wakeup.then(
        (v) => {
          if (v) finish({ kind: 'value', value: v })
          else finish({ kind: 'timeout' })
        },
        () => finish({ kind: 'timeout' })
      )
      void this.disposedSignal.then(() => finish({ kind: 'disposed' }))
    })
  }

  dispose(): void {
    this.disposed = true
    /** 先让等着的循环醒过来，再清状态 —— 否则它们会对着空表继续跑 */
    this.resolveDisposed?.()
    /** 清掉 signal 的引用：dispose 过的 manager 不该再被复用，也不该让 promise 一直挂着 */
    this.disposedPromise = null
    this.resolveDisposed = null
    for (const s of this.states.values()) {
      if (s.watcher) void s.watcher.close().catch(() => undefined)
      s.watcher = null
    }
    this.waiters.clear()
    this.listeners.clear()
    this.states.clear()
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) finish()
  })
}
