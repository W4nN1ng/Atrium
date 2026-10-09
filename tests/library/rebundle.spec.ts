import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { makeAssetRow, upsertAsset, getAsset, listChildren } from '../../src/main/db/repos/asset'
import { scanRebundle, applyRebundle } from '../../src/main/library/rebundle'
import { appendJournal } from '../../src/main/db/repos/journal'
import { undoLast } from '../../src/main/library/undo'
import { loadLexicon, type Lexicon } from '../../src/main/classify/lexicon'
import type { CategoryConfig } from '../../src/shared/types'

/**
 * 「重新整理合集」（改动单 §5）：上一版把合集拆成一堆顶层素材，这里要能吸回去，
 * 而且**不许动一个文件**、不许把分类目录当成合集。
 */

const ROOT = path.resolve(__dirname, '../..')
let root = ''
let lib = ''
let db: Db
let lex: Lexicon
let cfg: CategoryConfig

beforeAll(() => {
  lex = loadLexicon({ builtin: path.join(ROOT, 'resources/lexicon/lexicon.json') })
  cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/lexicon/categories.json'), 'utf8')) as CategoryConfig
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-rebundle-'))
  lib = path.join(root, 'lib')
  fs.mkdirSync(lib, { recursive: true })
  db = openDatabase(path.join(root, 'test.db'))
})

afterAll(() => {
  closeDatabase()
  try {
    fs.rmSync(root, { recursive: true, force: true })
  } catch {
    /* Windows 上偶尔慢一拍 */
  }
})

function touch(file: string, bytes = 64): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.alloc(bytes, 3))
}

/** 登记一条"顶层素材"，物理位置就在 dir 下面 */
function register(name: string, dir: string, over: Partial<Parameters<typeof makeAssetRow>[0]> = {}): string {
  const row = makeAssetRow({
    name,
    raw_name: name,
    category: 'plugin',
    status: 'classified',
    confidence: 0.5,
    storage_mode: 'indexed',
    source_path: path.join(dir, name),
    size_bytes: 100,
    ...over
  } as never)
  upsertAsset(db, row)
  return row.id
}

function snapshot(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name)
      if (e.isDirectory()) walk(abs)
      else out.push(`${path.relative(dir, abs)}:${fs.statSync(abs).size}`)
    }
  }
  walk(dir)
  return out.sort()
}

const catOf = (rows: Array<{ category: string; subcategory: string | null }>): { category: string; subcategory: string | null } => {
  const tally = new Map<string, number>()
  for (const r of rows) tally.set(r.category, (tally.get(r.category) ?? 0) + 1)
  return { category: Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0][0], subcategory: null }
}

describe('只读扫描', () => {
  it('同一容器目录下的几件 → 一组；同名的几个版本合成一个子项', () => {
    const dir = path.join(lib, '插件道具合集-初音的VRC小店')
    for (const n of ['GoLoco.unitypackage', 'SPS.zip', 'StoZeroCustomEX.zip', 'StoZeroCustomEX_v1.01.zip', 'StoZeroCustomEX_v1.10.zip']) {
      touch(path.join(dir, n), 50)
      register(n, dir)
    }
    const before = snapshot(lib)
    const groups = scanRebundle(db, cfg, lex, lib)
    expect(groups.length, '不该改东西').toBe(1)
    const g = groups[0]
    expect(g.bundleName).toBe('插件道具合集-初音的VRC小店')
    expect(g.from).toBe(5)
    expect(g.to, '三个 StoZero 合成一个子项').toBe(3)
    const sto = g.items.find((i) => i.assetIds.length === 3)
    expect(sto, '要找到那组版本').toBeTruthy()
    expect(sto!.primaryId, '最新版本当本体').toBe(
      g.items.find((i) => i.assetIds.length === 3)!.assetIds[0]
    )
    expect(snapshot(lib), '扫描必须是只读的').toEqual(before)
  })

  it('分类目录（贴图/皮肤）不算合集 —— 那是库的结构，不是筐', () => {
    const dir = path.join(lib, '贴图', '皮肤')
    for (const n of ['a.png', 'b.png', 'c.png', 'd.png']) {
      touch(path.join(dir, n), 10)
      register(n, dir, { category: 'texture' })
    }
    const groups = scanRebundle(db, cfg, lex, lib)
    expect(groups.some((g) => g.dir === dir), '皮肤下面四件不许被并成"皮肤合集"').toBe(false)
  })

  it('库根本身不算合集目录', () => {
    register('散件.zip', lib, { category: 'tool' })
    touch(path.join(lib, '散件.zip'), 10)
    expect(scanRebundle(db, cfg, lex, lib).some((g) => g.dir === lib)).toBe(false)
  })
})

describe('执行归并', () => {
  it('建合集行 + 改挂 + 版本行，一个文件都不动，且可整批撤销', async () => {
    const dir = path.join(lib, '武器合集')
    for (const n of ['Rifle.zip', 'Pistol.zip', 'Knife.zip']) {
      touch(path.join(dir, n), 70)
      register(n, dir)
    }
    const before = snapshot(lib)
    const groups = scanRebundle(db, cfg, lex, lib).filter((g) => g.dir === dir)
    expect(groups.length).toBe(1)

    const r = applyRebundle(db, groups, { categoryOf: catOf })
    expect(r.bundles).toBe(1)
    expect(r.moved).toBe(3)
    expect(snapshot(lib), '归并绝不能碰磁盘').toEqual(before)

    const bundleRow = db.prepare(`SELECT id FROM asset WHERE is_bundle = 1 AND library_path = ?`).get(dir) as { id: string } | undefined
    expect(bundleRow, '归并后应该有一条合集行').toBeTruthy()
    const bundle = getAsset(db, bundleRow!.id)
    expect(bundle?.name).toBe('武器合集')
    expect(bundle?.is_bundle).toBe(1)
    expect(bundle?.size_bytes, '合集体积 = 成员登记体积之和（每条 100）').toBe(300)
    const kids = listChildren(db, bundle!.id)
    expect(kids.length).toBe(3)
    expect(kids.every((k) => k.parent_asset_id === bundle!.id)).toBe(true)

    // 撤销：成员回到顶层、合集行消失、文件照旧
    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok, u.error ?? u.message).toBe(true)
    expect(getAsset(db, bundle!.id), '新建的合集行要被撤掉').toBeNull()
    for (const k of kids) expect(getAsset(db, k.id)?.parent_asset_id).toBeNull()
    expect(snapshot(lib)).toEqual(before)
  })

  it('解散合集后撤销：先把合集行塞回去再改挂，不然外键直接报错', async () => {
    // 复刻 assets:dissolve-bundle 留下的 journal 形状：子项原父级 = 已被删掉的合集行
    const dir = path.join(lib, '插件/解散试验')
    for (const n of ['a.zip', 'b.zip', 'c.zip']) {
      touch(path.join(dir, n), 20)
      register(n, dir)
    }
    const groups = scanRebundle(db, cfg, lex, lib).filter((g) => g.dir === dir)
    const r = applyRebundle(db, groups, { categoryOf: catOf })
    const bundleId = (db.prepare(`SELECT id FROM asset WHERE is_bundle = 1 AND library_path = ?`).get(dir) as { id: string }).id
    const kids = listChildren(db, bundleId)
    // 模拟"解散"：子项升顶层 + 合集行删掉，journal 记的是这套改动
    db.transaction(() => {
      for (const k of kids) db.prepare(`UPDATE asset SET parent_asset_id = NULL WHERE id = ?`).run(k.id)
      appendJournal(
        db,
        {
          op: 'reparent',
          changes: kids.map((k) => ({ id: k.id, from: bundleId, to: null })),
          restore: { row: getAsset(db, bundleId) },
          label: '解散合集（测试）'
        },
        {}
      )
      db.prepare(`DELETE FROM asset WHERE id = ?`).run(bundleId)
    })()
    expect(getAsset(db, bundleId)).toBeNull()

    const u = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(u.ok, u.error ?? u.message).toBe(true)
    expect(getAsset(db, bundleId), '合集行要回来').toBeTruthy()
    for (const k of kids) expect(getAsset(db, k.id)?.parent_asset_id, '子项要重新挂在合集下').toBe(bundleId)
    expect(r.bundles).toBe(1)
  })

  it('版本归并：同产品的几个包合成一个子项 + 版本行', async () => {
    const dir = path.join(lib, '更新')
    for (const n of ['DPS.zip', 'DPS_v1.9.zip', 'DPS_v1.10.zip']) {
      touch(path.join(dir, n), 30)
      register(n, dir, { version: n.includes('1.9') ? '1.9' : n.includes('1.10') ? '1.10' : null })
    }
    const groups = scanRebundle(db, cfg, lex, lib).filter((g) => g.dir === dir)
    expect(groups.length).toBe(1)
    expect(groups[0].from).toBe(3)
    expect(groups[0].to, '三个包 = 一个子项').toBe(1)
    const r = applyRebundle(db, groups, { categoryOf: catOf })
    expect(r.versions).toBe(2)
    const bundle = getAsset(db, (db.prepare(`SELECT id FROM asset WHERE is_bundle = 1 AND library_path = ?`).get(dir) as { id: string }).id)
    const items = listChildren(db, bundle!.id)
    expect(items.length).toBe(1)
    expect(listChildren(db, items[0].id).length, '另两个包挂在子项下面当版本').toBe(2)
    expect(items[0].name, '并了版本之后名字要回到共同核心词').toBe('DPS')
    await undoLast({ db, holdDir: path.join(root, 'hold') })
  })
})
