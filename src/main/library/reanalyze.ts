/**
 * 「重新分析」（增量改动单 2 §交付 4）。
 *
 * 交付要求原话：**说明这次改动是否需要重跑已入库数据的分类；如果需要，提供「重新分析」操作
 * （只读重算，不移动磁盘）。**
 *
 * 需要重跑吗？需要，但不是全部：
 *  - **名字 / 版本号 / 变体槽位原文** —— 需要。§A3/§A4/§B2 改的就是这三样，
 *    老行是按旧规则算出来的（`d6b99874-… base resized`、`佳兔工具箱.0版本`、
 *    被 UUID 咬出来的 `99874-3687-4746-8e`），不重算就永远挂着旧名字。
 *  - **附属资源识别** —— 需要，但它不在这里做：老行里没有 attachment_kind 的行，
 *    那些介绍图当年是被当成独立素材登记的。要正确拆出来必须**重新扫一遍目录**
 *    （splitContainer 要读文件清单），而"重新扫目录 + 登记"正是收件箱那条路，
 *    在新版本里已经修好了。这里硬去补会绕开收件箱的预览/撤销流程，风险更大。
 *  - **垃圾行**（.DS_Store 之类当年被当成素材登记的）—— 需要清。这里只**列出来**，
 *    删不删由界面那个单独的勾选决定，不在"重算名字"里顺手删用户的数据。
 *  - **分类（category/subcategory）** —— 不重算。用户手改过的分类是资产，
 *    规则一改就把人家调过的分类覆盖掉，是不可接受的（改动单 1 §7.4 的精神）。
 *    要重跑分类请用「重新整理合集」+ 收件箱重新登记。
 *
 * 全程只 UPDATE 库里的列，一个文件都不碰。写 journal，Ctrl+Z 整批退回。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import { appendJournal } from '../db/repos/journal'
import { deriveGroupKey } from '../classify/groupKey'
import { splitContainer } from '../fingerprint/primary'
import type { Lexicon } from '../classify/lexicon'
import { cleanDisplayName, isMeaninglessName, nameIsGarbage as sharedNameIsGarbage, pickMeaningfulName } from '../../shared/naming'
import { isJunkSegment, isJunkRelPath } from '../../shared/junk'
import { ulid } from '../../shared/ulid'
import type { AssetRow } from '../../shared/types'

/** 一行里被重算出来的差异；from 存旧值，撤销时按列写回去 */
export interface ReanalyzeChange {
  id: string
  name: string
  rawName: string
  from: Record<string, unknown>
  to: Record<string, unknown>
  /** 变了哪几列，界面分类汇总用 */
  fields: string[]
}

export interface ReanalyzePlan {
  scanned: number
  changes: ReanalyzeChange[]
  /** 附属资源降级：这些行要从顶层素材改成挂在 host 下面的附属行（§A2） */
  demote: Array<{ id: string; hostId: string; kind: string; name: string }>
  /** 现在的新规则认定这些行本不该存在（垃圾文件当年被当成素材登记了） */
  junk: Array<{ id: string; name: string; path: string | null }>
  /** 名字里还挂着 UUID 的行（§A3 的残留，重算能修） */
  uuidNamed: number
  /** 改了名字的行数 —— 验收 12「待复核数量明显下降」之外的另一个直观指标 */
  renamed: number
}

/**
 * 名字该不该被重算掉。
 *
 * **只在当前名字确实是垃圾时才改**。这条限制是拿真库数据试出来的：
 * 不加限制的话，`FREE無料-PoseAnimationShinano` 会被改成从 raw_name 现算的
 * `Shinano100Type ❥ Face&Pose Animations ⌖ ݁˚` —— 那行名字是引擎（或用户手改）挑过的，
 * 比文件名直译更有意义，一次"重新分析"就把它冲掉了，219 条里有大半是这种误伤。
 *
 * 真正该修的只有四种：UUID / 长 hex、还挂着扩展名、被旧版本正则咬坏剩下的 `.0版本`
 * 那种残骸、以及空串。
 */
function nameIsGarbage(name: string): boolean {
  /**
   * 第 10 轮 D：判据本体搬到了 `shared/naming.ts`（那边还要给"容器取名"用）。
   * 留这个壳是因为本文件里有十几处按名字调用，改名不值当；**规则只有一份**。
   */
  return sharedNameIsGarbage(name)
}

/**
 * 从磁盘路径上退一级找名字（§A3 的候选 ②③）。
 * 文件名本身就是个 UUID 时，cleanDisplayName 只能"退回原名"（绝不给空），
 * 于是名字里还是挂着 UUID —— 这时唯一有意义的来源是它所在的目录名。
 */
function dirCandidate(row: AssetRow): string | null {
  const p = row.library_path ?? row.source_path ?? null
  if (!p) return null
  const segs = p.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
  // 末段就是文件自己，取它的父目录；父目录是库根那种一级的不算
  const parent = segs.length >= 2 ? segs[segs.length - 2] : null
  return parent && !/^[A-Za-z]:$/.test(parent) ? parent : null
}

/** 只重算这几列。刻意不含 category / subcategory / needs_review（见文件头） */
function recompute(row: AssetRow, lex: Lexicon): Record<string, unknown> {
  const raw = row.raw_name || row.name
  const guess = cleanDisplayName(raw)
  const gk = deriveGroupKey(raw, lex)
  const out: Record<string, unknown> = {}
  /**
   * 展示名只在"当前名字确实是垃圾"时才改。
   * 不检查后半句会把 `d6b99874-… base resized` 改成空串 ——
   * cleanDisplayName 剥完 UUID 可能什么都不剩，那时它自己会退回原名。
   */
  if (guess.name && guess.name !== row.name && nameIsGarbage(row.name)) out.name = guess.name
  /**
   * 上面那条改完还是垃圾（文件名纯 UUID，退回的原名里就带着它）→
   * 按 §A3 往上一级找：主体所在目录名。真库那 4 张 `d6b99874-… base resized`
   * 就是靠这一步才有名字可给。
   */
  const proposed = out.name as string | undefined
  if (nameIsGarbage(proposed ?? row.name)) {
    const fallback = pickMeaningfulName([proposed ?? null, dirCandidate(row)])
    if (fallback && !nameIsGarbage(fallback)) out.name = fallback
  }
  /** 版本号：§A4 之后从 UUID 里咬出来的假版本会变 null；真版本照旧保留 */
  if ((guess.version ?? null) !== (row.version ?? null)) out.version = guess.version ?? null
  /** 括号槽位原文是这次新增的列，老行一定是 null */
  if (gk.variantRaw.length && !row.variant_raw) out.variant_raw = gk.variantRaw[0]
  return out
}

/**
 * 一行的真实体积：**回到磁盘上量**（只读 stat，不写不搬）。
 *
 * 为什么不"从子行汇总"就算完：真库那 869 GB 是"每个子项都背了一遍整包体积"造成的，
 * 子行本身也是错的 —— 拿错的东西加一遍还是错的。唯一可信的来源是文件系统。
 * 量不到（库挪盘了、路径为空）才退回按子行汇总，再退回原值。
 */
function sizeOfPath(p: string | null, limit = 20000): number | null {
  if (!p) return null
  try {
    const st = fs.statSync(p)
    /**
     * **只量目录**，文件一律交回 null（= 不动库里那个数）。
     * 原因是真库实测出来的：压缩包型合集的成员行，library_path 指的是**那个 .rar 自己**
     * （见 commitBundleAsset 里 rootIsDir 那段的注释），库里存的 4.1 MB 才是成员真实大小。
     * 按文件量会把每个成员都改成整包 300 MB —— 10 个成员全变成同一个数，比原来更错。
     */
    if (st.isFile()) return null
    let bytes = 0
    const stack = [p]
    let seen = 0
    while (stack.length && seen < limit) {
      const d = stack.pop() as string
      let list: fs.Dirent[]
      try {
        list = fs.readdirSync(d, { withFileTypes: true })
      } catch {
        continue
      }
      for (const e of list) {
        if (++seen > limit) break
        if (isJunkSegment(e.name)) continue
        const abs = path.join(d, e.name)
        try {
          if (e.isDirectory()) stack.push(abs)
          else bytes += fs.statSync(abs).size
        } catch {
          /* 读不到的当 0 */
        }
      }
    }
    return bytes
  } catch {
    return null
  }
}

/**
 * 体积重算：能回到磁盘量的就量，量不到的（挪盘 / 路径为空 / 压缩包内层成员）
 * 退回"从子行汇总"。附属资源不计入。
 */
function recomputeSizes(db: Db): Map<string, number> {
  const rows = db
    .prepare(`SELECT id, parent_asset_id, size_bytes, attachment_kind, library_path, source_path FROM asset`)
    .all() as Array<{
    id: string
    parent_asset_id: string | null
    size_bytes: number | null
    attachment_kind: string | null
    library_path: string | null
    source_path: string | null
  }>
  const kids = new Map<string, typeof rows>()
  for (const r of rows) {
    if (!r.parent_asset_id) continue
    const list = kids.get(r.parent_asset_id) ?? []
    list.push(r)
    kids.set(r.parent_asset_id, list)
  }
  const out = new Map<string, number>()
  for (const r of rows) {
    if (r.attachment_kind) continue
    const measured = sizeOfPath(r.library_path ?? r.source_path ?? null)
    if (measured !== null && measured > 0) {
      out.set(r.id, measured)
      continue
    }
    const list = kids.get(r.id) ?? []
    if (!list.length) continue
    let total = 0
    for (const k of list) {
      if (k.attachment_kind) continue
      total += Number(out.get(k.id) ?? k.size_bytes ?? 0)
    }
    if (total > 0) out.set(r.id, total)
  }
  return out
}

/**
 * 旧规则留下的"附属资源被当成独立素材"→ 降级成附属行（§A2）。
 *
 * 为什么必须在重新分析里做、不能推给"清掉收件箱重新登记"：
 * 那 151 项就是旧规则分析出来的产物，重新分析这个功能存在的意义就是把它们修正掉
 * （用户原话）。而且那批只存在于 asset 表里 —— 收件箱是内存态、重启就没，
 * 让他人肉重扫一遍等于把已经确认过的东西再确认一遍。
 *
 * 判据完全复用 `splitContainer`，但输入是**库里同一目录下平铺的兄弟行**，不是磁盘清单：
 * 一个目录的兄弟行里如果**恰好只有一行是主体、其余全是附属类型**，那这一堆就是
 * "一件东西 + 它的介绍图/视频/说明"，把其余那些挂到主体下面标上 attachment_kind。
 *
 * 反过来一律不动：兄弟行里有两行以上像主体的（`西装/` 里平铺 5 个不相干的包），
 * 或者那行自己在某个容器底下，都不许并 —— 并错了就是把两件东西揉成一件。
 */
function planDemotions(rows: AssetRow[]): ReanalyzePlan['demote'] {
  const byDir = new Map<string, AssetRow[]>()
  for (const r of rows) {
    if (r.attachment_kind || Number(r.is_bundle) === 1 || r.parent_asset_id) continue
    const p = r.library_path ?? r.source_path
    if (!p) continue
    const norm = p.replace(/[\\/]+$/, '')
    const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
    if (i < 2) continue
    const dir = norm.slice(0, i)
    const list = byDir.get(dir) ?? []
    list.push(r)
    byDir.set(dir, list)
  }
  const out: ReanalyzePlan['demote'] = []
  for (const [, siblings] of byDir) {
    if (siblings.length < 2) continue
    /** 把每一行当成"目录里的一个条目"喂给同一个判定器；末段名字决定它是主体还是附属 */
    const entries = siblings.map((r) => {
      const p = String(r.library_path ?? r.source_path)
      const name = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
      return { relPath: name, size: r.size_bytes ?? 0, ext: '', isDir: false }
    })
    const split = splitContainer(entries)
    if (!split.primary || split.attachments.length === 0) continue
    /** splitContainer 可能认出一个目录型主体（primaryRoot），那说明这些不是平铺兄弟，别动 */
    if (split.primaryRoot) continue
    const hostNames = new Set(split.primary.map((p) => p.relPath))
    const hosts = siblings.filter((r) => hostNames.has(basenameOf(r)))
    if (hosts.length !== 1) continue
    const host = hosts[0]
    const attachNames = new Set(split.attachments.map((a) => a.relPath))
    for (const r of siblings) {
      if (r.id === host.id) continue
      const kind = attachNames.has(basenameOf(r)) ? split.attachments.find((a) => a.relPath === basenameOf(r))?.kind : undefined
      if (!kind) continue
      out.push({ id: r.id, hostId: host.id, kind, name: r.name })
    }
  }
  return out
}

function basenameOf(r: AssetRow): string {
  const p = String(r.library_path ?? r.source_path ?? r.raw_name)
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
}

/**
 * 只读扫描。反复刷都不改任何东西，界面可以在用户按下之前先给他看"会影响多少条"。
 */
export function planReanalyze(db: Db, lex: Lexicon): ReanalyzePlan {
  const sizes = recomputeSizes(db)
  const rows = db.prepare(`SELECT * FROM asset ORDER BY updated_at DESC`).all() as AssetRow[]
  const changes: ReanalyzeChange[] = []
  const junk: ReanalyzePlan['junk'] = []
  let uuidNamed = 0

  for (const r of rows) {
    const pathStr = r.library_path ?? r.source_path ?? null
    /**
     * 垃圾判定看**路径的最后一段**，不是整条路径：
     * `E:\vrc\A\插件\x\__MACOSX` 这种整条里含垃圾段的，是素材目录本身叫那个名字，
     * 用 isJunkRelPath 会把正常的绝对路径也判成垃圾（Windows 路径里的 `$recycle.bin` 同理）。
     */
    const base = pathStr ? pathStr.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '' : ''
    if (base && isJunkSegment(base)) {
      junk.push({ id: r.id, name: r.name, path: pathStr })
      continue
    }
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(r.name)) uuidNamed++

    const to = recompute(r, lex)
    /** 容器 / 子项那行的体积是从子行汇总出来的，入库时算错过一次，这里一并重算 */
    const own = Number(r.size_bytes ?? 0)
    const good = sizes.get(r.id)
    if (good !== undefined && good > 0 && Math.abs(good - own) > 1024 * 1024) to.size_bytes = good
    if (!Object.keys(to).length) continue
    const from: Record<string, unknown> = {}
    for (const k of Object.keys(to)) from[k] = (r as unknown as Record<string, unknown>)[k] ?? null
    changes.push({
      id: r.id,
      name: r.name,
      rawName: r.raw_name,
      from,
      to,
      fields: Object.keys(to)
    })
  }

  return {
    scanned: rows.length,
    changes,
    demote: planDemotions(rows),
    junk,
    uuidNamed,
    renamed: changes.filter((c) => c.fields.includes('name')).length
  }
}

export interface ReanalyzeResult {
  updated: number
  batchId: string
  journalId: number
}

/**
 * 执行重算。**只 UPDATE 列**，不建不删、不碰文件系统。
 * 附属行的清理是另一件事（删行要另写 journal），这里不混进来。
 */
export function applyReanalyze(db: Db, plan: ReanalyzePlan, opts?: { ids?: string[] }): ReanalyzeResult {
  const want = opts?.ids ? new Set(opts.ids) : null
  const list = want ? plan.changes.filter((c) => want.has(c.id)) : plan.changes
  /** 附属降级也按点名的范围走（界面勾了部分行时不许整库重写） */
  const demote = want ? plan.demote.filter((d) => want.has(d.id)) : plan.demote
  if (!list.length && !demote.length) return { updated: 0, batchId: '', journalId: 0 }
  const batchId = ulid()
  const fieldChanges: Array<{ id: string; to: Record<string, unknown>; from: Record<string, unknown> }> = list.map(
    (c) => ({ id: c.id, to: c.to, from: c.from })
  )

  db.transaction(() => {
    /**
     * 附属资源降级和改名字进**同一条** journal：撤销一次就该整批回到按下之前，
     * 不该让人撤完名字发现"挂还挂着"。写回的列由 from 决定，undo 那边天然支持任意列。
     */
    for (const d of demote) {
      const row = db
        .prepare(`SELECT attachment_kind, parent_asset_id FROM asset WHERE id = ?`)
        .get(d.id) as { attachment_kind: string | null; parent_asset_id: string | null } | undefined
      if (!row || row.attachment_kind) continue
      fieldChanges.push({
        id: d.id,
        to: { attachment_kind: d.kind, parent_asset_id: d.hostId },
        from: { attachment_kind: row.attachment_kind, parent_asset_id: row.parent_asset_id }
      })
      db.prepare(`UPDATE asset SET attachment_kind = ?, parent_asset_id = ?, updated_at = ? WHERE id = ?`).run(
        d.kind,
        d.hostId,
        Date.now(),
        d.id
      )
    }
    for (const c of list) {
      const keys = Object.keys(c.to)
      db
        .prepare(`UPDATE asset SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...keys.map((k) => c.to[k] ?? null), Date.now(), c.id)
    }
    appendJournal(
      db,
      {
        op: 'reanalyze',
        fieldChanges,
        label:
          `重新分析 ${list.length + demote.length} 条（改名 ${list.filter((c) => c.fields.includes('name')).length}` +
          `，附属降级 ${demote.length}）`
      },
      { batchId }
    )
  })()

  return { updated: list.length + demote.length, batchId, journalId: 0 }
}

/**
 * 把"本该不存在"的垃圾行请出库（**不动磁盘**，文件留在原地由用户处置）。
 * 删行前先整条存进 journal，撤销能塞回来 —— 这是删库记录唯一允许的姿势。
 */
export function dropJunkRows(db: Db, ids: string[]): { deleted: number; batchId: string } {
  if (!ids.length) return { deleted: 0, batchId: '' }
  const batchId = ulid()
  let deleted = 0
  db.transaction(() => {
    for (const id of ids) {
      const row = db.prepare(`SELECT * FROM asset WHERE id = ?`).get(id) as AssetRow | undefined
      if (!row) continue
      appendJournal(
        db,
        { op: 'reanalyze', fieldChanges: [], restore: { row }, label: `移除垃圾素材记录 ${row.name}（磁盘文件未动）` },
        { batchId }
      )
      db.prepare(`DELETE FROM search_alias WHERE asset_id = ?`).run(id)
      db.prepare(`DELETE FROM asset WHERE id = ?`).run(id)
      deleted++
    }
  })()
  return { deleted, batchId }
}

export { isJunkRelPath }
