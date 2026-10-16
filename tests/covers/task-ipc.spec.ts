import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { setAppPathsForTest } from '../../src/main/services/paths'
import { registerCoverIpc } from '../../src/main/covers/ipc'
import type { BridgeManager } from '../../src/main/bridge/manager'
import type { IpcRegistrar } from '../../src/main/ipc/types'
import type { CoverService } from '../../src/main/covers/service'
import type { CoverTask } from '../../src/shared/coverTasks'

const external = vi.hoisted(() => ({ discover: vi.fn(), dispose: vi.fn() }))
vi.mock('electron', () => ({ app: {}, nativeImage: {} }))
vi.mock('../../src/main/services/settings', () => ({
  getSettings: () => ({ unityExePath: '', coverDependencyProjectId: '' }), setSettings: vi.fn()
}))
vi.mock('../../src/main/covers/packageProvider', () => ({ PackageCoverProvider: class {
  discover = external.discover
  dispose = external.dispose
  status = () => ({ available: true, editorPath: 'fixture/Unity.exe', version: '2022.3.22f1' })
} }))

let db: Db, service: CoverService, root: string
const handlers = new Map<string, (...args: any[]) => any>()
const call = (channel: string, ...args: unknown[]): any => {
  const handler = handlers.get('covers:' + channel)
  if (!handler) throw new Error('Missing production IPC: covers:' + channel)
  return handler(...args)
}
const card = (id: string, extra = {}) => upsertAsset(db, makeAssetRow({ id, name: id, raw_name: id, category: 'props', ...extra }))
async function settled(id: string): Promise<CoverTask> {
  for (let i = 0; i < 300; i++) {
    const task = call('task-status', id) as CoverTask
    if (!task.running) return task
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Cover IPC task did not settle')
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-cover-task-ipc-'))
  setAppPathsForTest(root)
  db = new Database(':memory:'); migrate(db)
  handlers.clear(); external.discover.mockReset(); external.dispose.mockReset()
  external.discover.mockResolvedValue({ targets: [], warnings: [], truncated: false })
  service = registerCoverIpc(db, {} as BridgeManager, {
    ipc: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) }, broadcast: vi.fn()
  } as IpcRegistrar)
})
afterEach(() => { service?.dispose(); db?.close(); fs.rmSync(root, { recursive: true, force: true }) })

it('starts a real main-process whole-library task through IPC, including rows beyond the visible 500', async () => {
  db.transaction(() => { for (let i = 0; i < 503; i++) card('card-' + i) })()
  card('photo', { attachment_kind: 'image' })
  const task = call('start-task', { scope: 'all' }) as CoverTask
  expect(task.items).toHaveLength(503)
  const result = await settled(task.id)
  expect(result.items.some(item => item.assetId === 'card-502')).toBe(true)
  expect(result.items.some(item => item.assetId === 'photo')).toBe(false)
  expect(call('task-status')?.id).toBe(task.id)
})

it('protects an existing product cover without invoking package discovery', async () => {
  card('product', { cover_image: 'athumb://product.jpg' })
  const task = call('start-task', { scope: 'all' }) as CoverTask
  expect((await settled(task.id)).items[0].state).toBe('skipped')
  expect(external.discover).not.toHaveBeenCalled()
})

it('rejects a malformed scope and an attempt to apply another task item through production handlers', async () => {
  expect(() => call('start-task', { scope: 'not-a-scope' })).toThrow('covers.invalidRequest')
  card('one')
  const task = call('start-task', { scope: 'ids', assetIds: ['one'] }) as CoverTask
  await settled(task.id)
  await expect(Promise.resolve().then(() => call('apply-task-choice', task.id, 'unrelated', 'fake-target'))).rejects.toThrow()
})

it('the existing service lifecycle aborts its cover task before a late package discovery returns', async () => {
  card('one')
  let release!: (value: unknown) => void
  let seenSignal: AbortSignal | undefined
  external.discover.mockImplementation((_asset, _request, _dependency, signal) => {
    seenSignal = signal
    return new Promise(resolve => { release = resolve })
  })
  const task = call('start-task', { scope: 'all' }) as CoverTask
  for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 2))
  expect(release).toBeTypeOf('function')
  service.dispose()
  expect(seenSignal?.aborted).toBe(true)
  release({ targets: [], warnings: [], truncated: false })
  await new Promise(resolve => setTimeout(resolve, 10))
  expect((call('task-status', task.id) as CoverTask).items.every(item => item.state !== 'done')).toBe(true)
})
