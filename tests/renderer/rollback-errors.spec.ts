import { beforeEach, expect, it, vi } from 'vitest'
beforeEach(() => vi.resetModules())
it('the existing single-import rollback entry translates newer-overlap protection instead of showing an internal key', async () => {
  const { initI18n } = await import('../../src/renderer/i18n')
  await initI18n('zh-CN')
  ;(globalThis as any).window = { a: { unity: {
    rollbackImport: vi.fn(async () => ({ ok: false, error: 'i18n:importHistory.newerOverlap' }))
  } } }
  const { useUi } = await import('../../src/renderer/stores/ui')
  useUi.setState(s => ({ importFlow: { ...s.importFlow, last: {
    importId: 'old-import', projectName: 'Test', created: 1, overwritten: 0, backupDir: null, backupSaved: 0
  } } }))
  await useUi.getState().rollbackLastImport()
  const text = useUi.getState().toasts.at(-1)?.text
  expect(text).toContain('后来的导入修改了同一资源')
  expect(text).not.toContain('i18n:')
})
