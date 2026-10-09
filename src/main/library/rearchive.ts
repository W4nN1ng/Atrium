/**
 * R4 ③ · 改分类时把文件搬到新分类该在的位置（"改分类不搬文件"这条 M4 缺口的补法）。
 *
 * 症状（实测过）：详情面板把一张卡从 `材质` 改成 `道具 / 武器`，卡片写的是道具，
 * 文件夹还在 `材质/MatCap` —— 用户按分类浏览时找不到它，按目录浏览时又和卡片对不上。
 *
 * ## 为什么默认**不**搬，且必须先看预览
 *
 * 这是一轮里唯一直接动 `E:\vrc\A`（25 GB 真实素材）磁盘的操作。所以：
 *  1. `storageMode === 'indexed'`（只登记不搬）或没设库根 → **一个文件都不动**，只改记录；
 *  2. 素材当前路径不在库根之下 → 不搬（那是别人目录里的东西，A 没资格挪）；
 *  3. 真要搬之前先算一份预览（搬到哪、几个文件、多大、会不会撞上同名），确认才执行；
 *  4. 一次改分类写**一条** `op='rearchive'` 的 journal，Ctrl+Z 一次做完两半：
 *     文件搬回去 + 库里路径改回来。
 *
 * ## 附属与子项为什么不单独搬
 *
 * 它们在父目录**里面**，`moveTree` 一次就连带搬走了。这里只重写它们库里的路径字符串。
 * 反过来，子项的路径**不在**父目录下时（历史数据、手工挪过）才单独记一条 move。
 * 判断依据是路径前缀，不是"有没有 parent_asset_id" —— 后者只说明库里的挂法，不说明盘上的位置。
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Db } from '../db'
import type { AssetRow, LocaleKey, RearchiveOutcome, RearchivePlan, RearchiveResult, RearchiveRewrite, RearchiveMove } from '../../shared/types'
import { appendJournal, type JournalPayload } from '../db/repos/journal'
import { getAsset, patchAsset } from '../db/repos/asset'
import { getSettings } from '../services/settings'
import { loadCategories, dirNames } from '../services/categories'
import { resolveDirNames } from './dirAliases'
import { renderSegments } from './template'
import { ensureDir, moveTree, pathExists, uniquePath } from './fsx'
import { isInside as insideRoot, normalizeForCompare } from '../security/paths'
import { reindexAsset } from '../search'
import { ulid } from '../../shared/ulid'
import { SIDECAR_FILENAME } from '../../shared/constants'
import log from 'electron-log'

/**
 * 契约（`RearchivePlan` / `RearchiveResult` / `RearchiveMove` / `RearchiveRewrite`）
 * 住在 `shared/types.ts` —— 界面和主进程共用一份，两边各写一遍必漂。
 */

/**
 * 目录里有多少文件、多少字节（浅递归，够用：素材目录不会深到爆栈）。
 *
 * ⚠ 跳过 `SIDECAR_FILENAME`（`.avca.json`）：那是 A 自己写的记账文件，不是用户的素材内容。
 * 算进去会出现"卡片写 8.1 kB、预览卡写 9.2 kB"这种自己和自己对不上号的场面
 * （沙盒活体第一跑就是这样，用户第一反应是"是不是要搬两份"）。
 * `undo.ts` 清空目录时同样把它当"不是内容"看待，口径保持一致。
 */
function treeStats(p: string): { bytes: number; files: number; isDir: boolean } {
  try {
    const st = fs.statSync(p)
    if (!st.isDirectory()) return { bytes: st.size, files: 1, isDir: false }
    let bytes = 0
    let files = 0
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name === SIDECAR_FILENAME) continue
        else {
          try {
            bytes += fs.statSync(full).size
            files++
          } catch {
            /* 读不到的算不进总量，但也不许把整次预览弄炸 */
          }
        }
      }
    }
    walk(p)
    return { bytes, files, isDir: true }
  } catch {
    return { bytes: 0, files: 0, isDir: false }
  }
}

/** 是不是同一个路径（Windows 大小写 / 斜杠 / 尾斜杠都不算差别） */
const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && normalizeForCompare(a) === normalizeForCompare(b)

/**
 * `child` 是否在 `parent` 里面（**不含等于**）。
 *
 * ⚠ 这里必须走 `insideRoot`，不能自己拼分隔符比：`normalizeForCompare` 把 `/` 和 `\`
 * 统一成**反斜杠**，所以 `startsWith(parent + '/')` 恒为 false。
 * 写反过一次，症状是"每个素材都被判成不在库根下、一次都不搬"，而预览界面只显示"没搬"，
 * 看不出为什么 —— 这种判断一律复用 `security/paths` 里那份带分隔符边界的实现。
 */
function isInside(child: string | null | undefined, parent: string | null | undefined): boolean {
  if (!child || !parent) return false
  if (same(child, parent)) return false
  return insideRoot(parent, child)
}

/**
 * `old`（在 `current` 底下）换成以 `dest` 为根的同一个相对路径。
 *
 * 用 `path.relative` 而不是 `old.slice(current.length)`：
 * 前者大小写不敏感、并且**保留原文件名的大小写**（后者会把手工挪过的 `E:\vrc\a\...`
 * 拼成对不上盘的字符串，Windows 认得、撤销时按原路搬回去就找不到东西了）。
 */
function repath(old: string, current: string, dest: string): string {
  const rel = path.relative(current, old)
  return rel && !rel.startsWith('..') ? path.join(dest, rel) : dest
}

/** 整棵子树（含自己）的素材行 —— 路径要一起改的那些都在这里面 */
function descendantsOf(db: Db, rootId: string): AssetRow[] {
  const out: AssetRow[] = []
  const queue = [rootId]
  const seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    const kids = db
      .prepare(`SELECT * FROM asset WHERE parent_asset_id = ?`)
      .all(id) as Array<Record<string, unknown>>
    for (const k of kids) {
      const row = k as unknown as AssetRow
      out.push(row)
      queue.push(row.id)
    }
  }
  return out
}

/**
 * 算目录要用到的三项设置。
 *
 * 做成显式入参而不是在函数里读全局：`commit.ts` 的 `CommitDeps` 就是这个形状，
 * 而且这样回归用例能直接指定库根，不必把 electron-store 拉进测试进程
 * （`getSettings()` 没初始化时会退回 `%TEMP%/A-uninitialized` 那个**进程级共享**目录，
 * 并行跑的用例会互相踩 —— `services/paths.ts:setAppPathsForTest` 上记着这次事故）。
 */
export interface RearchiveEnv {
  libraryRoot: string | null
  dirTemplate: string
  libraryLocale: LocaleKey
}

function resolveEnv(over?: Partial<RearchiveEnv>): RearchiveEnv {
  if (over && over.libraryRoot !== undefined && over.dirTemplate !== undefined && over.libraryLocale !== undefined) {
    return over as RearchiveEnv
  }
  const s = getSettings()
  return { libraryRoot: s.libraryRoot, dirTemplate: s.dirTemplate, libraryLocale: s.libraryLocale, ...over }
}

/**
 * 只读：算出"点确认会发生什么"。
 *
 * ⚠ 这一步**一个字节都不写**。界面上那些"搬到哪、N 个文件、X MB、会不会撞名"
 * 全部来自这里，用户看完才轮到 `applyRearchive`。
 */
export async function planRearchive(
  db: Db,
  assetId: string,
  category: string,
  subcategory: string | null,
  env?: Partial<RearchiveEnv>
): Promise<RearchiveOutcome> {
  const before = getAsset(db, assetId)
  if (!before) return { ok: false, reasonKey: 'err.assetGone' }
  const s = resolveEnv(env)
  const batchId = ulid()

  const base = {
    ok: true as const,
    assetId,
    category,
    subcategory,
    fromDir: null as string | null,
    toDir: null as string | null,
    moves: [] as RearchiveMove[],
    rewrites: [] as RearchiveRewrite[],
    fileCount: 0,
    bytes: 0,
    batchId
  }

  /** —— 该不该搬 —— */
  if (!s.libraryRoot) {
    return { ...base, willMove: false, reasonKey: 'rearchive.reason.noRoot', reasonParams: null }
  }
  if ((before.storage_mode ?? 'archived') !== 'archived') {
    return { ...base, willMove: false, reasonKey: 'rearchive.reason.indexed', reasonParams: null }
  }
  const current = before.library_path ?? (before.source_path ? path.dirname(before.source_path) : null)
  if (!current || !(await pathExists(current))) {
    return { ...base, willMove: false, reasonKey: 'rearchive.reason.missing', reasonParams: { path: current ?? '' } }
  }
  if (!insideRoot(s.libraryRoot, current) || same(current, s.libraryRoot)) {
    /** 不在库根下面（或就是库根本身）= 那是别人目录里的东西，A 没资格挪它 */
    return { ...base, willMove: false, reasonKey: 'rearchive.reason.outside', reasonParams: { path: current } }
  }

  /** —— 新位置：和入库时用的是同一套模板与目录别名 —— */
  const cfg = loadCategories()
  const names = new Map(
    Object.entries(resolveDirNames(s.libraryRoot, Object.fromEntries(dirNames(cfg, s.libraryLocale)), cfg).names)
  )
  const avatar = (db.prepare(`SELECT variant_value AS v FROM variant WHERE asset_id = ? AND variant_kind = 'avatar' ORDER BY id LIMIT 1`).get(assetId) as { v?: string } | undefined)?.v ?? null
  const segments = renderSegments(s.dirTemplate, {
    category,
    subcategory,
    name: before.name,
    version: before.version ?? null,
    avatar,
    author: before.author ?? null,
    year: String(new Date().getFullYear())
  }, names)
  const planned = path.join(s.libraryRoot, ...segments)
  if (same(planned, current)) {
    /** 分类改了但目录名没变（比如二级留空、或者新旧分类映射到同一个已有目录） */
    return { ...base, fromDir: current, toDir: current, willMove: false, reasonKey: 'rearchive.reason.samePlace', reasonParams: null }
  }
  const taken = await pathExists(planned)
  const dest = await uniquePath(planned)

  const st = treeStats(current)
  const moves: RearchiveMove[] = [{ from: current, to: dest, taken, isDirectory: st.isDir, bytes: st.bytes, fileCount: st.files }]

  /** —— 子树里"不在父目录下"的那些要单独搬；在里面的只改字符串 —— */
  const rewrites: RearchiveRewrite[] = []
  for (const kid of descendantsOf(db, assetId)) {
    for (const field of ['library_path', 'source_path', 'cover_image'] as const) {
      const old = kid[field]
      if (!old || !isInside(old, current)) continue
      rewrites.push({ assetId: kid.id, field, from: old, to: repath(old, current, dest) })
    }
    const kOld = kid.library_path
    if (kOld && !isInside(kOld, current) && !same(kOld, current)) {
      /**
       * 子项的目录**不在**父目录里面（历史数据、或用户手工挪过）。
       * 把它搬进新的父目录**里面**：和入库时的目录形状一致 ——
       * `commit.ts:397` 那条注释写的就是"附属资源跟着主体整棵 moveTree 进 destRoot"。
       */
      const kst = treeStats(kOld)
      if (kst.files) {
        const planned2 = path.join(dest, path.basename(kOld))
        const kdest = await uniquePath(planned2)
        moves.push({
          from: kOld,
          to: kdest,
          taken: await pathExists(planned2),
          isDirectory: kst.isDir,
          bytes: kst.bytes,
          fileCount: kst.files
        })
        rewrites.push({ assetId: kid.id, field: 'library_path', from: kOld, to: kdest })
        for (const field of ['source_path', 'cover_image'] as const) {
          const o = kid[field]
          if (o && isInside(o, kOld)) rewrites.push({ assetId: kid.id, field, from: o, to: repath(o, kOld, kdest) })
        }
      }
    }
  }
  for (const field of ['library_path', 'source_path', 'cover_image'] as const) {
    const old = before[field]
    if (!old) continue
    /**
     * 只改**在被搬的那棵目录里**的三列。指向库外的（比如"原件还在下载目录、只登记不搬"
     * 那种 `source_path`）一个字都不动 —— 这次搬运碰不到它，改了就是撒谎。
     */
    if (same(old, current)) rewrites.push({ assetId, field, from: old, to: dest })
    else if (isInside(old, current)) rewrites.push({ assetId, field, from: old, to: repath(old, current, dest) })
  }

  return {
    ...base,
    fromDir: current,
    toDir: dest,
    moves,
    rewrites,
    fileCount: moves.reduce((a, m) => a + m.fileCount, 0),
    bytes: moves.reduce((a, m) => a + m.bytes, 0),
    willMove: true,
    reasonKey: null,
    reasonParams: null
  }
}

/**
 * 真的搬。**必须在预览之后调用**。
 *
 * journal 一条写完：`moves`（盘上）+ `fieldChanges`（库里）+ `createdDirs`（新建的父目录）。
 * 顺序是"先写 journal 再动盘" —— 反过来一旦中途崩了，journal 里没账，
 * 那批文件就成了"搬了一半、没人知道搬到哪"的状态（M5-A/M5-B 的记账纪律同一条）。
 *
 * 这里**不删任何东西**（整棵 moveTree，旧目录空了留着），所以不需要回收站钩子。
 */
export async function applyRearchive(
  db: Db,
  plan: RearchivePlan,
  opts: { env?: Partial<RearchiveEnv> } = {}
): Promise<RearchiveResult> {
  const fieldChanges: Array<{ id: string; to: Record<string, unknown>; from: Record<string, unknown> }> = []
  const touch = (id: string, col: string, value: unknown): void => {
    let entry = fieldChanges.find((f) => f.id === id)
    if (!entry) {
      entry = { id, to: {}, from: {} }
      fieldChanges.push(entry)
    }
    entry.to[col] = value
  }

  /** 分类本身（搬不搬都要改） */
  touch(plan.assetId, 'category', plan.category)
  touch(plan.assetId, 'subcategory', plan.subcategory)
  touch(plan.assetId, 'status', 'classified')
  touch(plan.assetId, 'confidence', 1)
  for (const r of plan.rewrites) touch(r.assetId, r.field, r.to)

  const beforeRow = getAsset(db, plan.assetId)
  const beforeMap: Record<string, Record<string, unknown>> = {}
  for (const f of fieldChanges) {
    const row = getAsset(db, f.id)
    beforeMap[f.id] = row ? { ...(row as unknown as Record<string, unknown>) } : {}
  }
  for (const f of fieldChanges) f.from = beforeMap[f.id] ?? {}

  const root = resolveEnv(opts.env).libraryRoot
  const createdDirs = plan.willMove && root ? createdUnder(plan.toDir as string, root) : []
  const journalId = appendJournal(
    db,
    {
      op: 'rearchive',
      moves: plan.willMove ? plan.moves.map((m) => ({ from: m.from, to: m.to })) : [],
      fieldChanges,
      createdDirs,
      from: plan.fromDir ?? undefined,
      to: plan.toDir ?? undefined,
      assetIds: Array.from(new Set([plan.assetId, ...fieldChanges.map((f) => f.id)])),
      label: plan.willMove
        ? `改分类并搬文件 → ${path.basename(plan.toDir as string)}`
        : `改分类（未搬文件）${plan.reasonKey ? '：' + plan.reasonKey : ''}`,
      extra: { reasonKey: plan.reasonKey, fromDir: plan.fromDir, toDir: plan.toDir }
    },
    { batchId: plan.batchId }
  )

  /** —— 盘：倒序不重要，每条都是独立目录 —— */
  let moved = 0
  if (plan.willMove) {
    for (const m of plan.moves) {
      try {
        await ensureDir(path.dirname(m.to))
        await moveTree(m.from, m.to)
        moved++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log.warn(`[rearchive] 搬 ${m.from} → ${m.to} 失败：${msg}`)
        markJournalFailed(db, journalId, msg)
        return { ok: false, batchId: plan.batchId, journalId, moved, rewrites: 0, dbOnly: false, reasonKey: null, reasonParams: null, error: msg }
      }
    }
  }

  /** —— 库：一次事务把所有列改完 —— */
  db.transaction(() => {
    for (const f of fieldChanges) patchAsset(db, f.id, f.to as never)
  })()
  for (const id of new Set([plan.assetId, ...fieldChanges.map((f) => f.id)])) reindexAsset(db, id)

  log.info(
    `[rearchive] ${beforeRow?.name ?? plan.assetId}：搬了 ${moved} 项、改了 ${fieldChanges.length} 行库记录` +
      (plan.willMove ? '' : `（没搬，原因 ${plan.reasonKey}）`)
  )
  return {
    ok: true,
    batchId: plan.batchId,
    journalId,
    moved,
    rewrites: fieldChanges.length,
    dbOnly: !plan.willMove,
    reasonKey: plan.willMove ? null : plan.reasonKey,
    reasonParams: plan.willMove ? null : plan.reasonParams,
    error: null
  }
}

function markJournalFailed(db: Db, id: number, error: string): void {
  db.prepare(`UPDATE journal SET status = 'failed', error = ? WHERE id = ?`).run(error.slice(0, 400), id)
}

/**
 * `target` 之下、`root` 之外新建了哪些目录 —— **从浅到深**返回，
 * 和 `commit.ts:createdDirsUnder` 同一个顺序约定：撤销时倒序（先深后浅）才删得干净。
 * 顺序弄反过一次，表现是"撤销改分类之后库里留下两个空的分类目录"
 * （先试浅的那层时它还有内容 → 跳过 → 里面那层空了才删，外层永远删不掉）。
 */
function createdUnder(target: string, root: string): string[] {
  const out: string[] = []
  let cur = path.resolve(target)
  const stop = path.resolve(root)
  try {
    while (cur && cur !== stop && !fs.existsSync(cur)) {
      out.push(cur)
      const parent = path.dirname(cur)
      if (parent === cur) break
      cur = parent
    }
  } catch {
    /* 路径读不动就少记几条，撤销时顶多多留一个空目录，不会删错东西 */
  }
  return out.reverse()
}

/**
 * 撤销一条 `rearchive`：**先把文件搬回去，再把库里路径改回去**。
 *
 * 两半必须一起做完 —— 只搬文件不改库 = 卡片指着不存在的新路径；
 * 只改库不搬文件 = 库和盘各说一套。任何一半失败都抛错停下，
 * 由 `undoLast` 把这条 journal 标成 `failed`（不许标 undone 装作撤过了）。
 */
export async function undoRearchive(
  db: Db,
  payload: JournalPayload,
  moveBack: (from: string, to: string) => Promise<void>
): Promise<{ moved: number; rows: number }> {
  const moves = payload.moves ?? []
  let moved = 0
  for (const m of moves.slice().reverse()) {
    if (!(await pathExists(m.to))) throw new Error(`撤销中止：${m.to} 已经不在这儿了，没敢乱动`)
    if (await pathExists(m.from)) throw new Error(`撤销中止：原位置 ${m.from} 已被别的东西占用，没敢覆盖`)
    await ensureDir(path.dirname(m.from))
    await moveBack(m.to, m.from)
    moved++
  }
  const changes = payload.fieldChanges ?? []
  db.transaction(() => {
    for (const f of changes) patchAsset(db, f.id, f.from as never)
  })()
  for (const f of changes) reindexAsset(db, f.id)
  /** 空掉的父目录：只删空的，里面有东西说明还有人的数据在 */
  for (const d of (payload.createdDirs ?? []).slice().reverse()) {
    try {
      if (fs.readdirSync(d).length === 0) fs.rmdirSync(d)
    } catch {
      /* 已经不在了 */
    }
  }
  return { moved, rows: changes.length }
}
