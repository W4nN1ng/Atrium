import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { appendJournal, getJournal, journalPayload, lastRevertible, listBatch, markUndone } from '../db/repos/journal'
import { deleteAssetRow, upsertAsset } from '../db/repos/asset'
import type { AssetRow, JournalRow } from '../../shared/types'
import { SIDECAR_FILENAME } from '../../shared/constants'
import { ensureDir, moveToHold, moveTree, pathExists } from './fsx'
import { undoRearchive } from './rearchive'

/**
 * Ctrl+Z 的实现。撤销单位是"一次操作"：
 * 一次入库会留下 mkdir + move + extract 好几条 journal，它们共用 batch_id，
 * 回滚时按 id 倒序整批撤，不能只撤最后一步（那样会留下半个库目录）。
 */

export interface UndoDeps {
  db: Db
  /** 撤销过程中产生的"多余文件"挪到这里，不直接 rm */
  holdDir: string
}

export interface UndoOutcome {
  ok: boolean
  journalId?: number
  batchId?: string | null
  undone: number
  /** 界面文案走 key + 参数（第 1 份 F11）；message 只给日志和兜底 */
  messageKey?: string
  messageParams?: Record<string, string | number>
  message?: string
  error?: string
  /**
   * 这次撤销**真的删掉了**哪些素材记录。摄取层拿它把对应卡片退回收件箱。
   * 半途失败时是空数组 —— 那批库记录还在库里，不该同时出现在收件箱里。
   */
  assetIds: string[]
}

/** undoOne 的回报：note 进日志，kind/count 用来拼界面文案 */
type UndoStat = 'moved' | 'held' | 'gone' | 'dirs' | 'restored' | 'registered' | 'collections' | 'rearchived'
interface UndoStep {
  note: string
  kind: UndoStat
  count: number
}

/**
 * 撤销一步。返回值只用来拼文案 —— **计数由 `undoLast` 自己累加**，
 * 因为撤销的**顺序**有语义（见 `undoLast` 里 register 必须排最后），
 * 而且部分失败的路径上"先取返回值再累加"会漏掉已经做掉的那步。
 */
async function undoOne(deps: UndoDeps, row: JournalRow): Promise<UndoStep> {
  const db = deps.db
  const p = journalPayload(row)
  switch (row.op) {
    /**
     * R4 ③「改分类搬文件」：一次做完两半 —— 文件搬回去 + 库里路径改回去。
     * 顺序不能反：先改库再搬文件的话，中间崩了就留下"库指着新路径、文件还在旧位置"。
     */
    case 'rearchive': {
      const r = await undoRearchive(db, journalPayload(row), async (from, to) => {
        await moveTree(from, to)
      })
      return { note: `搬回并改回 ${r.rows} 行记录`, kind: 'rearchived', count: r.moved }
    }
    case 'move':
    case 'rename': {
      if (!p.from || !p.to) throw new Error('journal 记录不完整，无法安全撤销')
      if (!(await pathExists(p.to))) throw new Error(`撤销中止：${p.to} 已经不在这儿了，没敢乱动`)
      if (await pathExists(p.from)) throw new Error(`撤销中止：原位置 ${p.from} 已被别的东西占用，没敢覆盖`)
      await ensureDir(path.dirname(p.from))
      await moveTree(p.to, p.from)
      return { note: `搬回 ${path.basename(p.from)}`, kind: 'moved', count: 1 }
    }
    /**
     * 解压内容不"搬回 staging"。
     *
     * commit 时这条 journal 的 from 是暂存目录，而暂存目录是会被扫掉的临时物：
     * 撤销时它多半还在（里面还留着别的东西），于是"原位置已被占用"直接卡住整条撤销链 ——
     * 实测收编 10 件后按 Ctrl+Z，撤到第 8 批就停在那儿不动了。
     * 何况搬回去也没意义：那份内容属于这个素材，staging 迟早清空。
     * 所以按 copy 的规矩办：整个 _extracted 送进 hold（等于回收站），要回来能从 hold 拿。
     */
    case 'extract': {
      if (!p.to) throw new Error('journal 记录不完整，无法安全撤销')
      if (!(await pathExists(p.to))) return { note: '解压内容已经不在了', kind: 'gone', count: 0 }
      const held = await moveToHold(deps.holdDir, p.to)
      return { note: `解压内容已移出到 ${held}`, kind: 'held', count: 1 }
    }
    case 'copy': {
      if (!p.to) throw new Error('journal 记录不完整')
      if (!(await pathExists(p.to))) return { note: '副本已经不在了', kind: 'gone', count: 0 }
      const held = await moveToHold(deps.holdDir, p.to)
      return { note: `副本已移出到 ${held}`, kind: 'held', count: 1 }
    }
    case 'mkdir': {
      const dirs = (p.createdDirs?.length ? p.createdDirs : p.to ? [p.to] : []).slice().reverse()
      let removed = 0
      for (const d of dirs) {
        try {
          // 只删空目录：里面有东西就说明用户或我们还有数据在，绝不动
          const left = await fs.promises.readdir(d)
          if (left.some((n) => n !== SIDECAR_FILENAME)) continue
          if (left.some((n) => n === SIDECAR_FILENAME)) await fs.promises.rm(path.join(d, SIDECAR_FILENAME), { force: true })
          await fs.promises.rmdir(d)
          removed++
        } catch {
          /* 已被删或不在了 */
        }
      }
      return { note: `清掉 ${removed} 个空目录`, kind: 'dirs', count: removed }
    }
    case 'trash': {
      let back = 0
      for (const t of p.trashed ?? []) {
        if ((await pathExists(t.to)) && !(await pathExists(t.from))) {
          await ensureDir(path.dirname(t.from))
          await moveTree(t.to, t.from)
          back++
        }
      }
      return { note: `找回 ${back} 项`, kind: 'restored', count: back }
    }
    case 'reanalyze': {
      /**
       * 「重新分析」的撤销：只把当初改掉的那几列写回旧值，别的一律不碰。
       *
       * 为什么不"撤销时重算一遍"：撤销的时候规则可能又被改了，
       * 重算出来的东西和当初那次正向操作根本不是同一份 —— 必须用 journal 里存的旧值。
       * 另外这一条也承载 dropJunkRows 删掉的垃圾行，整行塞回去就行（磁盘本来就没动）。
       */
      const p2 = journalPayload(row)
      const changes = (p2.fieldChanges ?? []) as Array<{ id: string; from: Record<string, unknown> }>
      let n = 0
      db.transaction(() => {
        const restore = p2.restore as { row?: unknown } | undefined
        if (restore?.row) {
          upsertAsset(db, restore.row as AssetRow)
          n++
        }
        for (const c of changes) {
          const keys = Object.keys(c.from)
          if (!keys.length) continue
          const exists = db.prepare(`SELECT 1 AS x FROM asset WHERE id = ?`).get(c.id)
          if (!exists) continue
          db
            .prepare(`UPDATE asset SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
            .run(...keys.map((k) => c.from[k] ?? null), Date.now(), c.id)
          n++
        }
      })()
      return { note: `退回 ${n} 条`, kind: 'restored', count: 0 }
    }
    case 'reparent': {
      /**
       * 三级模型的改挂：从合集中拆出 / 解散合集 / 重新整理合集。
       * 纯库操作，一个文件都不碰，所以这里只把 parent_asset_id 挂回去。
       * 解散时删掉的那条合集行也一起复原（payload.restore 里存着原始行）。
       */
      const changes = (journalPayload(row).changes ?? []) as Array<{
        id: string
        from: string | null
        groupFrom?: string | null
        nameFrom?: string | null
      }>
      let n = 0
      db.transaction(() => {
        /**
         * 顺序不能反：解散合集时子项的"原父级"就是那条被删掉的合集行。
         * 先把合集塞回去再改挂，否则 UPDATE 指向一个还不存在的 id，
         * 开了 foreign_keys=ON 直接 FOREIGN KEY constraint failed（实测踩过）。
         */
        const restore = journalPayload(row).restore as { row?: unknown; dropped?: Array<{ row: unknown }> } | undefined
        if (restore?.row) {
          upsertAsset(db, restore.row as AssetRow)
          n++
        }
        /**
         * 解散容器时没有子项可挂的那些附属资源被删了行 —— 先塞回来，
         * 下面那圈 UPDATE 才有东西可改（不然 parent_asset_id 永远回不到原位）。
         */
        for (const d of restore?.dropped ?? []) {
          upsertAsset(db, d.row as AssetRow)
          n++
        }
        for (const c of changes) {
          /** 归并时顺手写进组、顺手改名的行也要一起退回去，否则撤销完留着个空组和错名字 */
          db.prepare(`UPDATE asset SET parent_asset_id = ?, group_id = ?, name = COALESCE(?, name), updated_at = ? WHERE id = ?`).run(
            c.from,
            c.groupFrom ?? null,
            c.nameFrom ?? null,
            Date.now(),
            c.id
          )
          n++
        }
      })()
      return { note: `改挂回 ${n} 条`, kind: 'restored', count: 0 }
    }
    case 'register': {
      /**
       * "只登记、没动盘"的批次（一键全部入库 / 合集 / 索引模式）。
       * 文件本来就不该被碰，所以这里什么都不做 —— 库记录由 undoLast 末尾按
       * payload.assetIds 统一删掉，撤销后收件箱那头的卡片由 ingest 层重新打开。
       */
      const ids = journalPayload(row).assetIds ?? []
      /**
       * `extra.groupIds` = 这次登记**新建的组**（#40 拆分归并组会建）。
       * 撤销时必须删掉它们，否则库里留一堆指向不了任何素材的空组。
       * 但**只在组确实空了才删** —— 这条记录所属的批次里可能还有别的动作
       * 把素材挂进了这个组，误删会让那些 asset.group_id 指向不存在的组。
       */
      const groupIds = (journalPayload(row).extra?.groupIds ?? []) as string[]
      let droppedGroups = 0
      for (const gid of groupIds) {
        const stay = db.prepare(`SELECT COUNT(*) AS n FROM asset WHERE group_id = ?`).get(gid) as { n: number }
        if (Number(stay.n) > 0) continue
        db.transaction(() => {
          db.prepare(`DELETE FROM variant WHERE group_id = ?`).run(gid)
          db.prepare(`DELETE FROM asset_group WHERE id = ?`).run(gid)
        })()
        droppedGroups++
      }
      const tail = droppedGroups ? `，清掉 ${droppedGroups} 个空组` : ''
      return { note: `撤销登记 ${ids.length} 条（文件未动）${tail}`, kind: 'registered', count: ids.length }
    }
    case 'collection_backfill': {
      /**
       * M6 ④：撤销"按库里出现过的模型补建集合"。
       *
       * ⚠ **只按 payload 里那份 id 清单删**，绝不按名字删 ——
       * 用户可能在这之后自己建了一个同名集合，或者给这几个集合挂了素材，
       * 按名字删会把不该动的删掉。挂了素材的集合也不删（那是用户自己的动作），
       * 只把它从"本次新建"里摘出来并在文案里说清楚。
       */
      const ids = journalPayload(row).collectionIds ?? []
      let dropped = 0
      let kept = 0
      for (const id of ids) {
        const linked = db.prepare(`SELECT COUNT(*) AS n FROM collection_asset WHERE collection_id = ?`).get(id) as { n: number }
        if (Number(linked.n) > 0) {
          kept++
          continue
        }
        db.transaction(() => {
          db.prepare(`DELETE FROM collection_asset WHERE collection_id = ?`).run(id)
          db.prepare(`DELETE FROM collection WHERE id = ?`).run(id)
        })()
        dropped++
      }
      const tail = kept ? `，${kept} 个已挂了素材的集合留着没动` : ''
      return { note: `撤销补建集合：删掉 ${dropped} 个${tail}`, kind: 'collections', count: dropped }
    }
    case 'import':
      throw new Error('导入撤销依赖 Unity 桥接，将在 M5 交付')
    default:
      throw new Error(`不支持撤销的操作类型：${row.op}`)
  }
}

export async function undoLast(deps: UndoDeps): Promise<UndoOutcome> {
  const db = deps.db
  const head = lastRevertible(db)
  if (!head)
    return {
      ok: false,
      undone: 0,
      assetIds: [],
      messageKey: 'toast.undoNone',
      message: '没有可撤销的操作'
    }

  const batchId = head.batch_id
  /**
   * 整批按 id 倒序撤（后来的先撤）。但 `register` 必须**留到最后** ——
   * 它只做记账清理（删本批新建、且**已经空了**的组），所以得等同一批里的
   * `reparent` 先把成员挂回原位、把新组腾空，它才删得掉。
   * 实测：#40 拆分那批是 reparent + register 共用一个 batch_id，
   * 倒序会让 register 先跑，那时新组还有成员 → 一个都删不掉，撤销后留一堆空组。
   */
  const rows = batchId
    ? [
        ...listBatch(db, batchId).filter((r) => r.undone === 0 && r.op !== 'register'),
        ...listBatch(db, batchId).filter((r) => r.undone === 0 && r.op === 'register')
      ]
    : [head]
  const notes: string[] = []
  const stats: Record<UndoStat, number> = {
    moved: 0,
    held: 0,
    gone: 0,
    dirs: 0,
    restored: 0,
    registered: 0,
    collections: 0,
    rearchived: 0
  }
  let undone = 0
  const touchedAssets = new Set<string>()

  for (const row of rows) {
    try {
      const step = await undoOne(deps, row)
      stats[step.kind] += step.count
      const what = step.note
      for (const id of journalPayload(row).assetIds ?? []) touchedAssets.add(id)
      const newId = appendJournal(
        db,
        { op: row.op, label: `撤销：${what}`, extra: { undoneJournalId: row.id } },
        /**
         * `batchId: null` 是**必须**的：撤销记录本身不能再算进那个批次里。
         * 否则下一次 `listBatch` 会把它当成一条"待撤销的原操作"，
         * 一次撤销就自我复制一批记录，Ctrl+Z 从此在这些记录之间来回横跳。
         * 它和原操作的从属关系已经由 `undo_of` 表达，不需要再借 batch_id。
         */
        { undoOf: row.id, batchId: null, isUndo: true }
      )
      markUndone(db, row.id, newId)
      notes.push(what)
      undone++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      markUndone(db, row.id, null, msg)
      notes.push(`失败：${msg}`)
      // 一步失败就停手：继续撤可能把状态搞得更乱
      return {
        ok: undone > 0,
        journalId: head.id,
        batchId,
        undone,
        // 半途停下时库记录没删（下面那个"整批撤完才删"的分支没走到），
        // 所以这里必须给空数组：给了 id 会让同一件东西同时出现在库和收件箱
        assetIds: [],
        error: msg,
        messageKey: 'toast.undoStopped',
        messageParams: { step: undone + 1, error: msg },
        message: `撤销在第 ${undone + 1} 步停下：${msg}`
      }
    }
  }

  /**
   * 「撤销 = 把库记录删掉」这条**只对新建记录的批次成立**（入库/收编那几类：
   * mkdir + move + extract + register，撤销后卡片该退回收件箱）。
   *
   * `rearchive`（R4 ③ 改分类搬文件）改的是**既有**记录：撤销之后素材还在库里，
   * 只是回到旧分类、旧路径。少了这个判断就是 —— 用户 Ctrl+Z 一次改分类，
   * 卡片连记录一起被删、还被 EV_UNDONE 退回收件箱，等于把归档状态弄丢。
   */
  const inPlace = rows.some((r) => r.op === 'rearchive')
  // 整批撤干净了才删库记录，否则界面会留一张指向已消失目录的幽灵卡片
  if (!inPlace && undone === rows.length && touchedAssets.size) {
    for (const id of touchedAssets) deleteAssetRow(db, id)
    notes.push(`移除 ${touchedAssets.size} 条库记录`)
  }
  return {
    ok: true,
    journalId: head.id,
    batchId,
    undone,
    /** 搬回去的那批用另一句文案：它没删任何记录，混在一起说就是撒谎 */
    messageKey: inPlace ? 'toast.undoRearchived' : 'toast.undoSteps',
    messageParams: inPlace
      ? { steps: undone, moved: stats.rearchived, assets: touchedAssets.size }
      : {
          steps: undone,
          moved: stats.moved + stats.restored,
          dirs: stats.dirs,
          assets: touchedAssets.size
        },
    assetIds: inPlace ? [] : Array.from(touchedAssets),
    message: `已撤销 ${undone} 步：${notes.join('；')}`
  }
}

/** "操作历史"面板用 */
export function recentOperations(db: Db, limit = 100): Array<{ id: number; op: string; label: string; undone: boolean; at: number }> {
  return (
    db.prepare(`SELECT * FROM journal ORDER BY id DESC LIMIT ?`).all(limit) as JournalRow[]
  ).map((r) => {
    let label: string = r.op
    try {
      const p = journalPayload(r)
      label = p.label ?? p.to ?? p.from ?? r.op
    } catch {
      /* payload 坏了就显示 op */
    }
    return { id: r.id, op: r.op, label, undone: r.undone === 1, at: r.created_at }
  })
}

export { getJournal }
