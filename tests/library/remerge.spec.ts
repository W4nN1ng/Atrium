import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { getAsset, makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { addVariant, getGroup } from '../../src/main/db/repos/product'
import { applyRemerge, planRemerge } from '../../src/main/library/remerge'
import { undoLast } from '../../src/main/library/undo'
import { deriveGroupKey } from '../../src/main/classify/groupKey'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'
import { ulid } from '../../src/shared/ulid'
import type { AssetGroupRow, AssetRow } from '../../src/shared/types'

/**
 * 第 9 轮 ② · B4 存量重并。
 *
 * ## 这个文件存在的理由（一句话）
 *
 * **判据修好了，症状还在** —— Libero 那 20 个文件名喂给现在的 `deriveGroupKey` 全塌成一个键，
 * 可库里 13 个组挂的还是 §B2 之前算出来的老键，而 `reanalyze` 的 `recompute()` 刻意不动
 * `group_key`，所以"再点一次重新分析"也治不了。缺的就是"把规则重新作用到存量上"这一步。
 *
 * ## 夹具的形状是抄真库的，不是编的
 *
 * 20 个名字与 13 个老键逐条来自 `node tools/probe-libero-key.cjs` 的只读输出
 * （`e:/vrc/a/衣服/名流`）。老键有两种：词表认得的 8 个共用
 * `libero attitude the royal bunny`，其余 12 个各自带模型名，且那 12 个组的变体值是
 * `UNIVERSAL`（真库里就是这样 —— 模型名压根没进变体）。
 * 用编的键名测，判据会在错的地方生效（`regroup.spec.ts` 为同一件事写过警告）。
 */
const ROOT = path.resolve(__dirname, '../..')
const DIR = 'E:/vrc/A/衣服/名流'
let lex: Lexicon

/** 真库那 20 个 raw_name（版本号照真数据各不相同） */
const LIBERO_RAW = [
  'Libero[Selestia_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Airi_ATTITUDE The Royal Bunny]_1.03.unitypackage',
  'Libero[Milltina_ATTITUDE The Royal Bunny]_1.02.unitypackage',
  'Libero[Shinra_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Shinano_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Manuka_ATTITUDE The Royal Bunny]_1.03.unitypackage',
  'Libero[Sio_ATTITUDE The Royal Bunny]_1.02.unitypackage',
  'Libero[Moe_ATTITUDE The Royal Bunny]_1.04.unitypackage',
  'Libero[Ichigo_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Ramune_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Lumina_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Misaki_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Sion_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Kumaly_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Lasyusha_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Chiffon&Chocolat_ATTITUDE The Royal Bunny]_1.02.unitypackage',
  'Libero[Milfy&Eku_ATTITUDE The Royal Bunny]_1.01.unitypackage',
  'Libero[Nemesis&Elusion_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[Rurune&Mizuki_ATTITUDE The Royal Bunny]_1.00.unitypackage',
  'Libero[KipfelMame_ATTITUDE]_1.00.unitypackage'
]

/** 真库里那 8 个"已经并上了"的模型 —— 它们共用一个老键 */
const MERGED_EIGHT = new Set(['Selestia', 'Airi', 'Milltina', 'Shinra', 'Shinano', 'Manuka', 'Sio', 'Moe'])

const modelOf = (raw: string): string => /\[([^_\]]+)/.exec(raw)?.[1] ?? ''

let root: string
let db: Db

beforeAll(() => {
  lex = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') })
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-remerge-'))
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

function makeGroup(key: string, name: string, category = 'clothing', dirKey: string | null = DIR.toLowerCase()): string {
  const id = ulid()
  const now = Date.now()
  db.prepare(
    `INSERT INTO asset_group (id, group_key, name, category, subcategory, created_at, updated_at, dir_key)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`
  ).run(id, key, name, category, now, now, dirKey)
  return id
}

/** 造一行顶层卡。`raw` 同时是 raw_name —— 重并的判据全从 raw_name 来 */
function addRow(opts: { groupId: string | null; raw: string; category?: string; libraryPath?: string | null }): string {
  const row = makeAssetRow({
    name: 'Libero',
    raw_name: opts.raw,
    category: opts.category ?? 'clothing',
    library_path: opts.libraryPath ?? `${DIR}/${opts.raw}`,
    source_path: null,
    storage_mode: 'indexed',
    status: 'classified',
    confidence: 0.9
  })
  row.group_id = opts.groupId
  upsertAsset(db, row)
  return row.id
}

/**
 * 按真库的样子铺 20 行 / 13 组：8 个共用老键，另外 12 个各自一组、键里带着模型名，
 * 每组一条 `avatar=UNIVERSAL` 占位变体。返回"raw → 行 id"和全部组 id。
 */
function seedLibero(): { idOf: Map<string, string>; groupIds: string[]; bigGroup: string } {
  const oldKey = 'libero attitude the royal bunny'
  const bigGroup = makeGroup(oldKey, 'Libero')
  const idOf = new Map<string, string>()
  const groupIds = [bigGroup]
  for (const raw of LIBERO_RAW) {
    const model = modelOf(raw)
    if (MERGED_EIGHT.has(model)) {
      idOf.set(raw, addRow({ groupId: bigGroup, raw }))
      addVariant(db, { groupId: bigGroup, assetId: idOf.get(raw) as string, kind: 'avatar', value: model })
      continue
    }
    const g = makeGroup(`libero ${model.toLowerCase()} attitude the royal bunny`, 'Libero')
    const id = addRow({ groupId: g, raw })
    addVariant(db, { groupId: g, assetId: id, kind: 'avatar', value: 'UNIVERSAL' })
    idOf.set(raw, id)
    groupIds.push(g)
  }
  /**
   * ⚠ 顺手在共用组里留一条**老写法**的 `ramune`（小写）—— 真库里就有这种混写法，
   * `regroup.spec.ts` 为同一件事写过警告（"老库里一张卡可能同时挂着 SHINANO 与 Shinano"）。
   * 有了它，"移动进来的那行会不会把 `Ramune` 再插一遍"才可测 —— 没有它，
   * 把查重那两行删掉也没有任何用例变红（变异回扫 C4 第一次就是这么暴露的）。
   */
  addVariant(db, { groupId: bigGroup, assetId: idOf.get(LIBERO_RAW[0]) as string, kind: 'avatar', value: 'ramune' })
  return { idOf, groupIds, bigGroup }
}

/** 全表快照（撤销前后逐字段比要用）。updated_at 在外面抹掉 */
function snapshot(): string {
  const g = db.prepare(`SELECT * FROM asset_group ORDER BY id`).all() as AssetGroupRow[]
  const a = db
    .prepare(`SELECT id, group_id, name, category, subcategory, library_path, raw_name, parent_asset_id FROM asset ORDER BY id`)
    .all()
  const v = db.prepare(`SELECT * FROM variant ORDER BY id`).all()
  return JSON.stringify({ g, a, v }).replace(/"updated_at":\s*\d+/g, '"updated_at":0')
}

function count(sql: string): number {
  return Number((db.prepare(sql).get() as { n: number }).n)
}

describe('planRemerge · 只读预览', () => {
  it('⭐ 真库形状：20 行 / 13 组 → 报 1 簇、改挂 12 张、合并掉 12 个组', async () => {
    const { bigGroup } = seedLibero()
    const before = snapshot()
    const plan = planRemerge(db, lex)
    expect(plan.clusters.length).toBe(1)
    const c = plan.clusters[0]
    expect(c.groupKey).toBe('libero attitude')
    expect(c.rows.length).toBe(20)
    expect(c.moveAssetIds.length).toBe(12)
    expect(c.dropGroupIds.length).toBe(12)
    /** 活下来的是成员最多的那个组（挂着 8 个模型变体的那个），不是随便第一个 */
    expect(c.keepGroupId).toBe(bigGroup)
    /** 只读：扫完一圈，全表快照一个字不变 */
    expect(snapshot()).toBe(before)
  })

  it('⭐ 预览把"要挪的"排在前面（界面只列前 8 行，排在后面的等于没给用户看）', async () => {
    const { bigGroup } = seedLibero()
    const c = planRemerge(db, lex).clusters[0]
    const moving = new Set(c.moveAssetIds)
    /** 前 12 行必须全是要挪的：面板只渲染 `rows.slice(0, 8)`，顺序错了就全是"已经不动的那批" */
    expect(c.rows.slice(0, 12).every((r) => moving.has(r.assetId))).toBe(true)
    expect(c.rows[0].fromGroupId).not.toBe(bigGroup)
    expect(c.rows[c.rows.length - 1].fromGroupId).toBe(bigGroup)
  })

  it('已经并好、键也对 → 一簇都不报（别让用户看见没用的确认）', async () => {
    seedLibero()
    applyRemerge(db, planRemerge(db, lex), lex)
    db.exec(`DELETE FROM journal`)
    expect(planRemerge(db, lex).clusters.length).toBe(0)
  })

  it('⭐ 正向对照：同目录的同一件东西要能报出来（不然下面那条"跨目录不许并"是空断言）', async () => {
    /**
     * 这条是给变异回扫（C1）补的。原来只有"跨目录不许并"一条负向断言 ——
     * 把 `dirKeyOf(...)` 写成 `library_path`（每张卡的"货架"成了它自己）之后，
     * 谁也不同架、一簇都报不出来，那条负向断言**照样绿**。
     * 只断言"不该发生"的用例必须配一条"该发生的确实发生了"的对照，否则它测的是空气。
     */
    const g1 = makeGroup('widget same series', 'Widget', 'clothing', 'e:/vrc/a/甲')
    const g2 = makeGroup('widget other series', 'Widget 2', 'clothing', 'e:/vrc/a/甲')
    addRow({ groupId: g1, raw: 'Widget[Airi_Same Series]_1.0.zip', libraryPath: 'E:/vrc/A/甲/Widget[Airi_Same Series]_1.0.zip' })
    addRow({ groupId: g2, raw: 'Widget[Moe_Same Series]_1.0.zip', libraryPath: 'E:/vrc/A/甲/Widget[Moe_Same Series]_1.0.zip' })
    expect(
      planRemerge(db, lex).clusters.filter((c) => c.moveAssetIds.length).length,
      '同目录同键也没并出来 —— 目录根本没喂对'
    ).toBe(1)
  })

  it('⭐ 跨目录同键不许并（#40 那条裁定：归并的前提是同目录）', async () => {
    /** 两组故意不同货架（`asset_group` 上有 UNIQUE(group_key,category,dir_key)，同架同键本来就建不出两行） */
    const g1 = makeGroup('widget same series', 'Widget', 'clothing', 'e:/vrc/a/甲')
    const g2 = makeGroup('widget same series', 'Widget', 'clothing', 'e:/vrc/a/乙')
    addRow({ groupId: g1, raw: 'Widget[Airi_Same Series]_1.0.zip', libraryPath: 'E:/vrc/A/甲/Widget[Airi_Same Series]_1.0.zip' })
    addRow({ groupId: g2, raw: 'Widget[Moe_Same Series]_1.0.zip', libraryPath: 'E:/vrc/A/乙/Widget[Moe_Same Series]_1.0.zip' })
    expect(
      planRemerge(db, lex).clusters.filter((c) => c.moveAssetIds.length).length,
      '两个目录里的东西被并到一处了'
    ).toBe(0)
  })

  it('⭐ 歧义闸门（§B2 安全保护 3）继承自 planGroups：三件不同东西不许并，且要报出来', async () => {
    /**
     * 名字抄 `bracket-variant.spec.ts` 里那条真会触发闸门的：前缀本身在 avatar 词表里，
     * 会被当变体剥掉 → 三个 key 全塌成系列名那一个词（`same`），key 已经没有区分力了。
     * 存的组键各不相同只是"老行各自成组"的形状，判据不看它。
     */
    const names = ['Shinano[X_Same Series]_1.0.zip', 'Manuka[Y_Same Series]_1.0.zip', 'Moe[Z_Same Series]_1.0.zip']
    for (const n of names) {
      const head = n.split('[')[0]
      const g = makeGroup(`same ${head}`, head)
      addRow({ groupId: g, raw: n, libraryPath: `${DIR}/${n}` })
    }
    const plan = planRemerge(db, lex)
    expect(plan.clusters.filter((c) => c.moveAssetIds.length).length, '歧义的一簇被自动并了').toBe(0)
    expect(plan.skippedAmbiguous, '挡掉了几处必须在计划里说一声').toBeGreaterThanOrEqual(1)
  })

  it('合集卡与附属一律不进人口（它们各自的归并走各自那条路）', async () => {
    const bundle = makeAssetRow({ name: '合集', raw_name: 'SomeBundle.zip', category: 'clothing', storage_mode: 'indexed', status: 'classified' })
    bundle.is_bundle = 1
    upsertAsset(db, bundle)
    const att = makeAssetRow({
      name: '附属',
      raw_name: 'Libero[Ichigo_ATTITUDE The Royal Bunny]_1.01.zip',
      category: 'clothing',
      storage_mode: 'indexed',
      status: 'classified'
    })
    att.attachment_kind = 'image'
    att.parent_asset_id = bundle.id
    upsertAsset(db, att)
    const plan = planRemerge(db, lex)
    expect(plan.scanned).toBe(0)
    expect(plan.clusters.length).toBe(0)
  })
})

describe('applyRemerge · 落地', () => {
  it('⭐ 一个文件都不搬：20 行的 library_path / raw_name 一字不变', async () => {
    const { idOf } = seedLibero()
    const pathsBefore = [...idOf.values()].map((id) => `${getAsset(db, id)?.library_path}|${getAsset(db, id)?.raw_name}`)
    const r = applyRemerge(db, planRemerge(db, lex), lex)
    expect(r.moved).toBe(12)
    expect([...idOf.values()].map((id) => `${getAsset(db, id)?.library_path}|${getAsset(db, id)?.raw_name}`)).toEqual(pathsBefore)
  })

  it('20 张塌成一张卡：全在同一个组、组键是新的、libero 系只剩一个组', async () => {
    const { idOf } = seedLibero()
    applyRemerge(db, planRemerge(db, lex), lex)
    const gids = new Set([...idOf.values()].map((id) => getAsset(db, id)?.group_id))
    expect(gids.size).toBe(1)
    const gid = [...gids][0] as string
    expect(getGroup(db, gid)?.group_key).toBe('libero attitude')
    expect(count(`SELECT COUNT(*) AS n FROM asset_group WHERE group_key LIKE 'libero%'`)).toBe(1)
  })

  it('⭐ 变体补齐：单体型的模型名进得来（原样词形），多体型的不许谎报变体', async () => {
    seedLibero()
    applyRemerge(db, planRemerge(db, lex), lex)
    const gid = db.prepare(`SELECT id FROM asset_group WHERE group_key LIKE 'libero%'`).get() as { id: string }
    const vals = (
      db.prepare(`SELECT variant_value v FROM variant WHERE group_id = ? AND variant_kind = 'avatar'`).all(gid.id) as Array<{ v: string }>
    ).map((x) => x.v)
    /** 单一体型 → 算一个变体（commit.ts:persistRelations 同一条规则，不是我自己定的） */
    for (const m of ['Ichigo', 'Lumina', 'Misaki', 'Sion', 'Kumaly', 'Lasyusha']) {
      expect(vals, `${m} 该作为模型变体出现`).toContain(m)
    }
    /**
     * `Ramune` 不在这份名单里，是**故意的**：共用组上先存了一条老写法 `ramune`，
     * 查重就该挡住新的 `Ramune`（否则一排徽章里两个是同一个模型）。
     */
    expect(vals, '已有老写法 ramune 时不许再插一份 Ramune').not.toContain('Ramune')
    expect(vals).toContain('ramune')
    /**
     * ⚠ 大小写：`NameTokens.avatars` 是大写写法（归并键内部用的），卡片要的是词典里那份原样词形。
     * 不换算一下的话一张卡上会一半 `Airi`、一半 `ICHIGO`。
     */
    expect(vals, '不许出现大写写法的新变体').not.toContain('ICHIGO')
    expect(new Set(vals.map((v) => v.toLowerCase())).size, '同一个模型不许有两种写法').toBe(vals.length)
    /**
     * 一个包适配两个体型（`Chiffon&Chocolat`）时那两个名字是兼容性说明、不是两个变体 ——
     * 写进 variant 表聚合视图就谎报"12 变体"（commit 那边实测踩过，所以它 `length === 1` 才写）。
     */
    for (const m of ['Chiffon', 'Chocolat', 'Milfy', 'Eku', 'Kipfel', 'Mame']) {
      expect(vals, `${m} 属于多体型包，不该进变体`).not.toContain(m)
    }
    /** 真模型名都进来了，就不该再留"通用"占位 */
    expect(vals).not.toContain('UNIVERSAL')
  })

  it('⭐ 不许顺手改分类：成员各自的 category 保持原样', async () => {
    const { idOf } = seedLibero()
    const first = [...idOf.values()][0]
    db.prepare(`UPDATE asset SET category = 'texture' WHERE id = ?`).run(first)
    applyRemerge(db, planRemerge(db, lex), lex)
    expect(getAsset(db, first)?.category).toBe('texture')
  })

  it('一次 Ctrl+Z 全撤：组行、变体行、成员归属、组键原样回来', async () => {
    seedLibero()
    const before = snapshot()
    applyRemerge(db, planRemerge(db, lex), lex)
    expect(snapshot()).not.toBe(before)
    const r = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(r.ok, `撤销失败：${r.error ?? ''}`).toBe(true)
    /** 逐字段比快照（updated_at 在 snapshot() 里已经抹平成 0） */
    expect(snapshot()).toBe(before)
  })

  it('撤销之后组数回到 13、变体行一条不多一条不少', async () => {
    seedLibero()
    const groupsBefore = count(`SELECT COUNT(*) AS n FROM asset_group`)
    const varsBefore = count(`SELECT COUNT(*) AS n FROM variant`)
    applyRemerge(db, planRemerge(db, lex), lex)
    await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(count(`SELECT COUNT(*) AS n FROM asset_group`)).toBe(groupsBefore)
    expect(count(`SELECT COUNT(*) AS n FROM variant`)).toBe(varsBefore)
  })

  it('⭐ 不留孤儿行：组里还有附属就不许删那个组', async () => {
    seedLibero()
    /** 往一个要被合并掉的组里塞一条附属：它不在人口里，但组不能因此被删 */
    const victim = db.prepare(`SELECT id FROM asset_group WHERE group_key = 'libero ichigo attitude the royal bunny'`).get() as { id: string }
    const att = makeAssetRow({ name: '附属', raw_name: 'preview.jpg', category: 'clothing', storage_mode: 'indexed', status: 'classified' })
    att.group_id = victim.id
    att.attachment_kind = 'image'
    upsertAsset(db, att)
    applyRemerge(db, planRemerge(db, lex), lex)
    expect(
      count(
        `SELECT COUNT(*) AS n FROM asset a WHERE a.group_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM asset_group g WHERE g.id = a.group_id)`
      ),
      '有行的 group_id 指向了已被删掉的组'
    ).toBe(0)
    expect(getGroup(db, victim.id), '组里还有附属就被删了').not.toBeNull()
  })

  it('撤销账只有一条 remerge + 一个 batch（Ctrl+Z 一次就够，不用按 12 下）', async () => {
    seedLibero()
    applyRemerge(db, planRemerge(db, lex), lex)
    const rows = db.prepare(`SELECT op, batch_id FROM journal`).all() as Array<{ op: string; batch_id: string }>
    expect(rows.filter((r) => r.op === 'remerge').length).toBe(1)
    expect(new Set(rows.map((r) => r.batch_id)).size).toBe(1)
  })
})

describe('键规则本身（防退化的那道不变量）', () => {
  it('⭐ 被当成变体的模型名不许同时留在键里 —— 词表认得与认不得都一样', async () => {
    for (const raw of LIBERO_RAW) {
      const t = deriveGroupKey(raw, lex)
      const models = [...t.avatars.map((a) => a.toLowerCase()), ...t.variantUnknown.map((a) => a.toLowerCase())]
      for (const m of models) {
        expect(t.groupKey.split(' '), `${raw}：模型名 ${m} 同时出现在键 "${t.groupKey}" 里`).not.toContain(m)
      }
    }
  })

  it('词表完全没收录的名字也并得上（重并不依赖词典有没有长齐）', async () => {
    const a = deriveGroupKey('Libero[Zzqqwfg_ATTITUDE The Royal Bunny]_1.01.zip', lex)
    const b = deriveGroupKey('Libero[Selestia_ATTITUDE The Royal Bunny]_1.01.zip', lex)
    expect(a.groupKey).toBe(b.groupKey)
    expect(a.variantUnknown).toEqual(['Zzqqwfg'])
  })
})
