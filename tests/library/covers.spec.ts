import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { upsertAsset, makeAssetRow } from '../../src/main/db/repos/asset'
import { ensureThumb, forgetThumb, pruneThumbCache } from '../../src/main/library/thumbs'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import { saveCover } from '../../src/main/db/repos/covers'
import { extractPackagePreview } from '../../src/main/unpack/unitypackage'

vi.mock('electron', () => ({ app: {}, nativeImage: { createFromBuffer: () => ({
  isEmpty: () => false, getSize: () => ({ width: 10, height: 10 }), toJPEG: () => Buffer.from('automatic image')
}) } }))
vi.mock('../../src/main/unpack/unitypackage', () => ({ extractPackagePreview: vi.fn() }))
let root: string
let db: Db
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-cover-')))
  setAppPathsForTest(root)
  db = new Database(':memory:')
  migrate(db)
  fs.mkdirSync(P.thumbs(), { recursive: true })
})
afterEach(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }) })
function card(id: string, cover: string | null = null): void {
  upsertAsset(db, makeAssetRow({ id, name: id, raw_name: id, category: 'props', hash_xxh64: 'samehash', cover_image: cover }))
}
function image(key: string): void { fs.writeFileSync(path.join(P.thumbs(), key + '.jpg'), Buffer.from('cached image')) }

describe('per-card covers and cache lifetime', () => {
  it.each([false, true])('protects a cover saved while package extraction is pending (image found: %s)', async found => {
    card('one')
    const dir = path.join(root, 'package'); fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'sample.unitypackage'), 'package')
    db.prepare('UPDATE asset SET library_path = ? WHERE id = ?').run(dir, 'one')
    let release!: (value: Awaited<ReturnType<typeof extractPackagePreview>>) => void
    vi.mocked(extractPackagePreview).mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = ensureThumb(db, 'one', { packages: true })
    image('manual-new')
    saveCover(db, { assetId: 'one', coverImage: 'athumb://manual-new.jpg', source: 'image', projectId: null, target: null, options: null })
    release(found ? { bytes: Buffer.from('preview'), unityPath: 'Assets/Preview.png' } : null)
    await pending
    expect(db.prepare('SELECT cover_image FROM asset WHERE id = ?').get('one')).toEqual({ cover_image: 'athumb://manual-new.jpg' })
  })
  it('automatic rebuild keeps the selected cover instead of replacing it with another card’s shared hash image', async () => {
    card('one', 'athumb://custom-one.jpg')
    card('two', 'athumb://samehash.jpg')
    image('custom-one'); image('samehash')
    const result = await ensureThumb(db, 'one')
    expect(result.url).toBe('athumb://custom-one.jpg')
    expect(db.prepare('SELECT cover_image FROM asset WHERE id = ?').get('one')).toEqual({ cover_image: 'athumb://custom-one.jpg' })
    expect(db.prepare('SELECT cover_image FROM asset WHERE id = ?').get('two')).toEqual({ cover_image: 'athumb://samehash.jpg' })
  })
  it('cache maintenance retains explicitly selected images and removes only unreferenced images', () => {
    card('one', 'athumb://custom-one.jpg')
    image('custom-one'); image('samehash'); image('orphan')
    expect(pruneThumbCache(db)).toEqual({ removed: 1, kept: 2 })
    expect(fs.existsSync(path.join(P.thumbs(), 'custom-one.jpg'))).toBe(true)
    expect(fs.existsSync(path.join(P.thumbs(), 'orphan.jpg'))).toBe(false)
  })
  it('deleting one card does not delete the automatic thumbnail still used by an identical-content card', () => {
    card('one', 'athumb://custom-one.jpg'); card('two', 'athumb://samehash.jpg')
    image('custom-one'); image('samehash')
    forgetThumb(db, 'one')
    expect(fs.existsSync(path.join(P.thumbs(), 'samehash.jpg'))).toBe(true)
    expect(fs.existsSync(path.join(P.thumbs(), 'custom-one.jpg'))).toBe(false)
  })
})
