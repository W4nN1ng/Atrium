import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcInvoke } from '../../../src/shared/ipc'
import { registerUnityIpc } from '../../../src/main/vpm/ipc/unity'
import type { VpmRuntime } from '../../../src/main/vpm'
import type { IpcApi } from '../../../src/main/ipc/types'

const PROJECT_KEY = 'c:\\demo'
const CORE_ID = 'core-1'

let handlers: Map<string, (...args: unknown[]) => unknown>
let bound: string[]
let cleared: string[]
interface LaunchCall {
  projectKey?: string
  editorPath?: string | null
  projectPath?: string
  bindTarget?: (path: string) => void
  clearTarget?: (path: string) => void
}
let launchImpl: (input: LaunchCall) => Promise<unknown>
let runtime: VpmRuntime

function call<T>(channel: string, ...args: unknown[]): T {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`missing handler ${channel}`)
  return handler(...args) as T
}

beforeEach(() => {
  handlers = new Map()
  bound = []
  cleared = []
  launchImpl = async () => ({
    status: 'launched',
    exePath: 'C:\\Unity\\Unity.exe',
    version: '2022.3.22f1',
    args: ['-projectPath', 'C:\\demo'],
    pid: 10
  })

  runtime = {
    projects: {
      get: (key: string) =>
        key === PROJECT_KEY
          ? { projectKey: PROJECT_KEY, coreId: CORE_ID, path: 'C:\\demo', name: 'Demo' }
          : null
    },
    linkage: {
      currentTarget: () => null,
      bindLaunchTarget: (id: string) => {
        bound.push(id)
      },
      clearLaunchTarget: (id: string) => {
        cleared.push(id)
      }
    },
    launch: {
      launch: (input: LaunchCall & { projectPath: string }) => {
        // 模拟 P5-D 的顺序：先绑定，再 spawn
        input.bindTarget?.(input.projectPath)
        return launchImpl(input)
      }
    }
  } as unknown as VpmRuntime

  const ipc: IpcApi = {
    handle(channel, fn) {
      handlers.set(channel, fn as unknown as (...args: unknown[]) => unknown)
    }
  }
  registerUnityIpc({ ipc, getRuntime: () => runtime })
})

describe('project launch target binding', () => {
  it('binds the core project id before spawning', async () => {
    const result = await call<Promise<{ status: string }>>(IpcInvoke.Vpm.ProjectLaunch, {
      projectKey: PROJECT_KEY
    })
    expect(result.status).toBe('launched')
    expect(bound).toEqual([CORE_ID])
    expect(cleared).toEqual([])
  })

  it('clears the binding when the launch fails', async () => {
    launchImpl = async (input: LaunchCall) => {
      input.clearTarget?.('C:\\demo')
      throw Object.assign(new Error('boom'), { code: 'vpmUnityLaunchFailed' })
    }
    await expect(
      call<Promise<unknown>>(IpcInvoke.Vpm.ProjectLaunch, { projectKey: PROJECT_KEY })
    ).rejects.toMatchObject({ code: 'vpmUnityLaunchFailed' })
    expect(bound).toEqual([CORE_ID])
    expect(cleared).toEqual([CORE_ID])
  })

  it('does not bind when the project is not in the ledger', async () => {
    await expect(
      call<Promise<unknown>>(IpcInvoke.Vpm.ProjectLaunch, { projectKey: 'c:\\other' })
    ).rejects.toMatchObject({ code: 'vpmProjectInvalid' })
    expect(bound).toEqual([])
  })

  it('does not bind when the project has no core id (nothing to bind to)', async () => {
    runtime = {
      ...runtime,
      projects: { get: () => ({ projectKey: PROJECT_KEY, coreId: null, path: 'C:\\demo' }) }
    } as unknown as VpmRuntime
    handlers = new Map()
    const ipc: IpcApi = {
      handle(channel, fn) {
        handlers.set(channel, fn as unknown as (...args: unknown[]) => unknown)
      }
    }
    registerUnityIpc({ ipc, getRuntime: () => runtime })

    await call<Promise<unknown>>(IpcInvoke.Vpm.ProjectLaunch, { projectKey: PROJECT_KEY })
    expect(bound).toEqual([])
    expect(cleared).toEqual([])
  })

  it('keeps the binding when the project is already running', async () => {
    launchImpl = async () => ({
      status: 'alreadyRunning',
      exePath: 'C:\\Unity\\Unity.exe',
      version: '2022.3.22f1',
      args: [],
      pid: null
    })
    const result = await call<Promise<{ status: string }>>(IpcInvoke.Vpm.ProjectLaunch, {
      projectKey: PROJECT_KEY
    })
    expect(result.status).toBe('alreadyRunning')
    expect(bound).toEqual([CORE_ID])
    expect(cleared).toEqual([])
  })
})
