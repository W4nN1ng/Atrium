/**
 * #40 存量清理：把**跨目录误并**的归并组按目录拆开。
 *
 * 背景（用户裁定原文）：
 *   「归并的前提是**同一父容器（同目录）**，跨目录的 groupKey 相同不构成归并理由。」
 *
 * V4 迁移（`asset_group.dir_key`）只保证**以后**不再跨目录吸附新成员，
 * 但迁移本身明确把存量跨目录组留成 `dir_key = NULL`，注释写着「拆开的动作留给健康检查」。
 * 这个文件就是那个动作。真库实测 13 组 / 27 行。
 *
 * ⚠ 但**不是所有跨目录组都该拆**。真库实测这 13 组分成两种性质：
 *
 *   甲、真误并（8 组）—— 两侧是**不同产品**：
 *        `贴图/脸部/4900077` vs `贴图/lime/4900077`（两个毫不相干的商品，名字都是 Booth id）
 *        lilToon 1.x 与 2.x 各自的 6 个附属资源（`parent=yes`，分属两个容器）
 *        `衣服/名流/材质包 psd/PSD`（324 MB 的 PSD.zip）vs `衣服/衣服twinklespica/PSD`（619 MB 的 PSD.zip）
 *
 *   乙、同一产品的两个形态（5 组）—— 两侧**同名同标签**，磁盘上一边是 zip、一边是已解压目录：
 *        `贴图/皮肤/Sexy skin material for VRC 6053463/Sexy skin material for VRC 6053463.rar`（98 MB）
 *        `贴图/6718483Milfy妆容/Sexy skin material for VRC 6053463/`（已解压）
 *
 * 乙类必须**保持归并** —— 那是裁定 #16「同名 zip 与已解压目录 = 同一素材的两个形态，
 * 归并成一张卡」。机械按目录拆会把它们变成重复卡，与裁定相反。
 * 判定见 `sameProductTwoForms()`：同名 + 同分类 + 同 avatar 标签集 = 同一个产品，
 * 只是躺在两个货架上（zip 在库目录、已解压副本在收编来的原目录）。
 *
 * 本模块**只写库、一个文件都不碰**，全程一个 journal 批次，Ctrl+Z 可整批撤销。
 */
import type { Db } from '../db'
import { getAsset } from '../db/repos/asset'
import { appendJournal } from '../db/repos/journal'
import { addVariant, listGroups } from '../db/repos/product'
import { dirKeyOf } from '../../shared/pathkey'
import { ulid } from '../../shared/ulid'
import type { AssetGroupRow, AssetRow } from '../../shared/types'

/** 拆开后的一组（同一个目录里的那些成员） */
export interface RegroupCluster {
  dirKey: string | null
  assetIds: string[]
  names: string[]
}

export interface RegroupGroup {
  groupId: string
  groupKey: string
  groupName: string
  category: string
  /** 拆之前组内所有成员，只读预览要显示"N 个变体 → 分到 M 个目录" */
  before: string[]
  clusters: RegroupCluster[]
  /** 为什么判定它跨目录（给人看的） */
  dirs: string[]
}

export interface RegroupPlan {
  /** 扫描了多少个组 */
  scanned: number
  /** 会被拆的组 */
  groups: RegroupGroup[]
  /** 保持归并的组（同产品两形态），只是告知用户"这些看过，故意没动" */
  kept: Array<{ groupKey: string; groupName: string; dirs: string[]; reason: 'same_product_two_forms' }>
  /** 会影响的素材行数 */
  affected: number
}

/** 每条素材的目录键：归档过的看 library_path，收编登记的看 source_path */
function dirOf(r: AssetRow): string | null {
  return dirKeyOf(r.library_path ?? r.source_path ?? null)
}

const ARCHIVE_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i

function baseName(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

function dirOfPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

/**
 * 这一组是不是「同一个产品的两个形态」—— **必须保持归并**（裁定 #16）。
 *
 * ⚠ 这条判据是照真库实测形状反推的（`tools/probe-40-forms.cjs`），
 * **只看 `library_path` 会判错** —— 真库里"一体两形态"的归档侧是这样存的：
 *
 *   库内（解压结果，带归档标记）:
 *     library_path = E:\vrc\A\贴图\皮肤\Sexy skin material for VRC 6053463    ← 就是个**目录**
 *     source_path  = E:\vrc\A\贴图\皮肤\Sexy skin material for VRC 6053463\Sexy skin material for VRC 6053463.rar
 *   库外收编（原目录）:
 *     library_path = E:\vrc\A\贴图\6718483Milfy妆容\Sexy skin material for VRC 6053463
 *
 * 所以压缩包名只在 `source_path` 里。**决定性的结构信号**是：
 *   有一行（那个同名目录）的路径**正好以"压缩包的 basename 去掉扩展名"结尾**，
 *   也就是"压缩包与它的解压目录同名"。
 *
 * 反过来，真误并长这样：
 *   #4 `4900077` —— 压缩包叫 `4900077.zip`，但另一行是 `…\贴图\lime\4900077`，
 *     末段虽是 `4900077` 却挂在 `lime\` 底下，和压缩包所在目录对不上 → 拆
 *   #6 `PSD`    —— 压缩包 `…\材质包 PSD\PSD.zip` 与目录 `…\材质包 PSD\PSD`
 *     是**同一个目录里的并存对**，那目录正是它自己的解压产物 → 拆
 */
function sameProductTwoForms(rows: AssetRow[]): boolean {
  const norm = (s: string | null | undefined): string =>
    String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

  const first = rows[0]
  const key = norm(first.name)
  if (!key) return false
  for (const r of rows) {
    if (norm(r.name) !== key) return false
    if (r.category !== first.category) return false
    if ((r.subcategory ?? null) !== (first.subcategory ?? null)) return false
    if ((r.content_type ?? null) !== (first.content_type ?? null)) return false
  }

  /** 每行可能有两个路径字段，两个都要看 */
  const votesOf = (r: AssetRow): Array<{ path: string; hasArchiveExt: boolean; stripped: string; dir: string }> =>
    [r.library_path, r.source_path]
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .map((p) => {
        const base = baseName(p)
        const hasExt = ARCHIVE_EXT.test(base)
        return {
          path: p,
          hasArchiveExt: hasExt,
          stripped: hasExt ? base.replace(ARCHIVE_EXT, '') : base,
          dir: dirOfPath(p)
        }
      })

  const all = rows.map(votesOf)

  /** 必须恰好有一个压缩包本体（带压缩扩展名） */
  const archives = all.flat().filter((v) => v.hasArchiveExt)
  if (archives.length !== 1) return false
  const arc = archives[0]

  /** 否决：压缩包与同名目录在**同一个目录**里并存 —— 那是它自己的解压目录（#6 PSD） */
  for (const votes of all) {
    for (const v of votes) {
      if (v.hasArchiveExt) continue
      if (v.stripped.toLowerCase() !== arc.stripped.toLowerCase()) continue
      if (v.dir.toLowerCase() === arc.dir.toLowerCase()) return false
      /** 正向：某行就是"压缩包的同名解压目录" → 一体两形态 */
      return true
    }
  }
  return false
}

/**
 * 只读扫描。反复刷不改任何东西 —— 界面可以先给用户看"会影响多少条"。
 */
export function planRegroup(db: Db): RegroupPlan {
  const groups = listGroups(db)
  const out: RegroupGroup[] = []
  const kept: RegroupPlan['kept'] = []
  let affected = 0

  for (const g of groups as AssetGroupRow[]) {
    const members = db
      .prepare(`SELECT * FROM asset WHERE group_id = ?`)
      .all(g.id) as AssetRow[]
    // 只有一条的不叫"归并"，没什么可拆
    if (members.length < 2) continue

    /** 按目录分簇。dirKey 为 NULL 的归一堆 —— 它们确实没有目录信息可比 */
    const byDir = new Map<string, AssetRow[]>()
    for (const m of members) {
      const d = dirOf(m)
      const k = d ?? '\u0000null'
      const list = byDir.get(k)
      if (list) list.push(m)
      else byDir.set(k, [m])
    }
    if (byDir.size < 2) continue

    const dirs = [...byDir.keys()].map((k) => (k === '\u0000null' ? '(无目录)' : k))

    /**
     * 乙类：同名同分类 —— 是「同一产品的 zip 与已解压副本」被目录隔开，
     * 按裁定 #16 必须**保持归并**，这里只登记"看过、故意没动"。
     */
    if (sameProductTwoForms(members)) {
      kept.push({ groupKey: g.group_key, groupName: g.name, dirs, reason: 'same_product_two_forms' })
      continue
    }

    const clusters: RegroupCluster[] = [...byDir.entries()].map(([k, ms]) => ({
      dirKey: k === '\u0000null' ? null : k,
      assetIds: ms.map((m) => m.id),
      names: ms.map((m) => m.name)
    }))
    out.push({
      groupId: g.id,
      groupKey: g.group_key,
      groupName: g.name,
      category: g.category,
      before: members.map((m) => m.name),
      clusters,
      dirs
    })
    affected += members.length
  }

  return { scanned: groups.length, groups: out, kept, affected }
}

export interface RegroupResult {
  groups: number
  moved: number
  createdGroups: number
  batchId: string
}

/** journal 里 reparent 的 changes 元素形状（和 rebundle 共用一种记录，撤销端已经认它） */
interface ReparentChange {
  id: string
  from: string | null
  to: string | null
  groupFrom: string | null
}

/**
 * 执行拆分。**只写库 + journal，不碰文件系统。**
 *
 * 撤销设计与 `applyRebundle` 同源：一条 `reparent` 记下每行的原 `group_id`，
 * 撤销端 `undo.ts` 的 `reparent` 分支会把 `group_id` 挂回去。
 *
 * 两个刻意的取舍：
 *  1. **payload 绝不带 `assetIds`** —— `undoLast` 会把 `assetIds` 里的资产**删掉**，
 *     带上它等于"一撤销素材就没了"。这里只放 `changes`。
 *  2. **拆空的旧组行不删** —— 撤销就不用复活它，而空组在 UI 上是不可见的
 *     （`summarizeGroups` 给它 variantCount=0，界面按 `variantCount===1` 判单成员）。
 *     删行省不了什么，却会引入"foreign_keys=ON 下先挂回还是先插回"的顺序坑。
 *
 * 组内 **variant 行按新簇重建**：原 variant 行的 `variant_value` 属于整个旧组，
 * 但变体是挂在具体 asset 上的，所以按每行的 `asset_tag` / `version` / `locale_tag`
 * 重算到各自的新组里，不丢信息、也不跨簇串味。
 */
export function applyRegroup(db: Db, plan: RegroupPlan): RegroupResult {
  const changes: ReparentChange[] = []
  const createdGroups: string[] = []
  const batchId = ulid()

  db.transaction(() => {
    const now = Date.now()
    for (const g of plan.groups) {
      const old = db.prepare(`SELECT * FROM asset_group WHERE id = ?`).get(g.groupId) as
        | AssetGroupRow
        | undefined
      if (!old) continue

      for (const c of g.clusters) {
        /**
         * 单成员簇也建组：不建的话这行就是"不在任何组里"，
         * 而它本来就是某个组的成员，撤销时 `groupFrom` 也对不上。
         * `ensureGroup` 的口径（同 key + 同分类 + 同 dir_key）正好保证
         * 重跑本操作是幂等的 —— 第二次跑会复用第一次建的组。
         */
        /**
         * 三项口径要分清（同 `ensureGroup`）：dirKey 是字符串就比字符串，
         * 是 null 就得用 `IS NULL` —— SQL 里 `= NULL` 永远不成立。
         */
        const existing = (
          c.dirKey === null
            ? db
                .prepare(`SELECT * FROM asset_group WHERE group_key = ? AND category = ? AND dir_key IS NULL`)
                .get(g.groupKey, g.category)
            : db
                .prepare(`SELECT * FROM asset_group WHERE group_key = ? AND category = ? AND dir_key = ?`)
                .get(g.groupKey, g.category, c.dirKey)
        ) as AssetGroupRow | undefined
        let gid = existing?.id
        if (!gid) {
          gid = ulid()
          db.prepare(
            `INSERT INTO asset_group (id, group_key, name, category, subcategory, created_at, updated_at, dir_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(gid, g.groupKey, old.name, g.category, old.subcategory, now, now, c.dirKey)
          createdGroups.push(gid)
        }

        for (const id of c.assetIds) {
          const row = getAsset(db, id)
          if (!row) continue
          changes.push({ id, from: row.parent_asset_id, to: row.parent_asset_id, groupFrom: row.group_id })
          db.prepare(`UPDATE asset SET group_id = ?, updated_at = ? WHERE id = ?`).run(gid, now, id)
        }

        /** variant 按新簇重建：先清掉这一簇成员在旧组上的行，再按各行的标签写进新组 */
        const ids = c.assetIds
        if (ids.length) {
          const ph = ids.map(() => '?').join(', ')
          db.prepare(`DELETE FROM variant WHERE asset_id IN (${ph})`).run(...ids)
          for (const id of ids) {
            const row = getAsset(db, id)
            if (!row) continue
            const tagRows = db
              .prepare(
                `SELECT t.kind AS kind, t.name AS value FROM asset_tag at
                   JOIN tag t ON t.id = at.tag_id
                  WHERE at.asset_id = ? AND t.kind = 'avatar'`
              )
              .all(id) as Array<{ kind: string; value: string }>
            /**
             * 大小写不同写法要当成同一个模型（和 classify 的 pushAvatar 同一条规则）：
             * 老库里一张卡可能同时挂着 `SHINANO` 与 `Shinano` 两个标签，那是 2 条而不是 1 个模型，
             * 下面的 `length === 1` 闸门一挡，重新归并之后就永远补不出 avatar 变体。
             */
            const seenAvatar = new Set<string>()
            const avatars: string[] = []
            for (const t of tagRows) {
              const k = t.value.toLowerCase()
              if (seenAvatar.has(k)) continue
              seenAvatar.add(k)
              avatars.push(t.value)
            }
            /**
             * `addVariant` 自带"已存在就返回、不重复插"的保护 —— 必须用它而不是自己 INSERT：
             * `variant` 上有 `UNIQUE(group_id, variant_kind, variant_value)`（**不含 asset_id**），
             * 同簇两个成员都算出 `avatar=UNIVERSAL` 时自己插会直接撞约束并炸掉整个事务。
             */
            if (avatars.length === 1) addVariant(db, { groupId: gid, assetId: id, kind: 'avatar', value: avatars[0] })
            if (avatars.length === 0) addVariant(db, { groupId: gid, assetId: id, kind: 'avatar', value: 'UNIVERSAL' })
            if (row.version) addVariant(db, { groupId: gid, assetId: id, kind: 'version', value: row.version })
            if (row.locale_tag) addVariant(db, { groupId: gid, assetId: id, kind: 'locale', value: row.locale_tag })
          }
        }
        db.prepare(`UPDATE asset_group SET updated_at = ? WHERE id = ?`).run(now, gid)
      }
    }

    if (!changes.length) return
    appendJournal(
      db,
      {
        op: 'reparent',
        changes,
        label: `按目录拆开误并的归并组：${plan.groups.length} 组 / ${changes.length} 行`
      },
      { batchId }
    )
    /**
     * 只记"新建了哪些组"，**不带 assetIds**（会被 undoLast 当成"待删除的素材"）。
     * `register` 的撤销分支什么都不做，组就留在库里 —— 正是我们要的：
     * 撤销把 group_id 挂回旧组之后，这些新组空了，UI 看不见。
     */
    appendJournal(
      db,
      { op: 'register', label: `拆分归并组新建 ${createdGroups.length} 个组记录`, extra: { groupIds: createdGroups } },
      { batchId }
    )
  })()

  return { groups: plan.groups.length, moved: changes.length, createdGroups: createdGroups.length, batchId }
}
