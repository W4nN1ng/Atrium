/**
 * R4 ① · 导入进度队列的**判据**（纯函数，不碰 React、不碰 IPC）。
 *
 * ## 为什么要有这个文件
 *
 * 规格 §8-4 要的是「多选 5 个 → 串行执行 → **进度可见** → 全部成功」，
 * 而 M5-A/M5-B 留下的现状是：主进程每跑完一条就有 `onItem` 这个回调参数
 * （`memberImport.ts:375`），但 `ipc.ts:435` 调它的时候**根本没传**，
 * 于是 `unity:import-progress` 一路只有 Unity 自己那条命令级进度，
 * 渲染层连这个都**没订阅**（只订了 `unity:command-busy`）。
 * 结果就是：一批 8 个包跑两三分钟，界面上只有一行"正在导入 …"不动。
 *
 * 本仓库渲染层零 DOM 测试（vitest 是 `environment:'node'`），所以"第几条该显示什么"
 * 这套判断如果写进 JSX，就只能靠人点。抽成纯函数之后组件是薄壳，判据错了用例会红 ——
 * 和 M6 的 `bannerState.ts` / `backfillState.ts` 是同一条路。
 *
 * ## 三条口径（都是这份文件自己定的，写清楚免得以后被"顺手改掉"）
 *
 * 1. **`queued` 与 `not-run` 是两件事**。串行链在第三条失败时停手（§7-R2 不自动回滚），
 *    剩下那五条**根本没执行** —— 报成"失败"是撒谎，报成"排队中"更像卡死。
 *    `BatchOutcome.notRun` 在主进程那边就是这个数，界面这边必须分得开。
 * 2. **命令级进度只贴到"当前在跑的那一条"上**。`unity:import-progress` 的载荷里只有
 *    `projectPath` + 桥接命令 id，**没有 batchId / relPath** —— 想精确对上就得改
 *    `CommitItemResult` 让它带上命令 id（本轮不做，理由见 `docs/PROMPT-R4-NEXT-ROUND.md` ①）。
 *    所以这里如实写成"贴到最后一条 running 上；一条都没有就不贴"，
 *    而不是假装能对上。**串行 = 同时最多一条 running**，这个近似在串行链里是成立的；
 *    哪天真并发导两个工程，这个函数就是第一个要改的地方。
 * 3. **不许出现"两条同时 running"**。`applyItemResult` 关掉一条之后才会把下一条提上来，
 *    顺序推进；有用例钉着。
 */
import type { ImportItemEvent, PlanView } from './types'

/** 一条在队列里的状态。`not-run` 是"因为前面失败所以根本没跑"，不是失败 */
export type QueueItemStatus = 'queued' | 'running' | 'ok' | 'failed' | 'cancelled' | 'not-run' | 'unknown'

export interface ImportQueueItem {
  /** `batchId:序号` —— 跨批不撞，React 拿它当 key */
  key: string
  batchId: string
  index: number
  /** 给人看的那一条叫什么（成员相对路径 / 文件名） */
  label: string
  sizeBytes: number
  conflictCount: number
  status: QueueItemStatus
  /** Unity 报回来的 0–100；null = 还不知道（**不许拿 0 当"不知道"**） */
  progress: number | null
  /** 主进程只给 key + 参数，中文文案住在 i18n（§i18n 铁律 1） */
  messageKey: string | null
  messageParams: Record<string, unknown> | null
  created: number
  overwritten: number
}

export interface ImportQueue {
  batchId: string | null
  projectName: string | null
  items: ImportQueueItem[]
  /** 整批还在跑 = true。跑完 / 失败停手 / 取消都要置 false */
  running: boolean
  /** 排队中的原因（Play 模式 / 编译中），来自 `unity:command-busy` */
  busyReason: string | null
  busyRetry: number
  busyNextDelayMs: number
}

export const EMPTY_QUEUE: ImportQueue = {
  batchId: null,
  projectName: null,
  items: [],
  running: false,
  busyReason: null,
  busyRetry: 0,
  busyNextDelayMs: 0
}

/** 按下确认之后用 `PlanView` 那批条目铺队列。全 `queued`，还没开始 */
export function queueFromPlan(plan: PlanView, projectName: string | null): ImportQueue {
  return {
    batchId: plan.batchId,
    projectName,
    running: false,
    busyReason: null,
    busyRetry: 0,
    busyNextDelayMs: 0,
    items: plan.items.map((it, i) => ({
      key: `${plan.batchId}:${i}`,
      batchId: plan.batchId,
      index: i,
      label: it.relPath,
      sizeBytes: it.sizeBytes,
      conflictCount: it.conflictCount,
      status: 'queued' as QueueItemStatus,
      progress: null,
      messageKey: null,
      messageParams: null,
      created: 0,
      overwritten: 0
    }))
  }
}

/** 真的开始跑了：置 running，并把**第一条** `queued` 提成 `running` */
export function beginQueue(q: ImportQueue): ImportQueue {
  return { ...q, running: true, items: promoteNext(q.items) }
}

function promoteNext(items: ImportQueueItem[]): ImportQueueItem[] {
  if (items.some((i) => i.status === 'running')) return items
  const at = items.findIndex((i) => i.status === 'queued')
  if (at < 0) return items
  return items.map((i, n) => (n === at ? { ...i, status: 'running' as QueueItemStatus } : i))
}

/** 导入结果的状态 → 队列状态。`blocked`/`skipped` 是"预扫描就没让它进批"，也算没跑 */
function statusOf(s: ImportItemEvent['status']): QueueItemStatus {
  if (s === 'ok') return 'ok'
  if (s === 'cancelled') return 'cancelled'
  if (s === 'skipped' || s === 'blocked') return 'not-run'
  return 'failed'
}

/** 找那条该被更新的：先按序号，再按 relPath（主进程给的序号万一和界面铺的不一致） */
function indexOfEvent(q: ImportQueue, ev: ImportItemEvent): number {
  const byIndex = q.items.findIndex((i) => i.index === ev.index && i.batchId === ev.batchId)
  if (byIndex >= 0) return byIndex
  return q.items.findIndex((i) => i.label === ev.relPath && i.batchId === ev.batchId)
}

/**
 * 一条跑完。
 *
 * ⚠ 序号对不上时**不许静默丢**：主进程切批之后可能先报第 0 条，
 * 而界面这条批的队列里根本没有它（例如用户开了两批）。这里如实返回原队列，
 * 由调用方记一条日志 —— 丢在无声处才是以后查不动的根。
 */
export function applyItemResult(q: ImportQueue, ev: ImportItemEvent): { queue: ImportQueue; matched: boolean } {
  const at = indexOfEvent(q, ev)
  if (at < 0) return { queue: q, matched: false }
  const items = q.items.map((it, i) =>
    i === at
      ? {
          ...it,
          status: statusOf(ev.status),
          progress: ev.ok ? 100 : it.progress,
          messageKey: ev.ok ? null : ev.reasonKey,
          messageParams: ev.reasonParams ?? null,
          created: ev.created,
          overwritten: ev.overwritten
        }
      : it
  )
  /**
   * **只有成功才把下一条提成 running。**
   *
   * 串行链失败即停手（§7-R2 不自动回滚），主进程根本不会给下一条发命令。
   * 无条件顶上来的话，界面会在一条根本没发出去的包上显示"进行中"，
   * 而它真实的下场是"未执行" —— 这正是 `not-run` 这个状态存在的理由。
   */
  const advanced = statusOf(ev.status) === 'ok' ? promoteNext(items) : items
  return { queue: { ...q, items: advanced }, matched: true }
}

/** 命令级进度贴到最后一条 `running` 上（口径 2） */
export function applyCommandProgress(
  q: ImportQueue,
  ev: { progress?: number | null; message?: string | null }
): ImportQueue {
  let at = -1
  for (let i = q.items.length - 1; i >= 0; i--) if (q.items[i].status === 'running') at = i
  if (at < 0) return q
  const pct = typeof ev.progress === 'number' && Number.isFinite(ev.progress) ? Math.max(0, Math.min(100, ev.progress)) : null
  const items = q.items.map((it, i) =>
    i === at ? { ...it, progress: pct ?? it.progress, messageKey: ev.message ? 'library.importMsgRaw' : it.messageKey, messageParams: ev.message ? { msg: ev.message } : it.messageParams } : it
  )
  return { ...q, items }
}

/** Unity 说忙：排队信息是**整批级**的（当前那条在等），所以存队列上而不是某条上 */
export function applyBusy(q: ImportQueue, ev: { busyReason?: string | null; retry?: number; nextDelayMs?: number }): ImportQueue {
  return {
    ...q,
    busyReason: ev.busyReason ?? null,
    busyRetry: Number(ev.retry) || 0,
    busyNextDelayMs: Number(ev.nextDelayMs) || 0
  }
}

/**
 * 整批收尾。
 *
 * `stoppedReasonKey` 非空 = 中途停手（失败即停 / 用户取消），
 * 那时剩下的 `queued` 一律变 `not-run` —— 留着它们，浮层会永远显示"还有 3 个在排队"，
 * 而主进程其实已经不再发命令了。
 *
 * ⚠ 收尾时还挂在 `running` 的那一条**不能**算成 `not-run`：它已经发过命令了，
 * 只是没等到终态事件（事件丢了 / 渲染进程订阅晚了 / 主进程中途死掉）。
 * 说它"没跑"是撒谎 —— 用户会以为工程里还是干净的，而它可能已经进去一半。
 * 所以它单独一种 `unknown`，界面上写"结果未知"，让人去工程里看一眼。
 */
export function endQueue(q: ImportQueue): ImportQueue {
  return {
    ...q,
    running: false,
    busyReason: null,
    busyRetry: 0,
    busyNextDelayMs: 0,
    items: q.items.map((i) =>
      i.status === 'queued'
        ? { ...i, status: 'not-run' as QueueItemStatus }
        : i.status === 'running'
          ? { ...i, status: 'unknown' as QueueItemStatus }
          : i
    )
  }
}

/** 收尾时还能对得上账就用账本说话：`BatchOutcome.results` 才是权威，事件只是直播 */
export interface OutcomeItem {
  relPath: string
  ok: boolean
  status: ImportItemEvent['status']
  reasonKey: string | null
  created: number
  overwritten: number
}

/**
 * 用主进程返回的 `BatchOutcome.results` 校正队列。
 *
 * 为什么需要这一道：进度事件是"直播"，直播可以丢（订阅晚了、窗口刷新了），
 * 但 `importCommit` 的返回值一定完整。收尾时按它重算一遍，
 * 浮层就不会出现"三条还在排队、其实早就导完了"这种对不上账的样子。
 */
export function reconcileFromOutcome(q: ImportQueue, results: OutcomeItem[]): ImportQueue {
  let items = q.items
  for (const r of results) {
    const at = items.findIndex((i) => i.label === r.relPath && i.status !== 'ok' && i.status !== 'failed')
    if (at < 0) continue
    items = items.map((it, i) =>
      i === at
        ? {
            ...it,
            status: statusOf(r.status),
            progress: r.ok ? 100 : it.progress,
            messageKey: r.ok ? null : r.reasonKey,
            created: r.created,
            overwritten: r.overwritten
          }
        : it
    )
  }
  return { ...q, items }
}

export interface QueueSummary {
  total: number
  done: number
  ok: number
  failed: number
  notRun: number
  running: number
  /** 发过命令但没等到终态（见 `endQueue` 的注释）。不许并进 failed，也不许并进 notRun */
  unknown: number
  conflicts: number
}

export function queueSummary(q: ImportQueue): QueueSummary {
  const s: QueueSummary = { total: q.items.length, done: 0, ok: 0, failed: 0, notRun: 0, running: 0, unknown: 0, conflicts: 0 }
  for (const it of q.items) {
    if (it.status === 'ok') {
      s.ok++
      s.done++
    } else if (it.status === 'failed' || it.status === 'cancelled') {
      s.failed++
      s.done++
    } else if (it.status === 'not-run') s.notRun++
    else if (it.status === 'unknown') s.unknown++
    else if (it.status === 'running') s.running++
    if (it.conflictCount > 0) s.conflicts++
  }
  return s
}

// ---------------------------------------------------------------- 渲染态

export interface QueueRow {
  key: string
  label: string
  statusKey: string
  statusParams: Record<string, unknown> | null
  /** 'ok' | 'bad' | 'warn' | 'muted' —— 组件只按它挑颜色，不自己判断状态 */
  tone: 'ok' | 'bad' | 'warn' | 'muted'
  percent: number | null
  noteKey: string | null
  noteParams: Record<string, unknown> | null
}

export interface ImportQueueRenderState {
  show: boolean
  /** 只有一条时不必摆一张表 —— 单包导入的观感应和 M5-A 一样是一行字 */
  single: boolean
  rows: QueueRow[]
  titleKey: string
  titleParams: Record<string, unknown>
  /** 排队那句（有 busyReason 才有）；没有就 null，别画一条空文案 */
  queuedNoteKey: string | null
  queuedNoteParams: Record<string, unknown> | null
}

const STATUS_TEXT: Record<QueueItemStatus, { key: string; tone: QueueRow['tone'] }> = {
  queued: { key: 'library.qQueued', tone: 'muted' },
  running: { key: 'library.qRunning', tone: 'warn' },
  ok: { key: 'library.qOk', tone: 'ok' },
  failed: { key: 'library.qFailed', tone: 'bad' },
  cancelled: { key: 'library.qCancelled', tone: 'bad' },
  'not-run': { key: 'library.qNotRun', tone: 'muted' },
  unknown: { key: 'library.qUnknown', tone: 'warn' }
}

/** 组件要的一切都在这里；`ImportFlow.tsx` 里不该再有一个 `if (status === …)` */
export function importQueueRenderState(q: ImportQueue): ImportQueueRenderState {
  const s = queueSummary(q)
  const rows: QueueRow[] = q.items.map((it) => {
    const t = STATUS_TEXT[it.status]
    return {
      key: it.key,
      label: it.label,
      statusKey: t.key,
      statusParams: it.status === 'ok' ? { created: it.created, overwritten: it.overwritten } : null,
      tone: t.tone,
      percent: it.progress,
      noteKey: it.messageKey,
      noteParams: it.messageParams
    }
  })
  return {
    show: q.items.length > 0 && (q.running || s.done > 0),
    single: q.items.length === 1,
    rows,
    titleKey: q.running ? 'library.queueRunning' : 'library.queueDone',
    titleParams: {
      project: q.projectName ?? '',
      done: s.done,
      total: s.total,
      ok: s.ok,
      failed: s.failed,
      notRun: s.notRun
    },
    queuedNoteKey: q.busyReason ? 'library.queueBusy' : null,
    queuedNoteParams: q.busyReason
      ? { reason: q.busyReason, n: q.busyRetry, s: Math.round(q.busyNextDelayMs / 1000) }
      : null
  }
}
