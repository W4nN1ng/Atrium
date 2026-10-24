import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcInvoke } from '../../../src/shared/ipc'
import { registerVpmIpc } from '../../../src/main/vpm/ipc'
import type { VpmRuntime } from '../../../src/main/vpm'
import type { TemplateListEntry } from '../../../src/main/vpm/templates'
import type { IpcApi } from '../../../src/main/ipc/types'

let handlers: Map<string, (...args: never[]) => unknown>
let templates: {
  list: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  duplicate: ReturnType<typeof vi.fn>
  removeReference: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  setFavorite: ReturnType<typeof vi.fn>
  recentLocations: ReturnType<typeof vi.fn>
}
let controller: { dispose(): void } | null

const entry: TemplateListEntry = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  name: 'My Template',
  description: 'desc',
  source: 'user',
  base: null,
  unity: { min: '2022.3', max: null, recommended: null },
  dependencies: { 'com.example.dep': '^1.0.0' },
  unitypackages: [{ path: 'files/a.unitypackage', name: 'a' }],
  favorite: false,
  visible: true,
  lastUsedAt: null,
  createdAt: 1,
  updatedAt: 2,
  builtin: false,
  broken: false,
  issues: []
}

function handler(channel: string): (...args: never[]) => unknown {
  const fn = handlers.get(channel)
  if (!fn) throw new Error('missing handler ' + channel)
  return fn
}

function call(channel: string, ...args: never[]): Promise<unknown> {
  return Promise.resolve().then(() => handler(channel)(...args))
}

beforeEach(() => {
  handlers = new Map()
  templates = {
    list: vi.fn(() => [entry]),
    create: vi.fn(() => entry),
    update: vi.fn(() => entry),
    duplicate: vi.fn(() => entry),
    removeReference: vi.fn(() => ({ ...entry, visible: false })),
    restore: vi.fn(() => entry),
    setFavorite: vi.fn(() => ({ ...entry, favorite: true })),
    recentLocations: vi.fn(() => [])
  }
  const runtime = { templates } as unknown as VpmRuntime
  const ipc: IpcApi = {
    handle(channel, fn) {
      handlers.set(channel, fn as unknown as (...args: never[]) => unknown)
    }
  }
  controller = registerVpmIpc({ ipc, getRuntime: () => runtime })
})

afterEach(() => {
  controller?.dispose()
  controller = null
})

describe('template editor IPC (P8-F)', () => {
  it('lists templates with optional hidden entries and maps a safe DTO', async () => {
    const all = (await call(IpcInvoke.Vpm.TemplateList)) as Array<Record<string, unknown>>
    expect(templates.list).toHaveBeenCalledWith({ includeHidden: false })
    expect(all[0]).toMatchObject({
      id: entry.id,
      name: entry.name,
      source: 'user',
      builtin: false,
      broken: false
    })
    expect(all[0]).not.toHaveProperty('settings')
    expect(all[0]).not.toHaveProperty('manifestPath')

    await call(IpcInvoke.Vpm.TemplateList, { includeHidden: true } as never)
    expect(templates.list).toHaveBeenLastCalledWith({ includeHidden: true })
  })

  it('creates a template with normalized fields and a server-generated identity', async () => {
    const result = (await call(IpcInvoke.Vpm.TemplateCreate, {
      name: '  My Template  ',
      description: '  desc  ',
      base: null,
      unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
      dependencies: { 'com.example.dep': ' ^1.0.0 ' },
      unitypackages: [{ path: 'files/a.unitypackage', name: ' a ' }]
    } as never)) as Record<string, unknown>

    expect(templates.create).toHaveBeenCalledWith({
      name: 'My Template',
      description: 'desc',
      base: null,
      unity: { min: '2022.3', max: null, recommended: '2022.3.22f1' },
      dependencies: { 'com.example.dep': '^1.0.0' },
      unitypackages: [{ path: 'files/a.unitypackage', name: 'a' }]
    })
    expect(result).toMatchObject({ id: entry.id, name: entry.name })
  })

  it('rejects malformed create/update input before touching the service', async () => {
    const cases: Array<[string, unknown]> = [
      [IpcInvoke.Vpm.TemplateCreate, {}],
      [IpcInvoke.Vpm.TemplateCreate, { name: '' }],
      [IpcInvoke.Vpm.TemplateCreate, { name: 'x', dependencies: { 'com.example.dep': 'wat' } }],
      [IpcInvoke.Vpm.TemplateCreate, { name: 'x', unitypackages: [{ path: '../escape' }] }],
      [IpcInvoke.Vpm.TemplateCreate, { name: 'x', base: '../escape' }],
      [IpcInvoke.Vpm.TemplateUpdate, { id: '../escape', name: 'x' }],
      [IpcInvoke.Vpm.TemplateUpdate, { id: entry.id, settings: [] }],
      [IpcInvoke.Vpm.TemplateList, { includeHidden: 'yes' }]
    ]
    for (const [channel, input] of cases) {
      await expect(call(channel, input as never)).rejects.toMatchObject({
        code: 'vpmTemplateInvalid'
      })
    }
    expect(templates.create).not.toHaveBeenCalled()
    expect(templates.update).not.toHaveBeenCalled()
  })

  it('updates, duplicates, removes and restores through the service', async () => {
    await call(IpcInvoke.Vpm.TemplateUpdate, {
      id: entry.id,
      name: 'Renamed',
      description: null
    } as never)
    expect(templates.update).toHaveBeenCalledWith(entry.id, {
      name: 'Renamed',
      description: null
    })

    await call(IpcInvoke.Vpm.TemplateDuplicate, { id: entry.id, name: 'Copy' } as never)
    expect(templates.duplicate).toHaveBeenCalledWith(entry.id, 'Copy')

    const removed = (await call(IpcInvoke.Vpm.TemplateRemoveReference, {
      id: entry.id
    } as never)) as Record<string, unknown>
    expect(templates.removeReference).toHaveBeenCalledWith(entry.id)
    expect(removed.visible).toBe(false)

    const restored = (await call(IpcInvoke.Vpm.TemplateRestore, {
      id: entry.id
    } as never)) as Record<string, unknown>
    expect(templates.restore).toHaveBeenCalledWith(entry.id)
    expect(restored.visible).toBe(true)
  })

  it('keeps favorite semantics and propagates read-only errors', async () => {
    const favorite = (await call(IpcInvoke.Vpm.TemplateFavorite, {
      id: entry.id,
      favorite: true
    } as never)) as Record<string, unknown>
    expect(templates.setFavorite).toHaveBeenCalledWith(entry.id, true)
    expect(favorite.favorite).toBe(true)

    templates.removeReference.mockImplementation(() => {
      throw Object.assign(new Error('readonly'), { code: 'vpmTemplateReadOnly' })
    })
    await expect(
      call(IpcInvoke.Vpm.TemplateRemoveReference, { id: 'builtin.avatars' } as never)
    ).rejects.toMatchObject({ code: 'vpmTemplateReadOnly' })
  })
})
