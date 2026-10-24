import { BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'
import { AllowedEvents } from '../../shared/ipc'
import type { IpcApi } from './types'

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; name: string }

/**
 * 所有通道统一包一层 {ok,data|error}：渲染进程不会遇到未捕获的 Promise 拒绝，
 * 错误也能原样显示给用户（第 3 份 §6.6"不得静默吞异常"在主进程侧的对应做法）。
 */
export function createRegistrar(): { ipc: IpcApi; broadcast: (event: string, payload?: unknown) => void } {
  const registered = new Set<string>()

  const ipc: IpcApi = {
    handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
      if (registered.has(channel)) throw new Error('IPC 通道重复注册：' + channel)
      registered.add(channel)
      ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
        try {
          const data = await (fn as unknown as (...a: unknown[]) => R | Promise<R>)(...args)
          return { ok: true, data } as IpcResult<R>
        } catch (err) {
          const base = err instanceof Error ? err.message : String(err)
          // 把 VpmError 的 params 一起带过去，渲染层才能把 {{reason}} 这类占位符填上。
          const params = (err as { params?: Record<string, unknown> }).params
          const error = params ? `${base}|${JSON.stringify(params)}` : base
          const name = err instanceof Error ? err.name : 'Error'
          log.error('[ipc] ' + channel + ' 失败：' + error)
          return { ok: false, error, name } as IpcResult<R>
        }
      })
    }
  }

  const broadcast = (event: string, payload?: unknown): void => {
    if (!AllowedEvents.includes(event)) throw new Error('未登记的事件通道：' + event)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(event, payload)
    }
  }

  return { ipc, broadcast }
}
