import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset, getAsset } from '../../src/main/db/repos/asset'
import { ensureGroup, addVariant } from '../../src/main/db/repos/product'
import {
  scanLibrary,
  findStrays,
  markMissing,
  unmarkMissing,
  dissolveOrphanGroups,
  rebuildFromSidecars,
  dHashFromBitmap,
  hamming,
  dHashOf,
  type ThumbDigest
} from '../../src/main/library/health'
import { writeSidecar, SIDECAR_SCHEMA } from '../../src/main/library/sidecar'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'
import { thumbPathFor } from '../../src/main/library/thumbs'
import { thumbUrlFor } from '../../src/main/library/thumbRules'

/**
 * F9 库健康检查。扫描必须只读，僵尸条目只标记不删 ——
 * 这两条是规格里写死的，测试就是为了让它们不被"顺手优化"掉。
 */

let root = ''
let lib = ''
let db: Db

function asset(over: Partial<Parameters<typeof makeAssetRow>[0]> & { name: string }): string {
  const row = makeAssetRow({ status: 'archived', raw_name: over.name + '.zip', ...over } as never)
  upsertAsset(db, row)
  return row.id
}

function touch(file: string, bytes = 64): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.alloc(bytes, 0x5a))
}

let lex: Lexicon

beforeAll(() => {
  lex = loadLexicon({ builtin: path.join(path.resolve(__dirname, '../..'), 'resources/lexicon/lexicon.json') })
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-health-'))
  lib = path.join(root, 'library')
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

describe('僵尸条目（DB 有、盘上没有）', () => {
  it('只报不改，标缺失要另外调，且永不删行', () => {
    const gone = path.join(lib, '插件', '动作类', '跑掉了')
    const id = asset({ name: '跑掉了', category: 'plugin', subcategory: 'action', library_path: gone, source_path: gone, size_bytes: 1234, confidence: 0.9 })
    const rep = scanLibrary(db, lib)
    const hit = rep.missing.find((m) => m.id === id)
    expect(hit, '应该被报成缺失').toBeTruthy()
    expect(getAsset(db, id), '扫描不许动库记录').toBeTruthy()
    expect(rep.totals.missingBytes).toBeGreaterThanOrEqual(1234)

    expect(markMissing(db, [id]).marked).toBe(1)
    expect(getAsset(db, id)?.status).toBe('missing')
    expect(markMissing(db, [id]).marked, '重复标记不该重复计数').toBe(0)

    expect(unmarkMissing(db, [id]).restored).toBe(1)
    expect(getAsset(db, id)?.status).toBe('classified')
    expect(getAsset(db, id), '解除标记也不能删行').toBeTruthy()
    fs.rmSync(path.dirname(gone), { recursive: true, force: true })
  })

  it('文件在的时候不报缺失', () => {
    const dir = path.join(lib, '插件', '动作类', '还在')
    touch(path.join(dir, 'ok.zip'), 128)
    const id = asset({ name: '还在', category: 'plugin', subcategory: 'action', library_path: dir, source_path: path.join(dir, 'ok.zip'), size_bytes: 128 })
    expect(scanLibrary(db, lib).missing.find((m) => m.id === id)).toBeUndefined()
  })
})

describe('重复检测（xxh64 完全一致）', () => {
  it('同哈希归一组，多出来的份算可回收空间', () => {
    const a = path.join(lib, '模型', '素体', 'A')
    const b = path.join(lib, '模型', '素体', 'B')
    touch(path.join(a, 'x.fbx'), 4096)
    touch(path.join(b, 'x.fbx'), 4096)
    asset({ name: 'A', category: 'model', subcategory: 'base', library_path: a, source_path: path.join(a, 'x.fbx'), size_bytes: 4096, hash_xxh64: 'duphash001' })
    asset({ name: 'B', category: 'model', subcategory: 'base', library_path: b, source_path: path.join(b, 'x.fbx'), size_bytes: 4096, hash_xxh64: 'duphash001' })
    const rep = scanLibrary(db, lib)
    const g = rep.duplicates.find((d) => d.hash === 'duphash001')
    expect(g?.assets).toHaveLength(2)
    expect(g?.sizeBytes).toBe(4096)
    expect(rep.totals.duplicateBytes).toBeGreaterThanOrEqual(4096)
  })

  it('没算出哈希的素材不参与重复', () => {
    const rep = scanLibrary(db, lib)
    for (const g of rep.duplicates) expect(g.hash).toBeTruthy()
  })
})

describe('游离文件（盘上有、DB 没有）', () => {
  it('整棵没人要的子树报出来，装着素材的目录继续往里钻', () => {
    const known = path.join(lib, '服装', '套装', 'Grimoir')
    touch(path.join(known, 'Grimoir.zip'), 2048)
    // 同一个分类目录下另起的一堆没人要的东西
    touch(path.join(lib, '服装', '套装', '忘了登记', 'a.png'), 1024)
    touch(path.join(lib, '服装', '套装', '忘了登记', 'b.png'), 1024)
    // 顶层直接扔的文件
    touch(path.join(lib, '随手放的.zip'), 512)

    const { items } = findStrays(lib, [known])
    const paths = items.map((i) => path.relative(lib, i.path).split(path.sep).join('/'))
    expect(paths).toContain(path.join('服装', '套装', '忘了登记').replace(/\\/g, '/'))
    expect(paths).toContain('随手放的.zip')
    // 已登记素材的内部不许当游离文件
    expect(paths.some((p) => p.startsWith('服装/套装/Grimoir'))).toBe(false)
    expect(paths.some((p) => p.includes('a.png'))).toBe(false)
    // 目录要带汇总大小（两个 1KB）
    const dir = items.find((i) => i.isDir && i.path.endsWith('忘了登记'))
    expect(dir?.sizeBytes).toBe(2048)
    expect(dir?.entries).toBeGreaterThanOrEqual(2)
  })

  it('一二级目录（分类 / 二级）是库的结构，不算游离', () => {
    // 真库刚接上、一条素材都没登记时，整棵目录树都会被判成游离；
    // 那时点"重新登记"= 把 25GB 全丢进取物队列，而自动归档会搬文件。
    const d = path.join(lib, '结构测试')
    fs.mkdirSync(path.join(d, '头发', '双马尾', '没登记的东西'), { recursive: true })
    fs.writeFileSync(path.join(d, '头发', '双马尾', '没登记的东西', 'x.fbx'), Buffer.alloc(4096))
    const paths = findStrays(d, []).items.map((i) => path.relative(d, i.path).split(path.sep).join('/'))
    expect(paths).not.toContain('头发')
    expect(paths).not.toContain('头发/双马尾')
    expect(paths).toContain('头发/双马尾/没登记的东西')
  })

  it('分批收编：under 只扫一棵子树，深度仍然相对库根算', () => {
    const d = path.join(lib, '分批')
    fs.mkdirSync(path.join(d, '贴图', 'lime', 'Custom skin'), { recursive: true })
    fs.mkdirSync(path.join(d, '衣服', '套装', '某件'), { recursive: true })
    fs.writeFileSync(path.join(d, '贴图', 'lime', 'Custom skin', 'a.png'), Buffer.alloc(4096))
    fs.writeFileSync(path.join(d, '衣服', '套装', '某件', 'b.zip'), Buffer.alloc(4096))
    const only = findStrays(d, [], { under: path.join(d, '贴图') }).items.map((i) => path.relative(d, i.path).split(path.sep).join('/'))
    expect(only).toEqual(['贴图/lime/Custom skin'])
    // 不传 under 时两棵都报
    const both = findStrays(d, [], {}).items.map((i) => path.relative(d, i.path).split(path.sep).join('/'))
    expect(both).toContain('贴图/lime/Custom skin')
    expect(both).toContain('衣服/套装/某件')
    // 子树在库根外面 → 什么都不报（不能越界扫）
    expect(findStrays(d, [], { under: 'C:\\Windows\\Fonts' }).items).toEqual([])
  })

  it('「包 + 同名已解压目录」并排时合成一条，登记只进包', () => {
    const d = path.join(lib, '并排')
    fs.mkdirSync(path.join(d, '贴图', 'lime', 'Custom skin'), { recursive: true })
    fs.writeFileSync(path.join(d, '贴图', 'lime', 'Custom skin', 'a.png'), Buffer.alloc(9000))
    fs.writeFileSync(path.join(d, '贴图', 'lime', 'Custom skin.zip'), Buffer.alloc(4000))
    // 另有一件只有包、没有解压副本 —— 不该被并掉
    fs.mkdirSync(path.join(d, '贴图', 'lime', 'solo'), { recursive: true })
    fs.writeFileSync(path.join(d, '贴图', 'lime', 'solo', 'x.txt'), Buffer.alloc(3000))

    const items = findStrays(d, [], {}).items
    const merged = items.find((i) => i.path.endsWith('Custom skin.zip'))
    expect(merged, '包应该被当成代表').toBeTruthy()
    expect(merged?.alsoDirs?.some((x) => x.endsWith('Custom skin'))).toBe(true)
    expect(items.some((i) => i.isDir && i.path.endsWith('Custom skin'))).toBe(false)
    // 没配对的目录照旧单独报出来
    expect(items.some((i) => i.isDir && i.path.endsWith('solo'))).toBe(true)
    // 合并不会把副本的体积算进去（腾空间时那个数才可信）
    expect(merged?.sizeBytes).toBe(4000)
  })

  it('库根不存在时不炸', () => {
    expect(findStrays(path.join(root, '没有这个库'), []).items).toEqual([])
  })

  it('侧车文件本身不算游离', () => {
    const dir = path.join(lib, '道具', '手持', '带侧车')
    touch(path.join(dir, 'prop.fbx'), 64)
    fs.writeFileSync(path.join(dir, '.avca.json'), '{}')
    const { items } = findStrays(lib, [dir])
    expect(items.some((i) => i.path.endsWith('.avca.json'))).toBe(false)
  })
})

describe('§A1 垃圾过滤 + §A5 结构层收口（改动单 2）', () => {
  it('验收 3：.DS_Store / Thumbs.db / __MACOSX / desktop.ini 在游离清单里完全不存在', () => {
    const d = path.join(lib, '垃圾测试')
    fs.mkdirSync(path.join(d, '__MACOSX', 'sub'), { recursive: true })
    fs.writeFileSync(path.join(d, '.DS_Store'), Buffer.alloc(4096))
    fs.writeFileSync(path.join(d, 'Thumbs.db'), Buffer.alloc(4096))
    fs.writeFileSync(path.join(d, 'desktop.ini'), Buffer.alloc(64))
    fs.writeFileSync(path.join(d, '~$报告.docx'), Buffer.alloc(64))
    fs.writeFileSync(path.join(d, 'half.crdownload'), Buffer.alloc(64))
    fs.writeFileSync(path.join(d, '__MACOSX', 'sub', '._a.png'), Buffer.alloc(8192))
    // 一件真素材陪跑，证明过滤器没把整棵树掐掉
    fs.mkdirSync(path.join(d, '贴图', 'lime', '真素材'), { recursive: true })
    fs.writeFileSync(path.join(d, '贴图', 'lime', '真素材', 'a.png'), Buffer.alloc(1024))

    const items = findStrays(d, []).items
    const all = items.map((i) => path.relative(d, i.path).split(path.sep).join('/')).join('|')
    expect(all).not.toMatch(/DS_Store|Thumbs|desktop\.ini|__MACOSX|~\$|crdownload/i)
    expect(all).toContain('贴图/lime/真素材')
  })

  it('垃圾不计入目录体积与条目数', () => {
    const d = path.join(lib, '体积测试')
    const dir = path.join(d, '贴图', 'lime', '带垃圾的素材')
    fs.mkdirSync(path.join(dir, '__MACOSX'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'body.png'), Buffer.alloc(1024))
    fs.writeFileSync(path.join(dir, '.DS_Store'), Buffer.alloc(4096))
    fs.writeFileSync(path.join(dir, '__MACOSX', '._body.png'), Buffer.alloc(8192))
    const it = findStrays(d, []).items.find((i) => i.path.endsWith('带垃圾的素材'))
    expect(it?.sizeBytes, '只算 body.png 那 1024 字节').toBe(1024)
  })

  it('验收 4：`Editor/SkinnedMeshMover.cs` 不再单独成卡 —— 整个 Editor 收成一条', () => {
    const d = path.join(lib, '脚本收口')
    fs.mkdirSync(path.join(d, '插件', 'Editor'), { recursive: true })
    fs.writeFileSync(path.join(d, '插件', 'Editor', 'SkinnedMeshMover.cs'), Buffer.alloc(2048))
    fs.writeFileSync(path.join(d, '插件', 'Editor', 'Other.cs'), Buffer.alloc(1024))
    const items = findStrays(d, []).items
    const rel = items.map((i) => path.relative(d, i.path).split(path.sep).join('/'))
    expect(rel).toContain('插件/Editor')
    expect(rel.some((p) => p.endsWith('.cs')), '脚本不许各自成条').toBe(false)
    expect(items.find((i) => i.path.endsWith('Editor'))?.contentKind).toBe('code')
  })

  it('§A5：结构层里全是散图 → 整体一条「参考资料」，不是 N 条', () => {
    const d = path.join(lib, '参考收口')
    fs.mkdirSync(path.join(d, '参考资料', '参考图'), { recursive: true })
    for (const n of ['a.jpg', 'b.png', 'c.webp']) fs.writeFileSync(path.join(d, '参考资料', '参考图', n), Buffer.alloc(512))
    fs.writeFileSync(path.join(d, '参考资料', '参考图', 'notes.md'), Buffer.alloc(128))
    const items = findStrays(d, []).items
    const rel = items.map((i) => path.relative(d, i.path).split(path.sep).join('/'))
    expect(rel).toEqual(['参考资料/参考图'])
    expect(items[0].contentKind).toBe('attachments')
  })

  it('混着主体的结构层照旧往里钻，不许被收口吞掉', () => {
    const d = path.join(lib, '不收口')
    fs.mkdirSync(path.join(d, '服装', '套装'), { recursive: true })
    fs.writeFileSync(path.join(d, '服装', '套装', 'x.fbx'), Buffer.alloc(4096))
    fs.writeFileSync(path.join(d, '服装', '套装', 'preview.jpg'), Buffer.alloc(1024))
    const items = findStrays(d, []).items
    expect(items.some((i) => i.isDir && i.path.endsWith('套装')), '有 fbx 就不算 code/attachments').toBe(false)
    expect(items.every((i) => i.contentKind === undefined)).toBe(true)
  })
})

describe('结构层收口（沙盒活体打回来的两条：lilToon 5 条 / 名流 21 条）', () => {
  const rel = (root: string, items: Array<{ path: string }>): string[] =>
      items.map((i) => path.relative(root, i.path).split(path.sep).join('/'))

  it('同一件东西的散包 ≥3 且 groupKey 全同 → 整个目录报一条（Libero 20 个）', () => {
    const d = path.join(lib, '归并收口')
    const dir = path.join(d, '衣服', '名流')
    const SER = 'ATTITUDE The Royal Bunny'
    const models = ['Airi', 'Chiffon&Chocolat', 'Shinano', 'Sion', 'Milfy&Eku']
    for (const m of models) touch(path.join(dir, `Libero[${m}_${SER}]_1.0.unitypackage`), 512)
    touch(path.join(dir, SER + '.jpg'), 200)

    const noLex = rel(d, findStrays(d, []).items)
    expect(noLex.some((p) => p.endsWith('.unitypackage')), '不给词典时还是老行为：散包各报一条').toBe(true)

    const r = rel(d, findStrays(d, [], { lex }).items)
    expect(r, '应当只剩 `衣服/名流` 一条：' + JSON.stringify(r)).toEqual(['衣服/名流'])
    const item = findStrays(d, [], { lex }).items[0]
    expect(item.contentKind).toBe('group')
  })

  it('§B2 闸门③在收口层也要生效：三个不同前缀塌成同一个 key → 不许并', () => {
    /**
     * 活体打回来的：沙盒里我造了 `Shinano[X_Same Series]` / `Manuka[…]` / `Moe[…]`
     * 三个不同产品，括号一摘 groupKey 全塌成 `same`。只比 key 就会并成一张卡，
     * 界面上凭空冒出一个叫 "Manuka" 的容器（真跑真界面扫出来的）。
     */
    const d = path.join(lib, '歧义试验')
    const dir = path.join(d, '衣服', '歧义')
    for (const p of ['Shinano', 'Manuka', 'Moe']) touch(path.join(dir, p + '[X_Same Series]_1.0.zip'), 400)
    const r = rel(d, findStrays(d, [], { lex }).items)
    expect(r.length, '三个不同前缀必须还是三条：' + JSON.stringify(r)).toBe(3)
    expect(r.some((p) => p === '衣服/歧义'), '不许冒出一条目录级容器').toBe(false)
  })

  it('主体在子目录里、根上只散着附属文件 → 整个目录报一条（lilToon）', () => {
    const d = path.join(lib, 'lilToon收口')
    const dir = path.join(d, '着色器', 'lilToon_2.x.x')
    touch(path.join(dir, 'Assets', 'lilToon', 'lilToon.shader'), 300)
    touch(path.join(dir, 'Assets', 'lilToon', 'Shader', 'lilCommon.hlsl'), 100)
    touch(path.join(dir, 'Assets', 'lilToon', 'Editor', 'lilInspector.cs'), 100)
    touch(path.join(dir, 'Readme.html'), 100)
    touch(path.join(dir, 'Distribution.png'), 100)
    touch(path.join(dir, 'package.json'), 40)

    const r = rel(d, findStrays(d, [], { lex }).items)
    expect(r, '应当只剩 `着色器/lilToon_2.x.x` 一条：' + JSON.stringify(r)).toEqual(['着色器/lilToon_2.x.x'])
    expect(findStrays(d, [], { lex }).items[0].contentKind).toBe('primary')
  })

  it('二级目录里平铺 5 个不相干的包 → 一条都不许并（并了就是把 5 件揉成 1 件）', () => {
    const d = path.join(lib, '不收口2')
    const dir = path.join(d, '衣服', '西装')
    for (const n of ['Alpha', 'Bravo', 'Cinder', 'Delft', 'Echo']) touch(path.join(dir, n + '_outfit.zip'), 400)
    const r = rel(d, findStrays(d, [], { lex }).items).sort()
    expect(r.length, '5 个不同产品必须还是 5 条：' + JSON.stringify(r)).toBe(5)
    expect(r.some((p) => p === '衣服/西装'), '不许冒出一条目录级记录').toBe(false)
  })

  it('同前缀但 groupKey 不同（配色 vs 模型）→ 不自动并，留给 §B5 建议横幅', () => {
    const d = path.join(lib, '建议不自动并')
    const dir = path.join(d, '衣服', '衣服TwinkleSpica')
    for (const n of ['Mint', 'Plum', 'Milk']) touch(path.join(dir, `TwinkleSpica_${n}_v1.1.zip`), 300)
    for (const n of ['Shinano', 'Eku', 'Ramune']) touch(path.join(dir, `TwinkleSpica_${n}_v1.1.zip`), 300)
    const r = rel(d, findStrays(d, [], { lex }).items)
    expect(r.length, '6 个各是一条，一条都不许并').toBe(6)
    expect(r.some((p) => p === '衣服/衣服TwinkleSpica')).toBe(false)
  })

  it('贴图/lime/Custom skin/a.png 这种三层结构照旧报到第三层（旧闸门不许退化）', () => {
    const d = path.join(lib, '第三层')
    const dir = path.join(d, '贴图', 'lime', 'Custom skin')
    for (const n of ['a.png', 'b.png', 'c.png']) touch(path.join(dir, n), 300)
    const r = rel(d, findStrays(d, [], { lex }).items)
    expect(r, '必须还是报 Custom skin 那一条').toEqual(['贴图/lime/Custom skin'])
  })
})

describe('大文件排行与孤儿变体', () => {
  it('largest 按体积倒序，最多 20 条', () => {
    const rep = scanLibrary(db, lib)
    expect(rep.largest.length).toBeLessThanOrEqual(20)
    for (let i = 1; i < rep.largest.length; i++) {
      expect((rep.largest[i - 1].sizeBytes ?? 0)).toBeGreaterThanOrEqual(rep.largest[i].sizeBytes ?? 0)
    }
  })

  it('只剩一个成员、但留着多份变体痕迹的组才算孤儿；天生单件的不算', () => {
    const g1 = ensureGroup(db, { groupKey: 'solo', name: 'Solo', category: 'plugin', subcategory: null })
    const g2 = ensureGroup(db, { groupKey: 'pair', name: 'Pair', category: 'plugin', subcategory: null })
    const g3 = ensureGroup(db, { groupKey: 'loner', name: 'Loner', category: 'plugin', subcategory: null })
    const solo = asset({ name: 'SoloOne', category: 'plugin', group_id: g1.id })
    asset({ name: 'PairA', category: 'plugin', group_id: g2.id })
    asset({ name: 'PairB', category: 'plugin', group_id: g2.id })
    const loner = asset({ name: 'Loner', category: 'plugin', group_id: g3.id })
    // 孤儿变体的证据是"这个组曾经有过 ≥2 个差异维度"（见 health.ts 里那段注释）
    addVariant(db, { groupId: g1.id, assetId: solo, kind: 'version', value: '1.0' })
    addVariant(db, { groupId: g1.id, assetId: solo, kind: 'locale', value: '汉化' })
    addVariant(db, { groupId: g3.id, assetId: loner, kind: 'avatar', value: 'SHINANO' })

    const rep = scanLibrary(db, lib)
    expect(rep.orphanGroups.some((o) => o.groupId === g1.id), 'g1 该被认成孤儿').toBe(true)
    expect(rep.orphanGroups.some((o) => o.groupId === g2.id), '两成员的组不动').toBe(false)
    expect(rep.orphanGroups.some((o) => o.groupId === g3.id), '天生单件 + 一个维度 ≠ 孤儿').toBe(false)

    const r = dissolveOrphanGroups(db)
    expect(r.dissolved).toBe(1)
    expect(r.assetsFreed).toBe(1)
    expect(getAsset(db, solo)?.group_id).toBeNull()
    expect(getAsset(db, loner)?.group_id, '没被点到的组不许顺手清掉').toBe(g3.id)
    const kept = db.prepare(`SELECT COUNT(*) c FROM asset WHERE group_id = ?`).get(g2.id) as { c: number }
    expect(kept.c).toBe(2)
    expect(db.prepare(`SELECT COUNT(*) c FROM asset_group WHERE id = ?`).get(g1.id)).toEqual({ c: 0 })
  })
})

describe('dHash 相似图', () => {
  const solid = (v: number): { bitmap: Buffer; width: number; height: number } => {
    const w = 9
    const h = 8
    const b = Buffer.alloc(w * h * 4)
    for (let i = 0; i < b.length; i += 4) {
      b[i] = v
      b[i + 1] = v
      b[i + 2] = v
      b[i + 3] = 255
    }
    return { bitmap: b, width: w, height: h }
  }
  const gradient = (): { bitmap: Buffer; width: number; height: number } => {
    const w = 9
    const h = 8
    const b = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const v = (x * 255) / (w - 1)
        b[i] = v
        b[i + 1] = v
        b[i + 2] = v
        b[i + 3] = 255
      }
    }
    return { bitmap: b, width: w, height: h }
  }
  const stripes = (): { bitmap: Buffer; width: number; height: number } => {
    const w = 9
    const h = 8
    const b = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const v = x % 2 === 0 ? 250 : 0
        b[i] = v
        b[i + 1] = v
        b[i + 2] = v
        b[i + 3] = 255
      }
    }
    return { bitmap: b, width: w, height: h }
  }
  const digestOf = (src: { bitmap: Buffer; width: number; height: number }): ThumbDigest => () => src

  it('同一张图距离 0，结构不同的图差很远', () => {
    const a = dHashOf('k', digestOf(solid(128))) as string
    const b = dHashOf('k', digestOf(solid(129))) as string
    const c = dHashOf('k', digestOf(stripes())) as string
    expect(a).toHaveLength(64)
    expect(hamming(a, b)).toBe(0)
    // 纯色 / 横向渐变在 dHash 下都是"一路不翻转"，所以要比就比结构不同的图
    expect(hamming(a, c)).toBeGreaterThan(20)
    expect(hamming(a, dHashOf('k', digestOf(gradient())) as string)).toBe(0)
  })

  it('整体亮度漂移不影响（这就是选 dHash 不选 aHash 的理由）', () => {
    const dark = dHashOf('k', digestOf(gradient())) as string
    const bright = dHashOf('k', digestOf({ ...gradient(), bitmap: Buffer.from(gradient().bitmap.map((v, i) => (i % 4 === 3 ? 255 : Math.min(255, v * 2 + 20)))) })) as string
    expect(hamming(dark, bright)).toBeLessThan(4)
  })

  it('拿不到位图就返回 null，不抛', () => {
    expect(dHashOf('k', () => null)).toBeNull()
    expect(dHashOf('k', () => ({ bitmap: Buffer.alloc(0), width: 0, height: 0 }))).toBeNull()
  })

  it('两张几乎一样的封面会被报成相似，差太多的不会', () => {
    const idA = asset({ name: '相似A', category: 'texture', cover_image: thumbUrlFor('hashA') })
    const idB = asset({ name: '相似B', category: 'texture', cover_image: thumbUrlFor('hashB') })
    const idC = asset({ name: '差很远', category: 'texture', cover_image: thumbUrlFor('hashC') })
    fs.mkdirSync(path.dirname(thumbPathFor('hashA')), { recursive: true })
    for (const k of ['hashA', 'hashB', 'hashC']) fs.writeFileSync(thumbPathFor(k), Buffer.alloc(8, 1))
    const bits: Record<string, { bitmap: Buffer; width: number; height: number }> = {
      hashA: { bitmap: Buffer.alloc(9 * 8 * 4, 10), width: 9, height: 8 },
      hashB: { bitmap: Buffer.alloc(9 * 8 * 4, 11), width: 9, height: 8 },
      hashC: (() => {
        const b = Buffer.alloc(9 * 8 * 4, 0)
        for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) {
          const i = (y * 9 + x) * 4
          const v = x % 2 === 0 ? 250 : 0
          b[i] = v; b[i + 1] = v; b[i + 2] = v; b[i + 3] = 255
        }
        return { bitmap: b, width: 9, height: 8 }
      })()
    }
    const rep = scanLibrary(db, lib, (key) => bits[key] ?? null)
    const pair = rep.similar.find((s) => [s.a.id, s.b.id].includes(idA) && [s.a.id, s.b.id].includes(idB))
    expect(pair, 'A/B 应该算相似').toBeTruthy()
    expect(rep.similar.some((s) => [s.a.id, s.b.id].includes(idC)), 'C 不该跟谁相似').toBe(false)
  })

  it('不传 digest 就完全跳过相似检测（扫描要能便宜）', () => {
    expect(scanLibrary(db, lib).similar).toEqual([])
  })
})

describe('游离扫描：容器名目录的粒度（改动单 §6.3）', () => {
  it('顶层名字写着合集、下面 ≥2 件 → 整包报成一个单元，不钻成碎片', () => {
    const dir = path.join(lib, '插件道具合集-扫描试验')
    for (const n of ['A', 'B', 'C']) touch(path.join(dir, n, 'x.prefab'), 40)
    const r = findStrays(lib, [])
    const hit = r.items.find((i) => i.path === dir)
    expect(hit, '合集目录自己要被当成一个单元报出来').toBeTruthy()
    expect(hit!.isDir).toBe(true)
    expect(r.items.filter((i) => i.path.startsWith(dir)).length, '不许再把它孙辈的碎片也报一遍').toBe(1)
  })

  it('容器只有一个孩子 → 继续往下钻，报真正那件商品', () => {
    const inner = path.join(lib, '插件', '道具22件', '6159895摇后会喷的酒')
    for (const n of ['a.zip', 'b.zip', 'c.zip']) touch(path.join(inner, n), 40)
    const r = findStrays(lib, [])
    const paths = r.items.map((i) => i.path)
    expect(paths).toContain(inner)
    expect(paths.some((p) => p.endsWith('道具22件')), '只有一个孩子的容器不该被当成单元').toBe(false)
  })
})

describe('从侧车重建索引', () => {
  it('库文件还在、记录没了 → 能整条捞回来', async () => {
    const dir = path.join(lib, '参考资料', '重建测试')
    touch(path.join(dir, 'doc.pdf'), 256)
    const id = asset({
      name: '重建测试',
      raw_name: 'doc.pdf',
      category: 'reference',
      subcategory: null,
      size_bytes: 256,
      hash_xxh64: 'rebuild001',
      kind: 'doc',
      library_path: dir,
      source_path: path.join(dir, 'doc.pdf')
    })
    await writeSidecar(dir, {
      schema: SIDECAR_SCHEMA,
      appVersion: 'test',
      generatedAt: 1,
      asset: {
        id,
        name: '重建测试',
        raw_name: 'doc.pdf',
        category: 'reference',
        subcategory: null,
        confidence: 0.8,
        status: 'archived',
        kind: 'doc',
        content_type: 'reference',
        version: null,
        author: null,
        locale_tag: null,
        source_url: null,
        source_platform: null,
        source_item_id: null,
        source_item_id_confidence: 0,
        cover_image: null,
        group_id: null,
        bundle_id: null,
        notes: null,
        storage_mode: 'archived',
        size_bytes: 256,
        hash_xxh64: 'rebuild001',
        attachment_kind: null,
        container_kind: null,
        variant_raw: null
      }
    })
    db.prepare(`DELETE FROM asset WHERE id = ?`).run(id)
    expect(getAsset(db, id)).toBeNull()

    const seen: string[] = []
    const r = await rebuildFromSidecars(db, lib, (x) => seen.push(x))
    expect(r.found).toBeGreaterThanOrEqual(1)
    expect(r.inserted).toBe(1)
    expect(seen).toEqual([id])
    const back = getAsset(db, id)
    expect(back?.name).toBe('重建测试')
    expect(back?.library_path).toBe(dir)
    expect(back?.hash_xxh64).toBe('rebuild001')

    const again = await rebuildFromSidecars(db, lib)
    expect(again.inserted).toBe(0)
    expect(again.skipped).toBeGreaterThanOrEqual(1)
    expect(getAsset(db, id)?.name, '重建不许覆盖已有记录').toBe('重建测试')
  })

  it('坏侧车只记错误，不中断整轮', async () => {
    const dir = path.join(lib, '参考资料', '坏侧车')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '.avca.json'), '{ 这不是 JSON')
    const r = await rebuildFromSidecars(db, lib)
    expect(r.errors.length).toBeGreaterThanOrEqual(1)
    expect(r.errors.join(' ')).toContain('坏侧车')
  })
})

describe('扫描是只读的', () => {
  it('scanLibrary 不改任何一行', () => {
    const before = db.prepare(`SELECT id, status, group_id, updated_at FROM asset ORDER BY id`).all()
    scanLibrary(db, lib)
    const after = db.prepare(`SELECT id, status, group_id, updated_at FROM asset ORDER BY id`).all()
    expect(after).toEqual(before)
  })
})
