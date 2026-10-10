import { beforeEach, expect, it, vi } from 'vitest'
beforeEach(() => vi.resetModules())
it('设置失败显示翻译后的原因，保留原来的设置', async () => {
  const { initI18n } = await import('../../src/renderer/i18n')
  await initI18n('zh-CN')
  ;(globalThis as any).window = { a: { settings: {
    setMany: vi.fn(async () => { throw new Error("Error invoking remote method 'settings:set-many': Error: i18n:wizard.step1.unityProject") })
  } } }
  const { useUi } = await import('../../src/renderer/stores/ui')
  const settings = useUi.getState().settings
  await useUi.getState().patchSettings({ libraryRoot: 'C:/test/Unity' })
  expect(useUi.getState().settings).toBe(settings)
  const text = useUi.getState().toasts.at(-1)?.text
  expect(text).toContain('Unity 工程目录')
  expect(text).not.toContain('i18n:')
})
