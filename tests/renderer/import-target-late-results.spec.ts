import { beforeEach, expect, it, vi } from 'vitest'

let api: any
const plan = (batchId: string) => ({ ok: true, batchId, items: [{ relPath: batchId + '.unitypackage', entryCount: 1, fresh: 1, conflicts: [] }], blocked: [] })
const deferred = () => {
  let resolve!: (value: any) => void
  const promise = new Promise<any>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  vi.resetModules()
  api = { packagesOfAsset: vi.fn(async () => ({ kind: 'archive', packages: [], notes: null })),
    importPlan: vi.fn(async () => plan('new')), importAbandon: vi.fn(async () => undefined) }
  ;(globalThis as any).window = { a: { unity: api } }
})
async function ready() {
  const { useUi } = await import('../../src/renderer/stores/ui')
  useUi.setState({ projects: [{ id: 'P1', name: 'Old' }, { id: 'P2', name: 'New' }] as any })
  return useUi
}

it('does not revive a closed member picker or replace its new target with an old member-list response', async () => {
  const ui = await ready(), old = deferred()
  ui.setState({ memberPicker: { ...ui.getState().memberPicker, open: true, assetId: 'old', projectId: 'P1' } })
  api.packagesOfAsset.mockImplementationOnce(() => old.promise)
  const pending = ui.getState().reloadMemberPicker()
  ui.getState().closeMemberPicker()
  ui.setState({ memberPicker: { ...ui.getState().memberPicker, open: true, assetId: 'new', projectId: 'P2' } })
  await ui.getState().reloadMemberPicker()
  old.resolve({ kind: 'archive', packages: [], notes: null }); await pending
  expect(ui.getState().memberPicker).toMatchObject({ assetId: 'new', projectId: 'P2' })
})

it('abandons a late member plan after close and preserves the plan for the new target', async () => {
  const ui = await ready(), old = deferred()
  ui.setState({ memberPicker: { ...ui.getState().memberPicker, open: true, assetId: 'old', projectId: 'P1', picked: ['old.unitypackage'] } })
  api.importPlan.mockImplementationOnce(() => old.promise)
  const pending = ui.getState().runMemberBatches()
  ui.getState().closeMemberPicker()
  ui.setState({ memberPicker: { ...ui.getState().memberPicker, open: true, assetId: 'new', projectId: 'P2', picked: ['new.unitypackage'] } })
  await ui.getState().runMemberBatches()
  old.resolve(plan('old')); await pending
  expect(ui.getState().memberPicker).toMatchObject({ assetId: 'new', projectId: 'P2', plan: { batchId: 'new' }, queue: [] })
  expect(api.importAbandon).toHaveBeenCalledWith('old')
})

it('abandons a late multi-card plan after close instead of attaching it to the new target', async () => {
  const ui = await ready(), old = deferred()
  const item = (assetId: string) => [{ assetId, relPath: assetId + '.unitypackage', label: assetId }]
  ui.setState({ batchImport: { ...ui.getState().batchImport, open: true, projectId: 'P1', queue: [item('old')] } })
  api.importPlan.mockImplementationOnce(() => old.promise)
  const pending = ui.getState().nextBatch()
  ui.getState().closeBatchImport()
  ui.setState({ batchImport: { ...ui.getState().batchImport, open: true, projectId: 'P2', queue: [item('new')] } })
  await ui.getState().nextBatch()
  old.resolve(plan('old')); await pending
  expect(ui.getState().batchImport).toMatchObject({ projectId: 'P2', plan: { batchId: 'new' }, queue: [] })
  expect(api.importAbandon).toHaveBeenCalledWith('old')
})

it('does not reload a member list while its import plan is being prepared', async () => {
  const ui = await ready(), pendingPlan = deferred()
  ui.setState({ memberPicker: { ...ui.getState().memberPicker, open: true, assetId: 'old', projectId: 'P1', picked: ['old.unitypackage'] } })
  api.importPlan.mockImplementationOnce(() => pendingPlan.promise)
  const pending = ui.getState().runMemberBatches()
  await ui.getState().reloadMemberPicker()
  expect(api.packagesOfAsset).not.toHaveBeenCalled()
  pendingPlan.resolve(plan('current')); await pending
  expect(ui.getState().memberPicker).toMatchObject({ plan: { batchId: 'current' }, running: false })
})

it('waits for the member list to finish loading before starting its import plan', async () => {
  const ui = await ready()
  ui.setState({ memberPicker: { ...ui.getState().memberPicker, open: true, assetId: 'old', projectId: 'P1', loading: true, picked: ['old.unitypackage'] } })
  await ui.getState().runMemberBatches()
  expect(api.importPlan).not.toHaveBeenCalled()
})
