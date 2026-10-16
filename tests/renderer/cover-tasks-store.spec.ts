import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoverTask, CoverTaskChoices } from '../../src/shared/coverTasks'

function task(id = 'task-1', patch: Partial<CoverTask> = {}): CoverTask {
  return { id, running: true, cancelled: false, canUndo: false, updatedAt: 1,
    items: [{ assetId: 'a', name: 'First outfit', state: 'running', reason: null }], ...patch }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const reviewTask = () => task('task-1', { running: false, items: [
  { assetId: 'a', name: 'First outfit', state: 'review', reason: 'covers.reviewRequired' },
  { assetId: 'b', name: 'Second outfit', state: 'review', reason: 'covers.reviewRequired' }
] })
const choices = (name = 'First'): CoverTaskChoices => ({ total: 12, truncated: false,
  choices: Array.from({ length: 8 }, (_, i) => ({ target: { id: 'target-' + i, name, path: 'Assets/' + name + '.prefab',
    persistent: true, isScene: false, sourceGuid: null, memberPaths: [] },
    preview: { id: 'preview-' + i, url: 'data:image/png;base64,fixture', width: 640, height: 480, rendererCount: 1 }, error: null })) })

let api: {
  startTask: ReturnType<typeof vi.fn>; taskStatus: ReturnType<typeof vi.fn>; taskChoices: ReturnType<typeof vi.fn>
  applyTaskChoice: ReturnType<typeof vi.fn>; retryTask: ReturnType<typeof vi.fn>; cancelTask: ReturnType<typeof vi.fn>
  undoTask: ReturnType<typeof vi.fn>
}
beforeEach(() => {
  vi.resetModules()
  api = { startTask: vi.fn(async () => task()), taskStatus: vi.fn(async () => task()),
    taskChoices: vi.fn(async () => choices()), applyTaskChoice: vi.fn(async () => reviewTask()),
    retryTask: vi.fn(async () => task()), cancelTask: vi.fn(async () => undefined),
    undoTask: vi.fn(async () => ({ restored: 1, preserved: 2 })) }
  vi.stubGlobal('window', { a: { covers: api } })
})
async function store() { return (await import('../../src/renderer/stores/coverTasks')).useCoverTasks }

describe('global cover task state', () => {
  it('starts all immediately, captures scope and prevents repeated clicks while starting or running', async () => {
    const pending = deferred<CoverTask>(); api.startTask.mockReturnValue(pending.promise)
    const s = await store(); const first = s.getState().start({ scope: 'all' })
    await s.getState().start({ scope: 'ids', assetIds: ['a'] })
    expect(s.getState().open).toBe(false); expect(s.getState().starting).toBe(true)
    expect(api.startTask.mock.calls).toEqual([[{ scope: 'all' }]])
    pending.resolve(task()); await first
    await s.getState().start({ scope: 'all' })
    expect(api.startTask).toHaveBeenCalledTimes(1); expect(s.getState().task?.running).toBe(true)
  })

  it('hides without cancellation and accepts a delayed start without reopening the panel', async () => {
    const pending = deferred<CoverTask>(); api.startTask.mockReturnValue(pending.promise)
    const s = await store(); const first = s.getState().start({ scope: 'all' })
    await s.getState().show(); s.getState().hide(); pending.resolve(task()); await first
    expect(s.getState().open).toBe(false); expect(s.getState().task?.id).toBe('task-1')
    expect(api.cancelTask).not.toHaveBeenCalled()
    await s.getState().show(); expect(s.getState().open).toBe(true)
  })

  it('builds a filtered request from the active filter, independent of loaded page cards', async () => {
    const { currentCoverTaskFilter } = await import('../../src/renderer/stores/coverTasks')
    expect(currentCoverTaskFilter({ nav: 'col:wardrobe', search: 'silver', view: 'flat' })).toEqual({
      collectionId: 'wardrobe', search: 'silver', view: 'flat' })
    expect(currentCoverTaskFilter({ nav: 'review', search: '', view: 'grouped' })).toEqual({ reviewOnly: true, view: 'grouped' })
    expect(currentCoverTaskFilter({ nav: 'cat:clothing', search: '', view: 'grouped' })).toEqual({ category: 'clothing', view: 'grouped' })
  })

  it('restores the main-process task without forcing a panel or loading candidate images', async () => {
    api.taskStatus.mockResolvedValue(reviewTask()); const s = await store(); await s.getState().refresh()
    expect(s.getState().task?.items[0].state).toBe('review'); expect(s.getState().open).toBe(false)
    expect(api.taskChoices).not.toHaveBeenCalled()
  })

  it('opening results loads the first review automatically and keeps the choices lock across hide/reopen', async () => {
    api.startTask.mockResolvedValue(reviewTask()); const pending = deferred<CoverTaskChoices>()
    api.taskChoices.mockReturnValueOnce(pending.promise)
    const s = await store(); await s.getState().start({ scope: 'all' })
    const old = s.getState().show()
    expect(api.taskChoices.mock.calls).toEqual([['task-1', 'a', 0]])
    await s.getState().selectReview('b'); await s.getState().start({ scope: 'all' })
    s.getState().hide(); await s.getState().show(); await s.getState().selectReview('b')
    expect(s.getState().choicesLoading).toBe(true); expect(api.taskChoices).toHaveBeenCalledTimes(1)
    expect(api.startTask).toHaveBeenCalledTimes(1); expect(s.getState().choices).toBeNull()
    pending.resolve(choices('Old')); await old
    await vi.waitFor(() => expect(s.getState().choices?.choices[0].target.name).toBe('First'))
    expect(s.getState().reviewAssetId).toBe('a'); expect(api.taskChoices).toHaveBeenCalledTimes(2)
    expect(s.getState().choicesOffset).toBe(0)
    await s.getState().selectReview('a', 8)
    expect(api.taskChoices.mock.calls.at(-1)).toEqual(['task-1', 'a', 8])
  })

  it('clicking a candidate saves once, clears old previews, and advances to the next review item', async () => {
    api.startTask.mockResolvedValue(reviewTask()); const pending = deferred<CoverTask>()
    api.applyTaskChoice.mockReturnValue(pending.promise)
    const s = await store(); await s.getState().start({ scope: 'all' }); await s.getState().show()
    const save = s.getState().applyChoice('target-0'); await s.getState().applyChoice('target-1')
    expect(s.getState().applying).toBe(true); expect(api.applyTaskChoice.mock.calls).toEqual([['task-1', 'a', 'target-0']])
    pending.resolve({ ...reviewTask(), canUndo: true, updatedAt: 2, items: [
      { assetId: 'a', name: 'First outfit', state: 'done', reason: null }, reviewTask().items[1] ] }); await save
    expect(s.getState().task?.items[0].state).toBe('done'); expect(s.getState().reviewAssetId).toBe('b')
    expect(api.taskChoices.mock.calls.at(-1)).toEqual(['task-1', 'b', 0]); expect(s.getState().applying).toBe(false)
  })

  it('does not let a stale polling response replace an applied choice', async () => {
    api.startTask.mockResolvedValue(reviewTask()); const pending = deferred<CoverTask>()
    const s = await store(); await s.getState().start({ scope: 'all' }); await s.getState().show()
    api.taskStatus.mockReturnValue(pending.promise); const poll = s.getState().refresh()
    api.applyTaskChoice.mockResolvedValue(task('task-1', { running: false, updatedAt: 2, canUndo: true,
      items: [{ assetId: 'a', name: 'First outfit', state: 'done', reason: null }] }))
    await s.getState().applyChoice('target-0'); pending.resolve(reviewTask()); await poll
    expect(s.getState().task?.items[0].state).toBe('done'); expect(s.getState().choices).toBeNull()
  })

  it('rejects a late failure from a previous task without erasing a newer task or showing its error', async () => {
    const pending = deferred<CoverTask | null>(); api.taskStatus.mockReturnValueOnce(pending.promise)
    const s = await store(); const old = s.getState().refresh()
    api.startTask.mockResolvedValue(task('new-task')); await s.getState().start({ scope: 'all' })
    pending.reject(Error('covers.sourceChanged')); await old
    expect(s.getState().task?.id).toBe('new-task'); expect(s.getState().error).toBeNull()
  })

  it('explicit stop cancels once and refreshes cancelled state while preserving the panel', async () => {
    const s = await store(); await s.getState().start({ scope: 'all' })
    const pending = deferred<void>(); api.cancelTask.mockReturnValue(pending.promise)
    const stop = s.getState().stop(); await s.getState().stop()
    api.taskStatus.mockResolvedValue(task('task-1', { running: false, cancelled: true, updatedAt: 2 }))
    pending.resolve(); await stop
    expect(api.cancelTask.mock.calls).toEqual([['task-1']]); expect(s.getState().task?.cancelled).toBe(true)
    expect(s.getState().open).toBe(false)
  })

  it('can stop a pending candidate page while all other task actions stay locked', async () => {
    api.startTask.mockResolvedValue(reviewTask()); const pending = deferred<CoverTaskChoices>()
    api.taskChoices.mockReturnValue(pending.promise)
    const s = await store(); await s.getState().start({ scope: 'all' }); const page = s.getState().show()
    api.taskStatus.mockResolvedValue(task('task-1', { running: false, cancelled: true, updatedAt: 3, items: [
      { assetId: 'a', name: 'First outfit', state: 'cancelled', reason: 'covers.cancelled' }] }))
    await s.getState().stop(); pending.resolve(choices('Late')); await page
    expect(api.cancelTask.mock.calls).toEqual([['task-1']]); expect(s.getState().task?.cancelled).toBe(true)
    expect(s.getState().choices).toBeNull(); expect(s.getState().choicesLoading).toBe(false)
  })

  it('stop remains available during saving and ignores the late apply response', async () => {
    api.startTask.mockResolvedValue(reviewTask()); const pending = deferred<CoverTask>()
    api.applyTaskChoice.mockReturnValue(pending.promise)
    const s = await store(); await s.getState().start({ scope: 'all' }); await s.getState().show()
    const save = s.getState().applyChoice('target-0')
    api.taskStatus.mockResolvedValue(task('task-1', { running: false, cancelled: true, updatedAt: 3, items: [
      { assetId: 'a', name: 'First outfit', state: 'cancelled', reason: 'covers.cancelled' }] }))
    await s.getState().stop()
    pending.resolve(task('task-1', { running: false, updatedAt: 2, items: [
      { assetId: 'a', name: 'First outfit', state: 'done', reason: null }] })); await save
    expect(api.cancelTask.mock.calls).toEqual([['task-1']]); expect(s.getState().task?.items[0].state).toBe('cancelled')
    expect(s.getState().error).toBeNull(); expect(s.getState().applying).toBe(false)
  })

  it('retry and undo are locked against duplicates and preserve the protected count', async () => {
    api.startTask.mockResolvedValue(task('task-1', { running: false, canUndo: true, items: [
      { assetId: 'a', name: 'First outfit', state: 'failed', reason: 'covers.renderFailed' }] }))
    const s = await store(); await s.getState().start({ scope: 'all' })
    const pending = deferred<CoverTask>(); api.retryTask.mockReturnValue(pending.promise)
    const retry = s.getState().retry(); await s.getState().retry(); await s.getState().undo()
    expect(api.retryTask.mock.calls).toEqual([['task-1']]); expect(api.undoTask).not.toHaveBeenCalled()
    pending.resolve(task('task-1', { running: false, canUndo: true, updatedAt: 2 })); await retry
    const undoPending = deferred<{ restored: number; preserved: number }>(); api.undoTask.mockReturnValue(undoPending.promise)
    const undo = s.getState().undo(); await s.getState().undo()
    expect(api.undoTask).toHaveBeenCalledTimes(1)
    api.taskStatus.mockResolvedValue(task('task-1', { running: false, canUndo: false, updatedAt: 3 }))
    undoPending.resolve({ restored: 1, preserved: 2 }); await undo
    expect(s.getState().undoResult).toEqual({ restored: 1, preserved: 2 }); expect(s.getState().task?.canUndo).toBe(false)
  })

  it('clears busy and exposes localized failure keys with retryable candidate errors', async () => {
    api.startTask.mockRejectedValueOnce(Error('untranslated technical failure')); const s = await store()
    await s.getState().start({ scope: 'all' })
    expect(s.getState().starting).toBe(false); expect(s.getState().error?.key).toBe('coverTasks.requestFailed')
    api.startTask.mockResolvedValue(reviewTask()); await s.getState().start({ scope: 'all' })
    api.taskChoices.mockRejectedValueOnce(Error('covers.missingShader')); await s.getState().show()
    expect(s.getState().choicesLoading).toBe(false); expect(s.getState().choicesError?.key).toBe('covers.missingShader')
    await s.getState().selectReview('a'); expect(s.getState().choices?.choices).toHaveLength(8)
  })
})
