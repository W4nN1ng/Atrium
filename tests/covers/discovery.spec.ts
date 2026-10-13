import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { CoverService } from '../../src/main/covers/service'
import { getCover } from '../../src/main/db/repos/covers'
import { setAppPathsForTest } from '../../src/main/services/paths'
import type { BridgeManager, BridgeExecResult } from '../../src/main/bridge/manager'

vi.mock('electron', () => ({ app: {}, nativeImage: {} }))
const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32)
const success = { ok: true as const, status: 'ok' as const, commandId: 'fixture',
  error: null, stackTrace: null, elapsedMs: 0, retries: 0 }
const target = (guid = A) => ({ id: 'asset:' + guid, name: 'Chocolate', path: 'Assets/Chocolate.prefab',
  sourceGuid: guid, persistent: true, isScene: false })
let root: string, project: string, db: Db, service: CoverService
let execute: (projectPath: string, command: string, payload: unknown, options?: { id?: string; signal?: AbortSignal }) => Promise<BridgeExecResult>
function heartbeat(capabilities = ['object_preview', 'preview_candidates'], bridgeVersion = '1.2.0'): void {
  fs.writeFileSync(path.join(project, 'Temp', 'AVCABridge', 'bridge.json'), JSON.stringify({ protocolVersion: 1,
    pid: process.pid, projectPath: project, projectName: 'Fixture', unityVersion: '2022.3.22f1', bridgeVersion,
    capabilities, isPlaying: false, isCompiling: false, isUpdating: false, isPlayingOrWillChangePlaymode: false,
    activeScene: null, queueLength: 0, heartbeatUtc: Date.now() }))
}
function imported(id: string, created: string[], overwritten: string[] = [], member: string | null = null,
  assetId = 'card', projectId = 'project'): void {
  db.prepare(`INSERT INTO import_log(id,project_id,container_asset_id,asset_id,member_rel_path,
    created_guids_json,overwritten_json,status,kind) VALUES(?,?,?,?,?,?,?,'ok','import')`)
    .run(id, projectId, member ? assetId : null, member ? null : assetId, member, JSON.stringify(created), JSON.stringify(overwritten))
}
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-cover-discovery-')))
  project = path.join(root, 'project'); fs.mkdirSync(path.join(project, 'Temp', 'AVCABridge'), { recursive: true })
  setAppPathsForTest(path.join(root, 'app'))
  db = new Database(':memory:'); migrate(db)
  db.prepare('INSERT INTO project(id,path,name) VALUES(?,?,?)').run('project', project, 'Fixture')
  for (const id of ['card', 'other']) upsertAsset(db, makeAssetRow({ id, name: id, raw_name: id,
    category: 'props', cover_image: 'athumb://original.jpg' }))
  heartbeat()
  execute = async () => ({ ...success, data: { targets: [target()], truncated: false } })
  service = new CoverService({ db, manager: { execute: (...args: Parameters<typeof execute>) => execute(...args) } as unknown as BridgeManager })
})
afterEach(() => { service.dispose(); db.close(); fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks() })

describe('first cover candidate discovery', () => {
  it('matches exact imported and overwritten GUIDs in the selected card/project and retains member provenance', async () => {
    imported('original', [A], [], 'Original/Chocolate.unitypackage')
    imported('variant', [], [A, B], 'Variant/Chocolate.unitypackage')
    imported('unrelated-card', [C], [], null, 'other')
    imported('unrelated-project', [C], [], null, 'card', 'another')
    execute = async (receivedProject, command, payload) => {
      expect(receivedProject).toBe(project); expect(command).toBe('get_preview_candidates')
      expect((payload as { guids: string[] }).guids.sort()).toEqual([A, B])
      return { ...success, data: { targets: [target(A), target(B)], truncated: false } }
    }
    const result = await service.discover('card', 'project', 'find-one')
    expect(result.targets).toEqual([
      { ...target(A), memberPaths: ['Original/Chocolate.unitypackage', 'Variant/Chocolate.unitypackage'] },
      { ...target(B), memberPaths: ['Variant/Chocolate.unitypackage'] }
    ])
    expect(db.prepare('SELECT cover_image FROM asset WHERE id=?').get('card')).toEqual({ cover_image: 'athumb://original.jpg' })
    expect(getCover(db, 'card')).toBeNull()
  })

  it('keeps manual previews available but requests an update for a bridge without automatic candidate support', async () => {
    heartbeat(['object_preview'], '1.1.1')
    expect(service.status('card', 'project')).toMatchObject({ bridge: 'ready', candidates: false })
    await expect(service.discover('card', 'project', 'find-one')).rejects.toThrow('covers.bridgeUpgrade')
    expect((await service.targets('project', 'Chocolate'))[0].name).toBe('Chocolate')
  })

  it('rejects a wrong resource returned by the bridge rather than associating a different card', async () => {
    imported('one', [A])
    execute = async () => ({ ...success, data: { targets: [target(B)], truncated: false } })
    await expect(service.discover('card', 'project', 'find-one')).rejects.toThrow('covers.invalidRequest')
    expect(getCover(db, 'card')).toBeNull()
  })

  it('requires persistent asset candidates and rejects malformed bridge result metadata', async () => {
    imported('one', [A])
    execute = async () => ({ ...success, data: {
      targets: [{ ...target(), isScene: true, persistent: false }], truncated: false } })
    await expect(service.discover('card', 'project', 'find-one')).rejects.toThrow('covers.invalidRequest')
    execute = async () => ({ ...success, data: { targets: [target()], truncated: 'false' } })
    await expect(service.discover('card', 'project', 'find-two')).rejects.toThrow('covers.invalidRequest')
  })

  it('returns an empty actionable result without a bridge search when the source inventory is unavailable', async () => {
    execute = async () => { throw Error('The bridge must not guess by card name') }
    const result = await service.discover('card', 'project', 'find-one')
    expect(result.targets).toEqual([])
    expect(result.warnings).toContain('covers.sourceUnavailable')
  })

  it('marks undisplayed candidates as limited instead of silently claiming a complete list', async () => {
    const guids = Array.from({ length: 501 }, (_, i) => (i + 1).toString(16).padStart(32, '0'))
    imported('large', guids)
    execute = async (_project, _command, payload) => {
      const batch = (payload as { guids: string[] }).guids
      expect(batch.length).toBeLessThanOrEqual(500)
      return { ...success, data: { targets: batch.slice(0, 50).map(g => target(g)), truncated: true } }
    }
    const result = await service.discover('card', 'project', 'find-one')
    expect(result.targets).toHaveLength(50); expect(result.truncated).toBe(true)
  })

  it('cancels discovery and rejects late results without creating a saved cover', async () => {
    imported('one', [A])
    let release!: (result: BridgeExecResult) => void
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    execute = async (_project, _command, _payload, opts) => {
      expect(opts?.signal).toBeDefined(); started()
      return new Promise(resolve => { release = resolve })
    }
    const pending = service.discover('card', 'project', 'find-one')
    await ready; service.discard('find-one')
    release({ ...success, data: { targets: [target()], truncated: false } })
    await expect(pending).rejects.toThrow('covers.cancelled')
    expect(getCover(db, 'card')).toBeNull()
  })

  it('rejects duplicate pending IDs without cancelling the original discovery', async () => {
    imported('one', [A])
    let release!: (result: BridgeExecResult) => void
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    execute = async () => { started(); return new Promise(resolve => { release = resolve }) }
    const first = service.discover('card', 'project', 'find-one'); await ready
    await expect(service.discover('card', 'project', 'find-one')).rejects.toThrow('covers.invalidRequest')
    release({ ...success, data: { targets: [target()], truncated: false } })
    expect((await first).targets).toHaveLength(1)
  })

  it('rejects invalid requests and stale projects before consulting local source files', async () => {
    await expect(service.discover('card', 'project', '../invalid')).rejects.toThrow('covers.invalidRequest')
    await expect(service.discover('missing', 'project', 'find-one')).rejects.toThrow('covers.assetMissing')
    await expect(service.discover('card', 'missing', 'find-one')).rejects.toThrow('covers.projectMissing')
    service.dispose()
    await expect(service.discover('card', 'project', 'find-one')).rejects.toThrow('covers.cancelled')
  })
})
