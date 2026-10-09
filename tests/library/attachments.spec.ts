import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, collectStats, type Db } from '../../src/main/db'
import { getAsset, queryCards, listAttachments, listChildItems, countChildren } from '../../src/main/db/repos/asset'
import { commitAsset, commitBundleAsset, type CommitDeps, type CommitUnit } from '../../src/main/library/commit'
import { undoLast } from '../../src/main/library/undo'
import { containerInfoOf } from '../../src/main/ingest/container'
import { planBundle } from '../../src/main/classify/bundle'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'
import type { CategoryConfig, FileEntry, IngestResult } from '../../src/shared/types'

/**
 * 增量改动单 2 的落库那一半：附属资源怎么进库、归并型容器怎么建出来。
 *
 * 验收 1 的核心是"库中只有 1 张卡"—— 3 张介绍图和 1 个 mp4 必须**存在但不冒头**：
 * 存在，详情页才列得出来；不冒头，库列表和素材总数才不会被附属图灌水。
 * 这两件事是同一条规则的两面，所以放在一起测。
 */
const cfg: CategoryConfig = {
  version: 1,
  categories: [
    { key: 'plugin', order: 1, label: { 'zh-CN': '插件' }, subcategories: [{ key: 'audio', label: { 'zh-CN': '音效类' } }] },
    { key: 'clothing', order: 2, label: { 'zh-CN': '服装' }, subcategories: [{ key: 'outfit', label: { 'zh-CN': '套装' } }] }
  ]
}

const ROOT = path.resolve(__dirname, '../..')
let root: string
let db: Db
let lex: Lexicon
const names = new Map<string, string>([
  ['plugin', '插件'],
  ['plugin/audio', '音效类'],
  ['clothing', '服装'],
  ['clothing/outfit', '套装']
])

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-attach-'))
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true })
  fs.mkdirSync(path.join(root, 'hold'), { recursive: true })
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

function mkUnit(over: Partial<CommitUnit> = {}): CommitUnit {
  return {
    name: 'Kiss Sound Gimmick',
    rawName: '6866030亲亲音效+亲吻时产生爱心粒子',
    category: 'plugin',
    subcategory: 'audio',
    confidence: 0.9,
    status: 'classified',
    kind: 'folder',
    contentType: 'audio',
    version: '1.0',
    author: null,
    localeTag: null,
    sourceUrl: null,
    sourcePlatform: null,
    sourceItemId: '6866030',
    sourceItemIdConfidence: 1,
    tags: [],
    targetAvatars: [],
    groupKey: 'kiss sound gimmick',
    bundleRef: null,
    bundleName: null,
    reason: 'test',
    hash: 'kiss0001',
    sizeBytes: 4096,
    ...over
  }
}

function deps(over: Partial<CommitDeps> = {}): CommitDeps {
  return {
    db,
    libraryRoot: path.join(root, 'lib'),
    names,
    template: '{category}/{subcategory}/{name}',
    storageMode: 'indexed',
    autoExtract: false,
    holdDir: path.join(root, 'hold'),
    appVersion: 'test',
    ...over
  }
}

/** §A0 那 6 个条目，照抄改动单 2 */
const KISS_ENTRIES: FileEntry[] = [
  { relPath: 'Kiss_Sound_Gimmick_1.0/Kiss Sound Gimmick 1.0.unitypackage', size: 3000, ext: '.unitypackage', isDir: false },
  { relPath: '29d6e178-9672-4af7-b1e7-2909aaaa0001.jpg', size: 300, ext: '.jpg', isDir: false },
  { relPath: '56374c06-5b70-44bd-979c-f1d8aaaa0002.jpg', size: 310, ext: '.jpg', isDir: false },
  { relPath: 'd6b99874-3687-4746-8eca-21c8050c74a0.jpg', size: 320, ext: '.jpg', isDir: false },
  { relPath: 'Kiss_Sound_Gimmick_1.0.zip', size: 3000, ext: '.zip', isDir: false },
  { relPath: 'Kissギミック.mp4', size: 900, ext: '.mp4', isDir: false }
]

describe('containerInfoOf：清单 → 主体 / 附属 / 名字（§A2 §A3）', () => {
  it('验收 1：名字是 Kiss Sound Gimmick，不是 UUID；附属是 3 图 1 视频', () => {
    const info = containerInfoOf({ looseFiles: KISS_ENTRIES, entries: [] }, ['6866030亲亲音效+亲吻时产生爱心粒子'])
    expect(info.name).toBe('Kiss Sound Gimmick')
    expect(info.version).toBe('1.0')
    expect(info.attachments.map((a) => a.kind).sort()).toEqual(['image', 'image', 'image', 'video'])
    expect(info.attachments.some((a) => /d6b99874/.test(a.relPath)), '封面那张 UUID 图进附属区').toBe(true)
  })

  it('验收 2：UUID 不许被当成版本号', () => {
    const info = containerInfoOf({ looseFiles: KISS_ENTRIES, entries: [] }, [])
    expect(info.version).toBe('1.0')
    expect(String(info.version)).not.toContain('99874')
  })

  it('§A5：全是图片时不生成附属行（那些图就是素材本身，不是它的附属）', () => {
    const info = containerInfoOf(
      { looseFiles: [
        { relPath: 'a.jpg', size: 10, ext: '.jpg', isDir: false },
        { relPath: 'b.png', size: 10, ext: '.png', isDir: false }
      ], entries: [] },
      ['参考图']
    )
    expect(info.split.allAttachments).toBe(true)
    expect(info.attachments).toEqual([])
  })

  it('包内清单（正斜杠、来自 entries）与目录清单等价', () => {
    const fromEntries = containerInfoOf(
      { looseFiles: [], entries: KISS_ENTRIES.map((e) => ({ path: e.relPath, size: e.size, isDir: false, encrypted: false })) },
      ['6866030亲亲音效+亲吻时产生爱心粒子']
    )
    expect(fromEntries.name).toBe('Kiss Sound Gimmick')
    expect(fromEntries.attachments.length).toBe(4)
  })
})

describe('附属资源落库（§A2 核心规则）', () => {
  it('验收 1：库里只有 1 张卡，3 图 1 视频挂在它下面', async () => {
    const info = containerInfoOf({ looseFiles: KISS_ENTRIES, entries: [] }, ['6866030亲亲音效+亲吻时产生爱心粒子'])
    const unit = mkUnit({ name: info.name ?? 'Kiss Sound Gimmick', version: info.version, attachments: info.attachments })
    const srcDir = path.join(root, 'src-kiss')
    fs.mkdirSync(path.join(srcDir, 'Kiss_Sound_Gimmick_1.0'), { recursive: true })
    for (const e of KISS_ENTRIES) {
      const p = path.join(srcDir, ...e.relPath.split('/'))
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, Buffer.alloc(e.size, 0x31))
    }

    const r = await commitAsset(deps(), { unit, stagingPath: null, sourcePath: srcDir })

    // 附属行确实建出来了
    const atts = listAttachments(db, r.assetId)
    expect(atts.length).toBe(4)
    expect(atts.map((a) => a.attachment_kind).sort()).toEqual(['image', 'image', 'image', 'video'])
    expect(atts.every((a) => a.parent_asset_id === r.assetId)).toBe(true)
    // 路径是真拼得出来的（详情页要能打开它）
    for (const a of atts) expect(fs.existsSync(String(a.library_path)), String(a.library_path)).toBe(true)

    // 但库列表里只有主体那一张卡
    const { cards, total } = queryCards(db, { scope: 'all' }, cfg, 'zh-CN')
    expect(total, '附属资源不进第一层、也不进搜索').toBe(1)
    expect(cards.map((c) => c.name)).toEqual(['Kiss Sound Gimmick'])
    expect(cards[0].attachmentCount).toBe(4)
    expect(cards[0].childCount).toBe(0)
  })

  it('素材总数不数附属资源，附属数单独给一个', () => {
    const s = collectStats(db)
    expect(s.assets, '1 件素材').toBe(1)
    expect(s.attachments, '4 条附属').toBe(4)
    expect(s.totalBytes, '体积只算主体那一行').toBe(4096)
  })

  it('撤销时附属行跟着主体一起消失', async () => {
    const before = collectStats(db)
    const out = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(out.ok).toBe(true)
    const after = collectStats(db)
    expect(after.assets).toBe(before.assets - 1)
    expect(after.attachments, '附属不许留成孤儿行').toBe(before.attachments - 4)
  })
})

describe('归并型容器（§B0 / §B7）：20 个 Libero → 1 张容器卡', () => {
  /** 真库 `E:\vrc\A\衣服\名流\` 的清单（2026-10-05 实读，含截短那个 KipfelMame） */
  const LIBERO: Array<[string, number]> = [
    ['Libero[Airi_ATTITUDE The Royal Bunny]_1.03.unitypackage', 14000000],
    ['Libero[Chiffon&Chocolat_ATTITUDE The Royal Bunny]_1.02.unitypackage', 25000000],
    ['Libero[Ichigo_ATTITUDE The Royal Bunny]_1.01.unitypackage', 14100000],
    ['Libero[KipfelMame_ATTITUDE]_1.00.unitypackage', 13900000],
    ['Libero[Kumaly_ATTITUDE The Royal Bunny]_1.00.unitypackage', 13800000],
    ['Libero[Lasyusha_ATTITUDE The Royal Bunny]_1.01.unitypackage', 13700000],
    ['Libero[Lumina_ATTITUDE The Royal Bunny]_1.00.unitypackage', 13600000],
    ['Libero[Manuka_ATTITUDE The Royal Bunny]_1.03.unitypackage', 13500000],
    ['Libero[Milfy&Eku_ATTITUDE The Royal Bunny]_1.01.unitypackage', 13400000],
    ['Libero[Milltina_ATTITUDE The Royal Bunny]_1.02.unitypackage', 13300000],
    ['Libero[Misaki_ATTITUDE The Royal Bunny]_1.00.unitypackage', 13200000],
    ['Libero[Moe_ATTITUDE The Royal Bunny]_1.04.unitypackage', 13100000],
    ['Libero[Nemesis&Elusion_ATTITUDE The Royal Bunny]_1.00.unitypackage', 13000000],
    ['Libero[Ramune_ATTITUDE The Royal Bunny]_1.00.unitypackage', 12900000],
    ['Libero[Rurune&Mizuki_ATTITUDE The Royal Bunny]_1.00.unitypackage', 12800000],
    ['Libero[Selestia_ATTITUDE The Royal Bunny]_1.01.unitypackage', 12700000],
    ['Libero[Shinano_ATTITUDE The Royal Bunny]_1.00.unitypackage', 12600000],
    ['Libero[Shinra_ATTITUDE The Royal Bunny]_1.01.unitypackage', 12500000],
    ['Libero[Sio_ATTITUDE The Royal Bunny]_1.02.unitypackage', 12400000],
    ['Libero[Sion_ATTITUDE The Royal Bunny]_1.01.unitypackage', 12300000]
  ]

  function ingestOf(entries: FileEntry[], rawName: string): IngestResult {
    return {
      assetId: 'test-libero',
      rawName,
      sourcePath: path.join(root, 'src-libero'),
      sourceDirChain: ['衣服', '名流'],
      entries,
      totalBytes: entries.reduce((a, e) => a + e.size, 0),
      metadata: {
        urls: [],
        boothItemId: null,
        boothItemIdConfidence: 0,
        sourcePlatform: null,
        version: null,
        localeTag: null,
        author: null,
        previewImages: [],
        textSnippet: '',
        warnings: []
      },
      warnings: []
    } as unknown as IngestResult
  }

  it('验收 6：planBundle 把 20 个并成 1 个子项 / 20 个版本，容器类型是 merged', () => {
    const entries: FileEntry[] = [
      ...LIBERO.map(([relPath, size]) => ({ relPath, size, ext: '.unitypackage', isDir: false })),
      { relPath: 'ATTITUDE The Royal Bunny.jpg', size: 500000, ext: '.jpg', isDir: false }
    ]
    const plan = planBundle(ingestOf(entries, '名流'), { lex, depth: 0 } as never)
    expect(plan, '名流 这个目录名没提"合集"，但 20 个变体必须被聚出来').toBeTruthy()
    expect(plan?.containerKind, '归并型，不是合集型').toBe('merged')
    const libero = plan?.items.find((i) => i.name.toLowerCase().startsWith('libero'))
    expect(libero, '20 个 Libero 并成一个子项').toBeTruthy()
    expect(libero?.versions.length).toBe(20)
    // 验收 9：复合名两个模型都认出来
    const chiffon = libero?.versions.find((v) => v.rawName.includes('Chiffon'))
    expect(chiffon?.avatars.slice().sort()).toEqual(['CHIFFON', 'CHOCOLAT'])
    // 截短那个也在组里（系列名只取头词才办得到）
    expect(libero?.versions.some((v) => v.rawName.includes('KipfelMame'))).toBe(true)
    const kipfel = libero?.versions.find((v) => v.rawName.includes('KipfelMame'))
    expect(kipfel?.avatars.slice().sort(), '& 写丢了靠驼峰拆').toEqual(['KIPFEL', 'MAME'])
    // 版本排序：最新的在最前（1.04 > 1.03 > …）
    expect(libero?.versions[0].version).toBe('1.04')
    // §B2：每个变体都记得自己是从哪截括号内容来的
    expect(libero?.versions.every((v) => !!v.variantRaw)).toBe(true)
  })

  it('验收 6/7：落库后是 1 张容器卡，进去能看全 20 个变体', () => {
    const dir = path.join(root, 'src-libero')
    fs.mkdirSync(dir, { recursive: true })
    const entries: FileEntry[] = LIBERO.map(([relPath, size]) => {
      fs.writeFileSync(path.join(dir, relPath), Buffer.alloc(16))
      return { relPath, size, ext: '.unitypackage', isDir: false }
    })
    const plan = planBundle(ingestOf(entries, '名流'), { lex, depth: 0 } as never)!
    const item = plan.items.find((i) => i.name.toLowerCase().startsWith('libero'))!

    const unit = (n: string, over: Partial<CommitUnit> = {}): CommitUnit =>
      mkUnit({ name: n, category: 'clothing', subcategory: 'outfit', groupKey: null, ...over })

    const r = commitBundleAsset(deps(), {
      bundle: unit('Libero', { sizeBytes: item.sizeBytes }),
      rootPath: dir,
      containerKind: plan.containerKind,
      items: [
        {
          unit: unit(item.name, { groupKey: item.groupKey, sizeBytes: item.sizeBytes }),
          relPath: item.relPath,
          versions: item.versions
        }
      ]
    })

    const bundle = getAsset(db, r.bundleAssetId)!
    expect(bundle.is_bundle).toBe(1)
    expect(bundle.container_kind).toBe('merged')
    expect(countChildren(db, r.bundleAssetId), '容器下 1 个子项').toBe(1)

    const items = listChildItems(db, r.bundleAssetId)
    expect(items.length).toBe(1)
    const versions = db
      .prepare(`SELECT * FROM asset WHERE parent_asset_id = ?`)
      .all(items[0].id) as Array<{ name: string; version: string | null }>
    expect(versions.length, '20 个版本行').toBe(20)

    // 库列表第一层：容器卡 1 张 + 上一节的素材 0 张（已被撤销）
    const top = queryCards(db, {}, cfg, 'zh-CN')
    const libero = top.cards.find((c) => c.id === r.bundleAssetId)
    expect(libero, '容器卡出现在第一层').toBeTruthy()
    expect(libero?.isBundle).toBe(true)
    expect(libero?.containerKind).toBe('merged')
    expect(libero?.childCount).toBe(1)
    expect(top.cards.some((c) => /Libero\[/i.test(c.name)), '20 个变体不许各自成卡').toBe(false)
  })
})
