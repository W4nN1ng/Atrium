import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { ensureGroup } from '../../src/main/db/repos/product'
import { registerAssets } from '../../src/main/ipc/assets'
import { assetIndex, rebuildIndex, setCategoryConfig } from '../../src/main/search'
import { resolveIndexedAssetFilter } from '../../src/main/search/filter'
import { loadCategories } from '../../src/main/services/categories'
import { setAppPathsForTest } from '../../src/main/services/paths'

vi.mock('electron', () => ({ app: { commandLine: { hasSwitch: () => false }, getPath: () => process.env.TEMP }, nativeImage: {}, shell: {} }))
let root: string, db: Db
let handlers: Map<string, (...args: any[]) => any>
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-assetsearch-')))
  setAppPathsForTest(root); db = openDatabase(path.join(root, 'library.db'))
  handlers = new Map()
  registerAssets({ ipc: { handle: (channel, fn) => { handlers.set(channel, fn) } }, broadcast: () => undefined })
})
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })
function index() { const cfg = loadCategories(); setCategoryConfig(cfg); rebuildIndex(db, cfg, assetIndex) }
function seed(id: string, name: string, extra = {}) { upsertAsset(db, makeAssetRow({ id, name, raw_name: name, category: 'plugin', status: 'classified', ...extra })) }

it('finds a renamed asset immediately without rebuilding the whole index', () => {
  seed('A', 'OriginalApricot'); index()
  handlers.get('assets:rename')!('A', 'ZyxNebulaCitrus')
  expect(handlers.get('assets:list')!({ search: 'ZyxNebulaCitrus' }).cards.map((c: any) => c.id)).toEqual(['A'])
})

it('updates the shared group-name aliases of every variant', () => {
  const group = ensureGroup(db, { groupKey: 'test', name: 'OriginalApricot', category: 'plugin' })
  seed('A', 'VariantAmber', { group_id: group.id }); seed('B', 'VariantCobalt', { group_id: group.id }); index()
  handlers.get('assets:rename')!('A', 'ZyxNebulaCitrus')
  expect(handlers.get('assets:list')!({ search: 'ZyxNebulaCitrus', view: 'flat' }).cards.map((c: any) => c.id).sort()).toEqual(['A', 'B'])
})

it('searches inside collections of assets while normal browsing keeps children hidden', () => {
  seed('container', 'Container', { is_bundle: 1, container_kind: 'directory' })
  seed('child', 'HiddenSaffron', { parent_asset_id: 'container' }); index()
  expect(handlers.get('assets:list')!({}).cards.map((c: any) => c.id)).toEqual(['container'])
  expect(handlers.get('assets:list')!({ search: 'HiddenSaffron' }).cards.map((c: any) => c.id)).toEqual(['child'])
  expect(handlers.get('assets:list')!({ search: 'HiddenSaffron', scope: 'top' }).cards).toEqual([])
})

it('uses the same search scope before the memory index is ready and respects a parent filter', () => {
  seed('container', 'Container', { is_bundle: 1, container_kind: 'directory' })
  seed('child', 'HiddenSaffron', { parent_asset_id: 'container' })
  assetIndex.beginBuild()
  expect(handlers.get('assets:list')!({ search: 'HiddenSaffron' }).total).toBe(1)
  expect(resolveIndexedAssetFilter({ search: 'HiddenSaffron', parentId: 'container' })?.parentId).toBe('container')
})

it('keeps more than 2,000 matches through paging, category and collection filters', () => {
  db.transaction(() => {
    for (let i = 0; i < 2105; i++) seed('match-' + i, 'SaffronCommonItem', { category: i === 2104 ? 'texture' : 'plugin' })
  })()
  index()
  const all = handlers.get('assets:list')!({ search: 'SaffronCommonItem', view: 'flat', limit: 400 })
  expect(all.total).toBe(2105)
  expect(handlers.get('assets:list')!({ search: 'SaffronCommonItem', view: 'flat', limit: 400, offset: 2000 }).cards).toHaveLength(105)
  expect(handlers.get('assets:list')!({ search: 'SaffronCommonItem', category: 'texture' }).cards.map((c: any) => c.id)).toEqual(['match-2104'])
  const collection = handlers.get('collections:create')!({ name: 'Rare match' })
  handlers.get('collections:add-assets')!(collection.id, ['match-2104'])
  expect(handlers.get('assets:list')!({ search: 'SaffronCommonItem', collectionId: collection.id }).total).toBe(1)
})

it('binds a complete candidate set larger than SQLite allows as individual parameters', () => {
  seed('A', 'ActualAsset'); index()
  const ids = ['A', ...Array.from({ length: 35000 }, (_, i) => 'not-present-' + i)]
  expect(handlers.get('assets:list')!({ ids }).cards.map((c: any) => c.id)).toEqual(['A'])
})

it('the real trash IPC blocks shared file deletion before touching metadata', async () => {
  const archive = path.join(root, 'bundle.zip'); fs.writeFileSync(archive, 'owned fixture')
  seed('parent', 'Parent', { library_path: archive, is_bundle: 1 })
  seed('A', 'First', { library_path: archive, parent_asset_id: 'parent' })
  seed('B', 'Second', { library_path: archive, parent_asset_id: 'parent' })
  const result = await handlers.get('assets:trash')!(['A'])
  expect(result.trashed).toEqual([]); expect(result.failed[0].error).toContain('trashSharedFile')
  expect(db.prepare('SELECT COUNT(*) AS n FROM asset').get()).toEqual({ n: 3 })
  expect(fs.existsSync(archive)).toBe(true)
})
