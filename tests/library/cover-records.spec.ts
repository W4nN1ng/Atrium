import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, type Db } from '../../src/main/db'
import { upsertAsset, makeAssetRow, deleteAssetRow } from '../../src/main/db/repos/asset'
import { getCover, saveCover, restoreCover } from '../../src/main/db/repos/covers'

let db: Db
beforeEach(() => {
  db = new Database(':memory:'); db.pragma('foreign_keys = ON'); migrate(db)
  upsertAsset(db, makeAssetRow({ id: 'one', name: 'One', raw_name: 'One', category: 'props', cover_image: 'athumb://original.jpg' }))
})
afterEach(() => db.close())
function save(url: string): void {
  saveCover(db, { assetId: 'one', coverImage: url, source: 'image', projectId: null, target: null, options: null })
}
describe('cover override persistence', () => {
  it('replacing a cover twice still restores the original instead of the first override', () => {
    save('athumb://first.jpg'); save('athumb://second.jpg')
    expect(getCover(db, 'one')?.previousImage).toBe('athumb://original.jpg')
    expect(restoreCover(db, 'one')).toBe('athumb://original.jpg')
    expect(db.prepare('SELECT cover_image FROM asset WHERE id = ?').get('one')).toEqual({ cover_image: 'athumb://original.jpg' })
    expect(getCover(db, 'one')).toBeNull()
  })
  it('a missing card cannot create an orphaned override', () => {
    expect(() => saveCover(db, { assetId: 'missing', coverImage: 'athumb://new.jpg', source: 'image', projectId: null, target: null, options: null })).toThrow()
    expect(db.prepare('SELECT COUNT(*) AS n FROM asset_cover').get()).toEqual({ n: 0 })
  })
  it('deleting a card removes its source association', () => {
    save('athumb://first.jpg'); deleteAssetRow(db, 'one')
    expect(getCover(db, 'one')).toBeNull()
  })
})
