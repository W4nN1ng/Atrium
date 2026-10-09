import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { getAsset, makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { listGroups } from '../../src/main/db/repos/product'
import { applyRegroup, planRegroup } from '../../src/main/library/regroup'
import { undoLast } from '../../src/main/library/undo'
import { dirKeyOf } from '../../src/shared/pathkey'
import { ulid } from '../../src/shared/ulid'
import type { AssetKind, ContentType, StorageMode } from '../../src/shared/types'

/**
 * #40 存量清理的测试。两种"跨目录的组"必须被**区别对待** —— 这是本文件存在的全部理由：
 *
 *   甲、真误并 → 按目录拆开（`4900077`、lilToon 1.x/2.x 的 6 个附属、两个不同的 `PSD.zip`）
 *   乙、同一产品的两个形态（同名 zip 与已解压目录）→ **保持归并**（裁定 #16）
 *
 * ⚠ 本文件里的路径**抄自真库实测**（`node tools/probe-40-forms.cjs` 的输出），
 * 不是编的。第一版测试把"归档侧"的路径简化成了 `NAME.zip`，结果判据在错的地方生效、
 * 4 个用例假失败 —— 这里必须用真形状，否则测的是幻觉。
 *
 * 真库那个决定性形状是：**乙类的归档侧，`library_path` 就是那个同名目录本身**
 * （`…\贴图\皮肤\Sexy skin material for VRC 6053463`），`source_path` 才指向库外的 `.rar`；
 * 而甲类是**同一个目录下 `NAME.zip` 和 `NAME/` 并存**。
 */

let root: string
let db: Db

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-regroup-'))
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

beforeEach(() => {
  db.exec(`DELETE FROM variant`)
  db.exec(`DELETE FROM asset_tag`)
  db.exec(`DELETE FROM tag`)
  db.exec(`DELETE FROM journal`)
  db.exec(`DELETE FROM asset`)
  db.exec(`DELETE FROM asset_group`)
})

function countRows(sql: string, ...args: unknown[]): number {
  const row = db.prepare(sql).get(...args) as { n: number } | undefined
  return Number(row?.n ?? 0)
}

function makeGroup(opts: {
  key: string
  name: string
  category?: string
  subcategory?: string | null
}): string {
  const id = ulid()
  const now = Date.now()
  db.prepare(
    `INSERT INTO asset_group (id, group_key, name, category, subcategory, created_at, updated_at, dir_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(id, opts.key, opts.name, opts.category ?? 'texture', opts.subcategory ?? 'skin', now, now)
  return id
}

/** 造一行成员。`libraryPath` 必填（判据只看它），`sourcePath` 可选 */
function addMember(opts: {
  /** null = 这行不属于任何组（造容器/父行时用） */
  groupId: string | null
  name: string
  libraryPath: string | null
  sourcePath?: string | null
  category?: string
  subcategory?: string | null
  contentType?: ContentType | null
  storageMode?: StorageMode
  kind?: AssetKind | null
  avatar?: string | null
  version?: string | null
  locale?: string | null
}): string {
  const row = makeAssetRow({
    name: opts.name,
    raw_name: opts.name,
    category: opts.category ?? 'texture',
    subcategory: opts.subcategory ?? 'skin',
    library_path: opts.libraryPath,
    source_path: opts.sourcePath ?? null,
    content_type: opts.contentType ?? null,
    kind: opts.kind ?? null,
    storage_mode: opts.storageMode ?? 'archived',
    version: opts.version ?? null,
    locale_tag: opts.locale ?? null
  })
  row.group_id = opts.groupId
  upsertAsset(db, row)
  if (opts.avatar) {
    db.prepare(`INSERT OR IGNORE INTO tag (id, name, kind) VALUES (?, ?, 'avatar')`).run(ulid(), opts.avatar)
    const real = db.prepare(`SELECT id FROM tag WHERE name = ?`).get(opts.avatar) as { id: string }
    db.prepare(`INSERT OR IGNORE INTO asset_tag (asset_id, tag_id, source) VALUES (?, ?, 'auto')`).run(row.id, real.id)
  }
  return row.id
}

describe('#40 甲类：真误并 —— 必须按目录拆开', () => {
  it('4900077 形状：两个毫不相干的商品同名，拆成两组', () => {
    /**
     * 真库原文（`tools/probe-40-forms.cjs`）：
     *   E:\vrc\A\贴图\脸部\4900077        kind=archive storage=archived
     *   E:\vrc\A\贴图\lime\4900077        kind=folder  storage=indexed  name="lime"
     * 注意两行的 name 其实不同（一条叫 4900077、一条叫 lime），只是 group_key 撞了。
     */
    const g = makeGroup({ key: '4900077', name: '4900077', category: 'texture', subcategory: 'face' })
    const face = addMember({
      groupId: g, name: '4900077', libraryPath: 'E:\\vrc\\A\\贴图\\脸部\\4900077',
      category: 'texture', subcategory: 'face', contentType: 'texture', kind: 'archive', avatar: 'Lime'
    })
    const lime = addMember({
      groupId: g, name: 'lime', libraryPath: 'E:\\vrc\\A\\贴图\\lime\\4900077',
      category: 'texture', subcategory: 'face', contentType: 'texture', kind: 'folder',
      storageMode: 'indexed', avatar: 'Lime'
    })

    const plan = planRegroup(db)
    expect(plan.groups).toHaveLength(1)
    expect(plan.kept).toHaveLength(0)
    expect(plan.groups[0].clusters).toHaveLength(2)
    expect(plan.affected).toBe(2)

    const res = applyRegroup(db, plan)
    expect(res.moved).toBe(2)
    expect(res.createdGroups).toBe(2)

    const a = getAsset(db, face)!
    const b = getAsset(db, lime)!
    expect(a.group_id).not.toBe(b.group_id)
    expect(a.group_id).not.toBe(g)
    expect(b.group_id).not.toBe(g)
    const ga = db.prepare(`SELECT dir_key FROM asset_group WHERE id = ?`).get(a.group_id) as { dir_key: string }
    const gb = db.prepare(`SELECT dir_key FROM asset_group WHERE id = ?`).get(b.group_id) as { dir_key: string }
    expect(ga.dir_key).toBe(dirKeyOf('E:\\vrc\\A\\贴图\\脸部\\4900077'))
    expect(gb.dir_key).toBe(dirKeyOf('E:\\vrc\\A\\贴图\\lime\\4900077'))
    expect(ga.dir_key).not.toBe(gb.dir_key)
  })

  /**
   * R4 ⑤：拆组之后要能把 avatar 变体**补得出来**。
   *
   * 老数据里一张卡可能同时挂着 `Lime` 和 `LIME`（分类器早期把语料里两种写法都当成了模型）。
   * `applyRegroup` 重建变体时那条闸门是"只有一个模型才算变体"，按大小写数出来的 2 条
   * 会把 avatar 变体整个吞掉，聚合视图的「适配模型」分列就此永远出不来。
   */
  it('大小写双胞胎标签算同一个模型：拆完组仍然写出 1 条 avatar 变体', () => {
    const g = makeGroup({ key: '4900077', name: '4900077', category: 'texture', subcategory: 'face' })
    const face = addMember({
      groupId: g, name: '4900077', libraryPath: 'E:\\vrc\\A\\贴图\\脸部\\4900077',
      category: 'texture', subcategory: 'face', contentType: 'texture', kind: 'archive', avatar: 'Lime'
    })
    addMember({
      groupId: g, name: 'lime', libraryPath: 'E:\\vrc\\A\\贴图\\lime\\4900077',
      category: 'texture', subcategory: 'face', contentType: 'texture', kind: 'folder',
      storageMode: 'indexed', avatar: 'Lime'
    })
    // 再挂一个大写写法（同一个模型的另一种写法）
    db.prepare(`INSERT OR IGNORE INTO tag (id, name, kind) VALUES (?, ?, 'avatar')`).run(ulid(), 'LIME')
    const twin = db.prepare(`SELECT id FROM tag WHERE name = ?`).get('LIME') as { id: string }
    db.prepare(`INSERT OR IGNORE INTO asset_tag (asset_id, tag_id, source) VALUES (?, ?, 'auto')`).run(face, twin.id)

    applyRegroup(db, planRegroup(db))

    const rows = db
      .prepare(`SELECT variant_value AS v FROM variant WHERE asset_id = ? AND variant_kind='avatar'`)
      .all(face) as Array<{ v: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].v.toLowerCase()).toBe('lime')
  })

  it('lilToon 形状：两个容器的附属资源不再被并成一组', () => {
    /**
     * 真库原文：
     *   E:\vrc\A\lilToon_1.x.x\Readme.html    kind=doc attachment=doc
     *   E:\vrc\A\lilToon_2.x.x\Readme.html    kind=doc attachment=doc
     * 两行 name 完全相同（"Readme"），但分属 lilToon 1.x 与 2.x 两个容器 —— 是**不同产品**。
     */
    const g = makeGroup({ key: 'readme html', name: 'Readme', category: 'shader', subcategory: null })
    const v1 = addMember({
      groupId: g, name: 'Readme', libraryPath: 'E:\\vrc\\A\\lilToon_1.x.x\\Readme.html',
      sourcePath: 'E:\\vrc\\A\\lilToon_1.x.x\\Readme.html',
      category: 'shader', subcategory: null, storageMode: 'indexed', kind: 'doc'
    })
    const v2 = addMember({
      groupId: g, name: 'Readme', libraryPath: 'E:\\vrc\\A\\lilToon_2.x.x\\Readme.html',
      sourcePath: 'E:\\vrc\\A\\lilToon_2.x.x\\Readme.html',
      category: 'shader', subcategory: null, storageMode: 'indexed', kind: 'doc'
    })
    /** 这两行各自挂在不同的容器下 —— 父行必须真实存在（foreign_keys=ON） */
    const parent1 = addMember({
      groupId: null, name: 'lilToon 1.x',
      libraryPath: 'E:\\vrc\\A\\lilToon_1.x.x', category: 'shader', subcategory: null, storageMode: 'indexed'
    })
    const parent2 = addMember({
      groupId: null, name: 'lilToon 2.x',
      libraryPath: 'E:\\vrc\\A\\lilToon_2.x.x', category: 'shader', subcategory: null, storageMode: 'indexed'
    })
    db.prepare(`UPDATE asset SET is_bundle = 1, parent_asset_id = NULL WHERE id IN (?, ?)`).run(parent1, parent2)
    db.prepare(`UPDATE asset SET parent_asset_id = ? WHERE id = ?`).run(parent1, v1)
    db.prepare(`UPDATE asset SET parent_asset_id = ? WHERE id = ?`).run(parent2, v2)

    const plan = planRegroup(db)
    expect(plan.groups).toHaveLength(1)
    applyRegroup(db, plan)

    expect(getAsset(db, v1)!.group_id).not.toBe(getAsset(db, v2)!.group_id)
    /** 父级不能被这次拆分碰到 —— 它只动 group_id */
    expect(getAsset(db, v1)!.parent_asset_id).toBe(parent1)
    expect(getAsset(db, v2)!.parent_asset_id).toBe(parent2)
  })

  it('PSD 形状：同名目录下 NAME.zip 与 NAME/ 并存 = 压缩包与它自己的解压目录，必须拆', () => {
    /**
     * 真库原文（这一组是判据的核心反例）：
     *   E:\vrc\A\衣服\名流\材质包 PSD\PSD.zip   kind=loose_files storage=indexed
     *   E:\vrc\A\衣服\名流\材质包 PSD\PSD       kind=loose_files storage=indexed
     *   E:\vrc\A\衣服\衣服TwinkleSpica\PSD.zip  kind=archive     storage=indexed
     * 同一个目录里 `PSD.zip` 和 `PSD/` 并存 → 那是它自己的解压目录，
     * 跟另一个目录里的 `PSD.zip` 毫无关系 → 真误并。
     */
    const g = makeGroup({ key: 'psd', name: 'PSD', category: 'texture', subcategory: 'psd' })
    const mingliuZip = addMember({
      groupId: g, name: 'PSD', libraryPath: 'E:\\vrc\\A\\衣服\\名流\\材质包 PSD\\PSD.zip',
      category: 'texture', subcategory: 'psd', contentType: 'texture', storageMode: 'indexed', kind: 'loose_files'
    })
    const mingliuDir = addMember({
      groupId: g, name: 'PSD', libraryPath: 'E:\\vrc\\A\\衣服\\名流\\材质包 PSD\\PSD',
      category: 'texture', subcategory: 'psd', contentType: 'texture', storageMode: 'indexed', kind: 'loose_files'
    })
    const twinkle = addMember({
      groupId: g, name: 'PSD', libraryPath: null, sourcePath: 'E:\\vrc\\A\\衣服\\衣服TwinkleSpica\\PSD.zip',
      category: 'texture', subcategory: 'psd', contentType: 'texture', storageMode: 'indexed', kind: 'archive'
    })

    const plan = planRegroup(db)
    expect(plan.groups).toHaveLength(1)
    expect(plan.kept).toHaveLength(0)
    applyRegroup(db, plan)

    const gidZip = getAsset(db, mingliuZip)!.group_id
    /** 同目录的两行必须留在**同一个**新组里（这是"同目录才归并"的正向要求） */
    expect(getAsset(db, mingliuDir)!.group_id).toBe(gidZip)
    expect(getAsset(db, twinkle)!.group_id).not.toBe(gidZip)
  })
})

describe('#40 乙类：同一产品的两个形态 —— 必须保持归并（裁定 #16）', () => {
  it('Sexy skin 形状：library_path 就是同名目录，source_path 才指向库外 .rar → 不拆', () => {
    /**
     * 真库原文：
     *   library_path E:\vrc\A\贴图\皮肤\Sexy skin material for VRC 6053463   kind=archive storage=archived
     *   source_path  E:\vrc\A\贴图\皮肤\Sexy skin material for VRC 6053463\Sexy skin material for VRC 6053463.rar
     *   library_path (null) E:\vrc\A\贴图\6718483Milfy妆容\Sexy skin material for VRC 6053463  kind=folder storage=indexed
     * 归档侧 library_path 的父目录里**只有这一个同名条目**，没有 .zip/.rar 并存 → 一体两形态。
     */
    const g = makeGroup({ key: 'sexy skin material for vrc', name: 'Sexy skin material for VRC 6053463' })
    addMember({
      groupId: g, name: 'Sexy skin material for VRC 6053463',
      libraryPath: 'E:\\vrc\\A\\贴图\\皮肤\\Sexy skin material for VRC 6053463',
      sourcePath:
        'E:\\vrc\\A\\贴图\\皮肤\\Sexy skin material for VRC 6053463\\Sexy skin material for VRC 6053463.rar',
      contentType: 'bundle', storageMode: 'archived', kind: 'archive', avatar: 'Milfy'
    })
    addMember({
      groupId: g, name: 'Sexy skin material for VRC 6053463',
      libraryPath: 'E:\\vrc\\A\\贴图\\6718483Milfy妆容\\Sexy skin material for VRC 6053463',
      sourcePath: 'E:\\vrc\\A\\贴图\\6718483Milfy妆容\\Sexy skin material for VRC 6053463',
      contentType: 'bundle', storageMode: 'indexed', kind: 'folder', avatar: 'Milfy'
    })

    const plan = planRegroup(db)
    expect(plan.groups).toHaveLength(0)
    expect(plan.kept).toHaveLength(1)
    expect(plan.kept[0].reason).toBe('same_product_two_forms')
    expect(plan.affected).toBe(0)

    const res = applyRegroup(db, plan)
    expect(res.moved).toBe(0)
    /** 组里还是两条，用户看到的还是一张卡 */
    expect(countRows(`SELECT COUNT(*) AS n FROM asset WHERE group_id = ?`, g)).toBe(2)
  })

  it('Costume Pomae 形状：zip 在 衣服\\、解压目录在 衣服\\shinano\\ → 不拆（G6 的存量）', () => {
    /**
     * 真库原文：
     *   source_path E:\vrc\A\衣服\Costume_Pomae_20241024.zip                       kind=archive storage=indexed
     *   source_path E:\vrc\A\衣服\shinano\Costume_Pomae_20241024                   kind=folder  storage=indexed
     * 归档侧 library_path 是 null，所以判据读 source_path。
     */
    const g = makeGroup({ key: 'costume pomae', name: 'Costume Pomae 20241024', category: 'clothing', subcategory: 'coat' })
    addMember({
      groupId: g, name: 'Costume Pomae 20241024', libraryPath: null,
      sourcePath: 'E:\\vrc\\A\\衣服\\Costume_Pomae_20241024.zip',
      category: 'clothing', subcategory: 'coat', contentType: 'model', storageMode: 'indexed',
      kind: 'archive', avatar: 'Shinano'
    })
    addMember({
      groupId: g, name: 'Costume Pomae 20241024', libraryPath: null,
      sourcePath: 'E:\\vrc\\A\\衣服\\shinano\\Costume_Pomae_20241024',
      category: 'clothing', subcategory: 'coat', contentType: 'model', storageMode: 'indexed',
      kind: 'folder', avatar: 'Shinano'
    })

    const plan = planRegroup(db)
    expect(plan.groups).toHaveLength(0)
    expect(plan.kept).toHaveLength(1)
  })

  it('名字不同就不是"两个形态"，仍要拆', () => {
    const g = makeGroup({ key: 'kskin', name: 'K Skin' })
    addMember({ groupId: g, name: 'K Skin A', libraryPath: 'E:\\vrc\\A\\贴图\\皮肤\\A', avatar: 'Milfy' })
    addMember({ groupId: g, name: 'K Skin B', libraryPath: 'E:\\vrc\\A\\贴图\\化妆\\B', storageMode: 'indexed', avatar: 'Milfy' })

    const plan = planRegroup(db)
    expect(plan.kept).toHaveLength(0)
    expect(plan.groups).toHaveLength(1)
  })

  it('分类不同就不是"两个形态"，仍要拆', () => {
    const g = makeGroup({ key: 'same name', name: 'Same Name' })
    addMember({ groupId: g, name: 'Same Name', libraryPath: 'E:\\vrc\\A\\贴图\\皮肤\\Same Name', category: 'texture' })
    addMember({
      groupId: g, name: 'Same Name', libraryPath: 'E:\\vrc\\A\\衣服\\Same Name',
      category: 'clothing', subcategory: null, storageMode: 'indexed'
    })

    const plan = planRegroup(db)
    expect(plan.kept).toHaveLength(0)
    expect(plan.groups).toHaveLength(1)
  })
})

describe('planRegroup 是只读的', () => {
  it('反复扫描不改任何一行', () => {
    const g = makeGroup({ key: 'x', name: 'X' })
    addMember({ groupId: g, name: 'X1', libraryPath: 'E:\\vrc\\A\\贴图\\皮肤\\X1' })
    addMember({ groupId: g, name: 'X2', libraryPath: 'E:\\vrc\\A\\贴图\\化妆\\X2' })

    const snapshot = (): string =>
      JSON.stringify(db.prepare(`SELECT id, group_id FROM asset ORDER BY id`).all()) +
      JSON.stringify(db.prepare(`SELECT id, dir_key FROM asset_group ORDER BY id`).all()) +
      String(countRows(`SELECT COUNT(*) AS n FROM journal`))

    const before = snapshot()
    planRegroup(db)
    planRegroup(db)
    expect(snapshot()).toBe(before)
  })

  it('同目录的组不动；单成员的组不动', () => {
    const same = makeGroup({ key: 'same', name: 'Same' })
    addMember({ groupId: same, name: 'S1', libraryPath: 'E:\\vrc\\A\\贴图\\皮肤\\a.zip' })
    addMember({ groupId: same, name: 'S2', libraryPath: 'E:\\vrc\\A\\贴图\\皮肤\\b.zip' })
    const lone = makeGroup({ key: 'lone', name: 'Lone' })
    addMember({ groupId: lone, name: 'L1', libraryPath: 'E:\\vrc\\A\\贴图\\皮肤\\c.zip' })

    const plan = planRegroup(db)
    expect(plan.groups).toHaveLength(0)
    expect(plan.kept).toHaveLength(0)
  })
})

describe('重跑是幂等的', () => {
  it('拆完再扫一次 → 没有可拆的了，也不会重复建组', () => {
    const g = makeGroup({ key: '4900077', name: '4900077', category: 'texture', subcategory: 'face' })
    addMember({
      groupId: g, name: '4900077', libraryPath: 'E:\\vrc\\A\\贴图\\脸部\\4900077',
      category: 'texture', subcategory: 'face', contentType: 'texture', kind: 'archive', avatar: 'Lime'
    })
    addMember({
      groupId: g, name: 'lime', libraryPath: 'E:\\vrc\\A\\贴图\\lime\\4900077',
      category: 'texture', subcategory: 'face', contentType: 'texture', kind: 'folder',
      storageMode: 'indexed', avatar: 'Lime'
    })

    applyRegroup(db, planRegroup(db))
    const groupsAfterFirst = listGroups(db).length

    const second = planRegroup(db)
    expect(second.groups).toHaveLength(0)
    const res2 = applyRegroup(db, second)
    expect(res2.moved).toBe(0)
    expect(res2.createdGroups).toBe(0)
    expect(listGroups(db).length).toBe(groupsAfterFirst)
  })
})

describe('撤销：Ctrl+Z 必须能整批退回去，且不能删掉素材', () => {
  it('拆完撤销 → group_id 回原位、素材还在、新建的空组被清掉', async () => {
    const g = makeGroup({ key: '4900077', name: '4900077', category: 'texture', subcategory: 'face' })
    const a = addMember({
      groupId: g, name: '4900077', libraryPath: 'E:\\vrc\\A\\贴图\\脸部\\4900077',
      category: 'texture', subcategory: 'face', contentType: 'texture', kind: 'archive', avatar: 'Lime'
    })
    const b = addMember({
      groupId: g, name: 'lime', libraryPath: 'E:\\vrc\\A\\贴图\\lime\\4900077',
      category: 'texture', subcategory: 'face', contentType: 'texture', kind: 'folder',
      storageMode: 'indexed', avatar: 'Lime'
    })
    /** 旧组上先有 variant 行，撤销后该组还得有东西可看 */
    db.prepare(
      `INSERT INTO variant (id, group_id, asset_id, variant_kind, variant_value) VALUES (?, ?, ?, 'avatar', 'Lime')`
    ).run(ulid(), g, a)

    const res = applyRegroup(db, planRegroup(db))
    expect(res.moved).toBe(2)
    expect(listGroups(db)).toHaveLength(3) // 旧组 + 两个新组

    const out = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(out.ok).toBe(true)

    /** 1. 素材一个都不能少 —— payload 带 assetIds 就会在这里被删掉 */
    expect(getAsset(db, a)).not.toBeNull()
    expect(getAsset(db, b)).not.toBeNull()
    /** 2. group_id 回到旧组 */
    expect(getAsset(db, a)!.group_id).toBe(g)
    expect(getAsset(db, b)!.group_id).toBe(g)
    /** 3. 新建的两个空组被清掉，旧组还在 */
    const groups = listGroups(db).map((x) => x.id)
    expect(groups).toContain(g)
    expect(groups).toHaveLength(1)
  })

  it('撤销记录不再带 batch_id，否则一次撤销会自我复制一批记录', async () => {
    const g = makeGroup({ key: 'y', name: 'Y' })
    addMember({ groupId: g, name: 'Y1', libraryPath: 'E:\\vrc\\A\\贴图\\皮肤\\Y1' })
    addMember({ groupId: g, name: 'Y2', libraryPath: 'E:\\vrc\\A\\贴图\\化妆\\Y2' })
    applyRegroup(db, planRegroup(db))
    const batchId = (db.prepare(`SELECT batch_id FROM journal ORDER BY id LIMIT 1`).get() as { batch_id: string }).batch_id

    /** 只看**这次**撤销产生的那两条 —— 用 id 水位线，别让别的用例的残留混进来 */
    const watermark = countRows(`SELECT COALESCE(MAX(id), 0) AS n FROM journal`)
    await undoLast({ db, holdDir: path.join(root, 'hold') })

    const undoRows = db
      .prepare(`SELECT op, batch_id FROM journal WHERE id > ?`)
      .all(watermark) as Array<{ op: string; batch_id: string | null }>
    expect(undoRows.length).toBe(2)
    for (const r of undoRows) expect(r.batch_id).toBeNull()
    /** 原批次那两条都被标成已撤销 */
    expect(countRows(`SELECT COUNT(*) AS n FROM journal WHERE batch_id = ? AND undone = 0`, batchId)).toBe(0)
  })

  it('撤销不会误删"已经有成员"的新组', async () => {
    const g = makeGroup({ key: 'y2', name: 'Y2' })
    const a = addMember({ groupId: g, name: 'Y2A', libraryPath: 'E:\\vrc\\A\\贴图\\皮肤\\Y2A' })
    const b = addMember({ groupId: g, name: 'Y2B', libraryPath: 'E:\\vrc\\A\\贴图\\化妆\\Y2B' })
    applyRegroup(db, planRegroup(db))
    const newGid = getAsset(db, b)!.group_id!
    expect(newGid).not.toBe(g)

    /**
     * 模拟"这个组里已经有成员了，而且那成员**不在**本次 reparent 的快照里"
     * （快照里有的行撤销时会按 groupFrom 挂回旧组，那种不算"留下来"）。
     * 借一条本用例之外的行来占位。
     */
    const squatter = addMember({ groupId: null, name: 'Squatter', libraryPath: 'E:\\vrc\\A\\贴图\\其他\\Squatter' })
    db.prepare(`UPDATE asset SET group_id = ? WHERE id = ?`).run(newGid, squatter)

    await undoLast({ db, holdDir: path.join(root, 'hold') })

    /** 有成员的新组不能被删，否则那些 asset.group_id 会指向不存在的组 */
    expect(db.prepare(`SELECT 1 FROM asset_group WHERE id = ?`).get(newGid)).toBeTruthy()
    expect(getAsset(db, squatter)!.group_id).toBe(newGid)
    /** 而参与过 reparent 的两行按快照挂回了旧组 */
    expect(getAsset(db, a)!.group_id).toBe(g)
    expect(getAsset(db, b)!.group_id).toBe(g)
  })
})
