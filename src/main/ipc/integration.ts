/**
 * 系统集成相关 IPC：资源管理器右键菜单、监视文件夹状态。
 * 都是"改的是这台机器、不是素材库"的动作，所以每一步都由用户点，程序不自动做。
 */
import log from 'electron-log'
import { installShellMenu, shellMenuState, uninstallShellMenu, ingestExePath, type ShellMenuResult } from '../services/shellMenu'
import type { FolderWatcher } from '../services/watcher'
import type { IpcRegistrar } from './types'

export interface IntegrationState {
  watching: string[]
  /** 右键菜单登记指向的 exe，让用户看得见"我搬家了要不要重登记" */
  shellTarget: string
}

export function registerIntegration(
  { ipc }: IpcRegistrar,
  getWatcher: () => FolderWatcher | null
): void {
  ipc.handle('integration:shell-menu-state', async () => {
    const st = await shellMenuState()
    return { ...st, current: ingestExePath() }
  })

  // 菜单文字由渲染进程传（主进程没有 i18next）
  ipc.handle('integration:shell-menu-install', async (label: unknown): Promise<ShellMenuResult> => {
    const text = typeof label === 'string' && label.trim() ? label.trim() : 'Atrium'
    const r = await installShellMenu(text)
    log.info(`右键菜单登记：${r.ok ? '成功' : '失败 ' + (r.detail ?? '')}`)
    return r
  })

  ipc.handle('integration:shell-menu-uninstall', async (): Promise<ShellMenuResult> => {
    const r = await uninstallShellMenu()
    log.info(`右键菜单移除：${r.ok ? '成功' : '失败 ' + (r.detail ?? '')}`)
    return r
  })

  ipc.handle('integration:watcher-state', (): IntegrationState => {
    const w = getWatcher()
    return { watching: w ? w.watching() : [], shellTarget: ingestExePath() }
  })
}
