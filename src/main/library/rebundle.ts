/**
 * 「重新整理合集」（改动单 §5）—— 把上一版已经拆成顶层素材的东西重新吸附回合集。
 *
 * 用户已经跑过一次收编，库里躺着 343 个单元、其中 23 项是被旧逻辑拆开的合集碎片。
 * 让他重建整库是不可接受的：那 228 项的确认工作白做。所以这里做**纯库**的二次归并：
 *
 *   1. 只读扫描：找"物理上在同一个目录下、而那个目录看起来是个筐"的一组顶层素材
 *   2. 预览：左侧列出会被合并的组，右侧写「17 个素材 → 1 个合集」
 *   3. 执行：建合集行、把成员 parent_asset_id 指过去、按 §2.3 重算版本归并
 *   4. **一个文件都不搬**；整个过程写 journal，可撤销
 *
 * 误判的代价：把一件衣服的 Mesh/Textures 当成"两个素材在同一目录"合并成合集。
 * 所以有两条硬护栏 —— 分类/二级目录名所在的目录一律跳过，且成员必须都是已登记的顶层素材。
 */
import path from 'node:path'
import type { Db } from '../db'
import { getAsset, listChildren, upsertAsset } from '../db/repos/asset'
import { addVariant, ensureGroup } from '../db/repos/product'
import { appendJournal } from '../db/repos/journal'
import { looksLikeBundleDir } from '../classify/bundle'
import { dirKeyOf } from '../../shared/pathkey'
import { deriveGroupKey } from '../classify/groupKey'
import type { Lexicon } from '../classify/lexicon'
import { compareVersionDesc } from '../../shared/version'
import { ulid } from '../../shared/ulid'
import type { AssetRow, CategoryConfig } from '../../shared/types'

export interface RebundleItem {
  name: string
  groupKey: string
  /** 这个子项吸收的成员（≥2 个就是版本） */
  assetIds: string[]
  /** 挂在最前面那条 = 子项本体，其余是它的版本行 */
  primaryId: string
}

export interface RebundleGroup {
  /** 成员共同所在的目录 */
  dir: string
  bundleName: string
  assetIds: string[]
  items: RebundleItem[]
  from: number
  to: number
  /** 为什么算合集（界面要写清楚，别让用户猜） */
  why: string
}

/** 素材实际在磁盘上的位置：归档过的用 library_path，收编登记的用 source_path */
function physicalOf(row: AssetRow): string | null {
  return row.library_path ?? row.source_path ?? null
}

/**
 * 这些目录名是**库的结构**，不是合集。
 * 不排掉的话 `贴图/皮肤/` 下面四件素材会被合并成"皮肤合集" —— 那是把分类当筐。
 */
function structureNames(cfg: CategoryConfig): Set<string> {
  const out = new Set<string>()
  for (const c of cfg.categories) {
    for (const loc of Object.keys(c.label)) out.add(String(c.label[loc as keyof typeof c.label]).toLowerCase())
    out.add(c.key.toLowerCase())
    for (const s of c.subcategories) {
      for (const loc of Object.keys(s.label)) out.add(String(s.label[loc as keyof typeof s.label]).toLowerCase())
      out.add(s.key.toLowerCase())
    }
  }
  return out
}

function dirOf(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return i > 1 ? norm.slice(0, i) : norm
}

/**
 * 只读扫描。不改任何东西 —— 预览界面要能反复刷。
 */
export function scanRebundle(
  db: Db,
  cfg: CategoryConfig,
  lex: Lexicon,
  libraryRoot: string | null
): RebundleGroup[] {
  const rows = db
    .prepare(`SELECT * FROM asset WHERE parent_asset_id IS NULL AND is_bundle = 0 ORDER BY name`)
    .all() as AssetRow[]
  if (rows.length < 2) return []

  const structure = structureNames(cfg)
  const root = libraryRoot ? path.resolve(libraryRoot).toLowerCase() : null
  const byDir = new Map<string, AssetRow[]>()
  for (const r of rows) {
    const phys = physicalOf(r)
    if (!phys) continue
    const dir = dirOf(phys)
    if (root && dir.toLowerCase() === root) continue
    const base = dirOf(dir) === dir ? dir : path.basename(dir)
    if (structure.has(base.toLowerCase())) continue
    const list = byDir.get(dir) ?? []
    list.push(r)
    byDir.set(dir, list)
  }

  const groups: RebundleGroup[] = []
  for (const [dir, members] of byDir) {
    if (members.length < 2) continue
    const dirName = path.basename(dir)
    if (!looksLikeBundleDir(dirName, members.length)) continue

    /** §2.3 版本归并：同一归并键的成员合成一个子项，最新的版本当本体 */
    const byKey = new Map<string, AssetRow[]>()
    for (const m of members) {
      const key = deriveGroupKey(m.raw_name || m.name, lex).groupKey
      const list = byKey.get(key) ?? []
      list.push(m)
      byKey.set(key, list)
    }
    const items: RebundleItem[] = []
    for (const [key, list] of byKey) {
      const sorted = [...list].sort((a, b) => {
        const t = compareVersionDesc(a.version, b.version)
        return t !== 0 ? t : String(a.name).localeCompare(String(b.name))
      })
      const first = sorted[0]
      /**
       * 并了版本之后名字要回到共同核心词：11 个 `Grimoir_AIRI_V1.0` 合成一项后
       * 该叫 `Grimoir`，不能留着第一个成员的名字（实测显示成 "Grimoir AIRI"）。
       * 只有一件东西时反过来 —— 保留磁盘上的原名，用户按名字找文件才对得上。
       */
      const core = deriveGroupKey(first.raw_name || first.name, lex).core.join(' ').trim()
      items.push({
        name: sorted.length > 1 && core ? core : first.name,
        groupKey: key,
        assetIds: sorted.map((r) => r.id),
        primaryId: first.id
      })
    }
    // 只有一个子项、又没有版本差异 → 本来就是一件素材，没什么可整理的
    if (items.length === 1 && items[0].assetIds.length === 1) continue
    groups.push({
      dir,
      bundleName: path.basename(dir),
      assetIds: members.map((m) => m.id),
      items,
      from: members.length,
      to: items.length,
      why: items.some((i) => i.assetIds.length > 1)
        ? 'same-dir-and-versions'
        : 'same-dir-container'
    })
  }
  return groups.sort((a, b) => b.from - a.from)
}

export interface RebundleResult {
  bundles: number
  moved: number
  versions: number
  batchId: string
}

/**
 * 执行归并。**只写库 + journal，不碰文件系统。**
 *
 * 撤销设计：一条 'reparent' 记下每个被改挂的行原来的 parent_asset_id 和 group_id，
 * 一条 'register' 记下这次新建的合集行 —— 撤销时先把成员挂回原位，再删掉新建的合集。
 */
export function applyRebundle(
  db: Db,
  groups: RebundleGroup[],
  opts: { categoryOf: (rows: AssetRow[]) => { category: string; subcategory: string | null } }
): RebundleResult {
  const changes: Array<{
    id: string
    from: string | null
    to: string | null
    groupFrom: string | null
    nameFrom?: string | null
  }> = []
  const createdBundles: string[] = []
  let versions = 0
  const batchId = ulid()

  db.transaction(() => {
    for (const g of groups) {
      const members = g.assetIds.map((id) => getAsset(db, id)).filter((r): r is AssetRow => !!r)
      if (members.length < 2) continue
      const now = Date.now()
      const cat = opts.categoryOf(members)
      const bundleId = ulid()
      const bytes = members.reduce((a, m) => a + (m.size_bytes ?? 0), 0)
      const worst = members.reduce((m, r) => Math.min(m, r.confidence), 1)
      upsertAsset(
        db,
        {
          ...members[0],
          id: bundleId,
          name: g.bundleName,
          raw_name: g.bundleName,
          category: cat.category,
          subcategory: cat.subcategory,
          confidence: worst,
          status: 'classified',
          content_type: 'bundle',
          library_path: g.dir,
          source_path: null,
          storage_mode: 'indexed',
          size_bytes: bytes,
          hash_xxh64: null,
          group_id: null,
          bundle_id: null,
          parent_asset_id: null,
          is_bundle: 1,
          notes: '重新整理合集生成',
          created_at: now,
          updated_at: now
        }
      )
      createdBundles.push(bundleId)

      for (const it of g.items) {
        const primary = getAsset(db, it.primaryId)
        if (!primary) continue
        changes.push({ id: primary.id, from: primary.parent_asset_id, to: bundleId, groupFrom: primary.group_id, nameFrom: primary.name })
        db.prepare(`UPDATE asset SET parent_asset_id = ?, name = ?, updated_at = ? WHERE id = ?`).run(
          bundleId,
          it.name,
          Date.now(),
          primary.id
        )
        if (it.assetIds.length > 1) {
          const group = ensureGroup(db, {
            groupKey: it.groupKey,
            name: primary.name,
            category: primary.category,
            subcategory: primary.subcategory,
            /** #40：吸附出来的版本组也只认"和主体同一个目录"，不跨目录吃新成员 */
            dirKey: dirKeyOf(primary.library_path ?? primary.source_path)
          })
          for (const vid of it.assetIds.filter((x) => x !== primary.id)) {
            const v = getAsset(db, vid)
            if (!v) continue
            changes.push({ id: vid, from: v.parent_asset_id, to: primary.id, groupFrom: v.group_id })
            db
              .prepare(`UPDATE asset SET parent_asset_id = ?, group_id = ?, updated_at = ? WHERE id = ?`)
              .run(primary.id, group.id, Date.now(), vid)
            addVariant(db, { groupId: group.id, assetId: vid, kind: 'version', value: v.version ?? v.raw_name })
            versions++
          }
          addVariant(db, { groupId: group.id, assetId: primary.id, kind: 'version', value: primary.version ?? primary.raw_name })
        }
      }
    }

    if (!changes.length) return
    appendJournal(
      db,
      { op: 'reparent', changes, label: `重新整理合集：${groups.length} 组 / ${changes.length} 项改挂` },
      { batchId }
    )
    appendJournal(
      db,
      { op: 'register', assetIds: createdBundles, label: `新建 ${createdBundles.length} 个合集记录` },
      { batchId }
    )
  })()

  return { bundles: createdBundles.length, moved: changes.length, versions, batchId }
}

/** 撤销之后顺手把这些行确认一下（合集被删了但子项还挂着就是脏数据） */
export function orphanUnder(db: Db, bundleId: string): string[] {
  return listChildren(db, bundleId).map((r) => r.id)
}
