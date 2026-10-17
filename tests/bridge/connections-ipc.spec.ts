import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import * as tar from 'tar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate, type Db } from '../../src/main/db'
import { upsertProject } from '../../src/main/db/repos/unity'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { registerBridgeIpc } from '../../src/main/bridge/ipc'
import { BridgeManager } from '../../src/main/bridge/manager'
import { installBridge } from '../../src/main/bridge/installer'
import { UnityConnections } from '../../src/main/project/connections'
import { getSettings, setSettings } from '../../src/main/services/settings'
import { bridgeTemplateRoot, setAppPathsForTest } from '../../src/main/services/paths'
import type { ProjectInfo, PlanView } from '../../src/shared/types'
import type { UnityConnectionSnapshot, UnityTargetResolution } from '../../src/shared/unityConnection'
import { FakeUnity } from './fake-unity'

let root: string, db: Db, manager: BridgeManager, connections: UnityConnections
let first: ProjectInfo, second: ProjectInfo, api: ReturnType<typeof registerBridgeIpc>
let handlers: Map<string, (...args: unknown[]) => unknown>, peers: FakeUnity[]
let trash: (file: string) => Promise<void>

const call = async <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error('Missing IPC: ' + channel)
  return await handler(...args) as T
}
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
function project(name: string): ProjectInfo {
  const dir = path.join(root, name)
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'ProjectSettings'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 2022.3.22f1\n')
  const row = upsertProject(db, { path: dir, name, unityVersion: '2022.3.22f1', isRunning: true })
  return { id: row.id, path: dir, name, unityVersion: '2022.3.22f1', running: true,
    detectedBy: ['lockfile'], bridgeVersion: null, bridgeInstalled: false }
}
function peer(p: ProjectInfo): FakeUnity {
  installBridge(db, p.path, bridgeTemplateRoot())
  const fake = new FakeUnity(p.path)
  fake.heartbeat()
  fake.onCommand(command => command.type === 'resolve_guids'
    ? { status: 'ok', data: { resolved: {} } }
    : { status: 'ok', data: { createdGuids: [], overwrittenGuids: [] } })
  fake.start(10); peers.push(fake)
  return fake
}
async function sourcePackage(): Promise<string> {
  const source = path.join(root, 'package-source'), guid = 'a'.repeat(32)
  fs.mkdirSync(path.join(source, guid), { recursive: true })
  fs.writeFileSync(path.join(source, guid, 'pathname'), 'Assets/Example.prefab')
  fs.writeFileSync(path.join(source, guid, 'asset'), 'example')
  fs.writeFileSync(path.join(source, guid, 'asset.meta'), 'fileFormatVersion: 2')
  const file = path.join(root, 'example.unitypackage')
  await tar.c({ gzip: true, cwd: source, file }, [guid])
  return file
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-connections-ipc-')))
  setAppPathsForTest(path.join(root, 'app'))
  setSettings({ unityAutoConnect: true, unityAutoConnectExcludedProjectIds: [],
    libraryRoot: path.join(root, 'library'), extractRoot: path.join(root, 'extract') })
  db = new Database(':memory:'); migrate(db)
  manager = new BridgeManager(); peers = []; handlers = new Map()
  first = project('First'); second = project('Second')
  connections = new UnityConnections({
    config: () => ({ enabled: getSettings().unityAutoConnect, excludedProjectIds: getSettings().unityAutoConnectExcludedProjectIds }),
    install: p => installBridge(db, p.path, bridgeTemplateRoot()),
    statusOf: dir => manager.statusOf(dir), watch: dir => manager.watch(dir), changed: () => undefined
  })
  trash = file => fs.promises.rm(file, { recursive: true, force: true })
  api = registerBridgeIpc({ db, manager, connections,
    registrar: { ipc: { handle: (channel, handler) => { handlers.set(channel, handler as (...args: unknown[]) => unknown) } }, broadcast: () => undefined },
    trashFn: file => trash(file), extractDisk: { driveOf: () => 'e', freeBytes: () => 50 * 1073741824 }
  })
  connections.update([first])
})
afterEach(() => {
  api?.dispose(); connections?.dispose(); manager?.dispose()
  for (const fake of peers) fake.stop()
  db?.close(); fs.rmSync(root, { recursive: true, force: true })
})

describe('connection IPC and computed import target', () => {
  it('reports the automatic target and a running project before its bridge is ready, without importing', async () => {
    expect(await call('unity:resolve-target')).toEqual({ kind: 'selected', projectId: first.id, projectName: 'First' })
    expect(await call('unity:status')).toMatchObject({ targetProjectId: first.id, running: true, bridgeReady: false })
    expect(api.targetProjectId()).toBe(first.id)
    await flush()
    expect((await call<UnityConnectionSnapshot>('unity:connection')).projects[0].phase).toBe('connecting')
    const fake = peer(first)
    connections.update([first])
    expect(await call('unity:prepare-target', first.id, 'ready-request')).toMatchObject({ projectId: first.id, phase: 'ready' })
    expect(fake.received).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM import_log').get()).toEqual({ n: 0 })
  })

  it('never falls back to an earlier manual local target when controller selection becomes ambiguous', async () => {
    await call('unity:set-target', first.id)
    connections.select(null); connections.update([first, second])
    expect(await call<UnityTargetResolution>('unity:resolve-target')).toEqual({ kind: 'choose', projectIds: [first.id, second.id] })
    expect((await call<{ targetProjectId: string | null }>('unity:status')).targetProjectId).toBeNull()
    expect(api.targetProjectId()).toBeNull()
    expect(await call('unity:preflight', { packagePath: 'unused' })).toMatchObject({ ok: false, reasonKey: 'unity.errNoProject' })
    expect(await call('unity:import-package', { packagePath: 'unused' })).toMatchObject({ ok: false })
    expect(await call('unity:import-plan', { assetId: 'unused', members: ['unused'] })).toMatchObject({ ok: false, reasonKey: 'unity.errNoProject' })
    connections.update([])
    expect(await call('unity:resolve-target')).toEqual({ kind: 'none' })
  })

  it('resolves explicit import IDs ahead of the automatic target and fixes a staged batch to that ID', async () => {
    const fakeFirst = peer(first), fakeSecond = peer(second)
    connections.update([first, second]); connections.select(first.id)
    const file = await sourcePackage()
    expect(await call('unity:preflight', { packagePath: file, projectId: second.id })).toMatchObject({ ok: true, projectId: second.id })
    upsertAsset(db, makeAssetRow({ id: 'asset-one', name: 'Example', raw_name: 'Example', category: 'props', source_path: file }))
    const plan = await call<PlanView>('unity:import-plan', { assetId: 'asset-one', members: [path.basename(file)], projectId: second.id })
    expect(plan.ok).toBe(true)
    connections.select(first.id)
    expect(await call('unity:import-commit', { batchId: plan.batchId })).toMatchObject({ ok: true })
    expect(fakeFirst.received).toEqual([])
    expect(fakeSecond.received.some(command => command.type === 'import_unitypackage')).toBe(true)
    expect(db.prepare('SELECT DISTINCT project_id FROM import_log').all()).toEqual([{ project_id: second.id }])
  })

  it('uses the current computed target for each new default import request', async () => {
    const fake = peer(second), file = await sourcePackage()
    connections.update([second])
    expect(await call('unity:preflight', { packagePath: file })).toMatchObject({ ok: true, projectId: second.id })
    expect(await call('unity:import-package', { packagePath: file })).toMatchObject({ ok: true })
    expect(fake.received.some(command => command.type === 'import_unitypackage')).toBe(true)
    expect(db.prepare('SELECT DISTINCT project_id FROM import_log').all()).toEqual([{ project_id: second.id }])
  })

  it('returns the automatic target when clearing a manual choice with one eligible project', async () => {
    await call('unity:set-target', first.id)
    expect(await call('unity:set-target', null)).toBe(first.id)
    expect(api.targetProjectId()).toBe(first.id)
  })
})

describe('fixed, independently cancellable target preparation', () => {
  it('keeps waiting for its initial project after the global target changes', async () => {
    connections.update([first, second]); connections.select(first.id)
    const pending = call('unity:prepare-target', first.id, 'fixed-target')
    connections.select(second.id)
    peer(first); connections.update([first, second])
    expect(await pending).toMatchObject({ projectId: first.id, phase: 'ready' })
    expect(api.targetProjectId()).toBe(second.id)
  })

  it('rejects duplicate pending IDs and cancels only the requested wait', async () => {
    connections.update([first, second])
    const one = call('unity:prepare-target', first.id, 'one').catch(error => error.message)
    const two = call('unity:prepare-target', second.id, 'two').then(value => ({ value }), error => ({ error }))
    await expect(call('unity:prepare-target', second.id, 'one')).rejects.toThrow('project.connectionFailed')
    await call('unity:cancel-target-preparation', 'one')
    expect(await one).toBe('project.connectionCancelled')
    peer(second); connections.update([first, second])
    expect(await two).toMatchObject({ value: { projectId: second.id, phase: 'ready' } })
    await call('unity:cancel-target-preparation', 'unknown-valid')
  })

  it.each(['', 'a'.repeat(81), '../escape', '含中文', 123, null])('rejects a malformed preparation or cancellation request ID (%s)', async id => {
    await expect(call('unity:prepare-target', first.id, id)).rejects.toThrow('project.connectionFailed')
    await expect(call('unity:cancel-target-preparation', id)).rejects.toThrow('project.connectionFailed')
  })

  it('aborts pending waits on IPC disposal and rejects new waits', async () => {
    const pending = call('unity:prepare-target', first.id, 'exit').catch(error => error.message)
    api.dispose()
    expect(await pending).toBe('project.connectionCancelled')
    await expect(call('unity:prepare-target', first.id, 'after-exit')).rejects.toThrow('project.connectionCancelled')
  })

  it('rejects a ready result cancelled before its IPC continuation returns', async () => {
    peer(first); connections.update([first])
    const pending = call('unity:prepare-target', first.id, 'ready-cancel').catch(error => error.message)
    await call('unity:cancel-target-preparation', 'ready-cancel')
    expect(await pending).toBe('project.connectionCancelled')
  })

  it('rejects unknown project IDs without starting any preparation', async () => {
    await expect(call('unity:prepare-target', 'not-registered', 'unknown')).rejects.toThrow('project.connectionProjectMissing')
    await expect(call('unity:retry-connection', 'not-registered')).rejects.toThrow('project.connectionProjectMissing')
  })
})

describe('explicit bridge exclusion persistence', () => {
  it('persists a single exclusion before trash starts, so the next controller poll cannot reinstall', async () => {
    await flush()
    trash = async file => {
      expect(getSettings().unityAutoConnectExcludedProjectIds).toContain(first.id)
      await fs.promises.rm(file, { recursive: true, force: true })
      connections.update([first])
      await flush()
    }
    expect(await call('unity:uninstall-bridge', first.id)).toMatchObject({ ok: true })
    expect(fs.existsSync(path.join(first.path, 'Packages', 'com.avca.bridge'))).toBe(false)
    expect(connections.snapshot().projects[0].phase).toBe('disabled')
  })

  it('keeps an exclusion when uninstall fails instead of repeatedly trying to auto-install', async () => {
    await flush()
    trash = async () => { throw new Error('Fixture locked') }
    expect(await call('unity:uninstall-bridge', first.id)).toMatchObject({ ok: false })
    expect(getSettings().unityAutoConnectExcludedProjectIds).toContain(first.id)
  })

  it('records all registered IDs before uninstall-all starts, preserving prior exclusions', async () => {
    await flush()
    setSettings({ unityAutoConnectExcludedProjectIds: ['previous'] })
    trash = async file => {
      expect(getSettings().unityAutoConnectExcludedProjectIds).toEqual(expect.arrayContaining(['previous', first.id, second.id]))
      await fs.promises.rm(file, { recursive: true, force: true })
    }
    expect(await call('unity:uninstall-bridge-all')).toMatchObject({ failed: [] })
  })

  it.each(['unity:retry-connection', 'unity:install-bridge'])('%s clears only its exclusion and retries the controller once', async channel => {
    await flush()
    setSettings({ unityAutoConnectExcludedProjectIds: [first.id, second.id] })
    const retry = vi.spyOn(connections, 'retry')
    await call(channel, first.id)
    expect(getSettings().unityAutoConnectExcludedProjectIds).toEqual([second.id])
    expect(retry).toHaveBeenCalledOnce(); expect(retry).toHaveBeenCalledWith(first.id)
    expect(connections.snapshot().projects[0].phase).toBe('connecting')
    expect(db.prepare('SELECT COUNT(*) AS n FROM import_log').get()).toEqual({ n: 0 })
  })

  it('can explicitly reconnect and import after uninstalling without changing another project exclusion', async () => {
    await flush()
    await call('unity:uninstall-bridge', first.id)
    setSettings({ unityAutoConnectExcludedProjectIds: [first.id, second.id] })
    await call('unity:retry-connection', first.id); await flush()
    expect(fs.existsSync(path.join(first.path, 'Packages', 'com.avca.bridge', 'package.json'))).toBe(true)
    const fake = peer(first); connections.update([first])
    await call('unity:prepare-target', first.id, 'reconnect')
    expect(await call('unity:import-package', { packagePath: await sourcePackage() })).toMatchObject({ ok: true })
    expect(fake.received.some(command => command.type === 'import_unitypackage')).toBe(true)
    expect(getSettings().unityAutoConnectExcludedProjectIds).toEqual([second.id])
  })
})
