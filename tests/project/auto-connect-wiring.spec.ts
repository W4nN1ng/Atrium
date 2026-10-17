import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { getProjectByPath, listProjects, upsertProject } from '../../src/main/db/repos/unity'
import { __resetBridgeAsk, pendingBridgeAsks } from '../../src/main/bridge/askQueue'
import type { IpcRegistrar } from '../../src/main/ipc/types'
import { startProjectWatcher, type ProjectApi, type ProjectWatcherOptions } from '../../src/main/project/api'
import { UnityConnections } from '../../src/main/project/connections'
import { __resetRunningObserve } from '../../src/main/project/running'
import type { WmiProbeResult } from '../../src/main/project/wmi'
import { setAppPathsForTest } from '../../src/main/services/paths'
import { setSettings } from '../../src/main/services/settings'
import type { ProjectInfo } from '../../src/shared/types'

// The production fallback must never inspect this machine's real Unity processes, even on RED.
vi.mock('../../src/main/project/wmi', () => ({
  probeUnityProcesses: vi.fn(async () => ({ projects: [], error: null, queried: true }))
}))

let root: string
let db: Db
let clock: number
let apis: ProjectApi[]
const empty = (): WmiProbeResult => ({ projects: [], error: null, queried: true })
const running = (...paths: string[]): WmiProbeResult => ({ projects: paths.map((projectPath, i) => ({ projectPath, pid: 1000 + i })), error: null, queried: true })
async function flush(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve() }

function project(name: string): string {
  const dir = path.join(root, 'projects', name)
  fs.mkdirSync(path.join(dir, 'ProjectSettings'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1')
  return dir
}

function manifest(paths: string[]): void {
  const file = path.join(process.env.LOCALAPPDATA!, 'VRChatCreatorCompanion', 'settings.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ userProjects: paths, defaultProjectPath: null }))
}

function watcher(opts: ProjectWatcherOptions = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const broadcasts: Array<{ event: string; payload: unknown }> = []
  const detected: ProjectInfo[][] = []
  const registrar: IpcRegistrar = {
    ipc: { handle(channel, fn) { handlers.set(channel, fn as (...args: unknown[]) => unknown) } },
    broadcast(event, payload) { broadcasts.push({ event, payload }) }
  }
  const api = startProjectWatcher(registrar, {
    pollMs: 0, automaticConnections: true, probe: async () => empty(),
    onDetected: (list) => detected.push(list), ...opts
  })
  apis.push(api)
  return { api, handlers, broadcasts, detected }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'atrium-autoconnect-wiring-'))
  setAppPathsForTest(path.join(root, 'app'))
  vi.stubEnv('LOCALAPPDATA', path.join(root, 'Local'))
  vi.spyOn(os, 'homedir').mockReturnValue(root)
  clock = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  setSettings({ bridgeAutoInstall: false, projectRoots: [], autoSwitchBehavior: 'never' })
  manifest([])
  db = openDatabase(path.join(root, 'library.db'))
  apis = []
  __resetBridgeAsk()
  __resetRunningObserve()
})

afterEach(async () => {
  for (const api of apis) api.dispose()
  await flush()
  closeDatabase()
  __resetBridgeAsk()
  __resetRunningObserve()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('automatic connection watcher integration', () => {
  it('discovers a real running Unity project absent from VCC, scan roots and the database', async () => {
    const dir = project('unregistered')
    const probe = vi.fn(async () => running(dir))
    const h = watcher({ probe })
    await flush()
    const list = await (h.handlers.get('unity:list-projects')!() as Promise<ProjectInfo[]>)
    const row = getProjectByPath(db, dir)
    expect(row).toMatchObject({ name: 'unregistered', unity_version: '2022.3.22f1', is_running: 1 })
    expect(list).toEqual([expect.objectContaining({ id: row!.id, path: dir, running: true, detectedBy: ['wmi'], bridgeInstalled: false })])
    expect(h.detected.at(-1)).toEqual(list)
    // Discovery's second pass must use the same process snapshot, not a second WMI query.
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('refreshes the actual WMI snapshot after five seconds even with three-second polls and reports close', async () => {
    const dir = project('closing')
    let current = running(dir)
    const probe = vi.fn(async () => current)
    const h = watcher({ probe })
    await flush()
    clock += 3000
    await h.api.detect()
    expect(probe).toHaveBeenCalledTimes(1)
    current = empty()
    clock += 3000
    const list = await h.api.detect()
    expect(probe).toHaveBeenCalledTimes(2)
    expect(list[0]).toMatchObject({ path: dir, running: false, detectedBy: [] })
    expect(getProjectByPath(db, dir)!.is_running).toBe(0)
    expect(h.detected.at(-1)![0].running).toBe(false)
  })

  it('uses one WMI result for both passes even when registration outlasts the cache interval', async () => {
    const dir = project('slow-registration')
    const readFile = fs.readFileSync.bind(fs)
    vi.spyOn(fs, 'readFileSync').mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
      if (args[0] === path.join(dir, 'ProjectSettings', 'ProjectVersion.txt')) clock += 6000
      return readFile(...args)
    }) as typeof fs.readFileSync)
    const probe = vi.fn(async () => running(dir))
    watcher({ probe })
    await flush()
    expect(getProjectByPath(db, dir)).toBeTruthy()
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('does not register owned previews, damaged preview markers or non-project WMI paths', async () => {
    const preview = project('preview'), damaged = project('damaged')
    fs.writeFileSync(path.join(preview, '.atrium-cover-preview.json'), JSON.stringify({ kind: 'atrium-package-preview', version: 1, projectPath: preview }))
    fs.symlinkSync(path.join(root, 'missing-marker-target'), path.join(damaged, '.atrium-cover-preview.json'), 'junction')
    const h = watcher({ probe: async () => running(preview, damaged, root, path.join(root, 'does-not-exist')) })
    await flush()
    expect(listProjects(db)).toEqual([])
    expect(h.detected.at(-1)).toEqual([])
    expect(pendingBridgeAsks()).toEqual([])
  })

  it('keeps previously registered internal previews out of connection callbacks and running changes', async () => {
    const dir = project('previous-preview')
    upsertProject(db, { path: dir, name: 'previous-preview' })
    fs.writeFileSync(path.join(dir, '.atrium-cover-preview.json'), '{"kind":"atrium-package-preview"}')
    const h = watcher({ probe: async () => running(dir) })
    await flush()
    expect(h.detected.at(-1)).toEqual([])
    expect(h.broadcasts.filter((b) => b.event === 'project:running-changed')).toEqual([])
    expect(getProjectByPath(db, dir)!.is_running).toBe(0)
  })

  it('suppresses every legacy first-seen/install decision in automatic mode', async () => {
    const listed = project('listed'), discovered = project('discovered')
    manifest([listed])
    setSettings({ bridgeAutoInstall: true })
    const h = watcher({ probe: async () => running(listed, discovered) })
    await flush()
    await h.api.refresh()
    expect(listProjects(db)).toHaveLength(2)
    expect(h.broadcasts.filter((b) => b.event === 'project:first-seen')).toEqual([])
    expect(pendingBridgeAsks()).toEqual([])
  })

  it('preserves legacy first-seen decisions when automaticConnections is omitted', async () => {
    const dir = project('legacy')
    manifest([dir])
    const h = watcher({ automaticConnections: undefined })
    await flush()
    expect(h.broadcasts.filter((b) => b.event === 'project:first-seen')).toEqual([
      { event: 'project:first-seen', payload: expect.objectContaining({ projectPath: dir, decision: 'ask', detected: 'vcc' }) }
    ])
    expect(pendingBridgeAsks()).toHaveLength(1)
  })

  it('passes real discovery results into the connection controller without starting an import', async () => {
    const dir = project('controller')
    const installs: string[] = []
    const connections = new UnityConnections({
      config: () => ({ enabled: true, excludedProjectIds: [] }),
      install: (p) => { installs.push(p.path); return { ok: true, error: null } },
      statusOf: () => ({ bridgeReady: false, isPlaying: false, isCompiling: false, isUpdating: false, busyReason: null }),
      watch: () => {}, changed: () => {}
    })
    try {
      watcher({ probe: async () => running(dir), onDetected: (list) => connections.update(list) })
      await flush()
      expect(installs).toEqual([dir])
      expect(connections.snapshot()).toMatchObject({ targetProjectId: getProjectByPath(db, dir)!.id, targetMode: 'auto', ambiguous: false })
      expect(connections.snapshot().projects[0].phase).toBe('connecting')
    } finally { connections.dispose() }
  })

  it('shares one in-flight probe across concurrent detection requests', async () => {
    const deferred: Array<(result: WmiProbeResult) => void> = []
    let wait = false
    const h = watcher({ probe: () => wait ? new Promise((resolve) => deferred.push(resolve)) : Promise.resolve(empty()) })
    await flush()
    h.detected.length = 0
    wait = true
    clock += 6000
    const earlier = h.api.detect()
    const later = h.api.detect()
    expect(deferred).toHaveLength(1)
    deferred[0](empty())
    expect(await earlier).toEqual([])
    expect(await later).toEqual([])
    expect(listProjects(db)).toEqual([])
    expect(h.detected).toEqual([[]])
  })

  it('finishes slow process discovery even when it exceeds the polling interval', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const dir = project('slow-wmi')
    const probe = vi.fn(() => new Promise<WmiProbeResult>(resolve => setTimeout(() => resolve(running(dir)), 3500)))
    const h = watcher({ pollMs: 3000, probe })
    await vi.advanceTimersByTimeAsync(3501)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(h.detected.at(-1)).toEqual([expect.objectContaining({ path: dir, running: true })])
  })

  it('evaluates projects registered by a refresh while its shared process probe is still pending', async () => {
    const dir = project('registered-during-probe')
    const completions: Array<(result: WmiProbeResult) => void> = []
    const probe = vi.fn(() => new Promise<WmiProbeResult>(resolve => completions.push(resolve)))
    const h = watcher({ probe })
    manifest([dir])
    const request = h.api.refresh()
    expect(probe).toHaveBeenCalledTimes(1)
    for (const resolve of completions) resolve(running(dir))
    const list = await request
    expect(list).toEqual([expect.objectContaining({ path: dir, running: true, detectedBy: ['wmi'] })])
  })

  it('does not write or invoke callbacks for a probe that returns after disposal', async () => {
    const dir = project('late')
    let complete!: (result: WmiProbeResult) => void
    const h = watcher({ probe: () => new Promise((resolve) => { complete = resolve }) })
    await flush()
    h.api.dispose()
    complete(running(dir))
    await flush()
    expect(listProjects(db)).toEqual([])
    expect(h.detected).toEqual([])
    expect(h.broadcasts).toEqual([])
    await expect(h.api.refresh()).resolves.toEqual([])
    await expect(h.api.detect()).resolves.toEqual([])
    expect(listProjects(db)).toEqual([])
  })
})
