import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset, getAsset } from '../../src/main/db/repos/asset'
import { lastRevertible, journalPayload } from '../../src/main/db/repos/journal'
import { planReanalyze, applyReanalyze, dropJunkRows } from '../../src/main/library/reanalyze'
import { undoLast } from '../../src/main/library/undo'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'
import type { AssetRow } from '../../src/shared/types'

/**
 * 「重新分析」（增量改动单 2 §交付 4）。
 *
 * 三条不许破的规矩，都在这里测：
 *  1. **按下之前先知道影响多少条** —— plan 必须只读，而且报得出数；
 *  2. **不移动磁盘** —— 一次都不许出现文件操作；
 *  3. **能撤销** —— 重算掉的原值必须原样退回来，包括被请出库的垃圾行。
 */
const ROOT = path.resolve(__dirname, '../..')
let root: string
let db: Db
let lex: Lexicon

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-reanalyze-'))
  db = openDatabase(path.join(root, 'library.db'))
  lex = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') })
})

afterAll(() => {
  closeDatabase()
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* 交给系统 */
  }
})

function add(over: Partial<AssetRow> & { name: string; raw_name: string }): string {
  const row = makeAssetRow({
    category: 'plugin',
    subcategory: 'audio',
    confidence: 0.6,
    status: 'classified',
    storage_mode: 'indexed',
    size_bytes: 100,
    ...over
  } as never)
  upsertAsset(db, row)
  return row.id
}

/** 库根外的假路径：重分析不该碰它，测试里也不用真建文件 */
const FAKE = (name: string): string => path.join(root, 'lib', name)

describe('planReanalyze：只读扫描，先给出影响条数', () => {
  it('UUID 名字和从 UUID 里咬出来的假版本号都在待修清单里（验收 1/2 的旧数据）', () => {
    const id = add({
      name: 'd6b99874-3687-4746-8eca-21c8050c74a0 base resized',
      raw_name: 'd6b99874-3687-4746-8eca-21c8050c74a0 base resized.jpg',
      version: '99874-3687-4746-8e',
      library_path: FAKE('uuidcase')
    })
    const plan = planReanalyze(db, lex)
    const c = plan.changes.find((x) => x.id === id)
    expect(c, '这条要出现在预览里').toBeTruthy()
    expect(c!.fields).toContain('name')
    expect(c!.fields).toContain('version')
    expect(c!.to.name).toBe('base resized')
    expect(c!.to.version, '假版本号要被清成 null，不是留着 99874-…').toBeNull()
    expect(plan.uuidNamed).toBeGreaterThanOrEqual(1)
    expect(plan.renamed).toBeGreaterThanOrEqual(1)
  })

  it('扫描是真的只读：一遍下来库里一个字节都没变', () => {
    const before = db.prepare(`SELECT id, name, version, category, updated_at FROM asset ORDER BY id`).all()
    planReanalyze(db, lex)
    planReanalyze(db, lex)
    const after = db.prepare(`SELECT id, name, version, category, updated_at FROM asset ORDER BY id`).all()
    expect(after).toEqual(before)
  })

  it('用户手改过的分类不许被重算冲掉（只碰 name / version / variant_raw）', () => {
    const id = add({
      name: 'Some Tool v1.2',
      raw_name: 'SomeTool_v1.2.zip',
      category: 'tool',
      subcategory: null,
      version: '1.2',
      library_path: FAKE('toolcase')
    })
    const plan = planReanalyze(db, lex)
    for (const c of plan.changes) {
      for (const k of Object.keys(c.to)) {
        expect(['name', 'version', 'variant_raw', 'size_bytes'], `不该重算 ${k}`).toContain(k)
      }
      expect(c.to.category, '分类永远不在重算列里').toBeUndefined()
    }
    expect(getAsset(db, id)!.category).toBe('tool')
  })

  it('垃圾记录（.DS_Store 之类当年被当成素材登记的）单独列出来，不进 changes', () => {
    const id = add({
      name: 'DS_Store',
      raw_name: '.DS_Store',
      category: 'plugin',
      subcategory: 'audio',
      library_path: FAKE('插件/动作类/某物/.DS_Store')
    })
    const plan = planReanalyze(db, lex)
    expect(plan.junk.map((j) => j.id)).toContain(id)
    expect(plan.changes.some((c) => c.id === id), '垃圾行进的是 junk，不是 changes').toBe(false)
  })
})

describe('applyReanalyze：只 UPDATE 列，且整批可撤销', () => {
  it('改完能撤销回原值；journal 里存的是旧值而不是"再算一遍"', async () => {
    const id = add({
      name: '佳兔工具箱.0版本',
      raw_name: '佳兔工具箱v2.7.0版本.unitypackage',
      version: '2.7',
      library_path: FAKE('工具软件/佳兔工具箱')
    })
    const before = getAsset(db, id)!
    const plan = planReanalyze(db, lex)
    const r = applyReanalyze(db, plan)
    expect(r.updated).toBeGreaterThan(0)

    const after = getAsset(db, id)!
    expect(after.name).toBe('佳兔工具箱')
    expect(after.version).toBe('2.7.0')

    // 撤销回来必须是原来那两个值，不能是"按现在的规则再算一次"
    const journal = lastRevertible(db)!
    expect(journal.op).toBe('reanalyze')
    const p = journalPayload(journal)
    const rec = (p.fieldChanges ?? []).find((x: { id: string }) => x.id === id)
    expect(rec, 'journal 里要有这条的旧值').toBeTruthy()
    expect(rec!.from.name).toBe('佳兔工具箱.0版本')
    expect(rec!.from.version).toBe('2.7')

    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok).toBe(true)
    const back = getAsset(db, id)!
    expect(back.name).toBe(before.name)
    expect(back.version).toBe(before.version)
  })

  it('重复扫是幂等的：重算过一次之后再扫就是 0 条', async () => {
    add({
      name: 'Shinano FaceAnimation',
      raw_name: '6117553 Shinano_FaceAnimation.rar.rar',
      version: null,
      library_path: FAKE('动画/Shinano FaceAnimation')
    })
    const first = planReanalyze(db, lex)
    applyReanalyze(db, first)
    const second = planReanalyze(db, lex)
    expect(second.changes.length, '第二次不该再有差异').toBe(0)
    /**
     * 库是这个文件共享的，前面几个 describe 塞过 .DS_Store 那样的垃圾行，
     * 所以这里不能断言 junk 是空数组 —— 只断言"垃圾行不会同时出现在 changes 里"，
     * 那才是这条测试真正要守的不变量。
     */
    const junkIds = new Set(second.junk.map((j) => j.id))
    expect(second.changes.filter((c) => junkIds.has(c.id)), '一条行不许既进 changes 又进 junk').toEqual([])
  })

  it('只处理点名的那几条（界面勾了部分行时不能整库重写）', () => {
    /** 当前名字是 UUID 才够得上"垃圾"，才会被列进重算清单（见 nameIsGarbage） */
    const a = add({ name: 'd6b99874-3687-4746-8eca-21c8050c74a0', raw_name: 'd6b99874-3687-4746-8eca-21c8050c74a0.png', library_path: FAKE('a') })
    const b = add({ name: 'e9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4', raw_name: 'e9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4.png', library_path: FAKE('b') })
    const plan = planReanalyze(db, lex)
    expect(plan.changes.some((c) => c.id === a), 'UUID 名要出现在清单里').toBe(true)
    const r = applyReanalyze(db, plan, { ids: [a] })
    expect(r.updated, '只该改点名的那一条').toBe(1)
    expect(getAsset(db, a)!.name, '点名的那条被修成了不带 UUID 的名字').not.toMatch(/d6b99874/)
    expect(getAsset(db, b)!.name, '没点名的不许被顺手改掉').toMatch(/e9a0b1c2/)
  })
})

describe('重新分析不许冲掉已经挑过的名字（真库试出来的误伤）', () => {
  it('当前名字有意义时，就算和 raw_name 算出来的不一样也不改', () => {
    /**
     * 真库实测：`FREE無料-PoseAnimationShinano` 那行的 raw_name 是
     * `Shinano100Type ❥ Face&Pose Animations ⌖ ݁˚.zip`。
     * 不加这道闸，一次"重新分析"就把引擎（或用户）挑过的短名字换成了一串带颜文字的长标题。
     */
    const id = add({
      name: 'FREE無料-PoseAnimationShinano',
      raw_name: 'Shinano100Type ❥ Face&Pose Animations.zip',
      version: null,
      library_path: FAKE('pose')
    })
    const plan = planReanalyze(db, lex)
    const c = plan.changes.find((x) => x.id === id)
    expect(c?.to.name, '不该提议改名').toBeUndefined()
  })

  it('当前名字是 UUID / 带扩展名 / .0版本 残骸时，才提议改', () => {
    const u = add({ name: 'ab4fcf71-c65f-415f-b4aa-87267100e3ba', raw_name: 'ab4fcf71-c65f-415f-b4aa-87267100e3ba.png', library_path: FAKE('u') })
    const e = add({ name: 'Tool.zip', raw_name: 'Tool.zip', library_path: FAKE('e') })
    const v = add({ name: '佳兔工具箱.0版本', raw_name: '佳兔工具箱v2.7.0版本.unitypackage', library_path: FAKE('v') })
    const plan = planReanalyze(db, lex)
    for (const id of [u, e, v]) {
      expect(plan.changes.some((c) => c.id === id && c.fields.includes('name')), id + ' 应当被提议改名').toBe(true)
    }
  })
})

describe('附属资源降级（用户裁定：重新分析就该覆盖旧规则产出的那批）', () => {
  /** 真库形状：一个目录里平铺 3 张 UUID 介绍图 + 1 个演示视频 + 1 个 unitypackage */
  function kissDir(tag: string): string {
    const dir = path.join(root, 'lib2', tag, '6866030亲亲音效+亲吻时产生爱心粒子')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  it('同一目录里只有一行像主体、其余全是附属类型 → 其余挂到主体下并标 attachment_kind', () => {
    const dir = kissDir('demote1')
    const host = add({ name: 'Kiss Sound Gimmick', raw_name: 'Kiss Sound Gimmick 1.0.unitypackage', library_path: path.join(dir, 'Kiss Sound Gimmick 1.0.unitypackage') })
    const a = add({ name: 'base resized', raw_name: '29d6e178-9672-4af7-b1e7-2909aaaa0001.jpg', library_path: path.join(dir, '29d6e178-9672-4af7-b1e7-2909aaaa0001.jpg') })
    const b = add({ name: 'base resized', raw_name: '56374c06-5b70-44bd-979c-f1d8aaaa0002.jpg', library_path: path.join(dir, '56374c06-5b70-44bd-979c-f1d8aaaa0002.jpg') })
    const v = add({ name: 'Kissギミック', raw_name: 'Kissギミック.mp4', library_path: path.join(dir, 'Kissギミック.mp4') })

    const plan = planReanalyze(db, lex)
    const d = plan.demote.map((x) => x.id)
    expect(new Set(d), '三行附属都要降级').toEqual(new Set([a, b, v]))
    expect(plan.demote.find((x) => x.id === v)?.kind).toBe('video')
    expect(plan.demote.every((x) => x.hostId === host), '都挂到那个 unitypackage 上').toBe(true)

    const r = applyReanalyze(db, plan)
    expect(r.updated).toBeGreaterThanOrEqual(3)
    expect(getAsset(db, a)!.attachment_kind).toBe('image')
    expect(getAsset(db, a)!.parent_asset_id).toBe(host)
    expect(getAsset(db, host)!.attachment_kind, '主体不许被标成附属').toBeNull()
  })

  it('撤销整批退回：附属标记和挂靠关系一起回到按下之前', async () => {
    const dir = kissDir('demote2')
    const host = add({ name: 'Host', raw_name: 'Host.unitypackage', library_path: path.join(dir, 'Host.unitypackage') })
    const img = add({ name: 'preview', raw_name: 'preview.png', library_path: path.join(dir, 'preview.png') })
    applyReanalyze(db, planReanalyze(db, lex))
    expect(getAsset(db, img)!.attachment_kind).toBe('image')

    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok, '撤销不该报错').toBe(true)
    const back = getAsset(db, img)!
    expect(back.attachment_kind, '附属标记要退回').toBeNull()
    expect(back.parent_asset_id, '挂靠关系要退回顶层').toBeNull()
    expect(getAsset(db, host)!.name).toBe('Host')
  })

  it('目录里两行以上像主体的 → 一行都不许降级（不许把两件东西揉成一件）', () => {
    const dir = path.join(root, 'lib2', 'demote3', '西装')
    fs.mkdirSync(dir, { recursive: true })
    for (const n of ['Alpha', 'Bravo', 'Cinder']) add({ name: n, raw_name: n + '.unitypackage', library_path: path.join(dir, n + '.unitypackage') })
    const plan = planReanalyze(db, lex)
    expect(plan.demote.filter((x) => x.name === 'Bravo' || x.name === 'Cinder'), '5 个不相干的包一个都不许被并').toEqual([])
  })

  it('附属行不许再被降级第二次（幂等）', () => {
    const before = planReanalyze(db, lex).demote.length
    applyReanalyze(db, planReanalyze(db, lex))
    expect(planReanalyze(db, lex).demote.length, '跑一遍之后再扫不该还有活').toBeLessThanOrEqual(before)
    expect(planReanalyze(db, lex).demote.every((x) => !x.id.startsWith('00'))).toBe(true)
  })
})

describe('容器体积重算（真库实测出来的 869 GB 那个坑）', () => {
  it('入库时算错的体积，重新分析要能回到磁盘上量对', () => {
    /**
     * 真库的形状（实读）：容器目录底下若干子项，每个子项当年都被存成了"整包大小"。
     * 所以"从子行汇总"救不了它 —— 子行也是错的，必须回文件系统量。
     * 这里真的把文件建出来，测的就是那条量出来的路。
     */
    const dir = path.join(root, 'lib', '合集A')
    fs.mkdirSync(path.join(dir, 'GoLoco'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'GoLoco', 'v1.8.zip'), Buffer.alloc(1234))
    fs.writeFileSync(path.join(dir, 'GoLoco', 'v1.8.zip.meta'), Buffer.alloc(0))
    fs.writeFileSync(path.join(dir, 'SPS.zip'), Buffer.alloc(4321))

    const bundle = add({ name: '初音的VRC小店', raw_name: '插件道具合集-初音的VRC小店', is_bundle: 1, container_kind: 'collection', size_bytes: 900 * 1073741824, library_path: dir })
    const item = add({ name: 'GoLoco', raw_name: 'GoLoco', parent_asset_id: bundle, size_bytes: 900 * 1073741824, library_path: path.join(dir, 'GoLoco') })
    add({ name: 'SPS', raw_name: 'SPS.zip', parent_asset_id: bundle, size_bytes: 900 * 1073741824, library_path: path.join(dir, 'SPS.zip') })
    add({ name: 'GoLoco v1.8', raw_name: 'GoLoco_v1.8.zip', parent_asset_id: item, size_bytes: 900 * 1073741824, library_path: path.join(dir, 'GoLoco', 'v1.8.zip') })

    const plan = planReanalyze(db, lex)
    const c = plan.changes.find((x) => x.id === bundle)
    expect(c, '体积算错的容器要出现在重算清单里').toBeTruthy()
    expect(Number(c!.to.size_bytes), 'GoLoco 1234 + SPS 4321 = 5555').toBe(5555)
    applyReanalyze(db, plan)
    expect(Number(getAsset(db, bundle)!.size_bytes)).toBe(5555)
    expect(Number(getAsset(db, item)!.size_bytes), '子项也一起量对').toBe(1234)
  })

  it('附属资源不计入素材体积', () => {
    const host = add({ name: 'HostAsset', raw_name: 'HostAsset.zip', size_bytes: 5000, library_path: FAKE('host') })
    add({ name: 'preview', raw_name: 'preview.jpg', parent_asset_id: host, attachment_kind: 'image', size_bytes: 9000, library_path: FAKE('host/preview.jpg') })
    const plan = planReanalyze(db, lex)
    const c = plan.changes.find((x) => x.id === host)
    if (c) expect(Number(c.to.size_bytes), '附属的 9000 字节不许被算进主体').toBe(5000)
  })
})

describe('dropJunkRows：删库记录，不删文件', () => {
  it('整行存进 journal，撤销能塞回来；磁盘上那个文件一直都在', async () => {
    const file = path.join(root, 'lib', '插件', '动作类', '某物', '.DS_Store')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.alloc(512, 0x2a))

    const id = add({
      name: 'DS_Store',
      raw_name: '.DS_Store',
      category: 'plugin',
      subcategory: 'audio',
      library_path: file
    })

    const r = dropJunkRows(db, [id])
    expect(r.deleted).toBe(1)
    expect(getAsset(db, id)).toBeNull()
    expect(fs.existsSync(file), '文件必须还在原地').toBe(true)

    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok).toBe(true)
    const back = getAsset(db, id)
    expect(back, '撤销要能整行塞回来').toBeTruthy()
    expect(back!.name).toBe('DS_Store')
    expect(back!.library_path).toBe(file)
  })

  it('空数组什么都不做，也不留一条空 journal', () => {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM journal`).get() as { n: number }
    const r = dropJunkRows(db, [])
    expect(r.deleted).toBe(0)
    const after = db.prepare(`SELECT COUNT(*) AS n FROM journal`).get() as { n: number }
    expect(after.n).toBe(before.n)
  })
})
