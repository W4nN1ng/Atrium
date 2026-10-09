/**
 * 只做一件事：限制并发数，多出来的排队。
 *
 * 为什么不直接用 p-queue（原本在这里就是它）：它 6.6.2 的 CJS 产物是
 * `exports.default = PQueue` 且没打 `__esModule` 标记，electron-vite 打主进程时
 * interop 拿到的就是命名空间对象，启动即炸：
 *   UnhandledPromiseRejectionWarning: TypeError: PQueue is not a constructor
 * （2026-10-04 实测；升级 v7 是 ESM-only，主进程更不合适。这里只需要并发闸门，
 *   优先级/超时/重试一个都没用到，自己写反而没有依赖形态的坑。）
 *
 * 语义：add() 立刻返回 promise；promise 在任务真正跑完后 resolve/reject。
 * 调用方若不想处理 rejection，请自己 .catch()（api.ts 里的 schedule() 就是这么做的）。
 */
export class TaskQueue {
  private readonly limit: number
  private readonly waiting: Array<() => void> = []
  private active = 0

  constructor(opts: { concurrency: number }) {
    this.limit = Math.max(1, Math.floor(opts.concurrency) || 1)
  }

  get concurrency(): number {
    return this.limit
  }

  /** 正在跑的任务数 */
  get running(): number {
    return this.active
  }

  /** 排队中、还没拿到执行权任务数 */
  get pending(): number {
    return this.waiting.length
  }

  add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        this.active++
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.active--
            const next = this.waiting.shift()
            if (next) next()
          })
      }
      if (this.active < this.limit) run()
      else this.waiting.push(run)
    })
  }

  /** 丢弃排队中的任务（正在跑的不动）；返回被丢掉的数量 */
  clearPending(): number {
    const n = this.waiting.length
    this.waiting.length = 0
    return n
  }
}
