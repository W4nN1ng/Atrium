import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset, getAsset } from '../../src/main/db/repos/asset'
import { trashAssets } from '../../src/main/library/trash'

let root: string, db: Db
let recycle: ReturnType<typeof vi.fn>
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-trash-')))
  db = openDatabase(path.join(root, 'library.db'))
  recycle = vi.fn(async (file: string) => {
    const destination = path.join(root, 'recycle', path.basename(file))
    if (!path.resolve(file).startsWith(root + path.sep) || !destination.startsWith(root + path.sep)) throw Error('Test path escaped')
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.renameSync(file, destination)
  })
})
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }) })
function seed(id: string, file: string, parent: string | null = null, source: string | null = null) {
  upsertAsset(db, makeAssetRow({ id, name: id, raw_name: id, category: 'plugin', status: 'classified', library_path: file, source_path: source, parent_asset_id: parent }))
}
function file(name: string) { const p = path.join(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, name); return p }

it('blocks a single archive member without moving the shared archive or removing any record', async () => {
  const archive = file('shared.zip'); seed('parent', archive); seed('A', archive, 'parent'); seed('B', archive, 'parent')
  const result = await trashAssets({ db, recycle }, ['A'])
  expect(result.failed[0].error).toContain('trashSharedFile'); expect(result.trashed).toEqual([])
  expect(recycle).not.toHaveBeenCalled(); expect(fs.existsSync(archive)).toBe(true)
  for (const id of ['parent', 'A', 'B']) expect(getAsset(db, id)).not.toBeNull()
})

it('recycles a complete archive subtree once even when a selected member comes first', async () => {
  const archive = file('shared.zip'); seed('parent', archive); seed('A', archive, 'parent'); seed('B', archive, 'parent')
  const removed = vi.fn(), result = await trashAssets({ db, recycle, removed }, ['A', 'parent', 'A'])
  expect(result.failed).toEqual([]); expect(result.trashed.sort()).toEqual(['A', 'parent'])
  expect(recycle).toHaveBeenCalledTimes(1)
  expect(removed.mock.calls.flat().sort()).toEqual(['A', 'B', 'parent'])
  for (const id of ['parent', 'A', 'B']) expect(getAsset(db, id)).toBeNull()
})

it('blocks a directory containing an independently registered promoted member', async () => {
  const member = file('bundle/a.unitypackage'), dir = path.dirname(member)
  seed('parent', dir); seed('A', member)
  const result = await trashAssets({ db, recycle }, ['parent'])
  expect(result.failed[0].error).toContain('trashReferencedDirectory')
  expect(recycle).not.toHaveBeenCalled(); expect(fs.existsSync(member)).toBe(true)
})

it('recognizes a missing member under a directory and an independent source-file reference', async () => {
  const member = file('bundle/a.unitypackage'), dir = path.dirname(member)
  seed('parent', dir); seed('A', path.join(dir, 'missing.unitypackage'))
  expect((await trashAssets({ db, recycle }, ['parent'])).failed[0].error).toContain('trashReferencedDirectory')
  const archive = file('shared.zip'); seed('archive', archive); seed('B', file('other.asset'), null, archive)
  expect((await trashAssets({ db, recycle }, ['archive'])).failed[0].error).toContain('trashSharedFile')
  expect(recycle).not.toHaveBeenCalled()
})

it('does not confuse sibling paths with descendants and allows an ordinary member to be recycled', async () => {
  const target = file('bundle/a.unitypackage'); seed('parent', path.dirname(target)); seed('A', target, 'parent')
  const sibling = file('bundle-extra/b.unitypackage'); seed('B', sibling)
  const result = await trashAssets({ db, recycle }, ['A'])
  expect(result.failed).toEqual([]); expect(getAsset(db, 'A')).toBeNull()
  expect(getAsset(db, 'parent')).not.toBeNull(); expect(fs.existsSync(sibling)).toBe(true)
})

it('recognizes junction aliases before recycling a shared directory', async () => {
  const target = file('bundle/a.unitypackage'), dir = path.dirname(target), alias = path.join(root, 'alias')
  fs.symlinkSync(dir, alias, process.platform === 'win32' ? 'junction' : 'dir')
  seed('parent', dir); seed('A', path.join(alias, 'a.unitypackage'))
  const result = await trashAssets({ db, recycle }, ['parent'])
  expect(result.failed[0].error).toContain('trashReferencedDirectory'); expect(recycle).not.toHaveBeenCalled()
})

it('preserves rows and cache callbacks when recycling fails, while independent items may succeed', async () => {
  const A = file('a.zip'), B = file('b.zip'); seed('A', A); seed('B', B)
  recycle.mockRejectedValueOnce(new Error('recycle denied'))
  const forget = vi.fn(), removed = vi.fn(), result = await trashAssets({ db, recycle, forget, removed }, ['A', 'B'])
  expect(result.failed).toEqual([{ id: 'A', error: 'recycle denied' }]); expect(result.trashed).toEqual(['B'])
  expect(getAsset(db, 'A')).not.toBeNull(); expect(fs.existsSync(A)).toBe(true)
  expect(forget).toHaveBeenCalledTimes(1); expect(forget).toHaveBeenCalledWith('B')
  expect(removed).toHaveBeenCalledTimes(1); expect(removed).toHaveBeenCalledWith('B')
})
