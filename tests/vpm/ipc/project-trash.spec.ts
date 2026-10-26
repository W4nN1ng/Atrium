import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initVpm, type VpmRuntime } from '../../../src/main/vpm'
import { setAppPathsForTest } from '../../../src/main/services/paths'
import { ProjectActivityRegistry, createProjectActivityPort } from '../../../src/main/project/activity'
import { registerProjectIpc } from '../../../src/main/vpm/ipc/projects'
import { IpcInvoke } from '../../../src/shared/ipc'

const electron = vi.hoisted(() => ({appData: ''}))
vi.mock('electron', () => ({app: {getPath: () => electron.appData}, shell: {}}))

let root: string, project: string, key: string
let runtime: VpmRuntime
let registry: ProjectActivityRegistry
let running: boolean, coreRunning: boolean
let handlers: Map<string, (...args: unknown[]) => unknown>
let trash: ReturnType<typeof vi.fn>, forget: ReturnType<typeof vi.fn>
const remove = () => Promise.resolve(handlers.get(IpcInvoke.Vpm.ProjectTrash)!(key))

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-trash-')))
  setAppPathsForTest(root); electron.appData = path.join(root, 'Roaming')
  project = path.join(root, 'Project')
  for(const dir of ['Assets', 'ProjectSettings', 'Packages']) fs.mkdirSync(path.join(project, dir), {recursive: true})
  fs.writeFileSync(path.join(project, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n')
  fs.writeFileSync(path.join(project, 'Packages/manifest.json'), '{"dependencies":{}}')
  const data = path.join(root, 'data'); fs.mkdirSync(data)
  running = false; coreRunning = false
  registry = new ProjectActivityRegistry({isUnityRunning: () => running})
  trash = vi.fn(async () => {}); forget = vi.fn()
  runtime = await initVpm({dataRoot: data, userAgent: 'Atrium/test', isNetworkAllowed: () => false,
    unityDiscovery: {appDataDir: root, localAppData: root, programFiles: [], extraRoots: []},
    coreProjects: {list: () => [{id: 'core', path: project, name: 'Project', unityVersion: '2022.3.22f1', running: coreRunning, detectedBy: [], bridgeVersion: null}]},
    projectActivity: createProjectActivityPort(registry), trashPath: trash, forgetCoreProject: forget})
  key = runtime.projects.addExisting(project).ledger.projectKey
  handlers = new Map()
  registerProjectIpc({ipc: {handle: (channel, fn) => handlers.set(channel, fn as (...args: unknown[]) => unknown)}, getRuntime: () => runtime})
})
afterEach(() => {runtime?.dispose(); fs.rmSync(root, {recursive: true, force: true})})

describe('project deletion activity protection', () => {
  it.each(['core', 'live'])('refuses a running project detected by %s', async source => {
    if(source === 'core') coreRunning = true; else running = true
    await expect(remove()).rejects.toMatchObject({code: 'vpmUnityRunning'})
    expect(trash).not.toHaveBeenCalled(); expect(forget).not.toHaveBeenCalled()
    expect(fs.existsSync(project)).toBe(true)
  })
  it('refuses during import and retains the ledger', async () => {
    const release = registry.beginImport(project)
    await expect(remove()).rejects.toMatchObject({code: 'vpmProjectImporting'})
    expect(trash).not.toHaveBeenCalled(); expect(runtime.projects.get(key)?.ledger).toBeTruthy()
    release()
  })
  it('refuses during other maintenance', async () => {
    const lease = registry.acquireMaintenance(project, 'backup')
    await expect(remove()).rejects.toMatchObject({code: 'vpmProjectBusy'})
    expect(trash).not.toHaveBeenCalled(); lease.release()
  })
  it('holds the lease across recycling and prevents new imports and duplicate deletion', async () => {
    let finish!: () => void
    trash.mockImplementation(() => new Promise<void>(resolve => {finish = resolve}))
    const pending = remove()
    expect(registry.state(project).maintenance).toBe('trash-project')
    expect(() => registry.beginImport(project)).toThrow()
    await expect(remove()).rejects.toMatchObject({code: 'vpmProjectBusy'})
    expect(trash).toHaveBeenCalledTimes(1)
    finish(); await expect(pending).resolves.toMatchObject({ok: true, mode: 'recycle'})
    expect(registry.state(project).maintenance).toBeNull(); expect(forget).toHaveBeenCalledWith(project)
  })
  it('retains the recoverable fallback and releases its lease', async () => {
    trash.mockRejectedValue(new Error('recycle unavailable'))
    await expect(remove()).resolves.toMatchObject({ok: true, mode: 'atrium'})
    expect(fs.existsSync(project)).toBe(false)
    const targets = fs.readdirSync(path.join(electron.appData, 'Atrium/trash'))
    expect(targets).toHaveLength(1)
    expect(registry.state(project).maintenance).toBeNull()
  })
  it('releases on fallback failure without removing the ledger or source', async () => {
    trash.mockRejectedValue(new Error('recycle unavailable'))
    fs.writeFileSync(electron.appData, 'not a directory')
    await expect(remove()).rejects.toBeTruthy()
    expect(registry.state(project).maintenance).toBeNull()
    expect(runtime.projects.get(key)?.ledger).toBeTruthy(); expect(fs.existsSync(project)).toBe(true)
  })
  it('releases when the source is already missing', async () => {
    fs.rmSync(project, {recursive: true})
    await expect(remove()).resolves.toMatchObject({ok: true, mode: 'missing'})
    expect(trash).not.toHaveBeenCalled(); expect(registry.state(project).maintenance).toBeNull()
  })
  it('fails closed if the activity port was not connected', async () => {
    runtime.activity = undefined
    await expect(remove()).rejects.toMatchObject({code: 'vpmInternal'})
    expect(trash).not.toHaveBeenCalled()
  })
})
