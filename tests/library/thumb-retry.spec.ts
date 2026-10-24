import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeDatabase, openDatabase } from '../../src/main/db'
import { P, setAppPathsForTest } from '../../src/main/services/paths'
import {
  cancelThumbRetry,
  clearThumbRetriesForTest,
  scheduleThumbRetry
} from '../../src/main/library/thumbs'

/**
 * P9-D 之后 · 导入当刻封面补拍。
 *
 * 现场（2026-10-24）：一次拖入 22 件，只有 1 张封面在入库那一刻写出来，
 * 其余要等下次启动的 `backfillThumbs` 才补上。原因是入库瞬间源目录还没落稳，
 * `ensureThumb` 拿不到图 → 返回 ok:false（"没图"的正常语义），以前就到此为止了。
 *
 * 这里钉住补拍机制本身：第一次没有图 → 等文件出现 → 补拍成功；
 * 一直没图 → 按次数放弃，不无限重试。
 */

/** thumbs.ts 用 Electron 的 nativeImage 解码，测试里换成永远成功的假实现。 */
const image = vi.hoisted(() => ({
  createFromPath: vi.fn(() => ({
    isEmpty: () => false,
    getSize: () => ({ width: 16, height: 16 }),
    resize() {
      return this
    },
    toJPEG: () => Buffer.from('fake-jpeg')
  })),
  createFromBuffer: vi.fn(() => ({
    isEmpty: () => false,
    getSize: () => ({ width: 16, height: 16 }),
    resize() {
      return this
    },
    toJPEG: () => Buffer.from('fake-jpeg')
  }))
}))

vi.mock('electron', () => ({ nativeImage: image }))

let root: string
let db: ReturnType<typeof openDatabase>

function addAsset(id: string, sourcePath: string | null): void {
  db.prepare(
    `INSERT INTO asset (id, name, raw_name, category, confidence, status, storage_mode,
                        source_path, hash_xxh64, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, '测试素材', '测试素材', '道具', 1, 'ready', 'indexed', sourcePath, null, 1, 1)
}

function coverOf(id: string): string | null {
  const row = db.prepare('SELECT cover_image FROM asset WHERE id = ?').get(id) as
    | { cover_image: string | null }
    | undefined
  return row?.cover_image ?? null
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-thumb-retry-'))
  setAppPathsForTest(root)
  db = openDatabase(P.db())
})

afterEach(() => {
  clearThumbRetriesForTest()
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('封面补拍', () => {
  it('入库当刻没图，图片出现后补拍成功并回调', async () => {
    const dir = path.join(root, 'asset-a')
    fs.mkdirSync(dir, { recursive: true })
    addAsset('a1', dir)

    const made: string[] = []
    scheduleThumbRetry(db, 'a1', { delays: [40, 120], onMade: (id) => made.push(id) })

    // 补拍第一次（40ms）时还没有图 → 失败；之后把图放进去，第二次（120ms）应该成功
    await wait(20)
    expect(coverOf('a1')).toBeNull()
    fs.writeFileSync(path.join(dir, 'cover.png'), Buffer.alloc(4096, 7))

    await wait(300)
    expect(made).toEqual(['a1'])
    expect(coverOf('a1')?.startsWith('athumb://')).toBe(true)
    expect(fs.existsSync(path.join(P.thumbs(), `${'a1'}.jpg`))).toBe(true)
  })

  it('目录读得出来但确实没图 → 记 none（这是"没图"的正解，别再补）', async () => {
    const dir = path.join(root, 'asset-b')
    fs.mkdirSync(dir, { recursive: true })
    addAsset('b1', dir)

    const made: string[] = []
    scheduleThumbRetry(db, 'b1', { delays: [20, 40], onMade: (id) => made.push(id) })
    await wait(200)

    expect(made).toEqual([])
    expect(coverOf('b1')).toBe('none')
  })

  /**
   * 这条是 2026-10-24 现场的直接回归：
   * 入库那一刻源目录**还不存在**（刚解压/刚拖入，路径还没落稳）。
   * 老代码在 `statSync` 之后就把 sawSomething 置真，最后一句把 cover_image 写成 'none'，
   * 而 backfillThumbs 只捞 NULL —— 于是这张卡永远没有封面，直到用户手动重建。
   */
  it('源目录还不存在时不写 none，等它出现后补拍能补上', async () => {
    const dir = path.join(root, 'asset-e')
    addAsset('e1', dir) // 故意不建目录

    const made: string[] = []
    scheduleThumbRetry(db, 'e1', { delays: [30, 90], onMade: (id) => made.push(id) })

    await wait(60)
    expect(coverOf('e1'), '路径不存在时不能写 none').toBeNull()

    // 目录和图片姗姗来迟
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'cover.png'), Buffer.alloc(4096, 7))

    await wait(300)
    expect(made).toEqual(['e1'])
    expect(coverOf('e1')?.startsWith('athumb://')).toBe(true)
  })

  it('同一个素材重复排补拍不会叠 timer', async () => {
    const dir = path.join(root, 'asset-c')
    fs.mkdirSync(dir, { recursive: true })
    addAsset('c1', dir)

    let calls = 0
    for (let i = 0; i < 5; i++) {
      scheduleThumbRetry(db, 'c1', { delays: [30], onMade: () => calls++ })
    }
    fs.writeFileSync(path.join(dir, 'cover.png'), Buffer.alloc(4096, 7))
    await wait(200)

    // 只该有一次成功回调；5 次排队被合并成 1 个 timer
    expect(calls).toBe(1)
  })

  it('取消后不再补拍', async () => {
    const dir = path.join(root, 'asset-d')
    fs.mkdirSync(dir, { recursive: true })
    addAsset('d1', dir)
    fs.writeFileSync(path.join(dir, 'cover.png'), Buffer.alloc(4096, 7))

    const made: string[] = []
    scheduleThumbRetry(db, 'd1', { delays: [60], onMade: (id) => made.push(id) })
    cancelThumbRetry('d1')
    await wait(150)

    expect(made).toEqual([])
    expect(coverOf('d1')).toBeNull()
  })
})
