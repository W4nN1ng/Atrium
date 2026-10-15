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

vi.mock('electron', () => ({ app: {}, nativeImage: {} }))
const guid = 'a'.repeat(32)
const target = { id: 'package:' + guid, name: 'Chocolate', path: 'Assets/Chocolate.prefab', persistent: true, isScene: false, sourceGuid: guid }
const options = { direction: 'auto' as const, background: 'dark' as const }
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000280000001e0', 'hex')
let root: string, db: Db, service: CoverService
let provider: any
let packageSaved: ReturnType<typeof vi.fn>
const input = (id = 'capture') => ({ provider: 'package' as const, assetId: 'one', projectId: '', target, options, requestId: id })
const current = () => db.prepare('SELECT cover_image FROM asset WHERE id=?').get('one') as { cover_image: string }
beforeEach(() => {
  packageSaved = vi.fn()
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-package-service-')))
  setAppPathsForTest(path.join(root, 'app')); fs.mkdirSync(P.thumbs(), { recursive: true })
  db = new Database(':memory:'); migrate(db)
  for (const id of ['one', 'two']) upsertAsset(db, makeAssetRow({ id, name: id, raw_name: id, category: 'props', cover_image: 'athumb://original.jpg' }))
  provider = {
    status: () => ({ available: true, editorPath: 'C:/Unity/Editor/Unity.exe', version: '2022.3.22f1' }),
    discover: async (_asset: string, _id: string, _dependency: string | undefined, _signal: AbortSignal, progress: Function) => {
      progress({ stage: 'reading', done: 1, total: 2 }); return { targets: [{ ...target, memberPaths: ['Chocolate.unitypackage'] }], warnings: [], truncated: false }
    },
    preview: async () => ({ bytes: PNG, width: 640, height: 480, rendererCount: 1, fingerprint: 'source-one', dependencyProjectId: null }),
    assertCurrent: () => undefined, dispose: vi.fn()
  }
  service = new CoverService({ db, manager: { execute: vi.fn(() => { throw new Error('Project bridge must not be used') }) }, packageProvider: provider, packageSaved,
    writeImage(bytes: Buffer, key: string) { fs.writeFileSync(path.join(P.thumbs(), key + '.jpg'), bytes); return { ok: true, url: 'athumb://' + key + '.jpg' } }
  } as any)
})
afterEach(() => { service.dispose(); db.close(); fs.rmSync(root, { recursive: true, force: true }); vi.restoreAllMocks() })
async function finished(id: string): Promise<void> {
  for (let i = 0; i < 100; i++) { if (!service.batchStatus(id).running) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error('Batch did not finish')
}

describe('unimported source cover service', () => {
  it('remembers the dependency only after a successful package save', async () => {
    provider.preview = async () => ({ bytes: PNG, width: 640, height: 480, rendererCount: 1, fingerprint: 'source-one', dependencyProjectId: 'dependency' })
    await service.discoverPackage('one', 'find')
    await service.preview(input('discarded')); service.discard('discarded')
    expect(packageSaved).not.toHaveBeenCalled()
    await service.preview(input('saved')); service.save('one', 'saved')
    expect(packageSaved).toHaveBeenCalledOnce(); expect(packageSaved).toHaveBeenCalledWith('dependency')
  })
  it('records a successful no-dependency choice, but never remembers failed saves', async () => {
    await service.preview(input('changed'))
    db.prepare('UPDATE asset SET cover_image=? WHERE id=?').run('athumb://manual.jpg', 'one')
    expect(() => service.save('one', 'changed')).toThrow('covers.changed')
    expect(packageSaved).not.toHaveBeenCalled()
    await service.preview(input('valid')); service.save('one', 'valid')
    expect(packageSaved).toHaveBeenCalledOnce(); expect(packageSaved).toHaveBeenCalledWith(null)
  })
  it('preserves a successfully saved cover if preference storage fails', async () => {
    packageSaved.mockImplementation(() => { throw new Error('Preference write failed') })
    await service.preview(input())
    expect(service.save('one', 'capture').source).toBe('package')
    expect(packageSaved).toHaveBeenCalledOnce()
  })
  it('exposes editor status without requiring a registered/open project', () => {
    expect((service as any).packageStatus()).toMatchObject({ available: true, version: '2022.3.22f1' })
  })
  it('discovers source candidates and progress without changing the cover or importing', async () => {
    expect((await (service as any).discoverPackage('one', 'find')).targets[0].sourceGuid).toBe(guid)
    expect((service as any).packageProgress('find')).toMatchObject({ stage: 'ready' })
    expect(current().cover_image).toBe('athumb://original.jpg')
    expect(db.prepare('SELECT COUNT(*) AS n FROM import_log').get()).toEqual({ n: 0 })
  })
  it('stages package capture and saves a durable package GUID with no temporary project association', async () => {
    await service.preview(input())
    expect(current().cover_image).toBe('athumb://original.jpg')
    const saved = service.save('one', 'capture')
    expect(saved).toMatchObject({ source: 'package', projectId: null, target, options, previousImage: 'athumb://original.jpg' })
    expect(saved.coverImage.startsWith('athumb://cover-')).toBe(true)
    expect(getCover(db, 'one')).toEqual(saved)
    service.restore('one'); expect(current().cover_image).toBe('athumb://original.jpg')
  })
  it('preserves a selected shader dependency for restart regeneration', async () => {
    provider.preview = async () => ({ bytes: PNG, width: 640, height: 480, rendererCount: 1, fingerprint: 'source-one', dependencyProjectId: 'dependency' })
    await service.preview(input()); expect(service.save('one', 'capture').projectId).toBe('dependency')
  })
  it('rejects invalid package ids, scene targets, options and providers before invoking the worker', async () => {
    const called = vi.spyOn(provider, 'preview')
    for (const request of [
      { ...input(), target: { ...target, id: 'package:wrong' } },
      { ...input(), target: { ...target, sourceGuid: 'b'.repeat(32) } },
      { ...input(), target: { ...target, isScene: true } },
      { ...input(), options: { ...options, direction: 'scene' } },
      { ...input(), provider: 'unknown' }
    ]) await expect(service.preview(request as any)).rejects.toThrow('covers.invalidRequest')
    expect(called).not.toHaveBeenCalled()
  })
  it('rejects invalid generated image dimensions and malformed PNG bytes', async () => {
    provider.preview = async () => ({ bytes: PNG, width: 320, height: 480, rendererCount: 1, fingerprint: 'source-one' })
    await expect(service.preview(input())).rejects.toThrow('covers.invalidImage')
    provider.preview = async () => ({ bytes: Buffer.from('not an image'), width: 640, height: 480, rendererCount: 1, fingerprint: 'source-one' })
    await expect(service.preview(input())).rejects.toThrow('covers.invalidImage')
    expect(current().cover_image).toBe('athumb://original.jpg')
  })
  it('rejects saving if the original package changed after the image was rendered', async () => {
    await service.preview(input())
    provider.assertCurrent = () => { throw new Error('covers.sourceChanged') }
    expect(() => service.save('one', 'capture')).toThrow('covers.sourceChanged')
    expect(current().cover_image).toBe('athumb://original.jpg')
  })
  it('preserves manual cover changes made during generation', async () => {
    await service.preview(input())
    db.prepare('UPDATE asset SET cover_image=? WHERE id=?').run('athumb://manual.jpg', 'one')
    expect(() => service.save('one', 'capture')).toThrow('covers.changed')
  })
  it('cancels a package query and rejects its late successful response', async () => {
    let complete!: Function, entered!: Function
    const ready = new Promise(resolve => { entered = resolve })
    provider.discover = async (_a: string, _id: string, _dep: string, signal: AbortSignal) => {
      entered(); await new Promise(resolve => { complete = resolve }); expect(signal.aborted).toBe(true)
      return { targets: [{ ...target, memberPaths: [] }], warnings: [], truncated: false }
    }
    const pending = (service as any).discoverPackage('one', 'find')
    await ready; service.discard('find'); complete()
    await expect(pending).rejects.toThrow('covers.cancelled')
    expect(current().cover_image).toBe('athumb://original.jpg')
  })
  it('cancels rendering and never stages a late image', async () => {
    let complete!: Function, entered!: Function
    const ready = new Promise(resolve => { entered = resolve })
    provider.preview = async (_r: unknown, signal: AbortSignal) => {
      entered(); await new Promise(resolve => { complete = resolve }); expect(signal.aborted).toBe(true)
      return { bytes: PNG, width: 640, height: 480, rendererCount: 1, fingerprint: 'source-one' }
    }
    const pending = service.preview(input()); await ready; service.discard('capture'); complete()
    await expect(pending).rejects.toThrow('covers.cancelled')
    expect(() => service.save('one', 'capture')).toThrow('covers.previewExpired')
  })
  it('updates package associations in batch and keeps manual image cards', async () => {
    await service.preview(input()); service.save('one', 'capture')
    saveCover(db, { assetId: 'two', coverImage: 'athumb://manual.jpg', source: 'image', projectId: null, target: null, options: null })
    const calls = vi.spyOn(provider, 'preview')
    const batch = service.startBatch(['one', 'two']); await finished(batch.id)
    expect(service.batchStatus(batch.id).items.map(item => item.state)).toEqual(['done', 'skipped'])
    expect(calls.mock.calls[0][0]).toMatchObject({ provider: 'package', projectId: '', target })
    expect(getCover(db, 'two')?.coverImage).toBe('athumb://manual.jpg')
  })
  it('retains all existing cover data while allowing the new package source in migration', () => {
    const legacy = new Database(':memory:')
    // Reproduce the actual v7 table constraints/data, then exercise the production migration.
    migrate(legacy)
    upsertAsset(legacy, makeAssetRow({ id: 'old', name: 'old', raw_name: 'old', category: 'props' }))
    legacy.exec("DROP TABLE asset_cover; CREATE TABLE asset_cover(asset_id TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,cover_image TEXT NOT NULL,previous_image TEXT,source TEXT NOT NULL CHECK(source IN ('unity','image')),project_id TEXT,target_json TEXT,options_json TEXT,updated_at INTEGER NOT NULL); PRAGMA user_version=7;")
    legacy.prepare('INSERT INTO asset_cover VALUES(?,?,?,?,?,?,?,?)').run('old', 'athumb://cover-old.jpg', 'athumb://original-old.jpg', 'unity', 'old-project', JSON.stringify(target), JSON.stringify(options), 123)
    migrate(legacy)
    expect(getCover(legacy, 'old')).toMatchObject({ source: 'unity', projectId: 'old-project', previousImage: 'athumb://original-old.jpg', target, options })
    expect(() => legacy.prepare("UPDATE asset_cover SET source='package' WHERE asset_id='old'").run()).not.toThrow()
    legacy.close()
  })
})
