import { expect, it } from 'vitest'
import { initI18n } from '../../src/renderer/i18n'
import { errorText } from '../../src/renderer/lib/msg'

it('translates a connection error wrapped by Electron IPC', async () => {
  await initI18n('zh-CN')
  expect(errorText(Error("Error invoking remote method 'unity:retry-connection': Error: project.connectionClosed"))).toBe('Unity 未打开')
})

it('preserves unknown connection failures for diagnosis', async () => {
  await initI18n('zh-CN')
  expect(errorText(Error('project.connectionUnknownFutureError'))).toBe('project.connectionUnknownFutureError')
})
