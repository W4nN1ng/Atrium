import type { IpcRegistrar } from './types'
import {
  clearImportNames,
  getProjectLayout,
  listImportNames,
  setProjectLayout
} from '../db/repos/uiPrefs'
import { getDb } from '../db'

/**
 * 两个小功能的 IPC：项目列表顺序/固定、导入名字历史。
 *
 * 单独一个文件而不是塞进 `bridge/ipc.ts`：那边已经 400+ 行、全部围着桥接转，
 * 这两样和 Unity 连接一点关系没有。
 */
export function registerUiPrefs({ ipc, broadcast }: IpcRegistrar): void {
  ipc.handle('ui:project-layout-get', () => getProjectLayout(getDb()))

  ipc.handle('ui:project-layout-set', (layout: unknown) => {
    if (!layout || typeof layout !== 'object') throw new Error('项目顺序数据无效')
    return setProjectLayout(getDb(), layout)
  })

  ipc.handle('ui:import-names', () => listImportNames(getDb()))

  ipc.handle('ui:import-names-clear', () => {
    clearImportNames(getDb())
    broadcast('data:changed', { reason: 'import-names-clear' })
    return listImportNames(getDb())
  })
}
