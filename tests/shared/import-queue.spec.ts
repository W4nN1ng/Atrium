import { describe, it, expect } from 'vitest'
import {
  EMPTY_QUEUE,
  applyBusy,
  applyCommandProgress,
  applyItemResult,
  beginQueue,
  endQueue,
  importQueueRenderState,
  queueFromPlan,
  queueSummary,
  type ImportQueue
} from '../../src/shared/importQueue'
import type { ImportItemEvent, PlanView } from '../../src/shared/types'

/**
 * R4 ① · 导入进度队列的判据。
 *
 * 这一份用例的存在意义不是"函数能跑"，而是钉住三件**症状很具体**的事：
 *  1. 「未执行」不许被算成「失败」—— 串行链第三条挂了，后面五条根本没发命令，
 *     报成失败等于让用户去查没发生的事；
 *  2. 同时只许有一条 `running`（串行是规格硬要求，不是实现巧合）；
 *  3. 进度事件对不上队列时**不许静默丢**（`matched:false` 要能被调用方看见）。
 */

function plan(items: Array<{ relPath: string; conflicts?: number }>, batchId = 'B1'): PlanView {
  return {
    ok: true,
    batchId,
    items: items.map((i) => ({
      relPath: i.relPath,
      sizeBytes: 1024,
      originArchive: null,
      extracted: true,
      entryCount: 3,
      fresh: 3,
      conflictCount: i.conflicts ?? 0,
      conflicts: []
    })),
    blocked: [],
    totalBytes: 1024 * items.length,
    freeBytes: 1 << 30,
    conflictPackages: items.filter((i) => (i.conflicts ?? 0) > 0).length,
    conflictEntries: items.reduce((a, i) => a + (i.conflicts ?? 0), 0),
    batchMax: 8
  }
}

function ev(over: Partial<ImportItemEvent> = {}): ImportItemEvent {
  return {
    batchId: 'B1',
    index: 0,
    relPath: 'a.unitypackage',
    ok: true,
    status: 'ok',
    reasonKey: null,
    created: 4,
    overwritten: 0,
    ...over
  }
}

const started = (): ImportQueue => beginQueue(queueFromPlan(plan([{ relPath: 'a.unitypackage' }, { relPath: 'b.unitypackage' }, { relPath: 'c.unitypackage' }]), 'shinano-Main2'))

describe('铺队列', () => {
  it('条目取自 PlanView.items，不是界面勾的那份（被 blocked 挡掉的不能出现在进度里）', () => {
    const p = plan([{ relPath: 'a' }, { relPath: 'b' }])
    p.blocked = [{ relPath: 'c.zip', reasonKey: 'err.corrupt', detail: null }]
    const q = queueFromPlan(p, null)
    expect(q.items.map((i) => i.label)).toEqual(['a', 'b'])
    expect(q.items.every((i) => i.status === 'queued')).toBe(true)
  })

  it('key 是 batchId:序号 —— 同一批内不撞、跨批也不撞（React 拿它当 key，撞了会串行显示）', () => {
    const keys = queueFromPlan(plan([{ relPath: 'x' }, { relPath: 'x' }], 'B1'), null).items.map((i) => i.key)
    expect(new Set(keys).size).toBe(2)
    expect(queueFromPlan(plan([{ relPath: 'x' }], 'B2'), null).items[0].key).toBe('B2:0')
  })

  it('还没开始的队列不该显示（show=false），也不该有 progress 冒充 0%', () => {
    const q = queueFromPlan(plan([{ relPath: 'a' }]), 'P')
    expect(importQueueRenderState(q).show).toBe(false)
    expect(q.items[0].progress).toBeNull()
    expect(importQueueRenderState(beginQueue(q)).rows[0].percent).toBeNull()
  })
})

describe('串行推进', () => {
  it('开始之后只有第一条是 running（串行是硬要求，不是实现巧合）', () => {
    const q = started()
    expect(q.items.map((i) => i.status)).toEqual(['running', 'queued', 'queued'])
    expect(q.running).toBe(true)
  })

  it('已经有 running 的时候再点一次开始，不许冒出第二条 running', () => {
    /**
     * 这条是 `tools/verify-red-r4.cjs` 的 A3 逼出来的：把 `promoteNext` 里那句
     * "已经有 running 就直接返回"撤掉，原来这几条用例**一条都不红** ——
     * 它们要么只 begin 一次，要么只断言"≤1"。而这条不变量正是串行浮层不串行的根。
     */
    const q = beginQueue(started())
    const running = q.items.filter((x) => x.status === 'running')
    expect(running.length, '两条同时进行中').toBe(1)
    expect(q.items.map((i) => i.status)).toEqual(['running', 'queued', 'queued'])
  })

  it('一条跑完顶下一条，任何时刻最多一条 running', () => {
    let q = started()
    for (const i of [0, 1, 2]) {
      q = applyItemResult(q, ev({ index: i, relPath: q.items[i].label })).queue
      expect(q.items.filter((x) => x.status === 'running').length).toBeLessThanOrEqual(1)
    }
    expect(q.items.map((i) => i.status)).toEqual(['ok', 'ok', 'ok'])
    expect(queueSummary(q)).toMatchObject({ done: 3, ok: 3, failed: 0, notRun: 0 })
  })

  it('成功的条目 percent=100，并把新建/覆盖数带出来（界面那句"新 4 · 覆盖 0"靠它）', () => {
    const q = applyItemResult(started(), ev({ index: 0, created: 4, overwritten: 2 })).queue
    expect(q.items[0].progress).toBe(100)
    const row = importQueueRenderState(q).rows[0]
    expect(row.statusKey).toBe('library.qOk')
    expect(row.statusParams).toEqual({ created: 4, overwritten: 2 })
  })

  it('序号对不上（另一批的事件串进来了）→ matched:false 且队列一个字都不动，不许静默改错条', () => {
    const q0 = started()
    const r = applyItemResult(q0, ev({ batchId: 'OTHER', index: 1, relPath: '不在这批里' }))
    expect(r.matched).toBe(false)
    expect(r.queue).toEqual(q0)
  })

  it('序号对不上但 relPath 认得出时按 relPath 落位（主进程切批后序号会漂）', () => {
    const q = applyItemResult(started(), ev({ index: 99, relPath: 'b.unitypackage' })).queue
    expect(q.items.map((i) => i.status)).toEqual(['running', 'ok', 'queued'])
  })
})

describe('停手与收尾：未执行 ≠ 失败', () => {
  it('第三条挂了 → 停手，剩下的一律 not-run，**不是** failed', () => {
    let q = started()
    q = applyItemResult(q, ev({ index: 0, relPath: 'a.unitypackage' })).queue
    q = applyItemResult(q, ev({ index: 1, relPath: 'b.unitypackage', ok: false, status: 'failed', reasonKey: 'err.importFailed' })).queue
    q = endQueue(q)
    expect(q.items.map((i) => i.status)).toEqual(['ok', 'failed', 'not-run'])
    expect(queueSummary(q)).toMatchObject({ ok: 1, failed: 1, notRun: 1, running: 0 })
    expect(q.running).toBe(false)
  })

  it('endQueue 之后不许再有 running（否则浮层永远显示"还有 3 个在排队"）', () => {
    const q = endQueue(started())
    expect(q.items.some((i) => i.status === 'running' || i.status === 'queued')).toBe(false)
  })

  it('blocked / skipped 都算"没跑"，cancelled 单独一种（三种语义不许糊成两种）', () => {
    const s = (status: ImportItemEvent['status']) => applyItemResult(started(), ev({ status, ok: false })).queue.items[0].status
    expect(s('blocked')).toBe('not-run')
    expect(s('skipped')).toBe('not-run')
    expect(s('cancelled')).toBe('cancelled')
    expect(s('failed')).toBe('failed')
  })

  it('失败那条把 reasonKey 留住（中文文案住在 i18n，主进程不许回传文案）', () => {
    const q = applyItemResult(started(), ev({ ok: false, status: 'failed', reasonKey: 'unity.errNoBridgeHeartbeat' })).queue
    expect(q.items[0].messageKey).toBe('unity.errNoBridgeHeartbeat')
  })
})

describe('命令级进度与排队', () => {
  it('进度只贴到最后一条 running；没有 running 时一个字都不改', () => {
    const q = started()
    expect(applyCommandProgress(q, { progress: 42, message: 'Writing 3/7' }).items[0].progress).toBe(42)
    const done = endQueue(q)
    expect(applyCommandProgress(done, { progress: 99, message: null }).items[0].progress).toBeNull()
  })

  it('progress 越界要夹住（Unity 回过 120 这种数不是没发生过）', () => {
    expect(applyCommandProgress(started(), { progress: 120, message: null }).items[0].progress).toBe(100)
    expect(applyCommandProgress(started(), { progress: -5, message: null }).items[0].progress).toBe(0)
  })

  it('排队信息是整批级的（当前那条在等），落在队列上而不是某条目上', () => {
    const q = applyBusy(started(), { busyReason: 'playing', retry: 3, nextDelayMs: 30000 })
    expect(q.busyReason).toBe('playing')
    expect(q.items[0].messageKey).toBeNull()
    const view = importQueueRenderState(q)
    expect(view.queuedNoteKey).toBe('library.queueBusy')
    expect(view.queuedNoteParams).toMatchObject({ reason: 'playing', n: 3, s: 30 })
  })

  it('没排队时不许凭空画一条"已排队（）"', () => {
    expect(importQueueRenderState(started()).queuedNoteKey).toBeNull()
  })
})

describe('渲染态：组件里不该再有一个状态判断', () => {
  it('只有一条 → single=true（单包导入的观感和 M5-A 一样是一行字，不摆表格）', () => {
    expect(importQueueRenderState(beginQueue(queueFromPlan(plan([{ relPath: 'a' }]), 'P'))).single).toBe(true)
    expect(importQueueRenderState(started()).single).toBe(false)
  })

  it('跑完的队列 show 仍然是 true（结果要留在屏幕上，不能一跑完就消失）', () => {
    let q = started()
    q = applyItemResult(q, ev({ index: 0, relPath: 'a.unitypackage' })).queue
    q = applyItemResult(q, ev({ index: 1, relPath: 'b.unitypackage' })).queue
    q = applyItemResult(q, ev({ index: 2, relPath: 'c.unitypackage' })).queue
    const v = importQueueRenderState(endQueue(q))
    expect(v.show).toBe(true)
    expect(v.titleKey).toBe('library.queueDone')
    expect(v.titleParams).toMatchObject({ ok: 3, total: 3, notRun: 0 })
  })

  it('tone 四种都算得出来（组件只按 tone 挑颜色）', () => {
    let q = started()
    q = applyItemResult(q, ev({ index: 0, relPath: 'a.unitypackage' })).queue
    q = applyItemResult(q, ev({ index: 1, relPath: 'b.unitypackage', ok: false, status: 'failed' })).queue
    const tones = importQueueRenderState(endQueue(q)).rows.map((r) => r.tone)
    expect(tones).toEqual(['ok', 'bad', 'muted'])
  })

  it('空队列什么都不画', () => {
    expect(importQueueRenderState(EMPTY_QUEUE).show).toBe(false)
    expect(importQueueRenderState(EMPTY_QUEUE).rows).toEqual([])
  })
})
