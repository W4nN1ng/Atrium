/**
 * 主进程内部的小事件总线。
 *
 * 为什么要有它：撤销发生在 ipc/assets.ts，而收件箱那 228 张卡片在 ingest 的内存任务表里。
 * 撤销完必须把卡片重新打开（否则"撤销一次全部入库"把库记录删了、收件箱却是空的，
 * 用户等于把素材弄丢了）。但让 ingest 去 import ipc 模块、或反过来，
 * 都会把依赖绕成圈 —— 一个进程内的发布/订阅最省事，也不会有跨进程副作用。
 */
type Handler = (payload: unknown) => void

const handlers = new Map<string, Set<Handler>>()

export function on(event: string, fn: Handler): () => void {
  const set = handlers.get(event) ?? new Set<Handler>()
  set.add(fn)
  handlers.set(event, set)
  return () => set.delete(fn)
}

export function emit(event: string, payload?: unknown): void {
  for (const fn of handlers.get(event) ?? []) {
    try {
      fn(payload)
    } catch {
      /* 订阅者出错不许把主流程带崩 */
    }
  }
}

/** 事件名集中在这儿，免得两边各写一个字符串然后拼错 */
export const EV_UNDONE = 'library:undone'
