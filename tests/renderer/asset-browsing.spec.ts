import { beforeEach, expect, it, vi } from 'vitest'

let api: any
function deferred() {
  let resolve!: (value: any) => void
  let reject!: (error: Error) => void
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const cards = (start: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: 'asset-' + (start + i) }))
beforeEach(() => {
  vi.resetModules()
  api = { list: vi.fn(async () => ({ cards: [], total: 0 })), detail: vi.fn(async (id) => ({ asset: { id } })) }
  ;(globalThis as any).window = { a: { assets: api } }
})
async function store() {
  const { useUi } = await import('../../src/renderer/stores/ui')
  useUi.setState({ nav: 'all' })
  return useUi
}

it('clears the previous detail immediately while the selected asset loads', async () => {
  const ui = await store(), next = deferred()
  await ui.getState().openDetail('A')
  api.detail.mockReturnValueOnce(next.promise)
  const pending = ui.getState().openDetail('B')
  expect(ui.getState()).toMatchObject({ detailId: 'B', detail: null })
  next.resolve({ asset: { id: 'B' } }); await pending
  expect(ui.getState().detail?.asset.id).toBe('B')
})

it('ignores old detail replies, including an earlier request for the same asset', async () => {
  const ui = await store(), old = deferred()
  api.detail.mockReturnValueOnce(old.promise)
  const pending = ui.getState().openDetail('A')
  await ui.getState().openDetail('B')
  api.detail.mockResolvedValueOnce({ asset: { id: 'A', name: 'fresh' } })
  await ui.getState().openDetail('A')
  old.resolve({ asset: { id: 'A', name: 'stale' } }); await pending
  expect(ui.getState().detail?.asset.name).toBe('fresh')
})

it('does not revive a detail after it is closed or the page changes', async () => {
  const ui = await store(), old = deferred()
  api.detail.mockReturnValueOnce(old.promise)
  const pending = ui.getState().openDetail('A')
  ui.getState().setNav('cat:clothing')
  old.resolve({ asset: { id: 'A' } }); await pending
  expect(ui.getState()).toMatchObject({ detailId: null, detail: null })
})

it('loads items after the first 400 and stops when the total is reached', async () => {
  const ui = await store()
  api.list.mockResolvedValueOnce({ cards: cards(0, 400), total: 408 })
  api.list.mockResolvedValueOnce({ cards: cards(400, 8), total: 408 })
  await ui.getState().refreshList(); await ui.getState().loadMore()
  expect(api.list.mock.calls[1][0]).toMatchObject({ offset: 400, limit: 400 })
  expect(ui.getState().cards).toHaveLength(408)
  await ui.getState().loadMore()
  expect(api.list).toHaveBeenCalledTimes(2)
})

it('does not send concurrent next-page requests and permits retry after failure', async () => {
  const ui = await store(), next = deferred()
  api.list.mockResolvedValueOnce({ cards: cards(0, 400), total: 408 })
  await ui.getState().refreshList()
  api.list.mockReturnValueOnce(next.promise)
  const pending = ui.getState().loadMore(); await ui.getState().loadMore()
  expect(api.list).toHaveBeenCalledTimes(2)
  next.reject(new Error('read failed')); await pending
  expect(ui.getState().loadingMore).toBe(false)
  expect(ui.getState().cards).toHaveLength(400)
  api.list.mockResolvedValueOnce({ cards: cards(400, 8), total: 408 })
  await ui.getState().loadMore()
  expect(ui.getState().cards).toHaveLength(408)
})

it('refreshes already loaded pages without collapsing the list to the first 400', async () => {
  const ui = await store()
  api.list.mockResolvedValueOnce({ cards: cards(0, 400), total: 408 })
  api.list.mockResolvedValueOnce({ cards: cards(400, 8), total: 408 })
  await ui.getState().refreshList(); await ui.getState().loadMore()
  api.list.mockResolvedValueOnce({ cards: cards(0, 408), total: 408 })
  await ui.getState().refreshList()
  expect(api.list.mock.lastCall[0].limit).toBe(408)
  expect(ui.getState().cards).toHaveLength(408)
})

it('rejects a late page after switching the search and resets pagination', async () => {
  const ui = await store(), next = deferred()
  api.list.mockResolvedValueOnce({ cards: cards(0, 400), total: 408 })
  await ui.getState().refreshList()
  api.list.mockReturnValueOnce(next.promise)
  const pending = ui.getState().loadMore()
  api.list.mockResolvedValueOnce({ cards: [{ id: 'new-result' }], total: 1 })
  ui.getState().setSearch('new')
  await vi.waitFor(() => expect(ui.getState().cards[0]?.id).toBe('new-result'))
  next.resolve({ cards: cards(400, 8), total: 408 }); await pending
  expect(ui.getState().cards.map(c => c.id)).toEqual(['new-result'])
  expect(api.list.mock.lastCall[0].limit).toBe(400)
})

it('ignores an earlier list reply after a newer search has completed', async () => {
  const ui = await store(), old = deferred()
  api.list.mockReturnValueOnce(old.promise)
  const pending = ui.getState().refreshList()
  api.list.mockResolvedValueOnce({ cards: [{ id: 'new-result' }], total: 1 })
  ui.getState().setSearch('new')
  await vi.waitFor(() => expect(ui.getState().cards[0]?.id).toBe('new-result'))
  old.resolve({ cards: [{ id: 'old-result' }], total: 1 }); await pending
  expect(ui.getState().cards.map(c => c.id)).toEqual(['new-result'])
})
