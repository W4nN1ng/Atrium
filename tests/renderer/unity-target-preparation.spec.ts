import { beforeEach, describe, expect, it, vi } from 'vitest'

let api: any
const delay = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)) }
beforeEach(() => {
  api = {
    resolveTarget: vi.fn(async () => ({ kind: 'selected', projectId: 'P1', projectName: 'First' })),
    prepareTarget: vi.fn(async () => ({ projectId: 'P1', projectPath: 'E:/first', name: 'First', phase: 'ready', reasonKey: null, detail: null })),
    cancelTargetPreparation: vi.fn(async () => undefined),
    connection: vi.fn(async () => ({ projects: [], targetProjectId: 'P1', targetMode: 'auto', ambiguous: false })),
    setTarget: vi.fn(async (id: string) => id),
    status: vi.fn(async () => ({ targetProjectId: 'P1', running: true, bridgeReady: true })),
    preflight: vi.fn(async () => ({ ok: true, entryCount: 2, fresh: 2, conflicts: [] })),
    importPackage: vi.fn(async () => ({ ok: false, error: 'fixture stopped' })),
    packagesOfAsset: vi.fn(async () => ({ kind: 'archive', packages: [{ path: null, relPath: 'Dress.unitypackage' }] })),
    importPlan: vi.fn(async () => ({ ok: true, batchId: 'B1', items: [{ relPath: 'Dress.unitypackage', entryCount: 2, fresh: 2, conflicts: [] }], blocked: [] })),
    importCommit: vi.fn(async () => ({ ok: false, reasonKey: 'fixture stopped' }))
  }
  ;(globalThis as any).window = { a: { unity: api } }
  vi.resetModules()
})
async function ready() {
  const { useUi } = await import('../../src/renderer/stores/ui')
  useUi.setState({ settings: { ...useUi.getState().settings, confirmBeforeImport: false },
    projects: [{ id: 'P1', name: 'First', running: true }, { id: 'P2', name: 'Second', running: true }] as any })
  return useUi
}

describe('explicit import prepares and freezes its Unity target', () => {
  it('uses the only running project without requiring a prior manual target', async () => {
    const ui = await ready()
    await ui.getState().importAsset('A1', { packagePath: 'E:/Dress.unitypackage' })
    expect(api.resolveTarget).toHaveBeenCalledOnce()
    expect(api.prepareTarget).toHaveBeenCalledWith('P1', expect.any(String))
    expect(api.preflight).toHaveBeenCalledWith({ packagePath: 'E:/Dress.unitypackage', projectId: 'P1' })
    expect(api.importPackage).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'P1' }))
  })
  it('keeps the request while connecting and discards a late successful preparation after cancellation', async () => {
    let finish!: (value: unknown) => void
    api.prepareTarget.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const ui = await ready(), request = ui.getState().importAsset('A1', { packagePath: 'E:/Dress.unitypackage' })
    await delay()
    expect(api.prepareTarget).toHaveBeenCalledOnce()
    expect(ui.getState().importFlow.busyReason).toBe('connecting')
    ui.getState().cancelImportPreparation()
    finish({ projectId: 'P1', name: 'First', phase: 'ready' })
    await request
    expect(api.cancelTargetPreparation).toHaveBeenCalledOnce()
    expect(api.preflight).not.toHaveBeenCalled()
    expect(api.importPackage).not.toHaveBeenCalled()
    expect(ui.getState().importFlow.busy).toBe(false)
  })
  it('offers one target choice at the import entry and continues the same request', async () => {
    api.resolveTarget.mockResolvedValueOnce({ kind: 'choose', projectIds: ['P1', 'P2'] })
    api.prepareTarget.mockResolvedValue({ projectId: 'P2', name: 'Second', phase: 'ready' })
    const ui = await ready(), request = ui.getState().importAsset('A1', { packagePath: 'E:/Dress.unitypackage' })
    await delay()
    expect(ui.getState().targetPicker).toEqual({ open: true, projectIds: ['P1', 'P2'] })
    expect(api.preflight).not.toHaveBeenCalled()
    await ui.getState().chooseImportTarget('P2'); await request
    expect(api.prepareTarget).toHaveBeenCalledWith('P2', expect.any(String))
    expect(api.preflight).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'P2' }))
    expect(ui.getState().targetPicker.open).toBe(false)
  })
  it('does not parse packages or import when there is no open project', async () => {
    api.resolveTarget.mockResolvedValue({ kind: 'none' })
    const ui = await ready()
    await ui.getState().importAsset('A1')
    expect(api.prepareTarget).not.toHaveBeenCalled(); expect(api.packagesOfAsset).not.toHaveBeenCalled()
  })
  it('ends a failed preparation without silently trying another project', async () => {
    api.prepareTarget.mockRejectedValue(Error('project.connectionClosed'))
    const ui = await ready()
    await ui.getState().importAsset('A1', { packagePath: 'E:/Dress.unitypackage' })
    expect(api.prepareTarget).toHaveBeenCalledOnce(); expect(api.preflight).not.toHaveBeenCalled()
    expect(ui.getState().importFlow.busy).toBe(false)
  })
  it('passes the captured ID even when a different project becomes the global target before preflight completes', async () => {
    const ui = await ready()
    api.preflight.mockImplementation(async () => {
      ui.setState({ unity: { ...ui.getState().unity, targetProjectId: 'P2' } })
      return { ok: true, entryCount: 2, fresh: 2, conflicts: [] }
    })
    await ui.getState().importAsset('A1', { packagePath: 'E:/Dress.unitypackage' })
    expect(api.importPackage).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'P1' }))
  })
  it('captures the project ID for an archive member plan as well as loose packages', async () => {
    const ui = await ready()
    await ui.getState().importAsset('A1')
    expect(api.importPlan).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'P1', assetId: 'A1' }))
  })
  it('cancels target selection without dispatching a stale import', async () => {
    api.resolveTarget.mockResolvedValue({ kind: 'choose', projectIds: ['P1', 'P2'] })
    const ui = await ready(), request = ui.getState().importAsset('A1', { packagePath: 'E:/Dress.unitypackage' })
    await delay(); await ui.getState().chooseImportTarget(null); await request
    expect(api.prepareTarget).not.toHaveBeenCalled(); expect(api.preflight).not.toHaveBeenCalled()
  })
  it('does not replace a newer global target when the original project finishes connecting', async () => {
    const ui = await ready()
    api.prepareTarget.mockImplementation(async () => {
      ui.setState({ unity: { ...ui.getState().unity, targetProjectId: 'P2' } })
      return { projectId: 'P1', name: 'First', phase: 'ready' }
    })
    await ui.getState().importAsset('A1', { packagePath: 'E:/Dress.unitypackage' })
    expect(ui.getState().unity.targetProjectId).toBe('P2')
    expect(api.preflight).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'P1' }))
  })
  it('blocks a competing import while the member picker owns an existing request', async () => {
    const ui = await ready()
    ui.setState({ memberPicker: { ...ui.getState().memberPicker, open: true, assetId: 'old' } })
    await ui.getState().importAsset('A1', { packagePath: 'E:/Dress.unitypackage' })
    expect(api.resolveTarget).not.toHaveBeenCalled(); expect(api.preflight).not.toHaveBeenCalled()
  })
  it('keeps later member batches on the captured project after the global target changes', async () => {
    const ui = await ready()
    const members = Array.from({ length: 9 }, (_, i) => `Item${i}.unitypackage`)
    api.packagesOfAsset.mockResolvedValue({ kind: 'archive', packages: members.map(relPath => ({ path: null, relPath })) })
    await ui.getState().openMemberPicker('A1')
    ui.getState().setMemberPicks(members)
    await ui.getState().runMemberBatches()
    ui.setState({ unity: { ...ui.getState().unity, targetProjectId: 'P2' } })
    await ui.getState().nextMemberBatch()
    expect(api.importPlan).toHaveBeenCalledTimes(2)
    for (const [input] of api.importPlan.mock.calls) expect(input.projectId).toBe('P1')
    expect(api.prepareTarget).toHaveBeenCalledOnce()
  })
  it('keeps later multi-card batches on the captured project after the global target changes', async () => {
    const ui = await ready()
    ui.setState({ selection: Array.from({ length: 9 }, (_, i) => `Asset${i}`) })
    await ui.getState().importSelected()
    ui.setState({ unity: { ...ui.getState().unity, targetProjectId: 'P2' } })
    await ui.getState().nextBatch()
    expect(api.importPlan).toHaveBeenCalledTimes(2)
    for (const [input] of api.importPlan.mock.calls) expect(input.projectId).toBe('P1')
    expect(api.prepareTarget).toHaveBeenCalledOnce()
  })
  it('reserves a multi-card import while packages are being enumerated', async () => {
    let finish!: (value: unknown) => void
    api.packagesOfAsset.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const ui = await ready()
    ui.setState({ selection: ['A1'] })
    const first = ui.getState().importSelected()
    await delay()
    await ui.getState().importAsset('A2', { packagePath: 'E:/Other.unitypackage' })
    expect(api.resolveTarget).toHaveBeenCalledOnce()
    finish({ kind: 'archive', packages: [{ path: null, relPath: 'Dress.unitypackage' }] })
    await first
  })
  it('keeps a new preparation visible when an older cancelled request completes late', async () => {
    const finishes: Array<(value: unknown) => void> = []
    api.prepareTarget.mockImplementation(() => new Promise(resolve => { finishes.push(resolve) }))
    const ui = await ready()
    const old = ui.getState().importAsset('A1', { packagePath: 'E:/Old.unitypackage' })
    await delay(); ui.getState().cancelImportPreparation()
    const next = ui.getState().importAsset('A2', { packagePath: 'E:/Next.unitypackage' })
    await delay(); finishes[0]({ projectId: 'P1', name: 'First', phase: 'ready' }); await old
    expect(ui.getState().importFlow.busyReason).toBe('connecting')
    finishes[1]({ projectId: 'P1', name: 'First', phase: 'ready' }); await next
    expect(api.preflight).toHaveBeenCalledOnce()
    expect(api.preflight).toHaveBeenCalledWith(expect.objectContaining({ packagePath: 'E:/Next.unitypackage' }))
  })
})
