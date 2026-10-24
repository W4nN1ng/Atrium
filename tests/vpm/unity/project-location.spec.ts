import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { IpcInvoke } from '../../../src/shared/ipc'
import { registerProjectLocationIpc } from '../../../src/main/vpm/ipc/unity'
import type { VpmRuntime } from '../../../src/main/vpm'
import type { IpcApi } from '../../../src/main/ipc/types'

let root: string
let handlers: Map<string, (...args: unknown[]) => unknown>

function call<T>(channel: string, ...args: unknown[]): T {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`missing handler ${channel}`)
  return handler(...args) as T
}

function makeProject(dir: string, version = '2022.3.22f1'): void {
  fs.mkdirSync(path.join(dir, 'ProjectSettings'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'),
    `m_EditorVersion: ${version}\n`
  )
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-location-'))
  handlers = new Map()
  const ipc: IpcApi = {
    handle(channel, fn) {
      handlers.set(channel, fn as unknown as (...args: unknown[]) => unknown)
    }
  }
  const runtime = {
    projects: {
      list: () => [{ path: path.join(root, 'Alpha') }]
    }
  } as unknown as VpmRuntime
  registerProjectLocationIpc({ ipc, getRuntime: () => runtime })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('project parent check (R14)', () => {
  it('moves one level up when the picked folder is a project', () => {
    const project = path.join(root, 'Alpha')
    makeProject(project)
    const result = call<{ parent: string; adjustedFrom: string | null }>(
      IpcInvoke.Vpm.ProjectParentCheck,
      project
    )
    expect(result.adjustedFrom).toBe(project)
    expect(result.parent).toBe(root)
  })

  it('keeps a plain container folder as-is', () => {
    const result = call<{ parent: string; adjustedFrom: string | null }>(
      IpcInvoke.Vpm.ProjectParentCheck,
      root
    )
    expect(result.adjustedFrom).toBeNull()
    expect(result.parent).toBe(root)
  })
})

describe('project root scan (R15)', () => {
  it('lists projects one level deep and marks the ones already added', () => {
    makeProject(path.join(root, 'Alpha'))
    makeProject(path.join(root, 'Beta'), '2021.3.0f1')
    fs.mkdirSync(path.join(root, 'NotAProject'))

    const result = call<{
      root: string
      candidates: Array<{ name: string; unityVersion: string | null; added: boolean }>
    }>(IpcInvoke.Vpm.ProjectScanRoot, root)

    expect(result.root).toBe(root)
    expect(result.candidates.map((item) => item.name)).toEqual(['Alpha', 'Beta'])
    expect(result.candidates[0].added).toBe(true)
    expect(result.candidates[1].added).toBe(false)
    expect(result.candidates[1].unityVersion).toBe('2021.3.0f1')
  })

  it('returns the project itself when the picked folder is a project', () => {
    const project = path.join(root, 'Alpha')
    makeProject(project)
    const result = call<{ candidates: Array<{ path: string }> }>(
      IpcInvoke.Vpm.ProjectScanRoot,
      project
    )
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].path).toBe(project)
  })

  it('returns an empty list for a folder without projects', () => {
    fs.mkdirSync(path.join(root, 'empty'), { recursive: true })
    const result = call<{ candidates: unknown[] }>(IpcInvoke.Vpm.ProjectScanRoot, path.join(root, 'empty'))
    expect(result.candidates).toEqual([])
  })
})
