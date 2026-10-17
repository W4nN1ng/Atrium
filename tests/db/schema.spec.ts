import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { openDatabase, closeDatabase, collectStats, migrate, type Db } from '../../src/main/db'
import { SCHEMA_VERSION } from '../../src/main/db/schema'
import {
  makeAssetRow,
  upsertAsset,
  getAsset,
  patchAsset,
  findAssetByHash,
  queryCards,
  deleteAssetRow,
  listChildren,
  countChildren,
  isBundleRow
} from '../../src/main/db/repos/asset'
import {
  ensureGroup,
  addVariant,
  listVariants,
  detachAssetFromGroup,
  mergeIntoGroup,
  summarizeGroups
} from '../../src/main/db/repos/product'
import { ensureTag, setAssetTags, tagNamesOf, createCollection, addAssetsToCollection, setSearchAliases } from '../../src/main/db/repos/meta'
import { appendJournal, lastRevertible, markUndone, listJournal, recordCorrection, learningFor, countLearnedRules } from '../../src/main/db/repos/journal'
import { replacePackageEntries, packageEntriesOf, guidsOfAsset, findProviderOfGuid, dependencySummary, replaceDependencies } from '../../src/main/db/repos/unity'
import type { CategoryConfig } from '../../src/shared/types'

let dir: string
let db: Db

const cfg: CategoryConfig = {
  version: 1,
  categories: [
    {
      key: 'plugin',
      order: 10,
      label: { 'zh-CN': '插件', en: 'Plugins', ja: 'プラグイン' },
      subcategories: [
        { key: 'action', label: { 'zh-CN': '动作类', en: 'Action', ja: 'モーション' } }
      ]
    },
    {
      key: 'clothing',
      order: 20,
      label: { 'zh-CN': '服装', en: 'Clothing', ja: '衣装' },
      subcategories: [{ key: 'dress', label: { 'zh-CN': '连衣裙', en: 'Dress', ja: 'ワンピース' } }]
    }
  ]
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avca-db-'))
  db = openDatabase(path.join(dir, 'library.db'))
})

afterAll(() => {
  closeDatabase()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('schema', () => {
  it('建齐第 1 份 §5 的全部表', () => {
    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>
    )
      .map((r) => r.name)
      .filter((n) => !n.startsWith('sqlite_'))
    for (const t of [
      'asset',
      'asset_group',
      'bundle',
      'variant',
      'tag',
      'asset_tag',
      'collection',
      'collection_asset',
      'package_entry',
      'dependency',
      'project',
      'import_log',
      'journal',
      'learning',
      'password_vault',
      'setting',
      'search_alias'
    ]) {
      expect(names, `缺表 ${t}`).toContain(t)
    }
  })

  it('重复迁移是幂等的', () => {
    expect(migrate(db)).toBe(0)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)
  })

  it('WAL 已开启', () => {
    expect(String(db.pragma('journal_mode', { simple: true }))).toBe('wal')
  })
})

describe('asset 仓库', () => {
  it('插入 / 打补丁 / 按 hash 查重', () => {
    const row = makeAssetRow({
      name: 'GoLoco v1.8.6',
      raw_name: 'GoLoco.v.1.8.6u.unitypackage',
      category: 'plugin',
      subcategory: 'action',
      confidence: 0.91,
      status: 'archived',
      kind: 'unitypackage',
      hash_xxh64: 'deadbeef00000001',
      size_bytes: 1234
    })
    upsertAsset(db, row)
    expect(getAsset(db, row.id)?.name).toBe('GoLoco v1.8.6')
    expect(findAssetByHash(db, 'deadbeef00000001')?.id).toBe(row.id)
    const patched = patchAsset(db, row.id, { notes: '汉化来自月见汐音', confidence: 0.5 })
    expect(patched?.notes).toBe('汉化来自月见汐音')
    expect(patched?.confidence).toBe(0.5)
    expect(patched?.name).toBe('GoLoco v1.8.6')
  })

  it('upsert 同一 id 不产生第二行', () => {
    const row = makeAssetRow({ name: 'ABT', raw_name: 'ABT.unitypackage', category: 'plugin' })
    upsertAsset(db, row)
    upsertAsset(db, { ...row, name: 'ABT 1.3.0' })
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM asset WHERE id = ?`).get(row.id) as { n: number }).n
    expect(Number(n)).toBe(1)
    expect(getAsset(db, row.id)?.name).toBe('ABT 1.3.0')
  })
})

describe('归并（第 2 份 §3）', () => {
  it('11 个变体共享一个 group，卡片只出一张', () => {
    const g = ensureGroup(db, { groupKey: 'grimoir', name: 'Grimoir', category: 'clothing', subcategory: 'dress' })
    const avatars = ['AIRI', 'CHIFFON', 'KIKYO', 'MANUKA', 'MILLTINA', 'MOE', 'RURUNE', 'SELESTIA', 'SHINANO', 'SHINRA', 'SIO']
    const ids = avatars.map((a) => {
      const row = makeAssetRow({
        name: 'Grimoir',
        raw_name: `Grimoir_${a}_V1.0.zip`,
        category: 'clothing',
        subcategory: 'dress',
        group_id: g.id,
        status: 'archived'
      })
      upsertAsset(db, row)
      addVariant(db, { groupId: g.id, assetId: row.id, kind: 'avatar', value: a })
      return row.id
    })
    expect(ids).toHaveLength(11)
    expect(listVariants(db, g.id)).toHaveLength(11)

    const grouped = queryCards(db, { view: 'grouped' }, cfg, 'zh-CN')
    const card = grouped.cards.find((c) => c.groupId === g.id)
    expect(card).toBeTruthy()
    expect(card?.variantCount).toBe(11)
    expect(card?.categoryLabel).toBe('服装')
    expect(card?.subcategoryLabel).toBe('连衣裙')
    /**
     * R4 ⑤「变体分列」：卡片 SQL 一条相关子查询就把维度带出来了。
     * 断言的是**内容**（11 个 avatar 值全在），不是"字段存在" ——
     * 分隔符写错、`group_concat` 被 GROUP BY 拆成多行、值里带 `|` 被截断，
     * 这三种都会在这里红，而"有没有 dims 这个属性"那种断言全都测不出来。
     */
    expect(card?.dims).toEqual([{ kind: 'avatar', values: avatars }])

    const flat = queryCards(db, { view: 'flat', groupId: g.id }, cfg, 'zh-CN')
    expect(flat.cards).toHaveLength(11)
    expect(flat.total).toBe(11)
    /** 平铺视图里同一组的每张卡带的是**同一份组级 dims**（那一列答"这 11 份差在哪"） */
    expect(new Set(flat.cards.map((c) => JSON.stringify(c.dims))).size).toBe(1)
    expect(flat.cards[0].dims[0].values).toHaveLength(11)
  })

  it('没有组的单件素材 dims 是空数组，不是 null、也不是 ["undefined"]', () => {
    const solo = makeAssetRow({ name: 'Solo', raw_name: 'Solo.zip', category: 'texture' })
    upsertAsset(db, solo)
    const card = queryCards(db, { view: 'flat', search: 'Solo' }, cfg, 'zh-CN').cards.find((c) => c.id === solo.id)
    expect(card?.dims).toEqual([])
    expect(card?.variantCount).toBe(0)
  })

  it('addVariant 对同一 (group,kind,value) 幂等', () => {
    const g = ensureGroup(db, { groupKey: 'pcs', name: 'PCS', category: 'plugin' })
    const a = makeAssetRow({ name: 'PCS', raw_name: '(Modular) PCS v1.10.0.unitypackage', category: 'plugin', group_id: g.id })
    const b = makeAssetRow({ name: 'PCS', raw_name: '(VRCFury) PCS v1.10.0.unitypackage', category: 'plugin', group_id: g.id })
    upsertAsset(db, a)
    upsertAsset(db, b)
    addVariant(db, { groupId: g.id, assetId: a.id, kind: 'install_method', value: 'Modular' })
    addVariant(db, { groupId: g.id, assetId: a.id, kind: 'install_method', value: 'Modular' })
    addVariant(db, { groupId: g.id, assetId: b.id, kind: 'install_method', value: 'VRCFury' })
    expect(listVariants(db, g.id)).toHaveLength(2)
    mergeIntoGroup(db, g.id, [a.id, b.id], [
      { assetId: a.id, kind: 'version', value: '1.10.0' },
      { assetId: b.id, kind: 'version', value: '1.10.0' }
    ])
    // variant 表按 (group,kind,value) 唯一：两个包同为 1.10.0 时只记一条，
    // 这正是"11 个 avatar 变体 = 11 行、同一版本 = 1 行"的语义
    expect(listVariants(db, g.id).map((v) => v.variant_kind).sort()).toEqual([
      'install_method',
      'install_method',
      'version'
    ])
  })

  it('解散到只剩 1 个成员时自动拆组（F9 孤儿变体）', () => {
    const g = ensureGroup(db, { groupKey: 'solo', name: 'Solo', category: 'clothing' })
    const a = makeAssetRow({ name: 'Solo A', raw_name: 'a.zip', category: 'clothing', group_id: g.id })
    const b = makeAssetRow({ name: 'Solo B', raw_name: 'b.zip', category: 'clothing', group_id: g.id })
    upsertAsset(db, a)
    upsertAsset(db, b)
    addVariant(db, { groupId: g.id, assetId: a.id, kind: 'avatar', value: 'SHINANO' })
    addVariant(db, { groupId: g.id, assetId: b.id, kind: 'avatar', value: 'MANUKA' })
    // F9 语义：组内只剩 1 个成员就自动解散，所以摘掉第一个（还剩一个）时整组就散了
    expect(detachAssetFromGroup(db, a.id).dissolved).toBe(true)
    expect(getAsset(db, b.id)?.group_id).toBeNull()
    // 再摘第二个：它已经不属于任何组
    expect(detachAssetFromGroup(db, b.id).dissolved).toBe(false)
    expect(ensureGroup(db, { groupKey: 'solo', name: 'Solo', category: 'clothing' }).id).not.toBe(g.id)
    expect(summarizeGroups(db).find((x) => x.key === 'solo' && x.variantCount > 1)).toBeUndefined()
  })
})

describe('合集三级模型（改动单 §2.4）', () => {
  it('合集 = asset 自引用，统计与列表都不把子项当顶层素材', () => {
    const base = collectStats(db)
    const shop = makeAssetRow({
      name: '初音的VRC小店',
      raw_name: '插件道具合集-初音的VRC小店',
      category: 'plugin',
      is_bundle: 1,
      status: 'archived',
      size_bytes: 3000
    })
    upsertAsset(db, shop)
    const kids = ['GoLoco', 'SPS', '佳兔工具箱'].map((nm, i) =>
      makeAssetRow({
        name: nm,
        raw_name: `${nm}.unitypackage`,
        category: 'plugin',
        parent_asset_id: shop.id,
        status: 'archived',
        size_bytes: 1000
      })
    )
    for (const k of kids) upsertAsset(db, k)

    expect(countChildren(db, shop.id)).toBe(3)
    expect(listChildren(db, shop.id).map((r) => r.name)).toEqual(['GoLoco', 'SPS', '佳兔工具箱'])
    expect(isBundleRow(getAsset(db, shop.id))).toBe(true)

    const stats = collectStats(db)
    // 合集自己不算素材，子项也不算素材；另出 bundles / bundleItems
    expect(stats.bundles - base.bundles).toBe(1)
    expect(stats.bundleItems - base.bundleItems).toBe(3)
    expect(stats.assets).toBe(base.assets)
    // 体积按顶层算一次：合集那行已经是子项之和，不能再把子项加一遍
    expect(stats.totalBytes - base.totalBytes).toBe(3000)

    // 默认视图：合集出一张卡，子项绝不冒出来（这个库里还有别的测试素材，所以按包含关系断言）
    const top = queryCards(db, {}, cfg, 'zh-CN').cards
    const shopCard = top.find((c) => c.name === '初音的VRC小店')
    expect(shopCard).toBeTruthy()
    expect(shopCard?.isBundle).toBe(true)
    expect(shopCard?.childCount).toBe(3)
    for (const k of ['GoLoco', 'SPS', '佳兔工具箱']) expect(top.map((c) => c.name)).not.toContain(k)

    // 合集详情：按 parentId 取子项
    const inside = queryCards(db, { parentId: shop.id }, cfg, 'zh-CN').cards
    expect(inside.length).toBe(3)
    expect(inside[0].parentName).toBe('初音的VRC小店')

    // 搜索要能连子项一起捞到（scope:'all'），否则搜 GoLoco 搜不到
    const all = queryCards(db, { scope: 'all', search: 'GoLoco' }, cfg, 'zh-CN').cards
    expect(all.map((c) => c.name)).toContain('GoLoco')

    // 合集入口
    expect(queryCards(db, { bundlesOnly: true }, cfg, 'zh-CN').cards.length).toBe(1)
  })

  /**
   * 「待复核」功能于 2026-10-15 整体移除。这条用例守的是**它真的没了**：
   * 列、部分索引、统计字段、筛选参数四样一起消失，
   * 而且迁移之后**老库（V2~V8）也能正常升上来**、原来标了 needs_review 的行照旧读得出来。
   *
   * 为什么值得留一条这样的用例：删功能的常见失败方式是"界面没了、底层还在写"，
   * 或者反过来"列删了、还有代码在 SELECT 它"—— 后者会在用户真库上直接报错。
   */
  it('needs_review 已随「待复核」功能一起删除（列、索引、统计、筛选都不在了）', () => {
    const cols = (db.prepare('PRAGMA table_info(asset)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(cols).not.toContain('needs_review')

    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map((i) => i.name)
    expect(idx).not.toContain('idx_asset_review')

    // 统计里没有 review 这个字段了（多留一个恒为 0 的数只会误导）
    expect(Object.keys(collectStats(db))).not.toContain('review')

    // 老行照常可读、可写：低置信度那件仍能入库，只是不再被标记
    const low = makeAssetRow({ name: 'LowConf', raw_name: 'low.zip', category: 'prop', confidence: 0.3, status: 'classified' })
    upsertAsset(db, low)
    const back = getAsset(db, low.id)
    expect(back?.name).toBe('LowConf')
    expect(back?.confidence).toBe(0.3)
    // 列表不再有"只看待复核"这个档位，正常查询照样取得到
    expect(queryCards(db, { scope: 'all' }, cfg, 'zh-CN').cards.map((c) => c.name)).toContain('LowConf')
  })

  it('迁移动真库：V8 升到 V9 后 needs_review 那列传的数据不丢', () => {
    /**
     * 直接在一个**停在 V8** 的库上跑迁移，模拟用户的老库。
     * 这是本次删列唯一真正的风险点：`ALTER TABLE ... DROP COLUMN` 会重写整张表，
     * 要是写坏了，用户 400 多条素材就没了。
     *
     * ⚠ 这里用裸 `new Database()` + `migrate()`，**刻意不用 `openDatabase()`**：
     * 后者会把模块级单例 `current` 换成我这条临时库，于是本文件 `beforeEach` 建的那个
     * `db` 就再也没人关，`afterAll` 的 `rmSync` 直接 EPERM（第一版就是这么红的）。
     */
    const tmp = path.join(os.tmpdir(), `avca-v9-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(tmp, { recursive: true })
    const file = path.join(tmp, 'library.db')
    try {
      /**
       * 造一个**停在 V8** 的老库：先正常迁移到最新，再把 needs_review 列加回去、
       * 把 user_version 退回 8 —— 这样它和"用户从 0.5.0 升上来"的库形状一致。
       * 顺序不能反：列要先加回来，才能往里插带 needs_review 的行。
       */
      const raw = new Database(file)
      migrate(raw)
      raw.exec('ALTER TABLE asset ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0')
      const id = 'legacy-1'
      raw
        .prepare(
          `INSERT INTO asset (id, name, raw_name, category, confidence, status, storage_mode, needs_review, created_at, updated_at)
           VALUES (?, 'LegacyAsset', 'legacy.zip', 'prop', 0.4, 'classified', 'indexed', 1, ?, ?)`
        )
        .run(id, Date.now(), Date.now())
      raw.pragma('user_version = 8')
      raw.close()

      // 重新打开 → 迁移会自动把 V9 跑一遍
      const upgraded = new Database(file)
      const applied = migrate(upgraded)
      expect(applied, 'V9 应该真的跑了一次').toBe(1)
      const cols = (upgraded.prepare('PRAGMA table_info(asset)').all() as Array<{ name: string }>).map((c) => c.name)
      expect(cols).not.toContain('needs_review')
      expect(Number(upgraded.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)
      /** 关键：行还在、字段一个没丢 */
      const row = upgraded.prepare('SELECT name, category, confidence FROM asset WHERE id = ?').get(id) as
        | { name: string; category: string; confidence: number }
        | undefined
      expect(row).toEqual({ name: 'LegacyAsset', category: 'prop', confidence: 0.4 })
      upgraded.close()
    } finally {
      try {
        fs.rmSync(tmp, { recursive: true, force: true })
      } catch {
        /* Windows 偶尔还占着句柄 */
      }
    }
  })

  it('删合集连带删子项（开了 foreign_keys，反过来会抛约束错误）', () => {
    const b = makeAssetRow({ name: 'CascadeBundle', raw_name: 'cb', category: 'plugin', is_bundle: 1 })
    upsertAsset(db, b)
    const c = makeAssetRow({ name: 'Kid', raw_name: 'kid.zip', category: 'plugin', parent_asset_id: b.id })
    upsertAsset(db, c)
    deleteAssetRow(db, b.id)
    expect(getAsset(db, b.id)).toBeNull()
    expect(getAsset(db, c.id)).toBeNull()
  })

  it('老的 bundle 表不再被写（改动单 §7.2 不许平行表）', () => {
    const before = Number((db.prepare(`SELECT COUNT(*) AS n FROM bundle`).get() as { n: number }).n)
    const row = makeAssetRow({ name: 'StillFlat', raw_name: 'sf', category: 'plugin', is_bundle: 1 })
    upsertAsset(db, row)
    const after = Number((db.prepare(`SELECT COUNT(*) AS n FROM bundle`).get() as { n: number }).n)
    expect(after).toBe(before)
  })
})

describe('标签与集合', () => {
  it('ensureTag 幂等，标签集合可整组替换', () => {
    const row = makeAssetRow({ name: 'Tagged', raw_name: 't.zip', category: 'plugin' })
    upsertAsset(db, row)
    setAssetTags(db, row.id, ['动作', 'Shinano'], 'topic', 'auto')
    setAssetTags(db, row.id, ['动作'], 'topic', 'auto')
    expect(tagNamesOf(db, row.id).sort()).toEqual(['动作'])
    const first = ensureTag(db, '动作', 'topic')
    expect(ensureTag(db, '动作', 'topic').id).toBe(first.id)
  })

  it('集合可加素材并按集合过滤', () => {
    const c = createCollection(db, { name: 'Shinano', rule: { keywords: ['shinano'], matchMode: 'any', priority: 10 } })
    const row = makeAssetRow({ name: 'Shinano 贴图', raw_name: 'x.zip', category: 'clothing' })
    upsertAsset(db, row)
    expect(addAssetsToCollection(db, c.id, [row.id])).toBe(1)
    expect(queryCards(db, { collectionId: c.id }, cfg, 'zh-CN').cards.map((x) => x.id)).toContain(row.id)
    expect(queryCards(db, { collectionId: '不存在的集合' }, cfg, 'zh-CN').cards).toHaveLength(0)
  })

  it('检索别名可以当搜索命中（拼音/假名互搜的地基）', () => {
    const row = makeAssetRow({ name: '衣服套装', raw_name: 'yifu.zip', category: 'clothing' })
    upsertAsset(db, row)
    setSearchAliases(db, row.id, 'name', ['yifu', 'fukushou'])
    expect(queryCards(db, { search: 'yifu' }, cfg, 'zh-CN').cards.map((c) => c.id)).toContain(row.id)
  })
})

describe('unitypackage 清单与依赖', () => {
  it('写入后可按 GUID 反查提供方', () => {
    const a = makeAssetRow({ name: 'lilToon', raw_name: 'lilToon.unitypackage', category: 'plugin' })
    upsertAsset(db, a)
    replacePackageEntries(db, a.id, [
      { guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', unityPath: 'Assets/lilToon/Editor/lilToonShaderGUI.cs', entryKind: 'cs', size: 10, hasPreview: false },
      { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'.slice(0, 32), unityPath: 'Assets/lilToon/Base.shader', entryKind: 'shader', size: 20, hasPreview: true }
    ])
    expect(packageEntriesOf(db, a.id)).toHaveLength(2)
    expect(guidsOfAsset(db, a.id)).toHaveLength(2)
    expect(findProviderOfGuid(db, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')?.assetId).toBe(a.id)
    expect(findProviderOfGuid(db, '不存在')).toBeNull()

    replaceDependencies(db, a.id, [
      { asset_id: a.id, dep_guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', dep_kind: 'internal', resolved_by: null },
      { asset_id: a.id, dep_guid: 'cccccccccccccccccccccccccccccccc', dep_kind: 'external', resolved_by: a.id },
      { asset_id: a.id, dep_guid: 'dddddddddddddddddddddddddddddddd', dep_kind: 'external', resolved_by: null }
    ])
    expect(dependencySummary(db, a.id)).toEqual({ internal: 1, external: 2, resolved: 1, missing: ['dddddddddddddddddddddddddddddddd'] })
  })
})

describe('journal 与 learning', () => {
  it('journal 追加后可撤销一次，且撤销过的不再被捡起来', () => {
    const id = appendJournal(db, { op: 'mkdir', createdDirs: ['E:\\lib\\插件'], label: '创建目录' })
    expect(id).toBeGreaterThan(0)
    const found = lastRevertible(db)
    expect(found?.id).toBe(id)
    markUndone(db, id, null)
    expect(listJournal(db, 5).find((j) => j.id === id)?.undone).toBe(1)
    expect(lastRevertible(db)?.id).not.toBe(id)
  })

  it('journal payload 是 pending 的也能落库（事务性：先记账再操作）', () => {
    const id = appendJournal(db, { op: 'move', from: 'A', to: 'B' }, { status: 'pending' })
    expect(db.prepare(`SELECT status FROM journal WHERE id = ?`).get(id)).toEqual({ status: 'pending' })
  })

  it('修正分类会加权重、抑制旧分类，并可读回', () => {
    const before = countLearnedRules(db)
    const r = recordCorrection(db, {
      tokens: ['Grimoir', 'SHINANO'],
      newCategory: 'clothing',
      newSubcategory: 'dress',
      oldCategory: 'plugin',
      oldSubcategory: 'action'
    })
    expect(r.touched).toBe(2)
    expect(countLearnedRules(db)).toBeGreaterThan(before)
    const rows = learningFor(db, ['grimoir'])
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.find((x) => x.category === 'clothing')?.weight).toBe(1)
  })

  it('同一 token 修正三次算"已学会"', () => {
    for (let i = 0; i < 3; i++) {
      recordCorrection(db, { tokens: ['gogoloco'], newCategory: 'plugin', newSubcategory: 'action' })
    }
    const row = learningFor(db, ['gogoloco']).find((x) => x.category === 'plugin')
    expect(row?.hits).toBe(3)
    expect(row?.weight).toBeCloseTo(3)
  })
})

describe('删除素材行会带走关联数据', () => {
  it('不留孤儿', () => {
    const g = ensureGroup(db, { groupKey: 'todelete', name: 'Del', category: 'clothing' })
    const row = makeAssetRow({ name: 'Del', raw_name: 'del.zip', category: 'clothing', group_id: g.id })
    upsertAsset(db, row)
    addVariant(db, { groupId: g.id, assetId: row.id, kind: 'avatar', value: 'AIRI' })
    ensureTag(db, '待删', 'user')
    setAssetTags(db, row.id, ['待删'], 'user', 'user')
    replacePackageEntries(db, row.id, [{ guid: 'e'.repeat(32), unityPath: 'Assets/x.prefab', entryKind: 'prefab', size: 1, hasPreview: false }])
    deleteAssetRow(db, row.id)
    expect(getAsset(db, row.id)).toBeNull()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM variant WHERE asset_id = ?`).get(row.id)).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM asset_tag WHERE asset_id = ?`).get(row.id)).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM package_entry WHERE asset_id = ?`).get(row.id)).toEqual({ n: 0 })
  })
})
