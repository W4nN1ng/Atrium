import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { saveCover, getCover } from '../../src/main/db/repos/covers'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import { CoverService } from '../../src/main/covers/service'
import type { BridgeManager } from '../../src/main/bridge/manager'
import type { PreviewTarget } from '../../src/shared/covers'

vi.mock('electron', () => ({ app: {}, nativeImage: {} }))
const target: PreviewTarget = { id: 'GlobalObjectId_V1-1-example-1-0', name: 'Chocolate', path: 'Assets/Chocolate.prefab', persistent: true, isScene: false, sourceGuid: 'a'.repeat(32) }
const options = { direction: 'auto' as const, background: 'dark' as const }
let root: string, project: string, db: Db, service: CoverService
let execute: (projectPath: string, command: string, payload: unknown, opts: { id: string; signal?: AbortSignal }) => Promise<unknown>
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000280000001e0', 'hex')
function heartbeat(capabilities = ['object_preview']): void {
  fs.writeFileSync(path.join(project, 'Temp', 'AVCABridge', 'bridge.json'), JSON.stringify({
    protocolVersion: 1, pid: process.pid, projectPath: project, projectName: 'Test', unityVersion: '2022.3.22f1',
    bridgeVersion: '1.1.0', capabilities, isPlaying: false, isCompiling: false, isUpdating: false,
    isPlayingOrWillChangePlaymode: false, activeScene: null, queueLength: 0, heartbeatUtc: Date.now()
  }))
}
function addCard(id: string): void { upsertAsset(db, makeAssetRow({ id, name: id, raw_name: id, category: 'props', cover_image: 'athumb://original.jpg' })) }
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-cover-service-')))
  project = path.join(root, 'project'); fs.mkdirSync(path.join(project, 'Temp', 'AVCABridge', 'previews'), { recursive: true })
  setAppPathsForTest(path.join(root, 'app')); fs.mkdirSync(P.thumbs(), { recursive: true })
  db = new Database(':memory:'); migrate(db)
  db.prepare('INSERT INTO project(id, path, name) VALUES (?, ?, ?)').run('project', project, 'Test')
  addCard('one'); addCard('two'); heartbeat()
  execute = async (_p, command, _payload, opts) => {
    if (command === 'get_preview_targets') return { ok: true, status: 'ok', data: { targets: [target] }, commandId: opts.id }
    fs.writeFileSync(path.join(project, 'Temp', 'AVCABridge', 'previews', opts.id + '.png'), PNG)
    return { ok: true, status: 'ok', data: { relativePath: 'previews/' + opts.id + '.png', width: 640, height: 480, rendererCount: 1 }, commandId: opts.id }
  }
  service = new CoverService({ db, manager: { execute: (...args: Parameters<typeof execute>) => execute(...args) } as unknown as BridgeManager,
    // Only the Electron image decoder is external; filesystem and DB effects are real.
    writeImage(bytes, key) { fs.writeFileSync(path.join(P.thumbs(), key + '.jpg'), bytes); return { ok: true, url: 'athumb://' + key + '.jpg' } }
  })
})
afterEach(() => { vi.restoreAllMocks(); service.dispose(); db.close(); fs.rmSync(root, { recursive: true, force: true }) })
const input = () => ({ assetId: 'one', projectId: 'project', target, options, requestId: 'request-one' })
const current = (id = 'one'): string => (db.prepare('SELECT cover_image FROM asset WHERE id = ?').get(id) as { cover_image: string }).cover_image
async function finished(id: string): Promise<void> {
  for (let i = 0; i < 100; i++) { if (!service.batchStatus(id).running) return; await new Promise(r => setTimeout(r, 10)) }
  throw new Error('Batch did not finish')
}

describe('cover capture and confirmation', () => {
  it('restores the original image after its source directory is moved', () => {
    const original = path.join(root, 'original.png'), upload = path.join(root, 'manual.png')
    fs.writeFileSync(original, PNG); fs.writeFileSync(upload, PNG)
    db.prepare('UPDATE asset SET cover_image = ? WHERE id = ?').run(original, 'one')
    service.upload('one', upload)
    fs.renameSync(original, path.join(root, 'moved.png'))
    service.restore('one')
    expect(current()).toMatch(/^athumb:\/\//)
    expect(fs.readFileSync(path.join(P.thumbs(), current().replace('athumb://', '')))).toEqual(PNG)
  })
  it('does not replace a valid existing cover when preservation of the original fails', () => {
    const original = path.join(root, 'original.png'), upload = path.join(root, 'manual.png')
    fs.writeFileSync(original, PNG); fs.writeFileSync(upload, Buffer.concat([PNG, Buffer.from('manual')]))
    db.prepare('UPDATE asset SET cover_image = ? WHERE id = ?').run(original, 'one')
    service.dispose()
    service = new CoverService({ db, manager: {} as BridgeManager, writeImage(bytes, key) {
      if (bytes.equals(PNG)) return { ok: false, url: null, why: 'Cannot write original cache' }
      fs.writeFileSync(path.join(P.thumbs(), key + '.jpg'), bytes)
      return { ok: true, url: 'athumb://' + key + '.jpg' }
    } })
    expect(() => service.upload('one', upload)).toThrow('covers.originalPreserveFailed')
    expect(current()).toBe(original)
    expect(getCover(db, 'one')).toBeNull()
    expect(fs.readdirSync(P.thumbs())).toEqual([])
  })
  it('retains bridge diagnostics for failed batch items and identifies their names', async () => {
    saveCover(db, { assetId: 'one', coverImage: 'athumb://old.jpg', source: 'unity', projectId: 'project', target, options })
    execute = async () => ({ ok: false, error: 'covers.unsupportedShader: Unsupported Fancy Shader', stackTrace: 'Material clone at AVCAPreview.Render' })
    const batch = service.startBatch(['one']); await finished(batch.id)
    const item = service.batchStatus(batch.id).items[0]
    expect(item.reason).toBe('covers.unsupportedShader')
    expect(item.detail).toContain('Fancy Shader')
    expect(item.detail).toContain('AVCAPreview.Render')
    expect(item.name).toBe('one')
  })
  it('rejects an old bridge before changing an existing cover', async () => {
    heartbeat([])
    await expect(service.preview(input())).rejects.toThrow('covers.bridgeUpgrade')
    expect(current()).toBe('athumb://original.jpg')
  })
  it('a preview remains uncommitted until confirmed, then survives service restart and can restore the original', async () => {
    const preview = await service.preview(input())
    expect(current()).toBe('athumb://original.jpg')
    expect(fs.existsSync(path.join(P.thumbs(), preview.url.replace('athumb://', '')))).toBe(true)
    service.save('one', preview.id)
    expect(current()).toMatch(/^athumb:\/\/cover-/)
    expect(getCover(db, 'one')?.target?.name).toBe('Chocolate')
    service.dispose()
    expect(getCover(db, 'one')?.coverImage).toBe(current())
    service.restore('one'); expect(current()).toBe('athumb://original.jpg')
  })
  it('discards a preview without affecting the original image', async () => {
    const preview = await service.preview(input()); service.discard(preview.id)
    expect(current()).toBe('athumb://original.jpg')
    expect(fs.existsSync(path.join(P.thumbs(), preview.url.replace('athumb://', '')))).toBe(false)
    expect(() => service.save('one', preview.id)).toThrow('covers.previewExpired')
  })
  it('rejects image paths outside this request’s preview directory', async () => {
    fs.writeFileSync(path.join(root, 'outside.png'), PNG)
    execute = async () => ({ ok: true, status: 'ok', data: { relativePath: '../../../outside.png', width: 640, height: 480, rendererCount: 1 } })
    await expect(service.preview(input())).rejects.toThrow('covers.invalidImage')
    expect(current()).toBe('athumb://original.jpg')
  })
  it('cancels a pending capture and ignores a late success response', async () => {
    let respond!: (r: unknown) => void
    execute = async () => new Promise(resolve => { respond = resolve })
    const pending = service.preview(input())
    await new Promise(r => setTimeout(r, 0))
    service.discard('request-one')
    respond({ ok: true, status: 'ok', data: { relativePath: 'previews/fake.png', width: 640, height: 480, rendererCount: 1 } })
    await expect(pending).rejects.toThrow('covers.cancelled')
    expect(current()).toBe('athumb://original.jpg')
  })
  it('cannot save one card’s preview into another card', async () => {
    const preview = await service.preview(input())
    expect(() => service.save('two', preview.id)).toThrow('covers.previewExpired')
    expect(current('two')).toBe('athumb://original.jpg')
  })
  it('expires unconfirmed previews and removes only their staging image', async () => {
    const preview = await service.preview(input()), now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60_000 + 1)
    expect(() => service.save('one', preview.id)).toThrow('covers.previewExpired')
    expect(fs.existsSync(path.join(P.thumbs(), preview.url.replace('athumb://', '')))).toBe(false)
    expect(current()).toBe('athumb://original.jpg')
  })
  it('rejects a preview directory junction without consuming the external image', async () => {
    const previews = path.join(project, 'Temp', 'AVCABridge', 'previews')
    const outside = path.join(root, 'external'); fs.mkdirSync(outside)
    fs.rmdirSync(previews); fs.symlinkSync(outside, previews, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(service.preview(input())).rejects.toThrow('covers.invalidImage')
    expect(fs.readFileSync(path.join(outside, 'cover-request-one.png'))).toEqual(PNG)
    expect(current()).toBe('athumb://original.jpg')
  })
  it('rejects a duplicate pending ID without cancelling the original capture', async () => {
    const originalExecute = execute
    let release!: () => void
    execute = async (...args) => { await new Promise<void>(resolve => { release = resolve }); return originalExecute(...args) }
    const pending = service.preview(input())
    await expect(service.preview(input())).rejects.toThrow('covers.invalidRequest')
    release(); const preview = await pending
    service.save('one', preview.id)
    expect(current()).toMatch(/^athumb:\/\/cover-/)
  })
})
describe('batch covers', () => {
  it('cancels the active batch and leaves later associated covers unchanged', async () => {
    for (const assetId of ['one', 'two']) saveCover(db, { assetId, coverImage: 'athumb://old-generated.jpg', source: 'unity', projectId: 'project', target, options })
    let calls = 0
    execute = async (_p, _cmd, _payload, opts) => {
      calls++
      return new Promise(resolve => opts.signal!.addEventListener('abort', () => resolve({ ok: false, error: 'covers.cancelled' }), { once: true }))
    }
    const batch = service.startBatch(['one', 'two']); service.cancelBatch(batch.id); await finished(batch.id)
    expect(service.batchStatus(batch.id).items.map(item => item.state)).toEqual(['cancelled', 'cancelled'])
    expect(calls).toBe(1)
    expect(current('one')).toBe('athumb://old-generated.jpg')
    expect(current('two')).toBe('athumb://old-generated.jpg')
  })
  it('generates associated covers sequentially and protects a manually uploaded cover', async () => {
    saveCover(db, { assetId: 'one', coverImage: 'athumb://old-generated.jpg', source: 'unity', projectId: 'project', target, options })
    saveCover(db, { assetId: 'two', coverImage: 'athumb://manual.jpg', source: 'image', projectId: null, target: null, options: null })
    const batch = service.startBatch(['one', 'two']); await finished(batch.id)
    expect(service.batchStatus(batch.id).items.map(i => i.state)).toEqual(['done', 'skipped'])
    expect(current('one')).toMatch(/^athumb:\/\/cover-/)
    expect(current('two')).toBe('athumb://manual.jpg')
  })
  it('does not apply a rendered image over a manual cover set while the job was running', async () => {
    saveCover(db, { assetId: 'one', coverImage: 'athumb://old-generated.jpg', source: 'unity', projectId: 'project', target, options })
    let resume!: () => void
    const originalExecute = execute
    execute = async (...args) => { await new Promise<void>(r => { resume = r }); return originalExecute(...args) }
    const batch = service.startBatch(['one']); await new Promise(r => setTimeout(r, 0))
    saveCover(db, { assetId: 'one', coverImage: 'athumb://manual-new.jpg', source: 'image', projectId: null, target: null, options: null })
    resume(); await finished(batch.id)
    expect(current()).toBe('athumb://manual-new.jpg')
    expect(service.batchStatus(batch.id).items[0].state).toBe('failed')
  })
})
