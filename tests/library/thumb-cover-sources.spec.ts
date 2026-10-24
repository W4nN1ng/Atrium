import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import * as tar from 'tar'
import yazl from 'yazl'
import { closeDatabase, openDatabase } from '../../src/main/db'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import { backfillThumbsFor, ensureThumb, repairUntrustedNoneCovers } from '../../src/main/library/thumbs'

/**
 * 封面的"图从哪来"：压缩包本体、包里的图、以及"一次落 N 行"时每行都要照顾到。
 *
 * 现场（2026-10-24 16:49）：用户拖进一个装着 17 件插件的文件夹，一次建了 27 条素材
 * （16 个目录 + 8 个 zip + 2 个 rar + 4 个 unitypackage），**一张封面都没出**。
 * 两个原因叠在一起：
 *   1. `finishCommit` 只给 `primaryId` 补封面，另外 26 行 `cover_image` 一直是 NULL；
 *      这条路径又不在"一键全部入库"里，连批尾的补齐都不会跑；
 *   2. 源是压缩包时，旧代码把压缩包本体丢给解码器（必然为空），
 *      从来没往包里看过 —— zip/rar/unitypackage 永远没有封面。
 *
 * 这里把两种来源都钉住。
 */

const FAKE_JPEG = Buffer.from('fake-jpeg')
const BIG_ENOUGH = 3000 // 大于 THUMB_MIN_SOURCE_BYTES(2048)，否则不算候选

const image = vi.hoisted(() => {
  const mk = (): Record<string, unknown> => ({
    isEmpty: () => false,
    getSize: () => ({ width: 16, height: 16 }),
    resize() {
      return this
    },
    toJPEG: () => Buffer.from('fake-jpeg')
  })
  return { createFromPath: vi.fn(mk), createFromBuffer: vi.fn(mk) }
})

vi.mock('electron', () => ({ nativeImage: image }))

let root: string
let db: ReturnType<typeof openDatabase>

function addAsset(id: string, sourcePath: string, cover: string | null = null): void {
  db.prepare(
    `INSERT INTO asset (id, name, raw_name, category, confidence, status, storage_mode,
                        source_path, cover_image, hash_xxh64, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, '测试素材', '测试素材', '插件', 1, 'ready', 'indexed', sourcePath, cover, null, 1, 1)
}

function coverOf(id: string): string | null {
  const row = db.prepare('SELECT cover_image FROM asset WHERE id = ?').get(id) as
    | { cover_image: string | null }
    | undefined
  return row?.cover_image ?? null
}

async function makeZip(dest: string, entries: Record<string, Buffer>): Promise<void> {
  const zip = new yazl.ZipFile()
  for (const [name, buf] of Object.entries(entries)) zip.addBuffer(buf, name)
  zip.end()
  await pipeline(zip.outputStream, fs.createWriteStream(dest))
}

/** 真 .unitypackage 的形状：`<guid>/pathname` + `<guid>/preview.png` */
async function makeUnitypackage(dest: string, preview: Buffer): Promise<void> {
  const src = fs.mkdtempSync(path.join(root, 'upkg-'))
  const guid = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  fs.mkdirSync(path.join(src, guid), { recursive: true })
  fs.writeFileSync(path.join(src, guid, 'pathname'), 'Assets/Demo/Body.prefab')
  fs.writeFileSync(path.join(src, guid, 'asset'), 'prefab')
  fs.writeFileSync(path.join(src, guid, 'asset.meta'), 'fileFormatVersion: 2')
  fs.writeFileSync(path.join(src, guid, 'preview.png'), preview)
  await tar.c({ gzip: true, cwd: src, file: dest, prefix: './' }, [guid])
  fs.rmSync(src, { recursive: true, force: true })
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-thumb-src-'))
  setAppPathsForTest(root)
  db = openDatabase(P.db())
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('源本身是压缩包时的封面', () => {
  it('zip 里的商品图能当封面（不再拿压缩包本体去解码）', async () => {
    const zip = path.join(root, 'pack.zip')
    await makeZip(zip, {
      'readme.txt': Buffer.from('no image here'),
      'Shop/preview.png': Buffer.alloc(BIG_ENOUGH, 0x41),
      'Shop/other.png': Buffer.alloc(BIG_ENOUGH, 0x42)
    })
    addAsset('A1', zip)

    const r = await ensureThumb(db, 'A1', { packages: true })

    expect(r.ok).toBe(true)
    expect(coverOf('A1')).toBe(`athumb://A1.jpg`)
    expect(fs.existsSync(path.join(P.thumbs(), 'A1.jpg'))).toBe(true)
  })

  it('zip 里确实没图 → 记 none，别每次刷新都重扫', async () => {
    const zip = path.join(root, 'empty.zip')
    await makeZip(zip, { 'readme.txt': Buffer.from('nothing') })
    addAsset('A2', zip)

    const r = await ensureThumb(db, 'A2', { packages: true })

    expect(r.ok).toBe(false)
    expect(coverOf('A2')).toBe('none')
  })

  it('unitypackage 里的 preview.png 能当封面', async () => {
    const pkg = path.join(root, 'item.unitypackage')
    await makeUnitypackage(pkg, Buffer.alloc(BIG_ENOUGH, 0x43))
    addAsset('A3', pkg)

    const r = await ensureThumb(db, 'A3', { packages: true })

    expect(r.ok).toBe(true)
    expect(coverOf('A3')).toBe('athumb://A3.jpg')
  })

  it('zip 里只有一个 unitypackage（包中包）也能出封面', async () => {
    /**
     * 现场：`liltoon_unebeta.zip` 解开只有一个 `liltoon_unebeta.unitypackage`，
     * 里面才有 preview.png。只下一层包、不下这一层的话，Booth 上最常见的
     * "zip 套 unitypackage" 永远没有封面（0.9.2 之前它被记成 none）。
     */
    const pkg = path.join(root, 'inner.unitypackage')
    await makeUnitypackage(pkg, Buffer.alloc(BIG_ENOUGH, 0x48))
    const zip = path.join(root, 'wrapper.zip')
    await makeZip(zip, { 'Inner/liltoon.unitypackage': fs.readFileSync(pkg) })
    addAsset('A4', zip)

    const r = await ensureThumb(db, 'A4', { packages: true })

    expect(r.ok).toBe(true)
    expect(coverOf('A4')).toBe('athumb://A4.jpg')
  })
})

describe('目录里没散图，但里面有包', () => {
  it('packages:true 时伸进目录里的 zip 拿封面', async () => {
    const dir = path.join(root, 'item-dir')
    fs.mkdirSync(dir, { recursive: true })
    const zip = path.join(dir, 'Inner.zip')
    await makeZip(zip, { 'preview.png': Buffer.alloc(BIG_ENOUGH, 0x44) })
    addAsset('B1', dir)

    const r = await ensureThumb(db, 'B1', { packages: true })

    expect(r.ok).toBe(true)
    expect(coverOf('B1')).toBe('athumb://B1.jpg')
  })

  it('packages:false 时不许把"没往包里看"记成没图', async () => {
    const dir = path.join(root, 'item-dir2')
    fs.mkdirSync(dir, { recursive: true })
    await makeZip(path.join(dir, 'Inner.zip'), { 'preview.png': Buffer.alloc(BIG_ENOUGH, 0x45) })
    addAsset('B2', dir)

    const r = await ensureThumb(db, 'B2', { packages: false })

    expect(r.ok).toBe(false)
    expect(coverOf('B2')).toBeNull()
  })

  it('连 packages 都没传（启动时那趟便宜的）也不许记 none', async () => {
    /**
     * 现场：启动第一趟只传 `{ deadlineMs }`，`packages` 是 undefined。
     * 旧口径 `opts.packages !== false` 把它当成"里外都找过了" —— 于是那一趟
     * 把压缩包素材全标成 'none'，第二趟（允许拆包）再也没资格碰它们。
     */
    const dir = path.join(root, 'item-dir3')
    fs.mkdirSync(dir, { recursive: true })
    await makeZip(path.join(dir, 'Inner.zip'), { 'preview.png': Buffer.alloc(BIG_ENOUGH, 0x49) })
    addAsset('B3', dir)

    await ensureThumb(db, 'B3', { deadlineMs: 1000 })

    expect(coverOf('B3')).toBeNull()
  })

  it('压缩包源同样：没允许拆包时保持 NULL，允许了才出图', async () => {
    const zip = path.join(root, 'pack2.zip')
    await makeZip(zip, { 'preview.png': Buffer.alloc(BIG_ENOUGH, 0x4a) })
    addAsset('B4', zip)

    await ensureThumb(db, 'B4', { deadlineMs: 1000 })
    expect(coverOf('B4')).toBeNull()

    expect((await ensureThumb(db, 'B4', { packages: true })).ok).toBe(true)
    expect(coverOf('B4')).toBe('athumb://B4.jpg')
  })
})

describe('一次性修复：不可信的 none', () => {
  it('把 none 清回 NULL，真实封面与用户自选封面都不动', () => {
    addAsset('E1', 'E:/x/a.zip', 'none')
    addAsset('E2', 'E:/x/b.rar', 'none')
    addAsset('E3', 'E:/x/c', 'athumb://keep.jpg')
    db.prepare(
      `INSERT INTO asset_cover (asset_id, cover_image, previous_image, source, updated_at)
       VALUES ('E1','athumb://mine.jpg',NULL,'image',1)`
    ).run()

    const cleared = repairUntrustedNoneCovers(db)

    expect(cleared).toBe(2)
    expect(coverOf('E1')).toBeNull()
    expect(coverOf('E2')).toBeNull()
    expect(coverOf('E3')).toBe('athumb://keep.jpg')
    const chosen = db.prepare('SELECT cover_image FROM asset_cover WHERE asset_id = ?').get('E1') as
      | { cover_image: string }
      | undefined
    expect(chosen?.cover_image).toBe('athumb://mine.jpg')
  })

  it('只跑一次：第二次调用什么都不做（不会把重新确认的 none 又来一遍）', () => {
    addAsset('E4', 'E:/x/d.zip', 'none')
    expect(repairUntrustedNoneCovers(db)).toBe(1)
    // 补看之后又确认"真没图"，再记回 none
    db.prepare(`UPDATE asset SET cover_image = 'none' WHERE id = 'E4'`).run()

    expect(repairUntrustedNoneCovers(db)).toBe(0)
    expect(coverOf('E4')).toBe('none')
  })
})

describe('一次落 N 行（整筐 / 合集拆分）', () => {
  it('backfillThumbsFor 把这一批都补上，missed 只留"还没落稳"的', async () => {
    const withImage = path.join(root, 'with-image')
    fs.mkdirSync(withImage, { recursive: true })
    fs.writeFileSync(path.join(withImage, 'cover.png'), Buffer.alloc(BIG_ENOUGH, 0x46))

    const emptyDir = path.join(root, 'empty-dir')
    fs.mkdirSync(emptyDir, { recursive: true })

    /** 源还没落稳：目录此刻不存在 */
    const notYet = path.join(root, 'not-yet')

    addAsset('C1', withImage)
    addAsset('C2', emptyDir)
    addAsset('C3', notYet)

    const r = await backfillThumbsFor(db, ['C1', 'C2', 'C3'], { packages: true })

    expect(r.checked).toBe(3)
    expect(r.made).toBe(1)
    expect(coverOf('C1')).toBe('athumb://C1.jpg')
    // 真看过、真没图 → none（不再补拍）
    expect(coverOf('C2')).toBe('none')
    // 没落稳 → 留 NULL，交给补拍
    expect(coverOf('C3')).toBeNull()
    expect(r.missed).toEqual(['C3'])
  })

  it('已经补过的（有缓存）不会重复解码', async () => {
    const dir = path.join(root, 'done-dir')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'cover.png'), Buffer.alloc(BIG_ENOUGH, 0x47))
    addAsset('D1', dir)
    expect((await ensureThumb(db, 'D1', { packages: true })).ok).toBe(true)

    image.createFromPath.mockClear()
    const r = await backfillThumbsFor(db, ['D1'], { packages: true })

    expect(r.made).toBe(1)
    expect(image.createFromPath).not.toHaveBeenCalled()
  })
})
