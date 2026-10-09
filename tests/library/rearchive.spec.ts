import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { getAsset, makeAssetRow, upsertAsset } from '../../src/main/db/repos/asset'
import { journalPayload, listJournal } from '../../src/main/db/repos/journal'
import { applyRearchive, planRearchive, type RearchiveEnv } from '../../src/main/library/rearchive'
import { undoLast } from '../../src/main/library/undo'
import { assetIndex, rebuildIndex, setCategoryConfig } from '../../src/main/search'
import { loadCategories } from '../../src/main/services/categories'
import type { AssetRow, RearchivePlan } from '../../src/shared/types'

/**
 * R4 ③ · 改分类把文件搬到新分类该在的位置。
 *
 * 这一份用例是整个仓库里最"贴地"的：它真的在临时目录里 mkdir / rename 真文件，
 * 也真的开一个 SQLite。因为这个功能的失败模式全部长在"库和盘各说一套"上 ——
 * 源码扫描式的用例看不见它（`isInside` 那次就是把 `/` 拼进了反斜杠化的比较串，
 * 于是每个素材都被判成"不在库根下"，预览界面上只表现为"没搬"，一点异常都没有）。
 *
 * 分类表用的是**真的** `resources/lexicon/categories.json`：目录名来自它，
 * 换成一份自造的最小 cfg 就测不到 `dirAliases`（用户自己建的 `衣服` vs 表里的 `服装`）那一层。
 */

const cfg = loadCategories()
let root = ''
let lib = ''
let db: Db
let env: RearchiveEnv

const dirOf = (...segs: string[]): string => path.join(lib, ...segs)

function touch(file: string, bytes = 64): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.alloc(bytes, 0x5a))
}

function seed(over: Partial<AssetRow> & { name: string; library_path?: string | null }): AssetRow {
  /** `name` 由 `over` 给（写两遍会被 TS 提醒"后面那份覆盖前面"），这里只补那几个不变的默认值 */
  const row = makeAssetRow({
    raw_name: over.name,
    category: 'material',
    subcategory: 'mat',
    status: 'classified',
    storage_mode: 'archived',
    ...over
  })
  upsertAsset(db, row)
  return row
}

/** 建一棵真目录：主体目录 + 里面两个文件 */
function materialDir(name: string): string {
  const d = dirOf('材质', '球', name)
  touch(path.join(d, name + '.mat'), 100)
  touch(path.join(d, 'cover.png'), 30)
  return d
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-rearchive-'))
  lib = path.join(root, 'lib')
  fs.mkdirSync(lib, { recursive: true })
  db = openDatabase(path.join(root, 'library.db'))
  env = { libraryRoot: lib, dirTemplate: '{category}/{subcategory}/{name}', libraryLocale: 'zh-CN' }
})

afterAll(() => {
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

/** 每条用例自己造素材，id 递增，免得互相踩目录 */
let seq = 0
function fresh(): string {
  seq += 1
  return 'RA' + String(seq).padStart(3, '0')
}

describe('预览：只读', () => {
  it('算完预览之后磁盘和库里一个字节都没变（界面上那些数字必须来自这里）', async () => {
    const name = 'MatCap 套装'
    const d = materialDir(name)
    const row = seed({ id: fresh(), name, library_path: d, source_path: path.join(d, name + '.mat') })
    const before = fs.readdirSync(lib, { recursive: true }).length

    const p = await planRearchive(db, row.id, 'accessory', 'headwear', env)
    expect(p.ok).toBe(true)
    expect((p as RearchivePlan).willMove).toBe(true)
    expect((p as RearchivePlan).toDir).toBe(dirOf('配饰', '头饰', name))

    expect(fs.readdirSync(lib, { recursive: true }).length, '预览不许建目录或搬文件').toBe(before)
    expect(getAsset(db, row.id)?.category).toBe('material')
    expect(listJournal(db, 50).some((r) => r.op === 'rearchive'), '预览不许写 journal').toBe(false)
  })

  it('文件数与字节数是真实统计（界面那句「N 个文件 · X MB」就靠它）', async () => {
    const name = '数得清'
    const d = materialDir(name)
    touch(path.join(d, 'inner', 'extra.png'), 10)
    const row = seed({ id: fresh(), name, library_path: d })
    const p = (await planRearchive(db, row.id, 'accessory', 'headwear', env)) as RearchivePlan
    expect(p.fileCount).toBe(3)
    expect(p.bytes).toBe(140)
  })

  it('侧车 .avca.json 不算进"几个文件 · 多大"（沙盒活体第一跑就是这里自己和自己对不上）', async () => {
    const name = '带侧车'
    const d = materialDir(name)
    touch(path.join(d, '.avca.json'), 1141)
    const row = seed({ id: fresh(), name, library_path: d })
    const p = (await planRearchive(db, row.id, 'accessory', 'headwear', env)) as RearchivePlan
    /** 文件会被整棵搬走（包括侧车），但预览那句只报用户的素材 */
    expect(p.moves[0].fileCount).toBe(2)
    expect(p.moves[0].bytes).toBe(130)
    expect(p.fileCount).toBe(2)
    expect(p.bytes).toBe(130)
  })

  it('索引模式（只登记不搬）一律不搬，并把原因带回去', async () => {
    const outside = path.join(root, 'somewhere-else', '登记型')
    touch(path.join(outside, 'a.png'), 8)
    const row = seed({
      id: fresh(),
      name: '登记型',
      storage_mode: 'indexed',
      library_path: null,
      source_path: path.join(outside, 'a.png')
    })
    const p = (await planRearchive(db, row.id, 'texture', 'skin', env)) as RearchivePlan
    expect(p.willMove).toBe(false)
    expect(p.reasonKey).toBe('rearchive.reason.indexed')
  })

  it('没设库根 → noRoot，不许拿相对路径瞎拼', async () => {
    const name = '无根'
    const d = materialDir(name)
    const row = seed({ id: fresh(), name, library_path: d })
    const p = (await planRearchive(db, row.id, 'accessory', 'headwear', { ...env, libraryRoot: null })) as RearchivePlan
    expect(p.willMove).toBe(false)
    expect(p.reasonKey).toBe('rearchive.reason.noRoot')
  })

  it('路径不在库根里面 → outside（A 不挪别人目录里的东西）', async () => {
    const foreign = path.join(root, 'foreign', '别人的')
    touch(path.join(foreign, 'x.png'), 8)
    const row = seed({ id: fresh(), name: '别人的', library_path: foreign })
    const p = (await planRearchive(db, row.id, 'accessory', 'headwear', env)) as RearchivePlan
    expect(p.willMove).toBe(false)
    expect(p.reasonKey).toBe('rearchive.reason.outside')
    expect(p.reasonParams?.path).toBe(foreign)
  })

  it('目录已经不存在 → missing，不许把库记录搬去一个空位置', async () => {
    const row = seed({ id: fresh(), name: '已消失', library_path: dirOf('材质', '球', '早就没了') })
    const p = (await planRearchive(db, row.id, 'accessory', 'headwear', env)) as RearchivePlan
    expect(p.willMove).toBe(false)
    expect(p.reasonKey).toBe('rearchive.reason.missing')
  })

  it('新分类算出来的目录就是现在这个位置 → samePlace（改了二级但模板里没有二级）', async () => {
    const name = '只认一级'
    const d = dirOf('材质', name)
    touch(path.join(d, 'm.mat'), 5)
    const row = seed({ id: fresh(), name, category: 'material', subcategory: null, library_path: d })
    const p = (await planRearchive(
      db,
      row.id,
      'material',
      'preset',
      { ...env, dirTemplate: '{category}/{name}' }
    )) as RearchivePlan
    expect(p.willMove).toBe(false)
    expect(p.reasonKey).toBe('rearchive.reason.samePlace')
    expect(p.fromDir).toBe(p.toDir)
  })

  it('目标位置已经有同名的东西 → taken=true，toDir 是避过名的', async () => {
    const name = '撞名'
    const d = materialDir(name)
    const block = dirOf('配饰', '头饰', name)
    touch(path.join(block, '别人的文件'), 1)
    const row = seed({ id: fresh(), name, library_path: d })
    const p = (await planRearchive(db, row.id, 'accessory', 'headwear', env)) as RearchivePlan
    expect(p.moves[0].taken).toBe(true)
    expect(p.toDir).toBe(block + ' (2)')
  })

  it('附属在父目录里面 → 只改路径字符串，不单独成一条 move', async () => {
    const name = '带附属'
    const d = materialDir(name)
    const cover = path.join(d, 'cover.png')
    const row = seed({ id: fresh(), name, library_path: d, cover_image: cover })
    const att = seed({
      id: fresh(),
      name: '附属贴图',
      category: 'material',
      subcategory: 'mat',
      parent_asset_id: row.id,
      library_path: cover
    })
    const p = (await planRearchive(db, row.id, 'accessory', 'headwear', env)) as RearchivePlan
    expect(p.moves).toHaveLength(1)
    const kid = p.rewrites.filter((r) => r.assetId === att.id)
    expect(kid.map((r) => r.field).sort()).toEqual(['library_path'])
    expect(kid[0].to).toBe(path.join(p.toDir!, 'cover.png'))
  })

  it('子项的目录不在父目录里面 → 单独一条 move，搬进新父目录里面（和入库时的形状一致）', async () => {
    const name = '散着的父子'
    const d = materialDir(name)
    const kidDir = dirOf('材质', '球', '附属独立目录')
    touch(path.join(kidDir, 'k.png'), 16)
    const row = seed({ id: fresh(), name, library_path: d })
    const kid = seed({
      id: fresh(),
      name: '附属独立目录',
      category: 'material',
      subcategory: 'mat',
      parent_asset_id: row.id,
      library_path: kidDir
    })
    const p = (await planRearchive(db, row.id, 'accessory', 'headwear', env)) as RearchivePlan
    expect(p.moves).toHaveLength(2)
    const m = p.moves[1]
    expect(m.from).toBe(kidDir)
    expect(m.to).toBe(path.join(p.toDir!, '附属独立目录'))
    expect(p.rewrites.find((r) => r.assetId === kid.id && r.field === 'library_path')?.to).toBe(m.to)
    expect(p.fileCount).toBe(3)
  })

  /**
   * ⭐ 第 3 轮补的洞（`tools/verify-red-r4.cjs` 原来记在 C3 位置那条注释里）。
   *
   * 上面那条夹具里的子项**只有 `library_path`**，`source_path` / `cover_image` 两列是空的 ——
   * 于是"散着的子项，它自己那棵树里的列跟着走、树外的列不动"这个循环体一次都没执行过。
   * 撤掉 `if (o && isInside(o, kOld))` 里的判断，全仓一条都不红（不是"改对了"，是"没人查"）。
   * 这里把两列都填上：一列指子项目录**里面**，一列指库**外面**（原件还在下载目录那种），
   * 两支才都落到断言上。
   */
  it('散着的子项：它自己目录里的列跟着挪，指向库外的列一个字不改', async () => {
    const name = '散着的父子二'
    const d = materialDir(name)
    const kidDir = dirOf('材质', '球', '附属独立目录二')
    touch(path.join(kidDir, 'k.png'), 16)
    touch(path.join(kidDir, 'nested', 'k2.png'), 9)
    const farCover = path.join(root, 'somewhere-else', 'kid-cover.png')
    touch(farCover, 7)
    const row = seed({ id: fresh(), name, library_path: d })
    const kid = seed({
      id: fresh(),
      name: '附属独立目录二',
      category: 'material',
      subcategory: 'mat',
      parent_asset_id: row.id,
      library_path: kidDir,
      source_path: path.join(kidDir, 'k.png'),
      cover_image: farCover
    })
    /** 历史数据：库里还挂着子项，盘上那个目录早就不在了 */
    const goneDir = dirOf('材质', '球', '附属独立目录_已经没了')
    const kid3 = seed({
      id: fresh(),
      name: '附属独立目录_已经没了',
      category: 'material',
      subcategory: 'mat',
      parent_asset_id: row.id,
      library_path: goneDir
    })

    const p = (await planRearchive(db, row.id, 'accessory', 'headwear', env)) as RearchivePlan
    expect(p.moves).toHaveLength(2)
    const kidMove = p.moves[1]
    expect(kidMove.from).toBe(kidDir)
    expect(kidMove.to).toBe(path.join(p.toDir!, '附属独立目录二'))

    const kidRewrites = p.rewrites.filter((r) => r.assetId === kid.id)
    const byField = new Map(kidRewrites.map((r) => [r.field, r]))
    /** ① 在子项目录里的 source_path 跟着进新位置（少了这条 = 库里指着一个已经不存在的路径） */
    expect(byField.get('source_path')?.to).toBe(path.join(kidMove.to, 'k.png'))
    /** ② 库外的 cover_image 不改（`rearchive.ts` 头部那句"改了就是撒谎"） */
    expect(byField.has('cover_image'), '不在被搬的那棵树里的路径不许改').toBe(false)
    /** ③ 同一列不许被改两次：既按父目录重算又按子目录重算 = 后一条覆盖前一条 */
    expect(kidRewrites).toHaveLength(2)
    expect(new Set(kidRewrites.map((r) => r.field)).size).toBe(2)
    /**
     * ④ 盘上已经不存在的子项目录 **不记 move**（`if (kst.files)` 那道闸）。
     * 记了会怎样：预览上看着正常，`applyRearchive` 走到那条 move 直接 ENOENT，
     * 整次改分类判失败、journal 标 failed，用户的分类没改成。
     */
    expect(p.moves.some((m) => m.from === goneDir), '空目录 / 不存在的目录不许单独成一条 move').toBe(false)
    expect(p.rewrites.some((r) => r.assetId === kid3.id), '指向不存在目录的列不该被改成新位置').toBe(false)

    /** nested 是子项目录里的子目录，整棵跟着 moveTree 走，不单独成一条 move */
    expect(kidMove.fileCount).toBe(2)
    expect(p.fileCount).toBe(4)
    expect(p.bytes).toBe(155)
  })
})

describe('执行 + 撤销', () => {
  it('搬完：文件在新位置、库里三列都改、只写一条 rearchive journal', async () => {
    const name = '真要搬'
    const d = materialDir(name)
    const cover = path.join(d, 'cover.png')
    const row = seed({ id: fresh(), name, library_path: d, source_path: path.join(d, name + '.mat'), cover_image: cover })

    const plan = (await planRearchive(db, row.id, 'shader', 'general', env)) as RearchivePlan
    const r = await applyRearchive(db, plan, { env })
    expect(r.ok).toBe(true)
    expect(r.dbOnly).toBe(false)
    expect(r.moved).toBe(1)

    const to = plan.toDir as string
    expect(to).toBe(dirOf('着色器', '通用', name))
    expect(fs.existsSync(path.join(to, name + '.mat'))).toBe(true)
    expect(fs.existsSync(path.join(to, 'cover.png'))).toBe(true)
    expect(fs.existsSync(path.join(d, name + '.mat')), '旧位置必须真的空了，不是复制一份').toBe(false)

    const after = getAsset(db, row.id) as AssetRow
    expect(after.category).toBe('shader')
    expect(after.subcategory).toBe('general')
    expect(after.library_path).toBe(to)
    expect(after.source_path).toBe(path.join(to, name + '.mat'))
    expect(after.cover_image).toBe(path.join(to, 'cover.png'))

    const rows = listJournal(db, 20).filter((x) => x.op === 'rearchive')
    expect(rows).toHaveLength(1)
    const p = journalPayload(rows[0])
    expect(p.moves).toEqual([{ from: d, to }])
    /**
     * 这次是往一个**全新**的分类里搬，所以三层目录都是新建的，撤销时都要清。
     * （上面那些用例已经建过 `配饰/头饰`，那条路径上 createdDirs 就只有素材目录自己 ——
     *  已存在的目录不许记进来，否则撤销会把别人的空目录删掉。）
     */
    expect(p.createdDirs).toEqual([dirOf('着色器'), dirOf('着色器', '通用'), to])
    expect((p.fieldChanges ?? []).map((f) => f.id)).toContain(row.id)
    expect(p.fieldChanges?.[0].from.library_path, '旧值必须逐列存着，撤销不能重算').toBe(d)
  })

  it('Ctrl+Z 一次做完两半：文件回原位、库里路径回原值，而且素材记录还在', async () => {
    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok, u.error ?? '撤销失败').toBe(true)
    /**
     * ⚠ 这条是本节最要紧的断言。
     * `undoLast` 末尾那句"整批撤完就删掉 payload.assetIds 里的库记录"是为**入库**设计的
     * （撤销入库 = 卡片退回收件箱）。rearchive 改的是既有记录，跟着删就等于
     * 用户 Ctrl+Z 一次改分类，素材从库里消失、还被 EV_UNDONE 塞回收件箱。
     */
    expect(u.assetIds).toEqual([])
    expect(listJournal(db, 100).some((x) => x.op === 'rearchive' && x.undone === 1)).toBe(true)
    const id = rowOf('真要搬')
    expect(getAsset(db, id)?.library_path).toBe(dirOf('材质', '球', '真要搬'))
    expect(getAsset(db, id)?.category).toBe('material')
    expect(getAsset(db, id)?.cover_image).toBe(path.join(dirOf('材质', '球', '真要搬'), 'cover.png'))
    expect(fs.existsSync(path.join(dirOf('材质', '球', '真要搬'), '真要搬.mat'))).toBe(true)
    expect(fs.existsSync(path.join(dirOf('材质', '球', '真要搬'), 'cover.png'))).toBe(true)
    /** 这次新建的三层目录（素材目录 + 通用 + 着色器）全空了就该一起清掉 */
    expect(fs.existsSync(dirOf('着色器', '通用', '真要搬'))).toBe(false)
    expect(fs.existsSync(dirOf('着色器', '通用'))).toBe(false)
    expect(fs.existsSync(dirOf('着色器'))).toBe(false)
    /** 撤销的文案不能写"移除了几条记录"—— 它一条都没移除 */
    expect(u.messageKey).toBe('toast.undoRearchived')
    expect(u.messageParams?.assets).toBeGreaterThan(0)
  })

  it('搬一半失败：journal 先写好的那条会被标 failed，不许留成"已经撤过"的假账', async () => {
    const name = '搬不动'
    const d = materialDir(name)
    const row = seed({ id: fresh(), name, library_path: d })
    const plan = (await planRearchive(db, row.id, 'texture', 'skin', env)) as RearchivePlan
    /** 直接把计划里的源路径改成不存在的地方：模拟"用户在预览之后手工挪走了" */
    const broken: RearchivePlan = {
      ...plan,
      moves: [{ ...plan.moves[0], from: path.join(lib, '材质', '球', '其实没有这个目录') }]
    }
    const r = await applyRearchive(db, broken, { env })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
    const j = listJournal(db, 5).find((x) => x.id === r.journalId)
    expect(j?.status).toBe('failed')
    expect(j?.undone, '失败了不能标 undone').toBe(0)
    /** 库记录一个字段都没改（事务在搬完之后） */
    expect(getAsset(db, row.id)?.library_path).toBe(d)
    expect(getAsset(db, row.id)?.category).toBe('material')
  })

  it('不该搬的时候：applyRearchive 只改记录，journal 里 moves 是空的', async () => {
    const name = '本来就在对的地方'
    const d = dirOf('材质', name)
    touch(path.join(d, 'm.mat'), 5)
    const row = seed({ id: fresh(), name, category: 'material', subcategory: null, library_path: d })
    const plan = (await planRearchive(db, row.id, 'material', 'mat', {
      ...env,
      dirTemplate: '{category}/{name}'
    })) as RearchivePlan
    expect(plan.willMove).toBe(false)
    const r = await applyRearchive(db, plan, { env })
    expect(r.dbOnly).toBe(true)
    expect(r.moved).toBe(0)
    expect(r.reasonKey).toBe('rearchive.reason.samePlace')
    expect(journalPayload(listJournal(db, 3).find((x) => x.id === r.journalId)!).moves).toEqual([])
    expect(getAsset(db, row.id)?.subcategory).toBe('mat')
    expect(getAsset(db, row.id)?.library_path).toBe(d)
  })

  /**
   * ⭐ 上一条那个形状在**真盘上**走一遍（预览对不对，最终要看文件落哪儿）。
   *
   * 这一支的失败模式是"库说子项在新父目录里、盘上它还在老地方"，
   * 只查 `plan` 看不见 —— 得真 mkdir / rename，再 Ctrl+Z 把两棵都搬回去。
   */
  it('散着的子项真的跟着搬进新父目录里面，Ctrl+Z 之后两棵都回原位', async () => {
    const name = '真要搬父子'
    const d = materialDir(name)
    const kidDir = dirOf('材质', '球', '附属独立目录三')
    touch(path.join(kidDir, 'k.png'), 16)
    const row = seed({ id: fresh(), name, library_path: d })
    const kid = seed({
      id: fresh(),
      name: '附属独立目录三',
      category: 'material',
      subcategory: 'mat',
      parent_asset_id: row.id,
      library_path: kidDir,
      source_path: path.join(kidDir, 'k.png')
    })

    const plan = (await planRearchive(db, row.id, 'plugin', 'closet', env)) as RearchivePlan
    expect(plan.moves).toHaveLength(2)
    const r = await applyRearchive(db, plan, { env })
    expect(r.ok).toBe(true)
    expect(r.moved, '父目录 + 散着的子项，两条都算搬了').toBe(2)

    const to = plan.toDir as string
    const kdest = path.join(to, '附属独立目录三')
    expect(fs.existsSync(path.join(to, name + '.mat'))).toBe(true)
    expect(fs.existsSync(path.join(kdest, 'k.png')), '子项要落在新父目录**里面**，不是旁边').toBe(true)
    expect(fs.existsSync(path.join(kidDir, 'k.png')), '旧位置必须真的空了').toBe(false)
    expect(getAsset(db, kid.id)?.library_path).toBe(kdest)
    expect(getAsset(db, kid.id)?.source_path).toBe(path.join(kdest, 'k.png'))

    /** journal 一条写完两棵：撤的时候不能只撤父目录、把子项丢在新位置 */
    const p = journalPayload(listJournal(db, 5).find((x) => x.id === r.journalId)!)
    expect(p.moves).toEqual([
      { from: d, to },
      { from: kidDir, to: kdest }
    ])

    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok, u.error ?? '撤销失败').toBe(true)
    expect(fs.existsSync(path.join(kidDir, 'k.png')), '撤销把散着的子项也搬回原处').toBe(true)
    expect(getAsset(db, kid.id)?.library_path).toBe(kidDir)
    expect(getAsset(db, kid.id)?.source_path).toBe(path.join(kidDir, 'k.png'))
    expect(fs.existsSync(path.join(to, name + '.mat')), '父目录也回原位').toBe(false)
    expect(getAsset(db, row.id)?.category).toBe('material')
    /** 这次为子项新建的那层目录（在新父目录里面）撤完是空的，跟着 createdDirs 一起清 */
    expect(fs.existsSync(dirOf('插件', '衣橱', '真要搬父子'))).toBe(false)
  })
})

describe('改分类之后搜得到（docs/SEARCH.md 那条口径）', () => {
  /**
   * 单例索引 + `reindexAsset`。
   * ⚠ `reindexAsset` 里面是 try/catch，索引没注入时**静默什么都不做**，
   * 所以断言必须打在"搜不搜得到"上，不能只断言"这行代码调用过了"。
   */
  const hitIds = (q: string): string[] => assetIndex.search(q).map((h) => h.id)

  it('搬完用新分类的词搜得到，撤销之后又只能按旧分类搜到', async () => {
    setCategoryConfig(cfg)
    const name = '搜得到我'
    const d = materialDir(name)
    const row = seed({ id: fresh(), name, library_path: d })
    rebuildIndex(db, cfg, assetIndex)
    expect(assetIndex.ready).toBe(true)
    const id = row.id
    expect(hitIds('插件')).not.toContain(id)

    const plan = (await planRearchive(db, id, 'plugin', 'closet', env)) as RearchivePlan
    const r = await applyRearchive(db, plan, { env })
    expect(r.ok).toBe(true)
    expect(hitIds('插件'), '改完分类不重建索引 = 用新分类的词搜不到（就是这条 bug）').toContain(id)

    await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(getAsset(db, id)?.category).toBe('material')
    expect(hitIds('插件'), '撤销之后索引也得跟着回旧分类').not.toContain(id)
    expect(hitIds('材质')).toContain(id)
  })
})

/** 给上面那条用例找回 id：按名字查一次，别在断言里写死 id */
const idCache = new Map<string, string>()
function rowOf(name: string): string {
  if (!idCache.has(name)) {
    const r = db.prepare(`SELECT id FROM asset WHERE name = ?`).get(name) as { id: string } | undefined
    if (!r) throw new Error(`没有这条素材：${name}`)
    idCache.set(name, r.id)
  }
  return idCache.get(name) as string
}

describe('只改记录那条路（assets:reclassify）也要重建索引', () => {
  it('handler 里真的有 reindexAsset —— 这条只能扫源码：IPC handler 要 Electron 应用才能跑起来', () => {
    /**
     * `docs/SEARCH.md` 一直写着"改分类会增量重建索引"，而实现里没有这一行 ——
     * 表现是"把卡从材质改成道具后用『道具』搜不到"，得等下次全量重建。
     * 上面那节用真索引测了搬文件那条路；这条路是纯库操作，测不到 handler，
     * 所以退而求其次把"这一行还在"钉住。删掉它就红。
     */
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/main/ipc/assets.ts'), 'utf8')
    /** 取两个 handler 之间那一段（handler 是 `ipc.handle('…', fn)`，多行写法，只能按标记切） */
    const between = (from: string, to: string): string => {
      const a = src.indexOf(from)
      const b = src.indexOf(to)
      expect(a, `源码里找不到 ${from}，扫描规则失效了`).toBeGreaterThan(-1)
      expect(b, `源码里找不到 ${to}，扫描规则失效了`).toBeGreaterThan(a)
      return src.slice(a, b)
    }
    const body = between("ipc.handle('assets:reclassify'", "ipc.handle('assets:rearchive-plan'")
    expect(body).toMatch(/reindexAsset\(\s*db\s*,\s*id\s*\)/)
    /** 顺带钉住"两条入口共用同一份 learning 记账"，免得又分叉 */
    expect(body).toMatch(/learnCorrection\(/)
    const moveBody = between("'assets:rearchive',", "ipc.handle('assets:resolve-pending'")
    expect(moveBody).toMatch(/learnCorrection\(/)
  })
})
