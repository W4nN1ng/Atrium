import { describe, expect, it } from 'vitest'
import { TaskQueue } from '../../src/main/lib/queue'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('TaskQueue', () => {
  it('never exceeds the concurrency limit', async () => {
    const q = new TaskQueue({ concurrency: 2 })
    let live = 0
    let peak = 0
    const runs = Array.from({ length: 9 }, () =>
      q.add(async () => {
        live++
        peak = Math.max(peak, live)
        await wait(8)
        live--
        return true
      })
    )
    const all = await Promise.all(runs)
    expect(all).toEqual(Array.from({ length: 9 }, () => true))
    expect(peak).toBe(2)
    expect(q.running).toBe(0)
    expect(q.pending).toBe(0)
  })

  it('starts immediately while slots are free and queues the rest', async () => {
    const q = new TaskQueue({ concurrency: 1 })
    let secondStarted = false
    const slow = q.add(async () => {
      await wait(25)
    })
    const later = q.add(async () => {
      secondStarted = true
    })
    expect(q.running).toBe(1)
    expect(q.pending).toBe(1)
    expect(secondStarted).toBe(false)
    await slow
    await later
    expect(secondStarted).toBe(true)
  })

  it('rejects only that task and keeps the slot moving', async () => {
    const q = new TaskQueue({ concurrency: 1 })
    const bad = q.add(async () => {
      throw new Error('boom')
    })
    const good = q.add(async () => 'ok')
    const alsoGood = q.add(async () => 'ok2')
    await expect(bad).rejects.toThrow('boom')
    await expect(good).resolves.toBe('ok')
    await expect(alsoGood).resolves.toBe('ok2')
    expect(q.running).toBe(0)
    expect(q.pending).toBe(0)
  })

  it('clearPending drops the queue but not the running work', async () => {
    const q = new TaskQueue({ concurrency: 1 })
    const running = q.add(async () => {
      await wait(20)
      return 'ran'
    })
    q.add(async () => 'never')
    q.add(async () => 'never either')
    expect(q.clearPending()).toBe(2)
    expect(q.pending).toBe(0)
    await expect(running).resolves.toBe('ran')
  })

  it('normalizes silly concurrency values to at least 1', () => {
    expect(new TaskQueue({ concurrency: 0 }).concurrency).toBe(1)
    expect(new TaskQueue({ concurrency: -3 }).concurrency).toBe(1)
    expect(new TaskQueue({ concurrency: 2.7 }).concurrency).toBe(2)
  })
})
