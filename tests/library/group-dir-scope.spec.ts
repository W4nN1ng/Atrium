import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, migrate, type Db } from '../../src/main/db'
import { getAsset } from '../../src/main/db/repos/asset'
import { ensureGroup } from '../../src/main/db/repos/product'
import { commitAsset, type CommitDeps, type CommitUnit } from '../../src/main/library/commit'
import { dirKeyOf } from '../../src/shared/pathkey'
import { backfillGroupDir } from '../../src/main/db/schema'
import type { CategoryConfig } from '../../src/shared/types'

/**
 * #40 —— 用户裁定原文：
 *   「归并的前提是**同一父容器（同目录）**，跨目录的 groupKey 相同不构成归并理由。」
 *
 * 真库实测到的事故形状（`node tools/probe-groups.cjs` 跑出来的）：
 *   `贴图/脸部/4900077` 与 `贴图/lime/4900077` —— 两个毫不相干的商品，
 *   名字都是 Booth id，归并键一模一样，于是被挂进同一组，
 *   界面上就是一张卡写着"2 变体"。跨目录的组一共 13 个 / 27 行。
 *
 * 这一份测的是**入库那条路**（`persistRelations` → `ensureGroup`），
 * 因为真正给用户看到"同一张卡"的就是它。`planGroups` 那层同样的闸门在
 * `tests/classify/grouping.spec.ts` 里测。
 */
const cfg: CategoryConfig = {
  version: 1,
  categories: [
    { key: 'texture', order: 1, label: { 'zh-CN': '贴图' }, subcategories: [{ key: 'skin', label: { 'zh-CN': '皮肤' } }] },
    { key: 'clothing', order: 2, label: { 'zh-CN': '服装' }, subcategories: [] }
  ]
}
const names = new Map<string, string>([
  ['texture', '贴图'],
  ['texture/skin', '皮肤'],
  ['clothing', '服装']
])

let root: string
let lib: string
let db: Db

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-dirscope-'))
  lib = path.join(root, 'A')
  fs.mkdirSync(lib, { recursive: true })
  db = openDatabase(path.join(root, 'library.db'))
})

afterAll(() => {
  closeDatabase()
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

/** 在库里造一个真实存在的目录 + 里面的文件（索引模式按路径定位，路径得在） */
function shelf(relDir: string, fileName: string): string {
  const dir = path.join(lib, relDir)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, fileName)
  if (!fs.existsSync(file)) fs.writeFileSync(file, 'x')
  return file
}

function unit(over: Partial<CommitUnit> = {}): CommitUnit {
  return {
    name: '4900077',
    rawName: '4900077.zip',
    category: 'texture',
    subcategory: 'skin',
    confidence: 0.8,
    status: 'classified',
    kind: 'archive',
    contentType: 'texture',
    version: null,
    author: null,
    localeTag: null,
    sourceUrl: null,
    sourcePlatform: null,
    sourceItemId: null,
    sourceItemIdConfidence: null,
    tags: [],
    targetAvatars: [],
    groupKey: '4900077',
    bundleRef: null,
    bundleName: null,
    reason: 'test',
    hash: 'h',
    sizeBytes: 1024,
    attachments: [],
    ...over
  }
}

function deps(sourcePath: string): CommitDeps {
  return {
    db,
    libraryRoot: lib,
    names,
    template: '{category}/{subcategory}/{name}',
    storageMode: 'indexed',
    autoExtract: false,
    holdDir: path.join(root, 'hold'),
    appVersion: 'test'
  } as CommitDeps
}

async function commitOne(id: string, relDir: string, over: Partial<CommitUnit> = {}): Promise<string> {
  const p = shelf(relDir, `${id}.zip`)
  const r = await commitAsset(deps(p), { assetId: id, unit: unit({ ...over, rawName: `${id}.zip` }), stagingPath: null, sourcePath: p })
  return r.assetId
}

describe('#40 入库层：跨目录的同一个归并键不许并成一个组', () => {
  it('三个不同目录下的同名产品，必须各自成卡、各自成组，不得归并', async () => {
    await commitOne('dps-a', '贴图/脸部')
    await commitOne('dps-b', '贴图/lime')
    await commitOne('dps-c', '贴图/化妆')

    const ids = ['dps-a', 'dps-b', 'dps-c'].map((i) => getAsset(db, i)!)
    expect(ids.every((a) => !!a), '三行都要落库').toBe(true)
    const groups = new Set(ids.map((a) => a.group_id))
    expect(groups.size, `三个目录三个组，实际 ${[...groups].join('/')}`).toBe(3)

    // 卡片层：三张独立的卡，不是"一张卡三个变体"。
    // 变体徽章数的是组内成员数，所以直接查组里各有几个人。
    const perGroup = db
      .prepare(`select group_id g, count(*) n from asset where group_id in (${[...groups].map(() => '?').join(',')}) group by g`)
      .all(...[...groups]) as Array<{ g: string; n: number }>
    expect(perGroup.length).toBe(3)
    for (const row of perGroup) expect(row.n, `组 ${row.g} 只该有它自己那一个成员`).toBe(1)

    const dirs = db.prepare(`select dir_key from asset_group where id in (${[...groups].map(() => '?').join(',')})`).all(
      ...[...groups]
    ) as Array<{ dir_key: string | null }>
    expect(new Set(dirs.map((d) => d.dir_key)).size, '三个组的 dir_key 互不相同').toBe(3)
  })

  it('同一目录下的同系列照旧并成一个组（闸门不许把正常归并一起砍掉）', async () => {
    await commitOne('hs-a', '衣服/修女', { name: 'Holy Spice Moe', groupKey: 'holy spice' })
    await commitOne('hs-b', '衣服/修女', { name: 'Holy Spice Shinano', groupKey: 'holy spice' })
    const a = getAsset(db, 'hs-a')!
    const b = getAsset(db, 'hs-b')!
    expect(a.group_id).toBeTruthy()
    expect(b.group_id).toBe(a.group_id)

    await commitOne('hs-c', '衣服/黑曜石', { name: 'Holy Spice Rurune', groupKey: 'holy spice' })
    expect(getAsset(db, 'hs-c')!.group_id, '换个目录就必须换组').not.toBe(a.group_id)
  })

  it('同一个组可以被两个一级分类各用一次（category 仍在键里）', () => {
    const g1 = ensureGroup(db, { groupKey: 'dup-key', name: 'A', category: 'texture', dirKey: 'e:/a/贴图' })
    const g2 = ensureGroup(db, { groupKey: 'dup-key', name: 'B', category: 'clothing', dirKey: 'e:/a/贴图' })
    const g3 = ensureGroup(db, { groupKey: 'dup-key', name: 'A2', category: 'texture', dirKey: 'e:/a/贴图' })
    expect(g2.id).not.toBe(g1.id)
    expect(g3.id, '同目录同类要复用').toBe(g1.id)
  })
})

describe('#40 dir_key 归一化与 V4 回填', () => {
  it('反斜杠、尾斜杠、大小写都要落到同一个键', () => {
    expect(dirKeyOf('E:\\vrc\\A\\贴图\\脸部\\4900077.zip')).toBe(dirKeyOf('E:/vrc/A/贴图/脸部/4900077.zip'))
    expect(dirKeyOf('e:/vrc/a/贴图/脸部/')).not.toBe(dirKeyOf('e:/vrc/a/贴图/脸部/x.zip'))
    expect(dirKeyOf('E:\\vrc\\A\\贴图\\脸部\\4900077')).toBe('e:/vrc/a/贴图/脸部')
    expect(dirKeyOf(null)).toBe(null)
  })

  it('回填：组内目录一致才写 dir_key，跨目录的历史组留 NULL', () => {
    const g = ensureGroup(db, { groupKey: 'backfill-same', name: 'S', category: 'texture', dirKey: null })
    const h = ensureGroup(db, { groupKey: 'backfill-cross', name: 'C', category: 'texture', dirKey: null })
    const mk = (id: string, gid: string, p: string): void => {
      db.prepare(
        `insert into asset (id,name,raw_name,category,confidence,status,storage_mode,library_path,source_path,created_at,updated_at,group_id,is_bundle)
         values (?,?,?,?,?,'classified','indexed',?,NULL,?,?,?,0)`
      ).run(id, id, `${id}.zip`, 'texture', 0.8, p, Date.now(), Date.now(), gid)
    }
    mk('bf-1', g.id, 'E:\\vrc\\A\\贴图\\皮肤\\a.zip')
    mk('bf-2', g.id, 'E:/vrc/A/贴图/皮肤/b.zip')
    mk('bf-3', h.id, 'E:\\vrc\\A\\贴图\\皮肤\\c.zip')
    mk('bf-4', h.id, 'E:\\vrc\\A\\贴图\\化妆\\d.zip')

    backfillGroupDir(db)
    expect(getGroupDir(db, g.id), '两条同目录（斜杠方向不同）要回填得上').toBe('e:/vrc/a/贴图/皮肤')
    expect(getGroupDir(db, h.id), '跨目录的历史组不许猜一个目录，留 NULL 表示"不再吸新成员"').toBe(null)

    /** NULL 的历史组不能被带 dirKey 的请求吸附 —— 不然误并会继续长大 */
    const again = ensureGroup(db, { groupKey: 'backfill-cross', name: 'C2', category: 'texture', dirKey: 'e:/vrc/a/贴图/皮肤' })
    expect(again.id).not.toBe(h.id)
  })

  it('迁移是幂等的：跑第二遍不许报错、不许改已有值', () => {
    expect(() => migrate(db)).not.toThrow()
    expect(migrate(db), '已经到 V4 了，第二次应一条都不做').toBe(0)
  })
})

function getGroupDir(db: Db, id: string): string | null {
  return (db.prepare(`select dir_key from asset_group where id = ?`).get(id) as { dir_key: string | null }).dir_key
}
