import { beforeEach, describe, expect, it, vi } from 'vitest'

let api: any
beforeEach(() => {
  api = {
    preflight: vi.fn(async () => ({ ok: true, entryCount: 2, fresh: 2, conflicts: [] })),
    importPackage: vi.fn(async () => ({ ok: false, error: 'mock stopped' })),
    packagesOfAsset: vi.fn(async () => ({ kind: 'archive', packages: [{ path: null, relPath: 'Dress.unitypackage' }] })),
    importPlan: vi.fn(async () => ({ ok: true, batchId: 'B1', items: [{ relPath: 'Dress.unitypackage', entryCount: 2, fresh: 2, conflicts: [] }] })),
    importCommit: vi.fn(async () => ({ ok: false, error: 'mock stopped' }))
  }
  ;(globalThis as any).window = { a: { unity: api } }
  vi.resetModules()
})

async function ready(confirm: boolean) {
  const { useUi } = await import('../../src/renderer/stores/ui')
  useUi.setState({ settings: { ...useUi.getState().settings, confirmBeforeImport: confirm },
    unity: { ...useUi.getState().unity, targetProjectId: 'P1', running: true }, projects: [{ id: 'P1', name: 'Test' }] as any })
  return useUi
}

describe('导入前确认设置', () => {
  it.each(['loose', 'archive'])('开启确认时，无冲突的 %s 包也要等用户确认', async (kind) => {
    const ui = await ready(true)
    await ui.getState().importAsset('A1', kind === 'loose' ? { packagePath: 'C:/test/Dress.unitypackage' } : undefined)
    expect(ui.getState().importFlow.pending?.entryCount).toBe(2)
    expect(api.importPackage).not.toHaveBeenCalled()
    expect(api.importCommit).not.toHaveBeenCalled()
  })
  it('关闭确认可直接导入无冲突包', async () => {
    const ui = await ready(false)
    await ui.getState().importAsset('A1', { packagePath: 'C:/test/Dress.unitypackage' })
    expect(api.importPackage).toHaveBeenCalledOnce()
  })
  it('关闭确认仍不能静默覆盖冲突文件', async () => {
    api.preflight.mockResolvedValue({ ok: true, entryCount: 2, fresh: 1, conflicts: [{ guid: 'g', existingPath: 'Assets/Old.prefab', incomingPath: 'Assets/New.prefab' }] })
    const ui = await ready(false)
    await ui.getState().importAsset('A1', { packagePath: 'C:/test/Dress.unitypackage' })
    expect(ui.getState().importFlow.pending?.conflicts).toHaveLength(1)
    expect(api.importPackage).not.toHaveBeenCalled()
  })
})
