import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase, closeDatabase, type Db } from '../../src/main/db'
import { listCollections, parseRule } from '../../src/main/db/repos/meta'
import { listJournal, lastRevertible } from '../../src/main/db/repos/journal'
import { ulid } from '../../src/shared/ulid'
import { applyModelCollections, avatarValuesInLibrary, planModelCollections } from '../../src/main/library/modelCollections'
import { undoLast } from '../../src/main/library/undo'
import type { CollectionRule } from '../../src/shared/types'

/**
 * M6 ④ · 补建集合：预览 → 写库 → Ctrl+Z 退回。
 *
 * 这三步是一个整体，所以放在同一份文件里测：
 * 少了"撤销"那半，它就变成一条只能往前走的批量写用户数据的通道。
 */

let root: string
let db: Db

/** 往库里塞一条带模型信息的素材（variant 那一路） */
function addVariant(value: string): void {
  const asset = ulid()
  db.prepare(
    `INSERT INTO variant (id, group_id, asset_id, variant_kind, variant_value) VALUES (?, ?, ?, 'avatar', ?)`
  ).run(ulid(), ulid(), asset, value)
}

/** 另一路：只打了 avatar 标签的素材 */
function addTagged(value: string): void {
  const tagId = ulid()
  db.prepare(`INSERT INTO tag (id, name, kind) VALUES (?, ?, 'avatar')`).run(tagId, value)
  db.prepare(`INSERT INTO asset_tag (asset_id, tag_id, source) VALUES (?, ?, 'auto')`).run(ulid(), tagId)
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-backfill-'))
  db = openDatabase(path.join(root, 'library.db'))
  addVariant('Shinano')
  addVariant('SHINANO')
  addVariant('Milfy')
  addVariant('UNIVERSAL')
  addTagged('Lime')
})

afterEach(() => {
  closeDatabase()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('数据源', () => {
  it('variant 与 tag 两处取并集（只看一处就会漏掉只打了标签的那批）', () => {
    const values = avatarValuesInLibrary(db).map((r) => r.value)
    expect(values).toEqual(expect.arrayContaining(['Shinano', 'Milfy', 'Lime']))
  })
})

describe('预览（只读）', () => {
  it('算出该建哪几个 + 为什么没建 UNIVERSAL，且一个字节都没写', () => {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM collection`).get() as { n: number }
    const plan = planModelCollections(db)
    expect(plan.candidates.map((c) => c.name).sort()).toEqual(['Lime', 'Milfy', 'Shinano'])
    expect(plan.skipped).toEqual([{ value: 'UNIVERSAL', key: 'universal', why: 'generic' }])
    const after = db.prepare(`SELECT COUNT(*) AS n FROM collection`).get() as { n: number }
    expect(after.n).toBe(before.n)
  })

  it('已经建过的名字不再出现在候选里', () => {
    applyModelCollections(db, ['Shinano'])
    expect(planModelCollections(db).candidates.map((c) => c.name)).toEqual(['Lime', 'Milfy'])
  })
})

describe('写库', () => {
  it('建出来的集合带 keywords / matchMode / is_auto，规则能被 parseRule 读回', () => {
    const r = applyModelCollections(db, ['Shinano', 'Milfy'])
    expect(r.created).toHaveLength(2)
    expect(r.ignored).toEqual([])
    const row = listCollections(db).find((c) => c.name === 'Shinano')
    expect(row).toBeTruthy()
    expect(row?.is_auto).toBe(1)
    const rule = parseRule(row!) as CollectionRule
    expect(rule.matchMode).toBe('any')
    expect(rule.keywords).toEqual(expect.arrayContaining(['Shinano', 'shinano']))
  })

  it('只认刚才预览里出现过的名字（否则这条通道就是任意造数据的后门）', () => {
    const r = applyModelCollections(db, ['Shinano', '我瞎写的集合', 'UNIVERSAL'])
    expect(r.created.map((c) => c.name)).toEqual(['Shinano'])
    expect(r.ignored.sort()).toEqual(['UNIVERSAL', '我瞎写的集合'])
    expect(listCollections(db).some((c) => c.name === '我瞎写的集合')).toBe(false)
  })

  it('一个都没建成时不留 journal（撤销列表里不该出现空条目）', () => {
    const r = applyModelCollections(db, ['不存在的东西'])
    expect(r.journalId).toBe(-1)
    expect(listJournal(db, 10)).toHaveLength(0)
  })

  it('Ctrl+Z 找得到这次补建（op 必须在可撤销白名单里）', () => {
    applyModelCollections(db, ['Shinano'])
    const head = lastRevertible(db)
    expect(head?.op).toBe('collection_backfill')
  })
})

describe('撤销', () => {
  it('整批退回去：集合行删掉、journal 标 undone', async () => {
    applyModelCollections(db, ['Shinano', 'Milfy'])
    expect(listCollections(db)).toHaveLength(2)
    const out = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(out.ok).toBe(true)
    expect(listCollections(db)).toHaveLength(0)
    /** 撤销记录本身不能再被当成"待撤销的原操作"（否则 Ctrl+Z 会来回横跳） */
    expect(lastRevertible(db)).toBe(null)
  })

  it('只删本次新建的那几个，用户自己建的集合留着', async () => {
    db.prepare(`INSERT INTO collection (id, name, icon, sort_order, rule_json, is_auto, priority) VALUES (?, '我自己建的', NULL, 10, NULL, 0, 0)`).run(ulid())
    applyModelCollections(db, ['Shinano'])
    expect(listCollections(db)).toHaveLength(2)
    await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(listCollections(db).map((c) => c.name)).toEqual(['我自己建的'])
  })

  it('已经挂了素材的集合不删（那是用户建完之后的动作，不能被他自己的后续操作反噬）', async () => {
    const r = applyModelCollections(db, ['Shinano'])
    const asset = ulid()
    db.prepare(
      `INSERT INTO asset (id, name, raw_name, category, status, storage_mode, confidence, library_path)
       VALUES (?, 'x', 'x', 'texture', 'committed', 'indexed', 0.9, 'E:/vrc/A/x.zip')`
    ).run(asset)
    db.prepare(`INSERT INTO collection_asset (collection_id, asset_id, added_at) VALUES (?, ?, 1)`).run(r.created[0].id, asset)

    const out = await undoLast({ db, holdDir: path.join(root, 'hold') })
    expect(out.ok).toBe(true)
    expect(listCollections(db).map((c) => c.name)).toEqual(['Shinano'])
  })
})
