import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULTS } from '../../src/shared/settingsDefaults'
import type { ProjectInfo, UnityStatus } from '../../src/shared/types'
import type { ConnectionPhase, UnityConnectionSnapshot } from '../../src/shared/unityConnection'

type Status = UnityStatus & { targetProjectId: string | null }

function project(id: string, running: boolean): ProjectInfo {
  return { id, name: id, path: `C:/fixture/${id}`, unityVersion: '2022.3.22f1', running,
    detectedBy: running ? ['bridge'] : [], bridgeVersion: 'fixture', bridgeInstalled: true }
}

function snapshot(targetProjectId: string | null, rows: Array<[string, ConnectionPhase]>): UnityConnectionSnapshot {
  return { targetProjectId, targetMode: 'auto', ambiguous: targetProjectId === null && rows.length > 1,
    projects: rows.map(([id, phase]) => ({ projectId: id, name: id, projectPath: `C:/fixture/${id}`, phase, reasonKey: null, detail: null })) }
}

function status(targetProjectId: string | null, isPlaying = false): Status {
  return { targetProjectId, running: targetProjectId !== null, bridgeReady: targetProjectId !== null,
    isPlaying, isCompiling: false, isUpdating: false, queueLength: 0, busyReason: null }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

const flush = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)) }
let events: Map<string, (payload: unknown) => void>
let api: { status: ReturnType<typeof vi.fn<() => Promise<Status>>>; listProjects: ReturnType<typeof vi.fn<() => Promise<ProjectInfo[]>>> }

beforeEach(() => {
  vi.resetModules()
  events = new Map()
  const initial = snapshot('P1', [['P1', 'ready']])
  api = { status: vi.fn(async () => status('P1')), listProjects: vi.fn(async () => [project('P1', true)]) }
  vi.stubGlobal('window', { location: { search: '' }, a: {
    unity: { ...api, connection: async () => initial },
    system: { info: async () => ({}), paths: async () => ({}) },
    settings: { getAll: async () => ({ ...DEFAULTS, onboardingDone: true, libraryRoot: null }) },
    assets: { list: async () => ({ cards: [], total: 0 }), stats: async () => ({}) },
    collections: { list: async () => [] }, categories: { list: async () => null },
    ingest: { queue: async () => [] },
    on: (name: string, listener: (payload: unknown) => void) => { events.set(name, listener) }
  } })
  vi.stubGlobal('document', { documentElement: { classList: { toggle: () => undefined }, lang: '' } })
})

afterEach(() => vi.unstubAllGlobals())

async function boot() {
  const { initI18n } = await import('../../src/renderer/i18n')
  await initI18n('en')
  const { useUi } = await import('../../src/renderer/stores/ui')
  useUi.setState({ projects: [project('P1', true)] })
  await useUi.getState().boot()
  expect(useUi.getState().bootError).toBeNull()
  expect(events.has('unity:connection-changed')).toBe(true)
  api.status.mockClear()
  return useUi
}

describe('connection events refresh actual project metadata', () => {
  it('adds a newly opened P2, then removes closed P1 from running candidates even when its phase is disabled', async () => {
    const ui = await boot()
    const emit = events.get('unity:connection-changed')!
    const both = [project('P1', true), { ...project('P2', true), name: 'Newly opened P2' }]
    api.listProjects.mockResolvedValue(both)
    api.status.mockResolvedValue(status(null))
    emit(snapshot(null, [['P1', 'ready'], ['P2', 'connecting']]))
    await flush()
    expect(ui.getState().projects).toEqual(both)
    expect(ui.getState().projects.filter(p => p.running).map(p => p.id)).toEqual(['P1', 'P2'])

    const remaining = [project('P1', false), both[1]]
    api.listProjects.mockResolvedValue(remaining)
    api.status.mockResolvedValue(status('P2'))
    emit(snapshot('P2', [['P1', 'disabled'], ['P2', 'ready']]))
    await flush()
    expect(ui.getState().projects).toEqual(remaining)
    expect(ui.getState().projects.filter(p => p.running).map(p => p.id)).toEqual(['P2'])
    expect(ui.getState().unity.targetProjectId).toBe('P2')
    expect(api.listProjects).toHaveBeenCalledTimes(2)
  })

  it.each(['P1', 'P2'])('ignores late status and project results from an older event when the newest target is %s', async newestTarget => {
    const ui = await boot()
    const emit = events.get('unity:connection-changed')!
    const oldStatus = deferred<Status>(), oldProjects = deferred<ProjectInfo[]>()
    api.status.mockImplementationOnce(() => oldStatus.promise)
    api.listProjects.mockImplementationOnce(() => oldProjects.promise)
    emit(snapshot('P1', [['P1', 'connecting']]))

    const latest = snapshot(newestTarget, [['P1', newestTarget === 'P1' ? 'ready' : 'closed'], ['P2', 'ready']])
    const latestProjects = [project('P1', newestTarget === 'P1'), project('P2', true)]
    const latestStatus = status(newestTarget, true)
    api.status.mockResolvedValue(latestStatus)
    api.listProjects.mockResolvedValue(latestProjects)
    emit(latest)
    await flush()
    expect(ui.getState().connection).toEqual(latest)
    expect(ui.getState().projects).toEqual(latestProjects)
    expect(ui.getState().unity).toEqual(latestStatus)

    oldStatus.resolve(status('P1'))
    oldProjects.resolve([project('P1', true)])
    await flush()
    expect(ui.getState().connection).toEqual(latest)
    expect(ui.getState().projects).toEqual(latestProjects)
    expect(ui.getState().unity).toEqual(latestStatus)
  })
})
