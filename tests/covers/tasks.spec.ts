import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { getAsset, makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { getCover, saveCover } from '../../src/main/db/repos/covers'
import { CoverService } from '../../src/main/covers/service'
import { CoverTasks } from '../../src/main/covers/tasks'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import type { CoverCandidate, CoverDiscovery, CoverRequest } from '../../src/shared/covers'
import type { PackageCoverBackend } from '../../src/main/covers/packageProvider'
import { assetIndex } from '../../src/main/search'

vi.mock('electron', () => ({ app: {}, nativeImage: {} }))
const candidate = (n = 0): CoverCandidate => {
  const guid = n.toString(16).padStart(32, 'a')
  return { id: 'package:' + guid, name: 'Object ' + n, path: 'Assets/Object' + n + '.prefab', sourceGuid: guid,
    persistent: true, isScene: false, memberPaths: ['source.unitypackage'] }
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000280000001e0', 'hex')
const options = { direction: 'right' as const, background: 'light' as const }
let root: string, db: Db, service: CoverService, tasks: CoverTasks
let discovery: (id: string) => Promise<CoverDiscovery>
let render: (request: CoverRequest) => Promise<void>
let requests: CoverRequest[]
let dependency: string | null
const add = (id: string, extra = {}) => upsertAsset(db, makeAssetRow({ id, name: id, raw_name: id, category: 'props', ...extra }))
const image = (id = 'one') => getAsset(db, id)?.cover_image
const start = (...ids: string[]) => tasks.start({ scope: 'ids', assetIds: ids })
async function finished(id: string): Promise<void> {
  for (let n = 0; n < 250; n++) { if (!tasks.status(id)?.running) return; await new Promise(r => setTimeout(r, 2)) }
  throw new Error('Task did not finish')
}
async function until(test: () => boolean): Promise<void> {
  for (let n = 0; n < 100; n++) { if (test()) return; await new Promise(r => setTimeout(r, 2)) }
  throw new Error('Condition not reached')
}
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-cover-tasks-')))
  setAppPathsForTest(path.join(root, 'app')); fs.mkdirSync(P.thumbs(), { recursive: true })
  db = new Database(':memory:'); migrate(db); add('one'); add('two')
  requests = []; dependency = null
  discovery = async () => ({ targets: [candidate()], warnings: [], truncated: false })
  render = async () => undefined
  const provider: PackageCoverBackend = {
    status: () => ({ available: true, editorPath: 'Unity', version: '2022.3.22f1' }),
    discover: async id => discovery(id),
    preview: async request => { requests.push(request); await render(request); return { bytes: PNG, width: 640, height: 480, rendererCount: 1,
      fingerprint: 'source', dependencyProjectId: request.dependencyProjectId ?? null } },
    assertCurrent: () => undefined, dispose: () => undefined
  }
  service = new CoverService({ db, manager: { execute: async () => { throw new Error('Unexpected project bridge') } }, packageProvider: provider,
    writeImage(bytes, key) { fs.writeFileSync(path.join(P.thumbs(), key + '.jpg'), bytes); return { ok: true, url: 'athumb://' + key + '.jpg' } }
  })
  tasks = new CoverTasks({ db, service, setup: () => ({ dependencies: [], recommendedProjectId: dependency, reason: dependency ? 'single' : 'none' }) })
})
afterEach(() => { tasks?.dispose(); service.dispose(); db.close(); fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks() })

describe('whole-library cover tasks', () => {
  it('scans every real row beyond 500 including children and grouped variants, excluding attachments', async () => {
    for (let n = 0; n < 503; n++) add('asset-' + n, { cover_image: 'athumb://product.jpg', group_id: 'same' })
    add('child', { parent_asset_id: 'asset-0', cover_image: 'athumb://product.jpg' })
    add('attachment', { attachment_kind: 'image', parent_asset_id: 'asset-0' })
    const task = tasks.start({ scope: 'all' }); await finished(task.id)
    const result = tasks.status(task.id)!
    expect(result.items).toHaveLength(506)
    expect(result.items.some(i => i.assetId === 'child')).toBe(true)
    expect(result.items.some(i => i.assetId === 'attachment')).toBe(false)
    expect(result.items.filter(i => i.state === 'done')).toHaveLength(2)
  })
  it('keeps filtered semantics while ignoring pagination and protecting original product images', async () => {
    add('one', { cover_image: 'athumb://product.jpg' }); add('two', { category: 'avatar' }); add('child', { parent_asset_id: 'one' })
    const task = tasks.start({ scope: 'filtered', filter: { category: 'props', limit: 1, offset: 20 } }); await finished(task.id)
    expect(tasks.status(task.id)?.items.map(i => [i.assetId, i.state])).toEqual([['one', 'skipped']])
    expect(image()).toBe('athumb://product.jpg')
  })
  it('automatically saves only a complete unique candidate and uses the recommended dependency', async () => {
    dependency = 'known-shaders'
    const task = start('one'); await finished(task.id)
    expect(tasks.status(task.id)?.items[0].state).toBe('done')
    expect(getCover(db, 'one')).toMatchObject({ source: 'package', projectId: 'known-shaders', target: candidate(), previousImage: null })
    expect(requests[0].dependencyProjectId).toBe('known-shaders')
    expect(tasks.status(task.id)?.canUndo).toBe(true)
  })
  it.each([{ warnings: ['covers.packageResourcesExcluded'], truncated: false }, { warnings: [], truncated: true }])('requires review for incomplete discovery %o', async flags => {
    discovery = async () => ({ targets: [candidate()], ...flags })
    const task = start('one'); await finished(task.id)
    expect(tasks.status(task.id)?.items[0].state).toBe('review')
    expect(image()).toBeNull(); expect(requests).toHaveLength(0)
  })
  it('keeps ambiguous candidates uncommitted, generates only one page, and applies a clicked choice', async () => {
    discovery = async () => ({ targets: Array.from({ length: 12 }, (_, n) => candidate(n)), warnings: [], truncated: false })
    const task = start('one'); await finished(task.id)
    expect(tasks.status(task.id)?.items[0].state).toBe('review'); expect(requests).toHaveLength(0)
    const page = await tasks.choices(task.id, 'one')
    expect(page.total).toBe(12); expect(page.choices).toHaveLength(8)
    expect(page.choices.every(c => c.preview !== null)).toBe(true); expect(image()).toBeNull()
    await tasks.apply(task.id, 'one', candidate(2).id)
    expect(getCover(db, 'one')?.target).toEqual(candidate(2))
    expect(tasks.status(task.id)?.items[0].state).toBe('done')
    expect(fs.readdirSync(P.thumbs()).filter(name => name.startsWith('preview-'))).toHaveLength(0)
  })
  it('regenerates expired choice images and rejects candidates outside the task', async () => {
    discovery = async () => ({ targets: [candidate(1), candidate(2)], warnings: [], truncated: false })
    const task = start('one'); await finished(task.id); await tasks.choices(task.id, 'one')
    await expect(tasks.apply(task.id, 'one', candidate(3).id)).rejects.toThrow('covers.targetMissing')
    await expect(tasks.apply(task.id, 'two', candidate(1).id)).rejects.toThrow('covers.invalidRequest')
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000)
    await tasks.apply(task.id, 'one', candidate(1).id)
    expect(getCover(db, 'one')?.target?.id).toBe(candidate(1).id)
  })
  it('protects uploaded images and missing associations with nonempty product images', async () => {
    saveCover(db, { assetId: 'one', coverImage: 'athumb://manual.jpg', source: 'image', projectId: null, target: null, options: null })
    add('two', { cover_image: 'C:/original-product.jpg' }); add('empty', { cover_image: 'none' })
    const task = start('one', 'two', 'empty'); await finished(task.id)
    expect(tasks.status(task.id)?.items.map(i => i.state)).toEqual(['skipped', 'skipped', 'done'])
    expect(image()).toBe('athumb://manual.jpg'); expect(image('two')).toBe('C:/original-product.jpg')
  })
  it('re-renders existing package associations with exactly their persisted target and options', async () => {
    saveCover(db, { assetId: 'one', coverImage: 'athumb://old.jpg', source: 'package', projectId: 'saved-dependency', target: candidate(8), options })
    discovery = async () => { throw new Error('Existing association must not be rediscovered') }
    const first = start('one'); await finished(first.id); const firstImage = image()
    const second = start('one'); await finished(second.id)
    expect(image()).not.toBe(firstImage)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({ target: candidate(8), options, dependencyProjectId: 'saved-dependency' })
    expect(tasks.undo(second.id)).toEqual({ restored: 1, preserved: 0 })
    expect(image()).toBe(firstImage)
  })
  it('runs serially, cancels the active render and prevents late saves or later jobs', async () => {
    let release!: () => void
    render = async () => new Promise<void>(resolve => { release = resolve })
    const task = start('one', 'two'); await until(() => requests.length === 1)
    expect(() => start('two')).toThrow('covers.batchBusy')
    tasks.cancel(task.id); release(); await finished(task.id)
    expect(tasks.status(task.id)?.items.map(i => i.state)).toEqual(['cancelled', 'cancelled'])
    expect(requests).toHaveLength(1); expect(image()).toBeNull(); expect(image('two')).toBeNull()
  })
  it('does not overwrite a changed full association even when the image URL stays the same', async () => {
    saveCover(db, { assetId: 'one', coverImage: 'athumb://old.jpg', source: 'package', projectId: null, target: candidate(1), options })
    let release!: () => void
    render = async () => new Promise<void>(resolve => { release = resolve })
    const task = start('one'); await until(() => requests.length === 1)
    saveCover(db, { assetId: 'one', coverImage: 'athumb://old.jpg', source: 'package', projectId: null, target: candidate(2), options })
    release(); await finished(task.id)
    expect(getCover(db, 'one')?.target?.id).toBe(candidate(2).id)
    expect(tasks.status(task.id)?.items[0].reason).toBe('covers.changed')
  })
  it('skips rows deleted while rendering and undo never resurrects them', async () => {
    let release!: () => void
    render = async () => new Promise<void>(resolve => { release = resolve })
    const task = start('one'); await until(() => requests.length === 1)
    db.prepare('DELETE FROM asset WHERE id=?').run('one'); release(); await finished(task.id)
    expect(tasks.status(task.id)?.items[0].state).toBe('failed')
    expect(tasks.undo(task.id).restored).toBe(0); expect(getAsset(db, 'one')).toBeNull()
  })
  it('retries only failed items and keeps the original before snapshot for undo', async () => {
    let fail = true
    render = async request => { if (fail && request.assetId === 'one') throw new Error('covers.unsupportedShader\nShader detail') }
    const task = start('one', 'two'); await finished(task.id)
    const twoImage = image('two'); fail = false
    tasks.retry(task.id); await finished(task.id)
    expect(image('two')).toBe(twoImage)
    expect(tasks.status(task.id)?.items.every(i => i.state === 'done')).toBe(true)
    expect(tasks.undo(task.id)).toEqual({ restored: 2, preserved: 0 })
    expect(image()).toBeNull(); expect(getCover(db, 'one')).toBeNull()
  })
  it('returns actionable no-model and rendering diagnostics without blocking the next asset', async () => {
    discovery = async id => id === 'one' ? { targets: [], warnings: [], truncated: false } : { targets: [candidate()], warnings: [], truncated: false }
    const task = start('one', 'two'); await finished(task.id)
    expect(tasks.status(task.id)?.items[0]).toMatchObject({ state: 'skipped', reason: 'covers.noCandidates' })
    expect(tasks.status(task.id)?.items[1].state).toBe('done')
  })
  it('rediscover choices after source changes and rejects the previously displayed choice', async () => {
    const source = path.join(root, 'source.unitypackage'); fs.writeFileSync(source, 'before'); add('one', { source_path: source })
    discovery = async () => ({ targets: [candidate(1), candidate(2)], warnings: [], truncated: false })
    const task = start('one'); await finished(task.id); await tasks.choices(task.id, 'one')
    fs.appendFileSync(source, '-changed')
    await expect(tasks.apply(task.id, 'one', candidate(1).id)).rejects.toThrow('covers.sourceChanged')
    expect(image()).toBeNull(); expect((await tasks.choices(task.id, 'one')).choices).toHaveLength(2)
    await tasks.apply(task.id, 'one', candidate(1).id)
    expect(image()).toMatch(/^athumb:\/\/cover-/)
  })
  it('preserves manual edits during candidate preview and rejects cancelled task selection', async () => {
    discovery = async () => ({ targets: [candidate(1), candidate(2)], warnings: [], truncated: false })
    const task = start('one'); await finished(task.id)
    let release!: () => void
    render = async () => new Promise<void>(resolve => { release = resolve })
    const page = tasks.choices(task.id, 'one'); await until(() => requests.length === 1)
    saveCover(db, { assetId: 'one', coverImage: 'athumb://manual.jpg', source: 'image', projectId: null, target: null, options: null })
    release(); await expect(page).rejects.toThrow('covers.changed')
    tasks.cancel(task.id)
    await expect(tasks.apply(task.id, 'one', candidate(1).id)).rejects.toThrow('covers.cancelled')
    expect(image()).toBe('athumb://manual.jpg')
  })
})

describe('saved Unity association compatibility', () => {
  function useUnityAssociation(scene: boolean): void {
    tasks.dispose(); service.dispose()
    const project = path.join(root, 'unity')
    fs.mkdirSync(path.join(project, 'Temp', 'AVCABridge', 'previews'), { recursive: true })
    fs.writeFileSync(path.join(project, 'Temp', 'AVCABridge', 'bridge.json'), JSON.stringify({ protocolVersion: 1, pid: process.pid,
      projectPath: project, bridgeVersion: '1.2.0', capabilities: ['object_preview'], isPlaying: false, isCompiling: false,
      isUpdating: false, isPlayingOrWillChangePlaymode: false, heartbeatUtc: Date.now() }))
    db.prepare('INSERT INTO project(id, path, name) VALUES (?, ?, ?)').run('unity', project, 'Unity')
    saveCover(db, { assetId: 'one', coverImage: 'athumb://old.jpg', source: 'unity', projectId: 'unity', target: { ...candidate(), id: 'persistent-unity', isScene: scene }, options })
    service = new CoverService({ db, manager: { execute: async (_p, _command, _payload, opts) => {
      const id = opts!.id!
      fs.writeFileSync(path.join(project, 'Temp', 'AVCABridge', 'previews', id + '.png'), PNG)
      return { ok: true, status: 'ok', error: null, stackTrace: null, elapsedMs: 1, retries: 0, commandId: id,
        data: { relativePath: 'previews/' + id + '.png', width: 640, height: 480, rendererCount: 1 } }
    } }, writeImage(bytes, key) { fs.writeFileSync(path.join(P.thumbs(), key + '.jpg'), bytes); return { ok: true, url: 'athumb://' + key + '.jpg' } } })
    tasks = new CoverTasks({ db, service, setup: () => { throw new Error('Unity associations must not discover package dependencies') } })
  }
  it('re-renders persistent saved scene targets without retargeting them', async () => {
    useUnityAssociation(true)
    const task = start('one'); await finished(task.id)
    expect(tasks.status(task.id)?.items[0].state).toBe('done')
    expect(getCover(db, 'one')).toMatchObject({ source: 'unity', projectId: 'unity', target: { id: 'persistent-unity', isScene: true }, options })
  })
  it('updates saved Unity targets when the original archive is gone and an ancestor has a broad source directory', async () => {
    add('parent', { source_path: root }); add('one', { parent_asset_id: 'parent', source_path: path.join(root, 'moved.unitypackage') })
    useUnityAssociation(false)
    const task = start('one'); await finished(task.id)
    expect(tasks.status(task.id)?.items[0].state).toBe('done')
    expect(image()).toMatch(/^athumb:\/\/cover-/)
  })
})

describe('task operation boundaries', () => {
  it('uses all indexed matches for current-filter tasks instead of SQL text matching or the visible page', async () => {
    vi.spyOn(assetIndex, 'ready', 'get').mockReturnValue(true)
    vi.spyOn(assetIndex, 'search').mockReturnValue([{ id: 'two', score: 1 }])
    const task = tasks.start({ scope: 'filtered', filter: { search: 'yifu', limit: 1, offset: 200 } })
    await finished(task.id)
    expect(task.items.map(item => item.assetId)).toEqual(['two'])
    vi.mocked(assetIndex.search).mockReturnValue([])
    const empty = tasks.start({ scope: 'filtered', filter: { search: 'yifu' } })
    expect(empty.items).toEqual([])
    await finished(empty.id)
  })
  it('requires a fresh choice page if the selected shader dependency changes after the images were shown', async () => {
    discovery = async () => ({ targets: [candidate(1), candidate(2)], warnings: [], truncated: false })
    dependency = 'dependency-a'
    const task = start('one'); await finished(task.id)
    await tasks.choices(task.id, 'one')
    dependency = 'dependency-b'
    await expect(tasks.apply(task.id, 'one', candidate(1).id)).rejects.toThrow('covers.sourceChanged')
    expect(image()).toBeNull()
    expect(getCover(db, 'one')).toBeNull()
  })
  it('keeps a pending choice page in review when a concurrent request is rejected as busy', async () => {
    discovery = async () => ({ targets: [candidate(1), candidate(2)], warnings: [], truncated: false })
    const task = start('one'); await finished(task.id)
    let release!: () => void
    render = async () => new Promise<void>(resolve => { release = resolve })
    const page = tasks.choices(task.id, 'one'); await until(() => requests.length === 1)
    await expect(tasks.choices(task.id, 'one')).rejects.toThrow('covers.batchBusy')
    expect(tasks.status(task.id)?.items[0].state).toBe('review')
    tasks.cancel(task.id); release(); await expect(page).rejects.toThrow('covers.cancelled')
  })
  it('requires a new choice page after a source change instead of accepting repeated stale clicks', async () => {
    const source = path.join(root, 'source.unitypackage'); fs.writeFileSync(source, 'before'); add('one', { source_path: source })
    discovery = async () => ({ targets: [candidate(1), candidate(2)], warnings: [], truncated: false })
    const task = start('one'); await finished(task.id); await tasks.choices(task.id, 'one')
    fs.appendFileSync(source, '-changed')
    await expect(tasks.apply(task.id, 'one', candidate(1).id)).rejects.toThrow('covers.sourceChanged')
    await expect(tasks.apply(task.id, 'one', candidate(1).id)).rejects.toThrow('covers.targetMissing')
    expect(image()).toBeNull()
  })
  it('rejects invalid scope/filter structures without starting a task', () => {
    expect(() => tasks.start({ scope: 'filtered', filter: [] } as never)).toThrow('covers.invalidRequest')
    expect(() => tasks.start({ scope: 'filtered', filter: { ids: 'one' } } as never)).toThrow('covers.invalidRequest')
    expect(tasks.status()).toBeNull()
  })
  it('does not save a unique candidate when the package source changes during rendering', async () => {
    const source = path.join(root, 'source.unitypackage'); fs.writeFileSync(source, 'before'); add('one', { source_path: source })
    render = async () => { fs.appendFileSync(source, '-changed') }
    const task = start('one'); await finished(task.id)
    expect(tasks.status(task.id)?.items[0]).toMatchObject({ state: 'review', reason: 'covers.sourceChanged' })
    expect(image()).toBeNull()
  })
  it('bounds retained task history and returns independent latest snapshots', async () => {
    add('one', { cover_image: 'athumb://product.jpg' })
    const first = start('one'); await finished(first.id)
    for (let n = 0; n < 11; n++) { const task = start('one'); await finished(task.id) }
    expect(tasks.status(first.id)).toBeNull()
    const latest = tasks.status()!; latest.items[0].name = 'changed by caller'
    expect(tasks.status()?.items[0].name).toBe('one')
  })
})
