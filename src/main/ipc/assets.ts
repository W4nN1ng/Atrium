import fs from 'node:fs'
import { backfillThumbs, forgetThumb, pruneThumbCache, thumbPathFor } from '../library/thumbs'
import { dissolveOrphanGroups, markMissing, rebuildFromSidecars, scanLibrary, unmarkMissing, type HealthReport } from '../library/health'
import { nativeImage, shell } from 'electron'
import log from 'electron-log'
import type { AssetFilter, AssetRow, DetailInfo } from '../../shared/types'
import type { Stats } from '../../shared/api'
import { getDb } from '../db'
import { collectStats } from '../db'
import { deleteAssetRow, getAsset, isBundleRow, listAttachments, listChildItems, listChildren, listVersions, patchAsset, queryCards } from '../db/repos/asset'
import { summarizeGroups, listVariants, getBundle, getGroup, renameGroup } from '../db/repos/product'
import { tagsOf, listCollections, createCollection, updateCollection, removeCollection, addAssetsToCollection, removeAssetFromCollection } from '../db/repos/meta'
import { entryKindHistogram, packageEntriesOf, dependencySummary, installedProjects } from '../db/repos/unity'
import { listImportLogs, lastImportOfAsset, recordCorrection, learningFor, listJournal, appendJournal } from '../db/repos/journal'
import { isInside } from '../security/paths'
import { learnedHint } from '../classify/learning'
import { scanRebundle, applyRebundle } from '../library/rebundle'
import { planRegroup, applyRegroup } from '../library/regroup'
import { planRemerge, applyRemerge } from '../library/remerge'
import { scanMergeSuggestions, applyMergeSuggestion, dismissMergeSuggestion, dirLabel } from '../library/mergeSuggest'
import { planReanalyze, applyReanalyze, dropJunkRows } from '../library/reanalyze'
import { planModelCollections, applyModelCollections } from '../library/modelCollections'
import { applyRearchive, planRearchive } from '../library/rearchive'
import { scanLearnCandidates } from '../services/learnModels'
import { addUserAvatarTerms } from '../services/userLexicon'
import { mainLexicon, invalidateLexicon } from '../services/lexicon'
import { undoLast } from '../library/undo'
import { emit, EV_UNDONE } from '../lib/events'
import { loadCategories } from '../services/categories'
import { assetIndex, reindexAsset, rebuildIndex, setCategoryConfig } from '../search'
import { getSettings, libraryRootOrThrow } from '../services/settings'
import { P } from '../services/paths'
import type { IpcRegistrar } from './types'

/**
 * R4 ③：「用户改了分类」这件事的公共半边。
 *
 * 两条入口都要走它，否则口径会分叉：
 *  - `assets:reclassify` = 只改记录（旧入口，预览说"不该搬"时也用这条）
 *  - `assets:rearchive` = 改记录 **并且**把文件搬到新分类该在的位置
 *
 * 搬文件那条以前不喂 learning 表 —— 新流程一上线，M3-7 的「已经学会 N 条」就悄悄断了，
 * 因为界面从此不再走 `reclassify`。这类"两条路只有一条记账"的漏账是这份代码的老毛病。
 */
function learnCorrection(
  db: ReturnType<typeof getDb>,
  before: AssetRow,
  category: string,
  subcategory: string | null
): { learnedTokens: number; hint: { rules: number; token: string; category: string; subcategory: string | null } | null } {
  const tokens = roughTokens(before)
  const r = recordCorrection(db, {
    tokens,
    newCategory: category,
    newSubcategory: subcategory,
    oldCategory: before.category,
    oldSubcategory: before.subcategory
  })
  const hard = learningFor(db, tokens).filter((x) => x.hits >= 3)
  /**
   * hint 只回结构化数据，中文句子由渲染进程拼 ——
   * 主进程回传文案是这份规格的硬红线（切英文/日文时界面会夹生中文）。
   */
  return { learnedTokens: r.touched, hint: hard.length ? learnedHint(db) : null }
}

/**
 * 预览说"不该搬"（索引模式 / 不在库根下 / 本来就在对的地方）时走这条 ——
 * 只改记录 + 增量重建索引，**一个文件都不碰**。
 */
function reclassifyOnly(
  db: ReturnType<typeof getDb>,
  id: string,
  category: string,
  subcategory: string | null
): { learnedTokens: number; hint: { rules: number; token: string; category: string; subcategory: string | null } | null } {
  const before = getAsset(db, id)
  if (!before) return { learnedTokens: 0, hint: null }
  patchAsset(db, id, { category, subcategory, status: 'classified', confidence: 1 })
  /** R4 ③ 顺手修的 bug：以前改完分类**不重建索引**，而 `docs/SEARCH.md:42` 写着会。 */
  reindexAsset(db, id)
  return learnCorrection(db, before, category, subcategory)
}

/**
 * 喂 learning 表的分词。
 *
 * 只用来记"用户把带这个词的东西改成了什么分类"，不参与打分本身
 * （打分走 classify/engine 的加权语料）。所以这里宁缺勿滥：
 * 学进去一个怪 token，以后同类素材会被它一路带到错的分类上。
 *
 * 实测踩过的坑：source_path 里的盘符 "E:" 曾被当成一个词学进去，
 * 于是"E 盘的东西"整体偏向用户当时选的那个分类。
 */
function roughTokens(row: AssetRow): string[] {
  const fromPath = [row.name, row.raw_name].join(' ')
  const parts = fromPath
    .split(/[\s_\-./\\()\[\]【】{}（）:：,，+&!?~'"@#$%*]+/)
    .map((s) => s.toLowerCase().trim())
    .filter((s) => s.length >= 3 && /[a-z0-9\u3400-\u9fff\u3041-\u30ff]/.test(s) && !/^\d+$/.test(s))
  return Array.from(new Set(parts)).slice(0, 40)
}

function buildDetail(assetId: string): DetailInfo | null {
  const db = getDb()
  const asset = getAsset(db, assetId)
  if (!asset) return null
  const entries = packageEntriesOf(db, assetId)
  const pathToCheck = asset.library_path ?? asset.source_path ?? null
  return {
    asset,
    group: asset.group_id ? getGroup(db, asset.group_id) ?? undefined : undefined,
    variants: asset.group_id ? listVariants(db, asset.group_id) : [],
    tags: tagsOf(db, assetId),
    bundle: asset.bundle_id ? getBundle(db, asset.bundle_id) ?? undefined : undefined,
    packageSummary: entries.length
      ? { total: entries.length, byKind: entryKindHistogram(db, assetId) }
      : null,
    dependencies: dependencySummary(db, assetId),
    // 「当前工程装了没有」要等 M5 的桥接 resolve_guids，这里如实返回 unknown
    installedInProject: { projectId: '', state: 'unknown', hit: 0, total: 0 },
    /** R4 ⑥ · 跨工程反查：只认 A 导过的那几次，口径写在 `repos/unity.ts` 那段注释里 */
    installedAcross: installedProjects(db, assetId),
    lastImport: lastImportOfAsset(db, assetId),
    pathExists: pathToCheck ? fs.existsSync(pathToCheck) : false
  }
}

export function registerAssets({ ipc, broadcast }: IpcRegistrar): void {
  ipc.handle('assets:list', (filter: unknown) => {
    const f = (filter ?? {}) as AssetFilter
    const cfg = loadCategories()
    const db = getDb()
    /**
     * 有搜索词且索引已经好了 → 先问内存索引要候选 id，再让 SQL 做剩下的过滤。
     * LIKE 做不到"输 shinano 命中 しなの"，那需要归一化后的倒排索引（F5）。
     * 索引没建完时退回 LIKE：至少搜得出原文，比给一个空列表诚实。
     */
    const q = (f.search ?? '').trim()
    let withIds = f
    if (q && assetIndex.ready) {
      const hits = assetIndex.search(q, 2000)
      withIds = { ...f, ids: hits.map((h) => h.id) }
      // 索引一个都没命中就别再查库了，直接空
      if (!hits.length) return { cards: [], total: 0 }
    }
    return queryCards(db, withIds, cfg, getSettings().language)
  })

  ipc.handle('assets:get', (id: unknown): AssetRow | null => {
    if (typeof id !== 'string') throw new Error('id 无效')
    return getAsset(getDb(), id)
  })

  ipc.handle('assets:detail', (id: unknown): DetailInfo | null => {
    if (typeof id !== 'string') throw new Error('id 无效')
    return buildDetail(id)
  })

  ipc.handle('assets:patch', (id: unknown, patch: unknown) => {
    if (typeof id !== 'string') throw new Error('id 无效')
    const row = patchAsset(getDb(), id, (patch ?? {}) as Partial<AssetRow>)
    reindexAsset(getDb(), id)
    broadcast('data:changed', { reason: 'patch', id })
    return row
  })

  ipc.handle('assets:rename', (id: unknown, name: unknown) => {
    if (typeof id !== 'string' || typeof name !== 'string') throw new Error('参数无效')
    const clean = name.trim()
    if (!clean) throw new Error('名字不能为空')
    const db = getDb()
    const row = patchAsset(db, id, { name: clean })
    if (row?.group_id) renameGroup(db, row.group_id, clean)
    broadcast('data:changed', { reason: 'rename', id })
    return row
  })

  /** 第 1 份 F4 安全约束 1：只进回收站。DB 行同时删除，但磁盘文件由用户自己从回收站找回 */
  ipc.handle('assets:trash', async (ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error('参数无效')
    const db = getDb()
    const trashed: string[] = []
    const failed: Array<{ id: string; error: string }> = []
    for (const id of ids) {
      if (typeof id !== 'string') continue
      const row = getAsset(db, id)
      if (!row) {
        failed.push({ id: String(id), error: '库里没有这条' })
        continue
      }
      const target = row.library_path ?? row.source_path
      if (target && fs.existsSync(target)) {
        try {
          await shell.trashItem(target)
        } catch (e) {
          failed.push({ id, error: '移入回收站失败：' + (e instanceof Error ? e.message : String(e)) })
          continue
        }
      }
      deleteAssetRow(db, id)
      // 行没了还要留着的只有回收站里的文件；索引和缩略图缓存都得跟着走，
      // 否则搜一个已删素材还能搜到（点进去就是空白），缓存也会一直涨
      assetIndex.remove(id)
      forgetThumb(db, id)
      trashed.push(id)
    }
    broadcast('data:changed', { reason: 'trash', ids: trashed })
    return { trashed, failed }
  })

  ipc.handle('assets:stats', (): Stats => {
    const db = getDb()
    const s = collectStats(db)
    return {
      assets: s.assets,
      groups: s.groups,
      bundles: s.bundles,
      bundleItems: s.bundleItems,
      review: s.review,
      pendingConfirm: s.pendingConfirm,
      inbox: s.inbox,
      collections: listCollections(db).length,
      tags: s.tags,
      totalBytes: s.totalBytes,
      dbBytes: sizeOfDb()
    }
  })

  /** 待确认队列顶部那句「它已经学会 N 条」的提示数据（文案在渲染进程拼） */
  ipc.handle('assets:learned-hint', () => learnedHint(getDb()))

  ipc.handle('assets:groups', () => summarizeGroups(getDb()))

  ipc.handle('assets:backfill-thumbs', async (budget: unknown) =>
    await backfillThumbs(getDb(), typeof budget === 'number' && budget > 0 ? Math.min(budget, 2000) : 200, { packages: true })
  )

  ipc.handle('assets:reclassify', (id: unknown, category: unknown, subcategory: unknown) => {
    if (typeof id !== 'string' || typeof category !== 'string') throw new Error('参数无效')
    const db = getDb()
    const before = getAsset(db, id)
    if (!before) throw new Error('素材不存在')
    const sub = typeof subcategory === 'string' ? subcategory : null
    const cfg = loadCategories()
    const valid = cfg.categories.find((c) => c.key === category)
    if (!valid) throw new Error('分类表里没有一级分类：' + category)
    if (sub && !valid.subcategories.some((s) => s.key === sub)) {
      throw new Error(`${category} 下没有二级分类 ${sub}`)
    }
    patchAsset(db, id, { category, subcategory: sub, status: 'classified', confidence: 1 })
    /**
     * R4 ③ 顺手修的 bug：以前改完分类**不重建索引**，而 `docs/SEARCH.md` 写着会。
     * 症状是"把一张卡从材质改成道具之后，用新分类的词搜不到它"，
     * 要等到下次全量重建才恢复 —— 用户不会等，也说不清。
     */
    reindexAsset(db, id)
    const learned = learnCorrection(db, before, category, sub)
    broadcast('data:changed', { reason: 'reclassify', id })
    return learned
  })

  /**
   * R4 ③ · 「改分类要不要把文件也搬过去」的**只读预览**。
   * 一个字节都不写；界面上"搬到哪、几个文件、多大、会不会撞名"全部来自这里。
   */
  ipc.handle('assets:rearchive-plan', async (id: unknown, category: unknown, subcategory: unknown) => {
    if (typeof id !== 'string' || typeof category !== 'string') return { ok: false, reasonKey: 'err.badArgs' }
    return await planRearchive(getDb(), id, category, typeof subcategory === 'string' ? subcategory : null)
  })

  /**
   * 真的搬。**必须带着预览那次给出的 `expectToDir`**：
   * 这里会重算一遍计划，算出来的目标和用户看到的不一样就拒绝执行 ——
   * 中间用户可能又动过一次、或者同名目录刚被别人建出来（那时会加 `(2)` 后缀）。
   * 拿一份没给用户看过的计划去动盘，等于偷偷搬。
   */
  ipc.handle(
    'assets:rearchive',
    async (input: unknown) => {
      const i = (input ?? {}) as { assetId?: string; category?: string; subcategory?: string | null; expectToDir?: string | null }
      const id = String(i.assetId ?? '')
      const category = String(i.category ?? '')
      if (!id || !category) return { ok: false, reasonKey: 'err.badArgs' }
      const db = getDb()
      const before = getAsset(db, id)
      if (!before) return { ok: false, reasonKey: 'err.assetGone' }
      const cfg = loadCategories()
      const valid = cfg.categories.find((c) => c.key === category)
      if (!valid) return { ok: false, reasonKey: 'err.badCategory' }
      const sub = typeof i.subcategory === 'string' && i.subcategory ? i.subcategory : null
      if (sub && !valid.subcategories.some((s) => s.key === sub)) return { ok: false, reasonKey: 'err.badSubcategory' }
      const plan = await planRearchive(db, id, category, sub)
      if (!plan.ok) return plan
      if (!plan.willMove) {
        /** 不该搬（索引模式 / 不在库根下 / 本来就在对的地方）：只改记录，并把原因原样带回去 */
        const learned = reclassifyOnly(db, id, plan.category, plan.subcategory)
        broadcast('data:changed', { reason: 'reclassify', id })
        return {
          ok: true,
          batchId: plan.batchId,
          journalId: -1,
          moved: 0,
          rewrites: 0,
          dbOnly: true,
          error: null,
          /** 界面必须把"为什么没搬"说出来，不能让它看起来像搬成功了 */
          reasonKey: plan.reasonKey,
          reasonParams: plan.reasonParams,
          learned
        }
      }
      if (String(i.expectToDir ?? '') !== String(plan.toDir ?? '')) {
        return { ok: false, reasonKey: 'err.rearchiveStale', reasonParams: { was: String(i.expectToDir ?? ''), now: String(plan.toDir ?? '') } }
      }
      const r = await applyRearchive(db, plan)
      if (r.ok) {
        broadcast('data:changed', { reason: 'rearchive', id })
        /** `applyRearchive` 里已经写了分类那四列，这里只补 learning 那半本账 */
        return { ...r, reasonKey: null, reasonParams: null, learned: learnCorrection(db, before, category, sub) }
      }
      return r
    }
  )

  ipc.handle('assets:resolve-pending', (id: unknown, accept: unknown) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    const db = getDb()
    const row = patchAsset(db, id, {
      status: accept === true ? 'archived' : 'inbox',
      confidence: accept === true ? 1 : 0
    })
    broadcast('data:changed', { reason: 'resolve', id })
    return row
  })

  /**
   * 待复核：改完点「标记已复核」。
   * 只动 needs_review 这一列 —— 分类改动本身走 assets:patch，两件事分开，
   * 免得"我改了分类但没点复核"和"我看过了没错"两种意图搅在一起。
   */
  /** 容器详情：一次拿全"容器 + 子项 + 每个子项的版本 + 附属资源"，省得界面来回四趟 */
  ipc.handle('assets:bundle', (id: unknown) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    const db = getDb()
    const bundle = getAsset(db, id)
    if (!bundle) return null
    const items = listChildItems(db, id).map((it) => ({
      item: it,
      versions: listVersions(db, it.id),
      attachments: listAttachments(db, it.id)
    }))
    return { bundle, items, attachments: listAttachments(db, id) }
  })

  /**
   * 改挂父级：「从合集中拆出」= parentId 给 null，「并入合集」= 给合集 id。
   * 纯库操作，一个文件都不碰（改动单 §7.1：合集里的东西不许被物理拆开）。
   */
  ipc.handle('assets:reparent', (ids: unknown, parentId: unknown) => {
    if (!Array.isArray(ids) || !ids.length) throw new Error('参数无效')
    if (parentId !== null && typeof parentId !== 'string') throw new Error('参数无效')
    const db = getDb()
    const changes: Array<{ id: string; from: string | null; to: string | null }> = []
    db.transaction(() => {
      for (const raw of ids) {
        if (typeof raw !== 'string') continue
        const cur = getAsset(db, raw)
        if (!cur) continue
        if (parentId && cur.id === parentId) continue
        changes.push({ id: raw, from: cur.parent_asset_id, to: parentId })
        db.prepare(`UPDATE asset SET parent_asset_id = ?, updated_at = ? WHERE id = ?`).run(parentId, Date.now(), raw)
      }
      if (changes.length) {
        appendJournal(
          db,
          { op: 'reparent', changes, label: `${changes.length} 项改挂父级（${parentId ? '并入合集' : '拆为顶层'}）` },
          {}
        )
      }
    })()
    broadcast('data:changed', { reason: 'reparent' })
    return { moved: changes.length }
  })

  /**
   * 解散合集：子项全部升为顶层，合集那行删掉。
   * 删掉的行整条存进 journal，撤销时原样塞回去 —— 用户手滑解散了 17 件的合集也不亏。
   */
  ipc.handle('assets:dissolve-bundle', (id: unknown) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    const db = getDb()
    const bundle = getAsset(db, id)
    if (!bundle) return { released: 0 }
    if (!isBundleRow(bundle)) throw new Error('这条不是合集')
    const kids = listChildren(db, id)
    const items = kids.filter((k) => !k.attachment_kind)
    const attaches = kids.filter((k) => !!k.attachment_kind)
    /**
     * 附属资源不能跟着升顶层 —— 它们本来就不该出现在库的第一层（§A2）。
     * 容器解散之后那件产品由第一个子项代表，介绍图/视频就改挂到它下面；
     * 一个子项都没有时只能删行（纯库操作，整条存进 journal，撤销时塞回来）。
     */
    const newParent = items[0]?.id ?? null
    const changes = [
      ...items.map((k) => ({ id: k.id, from: k.parent_asset_id, to: null })),
      ...attaches.map((k) => ({ id: k.id, from: k.parent_asset_id, to: newParent }))
    ]
    const dropped = newParent ? [] : attaches.map((k) => ({ row: k }))
    db.transaction(() => {
      for (const k of items) db.prepare(`UPDATE asset SET parent_asset_id = NULL, updated_at = ? WHERE id = ?`).run(Date.now(), k.id)
      for (const k of attaches) {
        if (newParent) {
          db.prepare(`UPDATE asset SET parent_asset_id = ?, updated_at = ? WHERE id = ?`).run(newParent, Date.now(), k.id)
        } else {
          db.prepare(`DELETE FROM search_alias WHERE asset_id = ?`).run(k.id)
          db.prepare(`DELETE FROM asset WHERE id = ?`).run(k.id)
        }
      }
      appendJournal(
        db,
        { op: 'reparent', changes, restore: { row: bundle, dropped }, label: `解散合集 ${bundle.name}` },
        {}
      )
      db.prepare(`DELETE FROM asset WHERE id = ?`).run(id)
    })()
    assetIndex.remove(id)
    for (const k of dropped) assetIndex.remove(k.row.id)
    broadcast('data:changed', { reason: 'dissolve' })
    return { released: items.length }
  })

  /**
   * §B5 同前缀建议合并。**只读扫描**，界面上出个条让用户点头才动库。
   * 和 §B2 的自动归并分开：方括号写着"这里是变体"的自动并，
   * 只是首词撞上的（TwinkleSpica Mint/Plum/Chocolate）必须问一声。
   */
  ipc.handle('assets:merge-suggestions', () => {
    const db = getDb()
    return scanMergeSuggestions(db, mainLexicon()).map((s) => ({
      head: s.head,
      assetIds: s.assetIds,
      names: s.names,
      dirLabel: dirLabel(s.dir)
    }))
  })

  ipc.handle('assets:merge-apply', (input: unknown) => {
    const i = (input ?? {}) as { assetIds?: unknown; name?: unknown; category?: unknown; subcategory?: unknown }
    if (!Array.isArray(i.assetIds) || i.assetIds.length < 2) throw new Error('参数无效')
    const name = String(i.name ?? '').trim()
    if (!name) throw new Error('参数无效')
    const db = getDb()
    const r = applyMergeSuggestion(db, {
      assetIds: i.assetIds.filter((x): x is string => typeof x === 'string'),
      name,
      category: typeof i.category === 'string' ? i.category : null,
      subcategory: typeof i.subcategory === 'string' ? i.subcategory : null
    })
    for (const id of [r.containerId, ...i.assetIds]) if (typeof id === 'string') void reindexAsset(db, id)
    broadcast('data:changed', { reason: 'merge', id: r.containerId })
    return r
  })

  ipc.handle('assets:merge-dismiss', (head: unknown) => {
    if (typeof head !== 'string' || !head.trim()) throw new Error('参数无效')
    dismissMergeSuggestion(getDb(), head.trim())
    return { dismissed: 1 }
  })

  /** §B4 从库中学习模型名：扫候选（只读） */
  ipc.handle('assets:learn-scan', () => scanLearnCandidates(getDb(), mainLexicon()))

  /** §B4：把选中的候选名写进用户词典，然后让主进程那份词典缓存失效 */
  ipc.handle('assets:learn-add', (tokens: unknown) => {
    if (!Array.isArray(tokens)) throw new Error('参数无效')
    const list = tokens.filter((x): x is string => typeof x === 'string')
    const r = addUserAvatarTerms(list)
    if (r.added) {
      invalidateLexicon()
      broadcast('data:changed', { reason: 'lexicon' })
    }
    return r
  })

  ipc.handle('assets:set-review', (ids: unknown, needReview: unknown) => {
    if (!Array.isArray(ids)) throw new Error('参数无效')
    const db = getDb()
    const flag = needReview === true ? 1 : 0
    let updated = 0
    db.transaction(() => {
      for (const id of ids) {
        if (typeof id !== 'string') continue
        const r = db.prepare(`UPDATE asset SET needs_review = ?, updated_at = ? WHERE id = ?`).run(flag, Date.now(), id)
        updated += Number(r.changes ?? 0)
      }
    })()
    if (updated) broadcast('data:changed', { reason: 'review' })
    return { updated }
  })

  ipc.handle('collections:list', () => listCollections(getDb()))
  ipc.handle('collections:create', (input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('参数无效')
    const i = input as { name: string; icon?: string; rule?: never; isAuto?: boolean }
    if (!i.name?.trim()) throw new Error('集合名不能为空')
    const row = createCollection(getDb(), { name: i.name.trim(), icon: i.icon ?? null, rule: i.rule ?? null, isAuto: i.isAuto })
    broadcast('data:changed', { reason: 'collection' })
    return row
  })
  ipc.handle('collections:update', (id: unknown, patch: unknown) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    const row = updateCollection(getDb(), id, (patch ?? {}) as Partial<ReturnType<typeof listCollections>[number]>)
    broadcast('data:changed', { reason: 'collection' })
    return row
  })
  ipc.handle('collections:remove', (id: unknown) => {
    if (typeof id !== 'string') throw new Error('参数无效')
    removeCollection(getDb(), id)
    broadcast('data:changed', { reason: 'collection' })
  })
  ipc.handle('collections:add-assets', (collectionId: unknown, assetIds: unknown) => {
    if (typeof collectionId !== 'string' || !Array.isArray(assetIds)) throw new Error('参数无效')
    const n = addAssetsToCollection(getDb(), collectionId, assetIds.filter((x): x is string => typeof x === 'string'))
    broadcast('data:changed', { reason: 'collection' })
    return n
  })
  ipc.handle('collections:remove-asset', (collectionId: unknown, assetId: unknown) => {
    if (typeof collectionId !== 'string' || typeof assetId !== 'string') throw new Error('参数无效')
    removeAssetFromCollection(getDb(), collectionId, assetId)
    broadcast('data:changed', { reason: 'collection' })
  })

  /**
   * M6 ④ · 补建集合：先看、再点、可撤。
   *
   * 分成两条通道不是洁癖：`plan` 只读，界面可以随时重算；`apply` 写用户数据，
   * 必须等用户在预览上点了确认才发。合成一条"点一下就建"的通道，
   * 就等于把一次批量写库做成了没有回头路的动作。
   */
  ipc.handle('collections:plan-backfill', () => planModelCollections(getDb()))
  ipc.handle('collections:apply-backfill', (names: unknown) => {
    if (!Array.isArray(names)) throw new Error('参数无效')
    const list = names.filter((n): n is string => typeof n === 'string' && !!n.trim())
    if (!list.length) return { created: [], ignored: [], journalId: -1 }
    const r = applyModelCollections(getDb(), list)
    if (r.created.length) broadcast('data:changed', { reason: 'collection-backfill' })
    return r
  })

  ipc.handle('journal:list', (limit?: unknown) => listJournal(getDb(), typeof limit === 'number' ? limit : 200))
  ipc.handle('journal:undo-last', async () => {
    const r = await undoLast({ db: getDb(), holdDir: P.trashHold() })
    /**
     * 撤销会删掉库记录。索引里留着就是"搜得到但点不开"的幽灵卡片，
     * 而一次撤销涉及的条目不多，直接全量重建最省事也最难漏。
     */
    if (r.ok && r.undone > 0) {
      try {
        rebuildIndex(getDb(), loadCategories(), assetIndex)
      } catch (e) {
        log.warn('撤销后重建检索索引失败：' + (e instanceof Error ? e.message : String(e)))
      }
      try {
        const p = pruneThumbCache(getDb())
        if (p.removed) log.info(`清掉 ${p.removed} 张没人引用的缩略图`)
      } catch (e) {
        log.warn('缩略图缓存清理失败：' + (e instanceof Error ? e.message : String(e)))
      }
      /**
       * 通知摄取层把对应的卡片退回收件箱。不通知的话，"撤销一次全部入库"
       * 只删了库记录、收件箱空空如也 —— 用户手上 228 项就这么"消失"了。
       */
      emit(EV_UNDONE, { batchId: r.batchId, assetIds: r.assetIds })
    }
    return r
  })

  ipc.handle('health:scan', (opts: unknown) => scanHealth(typeof opts === 'object' && opts ? (opts as { under?: string }).under : null))

  /**
   * "索引重建"两件事一起做：
   * 先从 .avca.json 侧车把丢掉的库记录捞回来（磁盘是唯一真相），
   * 再重建内存检索索引。侧车重建只补少的，不覆盖已有的。
   */
  ipc.handle('health:rebuild-index', async () => {
    const db = getDb()
    const root = getSettings().libraryRoot
    if (!root || !fs.existsSync(root)) {
      return { rebuilt: 0, skipped: 0, errors: ['库根目录不可用：' + (root ?? '未设置')] }
    }
    const r = await rebuildFromSidecars(db, root)
    let docs = 0
    try {
      const cfg = loadCategories()
      setCategoryConfig(cfg)
      docs = rebuildIndex(db, cfg, assetIndex).docs
    } catch (e) {
      return {
        rebuilt: r.inserted,
        skipped: r.skipped,
        errors: [...r.errors, '检索索引重建失败：' + (e instanceof Error ? e.message : String(e))]
      }
    }
    return { rebuilt: r.inserted, skipped: r.skipped, docs, errors: r.errors }
  })

  ipc.handle('health:mark-missing', (ids: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
    if (!list.length) throw new Error('没说要标记哪几条')
    return markMissing(getDb(), list)
  })
  ipc.handle('health:unmark-missing', (ids: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
    return unmarkMissing(getDb(), list)
  })
  ipc.handle('health:dissolve-orphans', () => dissolveOrphanGroups(getDb()))
  /**
   * 把勾选的游离项送回收站。
   *
   * 收编之后最常见的残留就是"登记了包、旁边还留着同名解压副本"，
   * 这些既不是素材也不该再被登记一次，删掉能直接腾出空间。
   * 一律走 shell.trashItem（回收站），绝不永久删。
   */
  ipc.handle('health:trash-strays', async (paths: unknown) => {
    const list = Array.isArray(paths) ? paths.filter((x): x is string => typeof x === 'string') : []
    if (!list.length) throw new Error('没说要清理哪几项')
    const root = getSettings().libraryRoot
    const trashed: string[] = []
    const failed: { path: string; error: string }[] = []
    for (const p of list) {
      // 只准删库根下面的东西，别的盘一律不碰
      if (!root || !isInside(root, p)) {
        failed.push({ path: p, error: '不在库根下面，拒绝删除' })
        continue
      }
      try {
        await shell.trashItem(p)
        trashed.push(p)
      } catch (e) {
        failed.push({ path: p, error: e instanceof Error ? e.message : String(e) })
      }
    }
    appendJournal(
      getDb(),
      { op: 'trash', trashed: trashed.map((p) => ({ from: p, to: '' })), label: '清理游离项（回收站）' },
      {}
    )
    broadcast('data:changed', { reason: 'trash-strays' })
    return { trashed, failed }
  })
  /**
   * 「重新整理合集」预览：只读，扫完给用户看"哪几组会被并成合集、各是几变几"。
   * 不点执行什么都不改（改动单 §5 要求先预览再动手）。
   */
  ipc.handle('health:scan-rebundle', () => {
    const s = getSettings()
    if (!s.libraryRoot) return []
    return scanRebundle(getDb(), loadCategories(), mainLexicon(), s.libraryRoot)
  })

  ipc.handle('health:apply-rebundle', (dirs: unknown) => {
    /** 这条会真搬盘（把散着的几份并成一个合集目录），所以闸门走 `libraryRootOrThrow()` 那一处（M7 ②） */
    const libraryRoot = libraryRootOrThrow()
    /** 空数组 = 处理预览里的全部（界面"整理这 N 组"传的就是完整列表） */
    const picked = Array.isArray(dirs) ? dirs.filter((x): x is string => typeof x === 'string') : []
    const want = picked.length ? new Set(picked) : null
    const cfg = loadCategories()
    const groups = scanRebundle(getDb(), cfg, mainLexicon(), libraryRoot).filter(
      (g) => !want || want.has(g.dir)
    )
    if (!groups.length) return { bundles: 0, moved: 0, versions: 0 }
    const r = applyRebundle(getDb(), groups, {
      /** 合集自己那行的分类 = 成员多数派 */
      categoryOf: (rows) => {
        const tally = new Map<string, number>()
        const subs = new Map<string, number>()
        for (const x of rows) {
          tally.set(x.category, (tally.get(x.category) ?? 0) + 1)
          if (x.subcategory) subs.set(x.category + '|' + x.subcategory, (subs.get(x.category + '|' + x.subcategory) ?? 0) + 1)
        }
        const category = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0][0]
        const sub = Array.from(subs.entries())
          .filter(([k]) => k.startsWith(category + '|'))
          .sort((a, b) => b[1] - a[1])[0]
        return { category, subcategory: sub ? sub[0].split('|')[1] : null }
      }
    })
    // 归并动了 parent_asset_id 和 group_id，索引与统计都得跟上
    try {
      rebuildIndex(getDb(), cfg, assetIndex)
    } catch (e) {
      log.warn('重新整理合集后重建索引失败：' + (e instanceof Error ? e.message : String(e)))
    }
    broadcast('data:changed', { reason: 'rebundle' })
    log.info(`重新整理合集：${r.bundles} 个合集 / ${r.moved} 项改挂 / ${r.versions} 条版本行`)
    return { bundles: r.bundles, moved: r.moved, versions: r.versions }
  })

  /**
   * #40 存量清理的只读预览：跨目录误并的归并组，按目录各拆到几个组。
   * 只读 —— 不点"拆开"什么都不改。
   *
   * `kept` 是**故意没动**的那些：同一产品的 zip 与已解压副本被两个目录隔开，
   * 裁定 #16 要求它们保持"一张卡"。界面要把这个也显示出来，
   * 否则用户会以为程序漏看了那几组。
   */
  ipc.handle('health:plan-regroup', () => planRegroup(getDb()))

  ipc.handle('health:apply-regroup', (keys: unknown) => {
    const db = getDb()
    const full = planRegroup(db)
    /** 空数组 / 非数组 = 处理预览里的全部；给了 groupKey 就只处理那几个组 */
    const want =
      Array.isArray(keys) && keys.length
        ? new Set(keys.filter((x): x is string => typeof x === 'string'))
        : null
    const picked = want ? full.groups.filter((g) => want.has(g.groupKey)) : full.groups
    if (!picked.length) return { groups: 0, moved: 0, createdGroups: 0 }

    const r = applyRegroup(db, {
      ...full,
      groups: picked,
      affected: picked.reduce((n, g) => n + g.before.length, 0)
    })
    /**
     * 拆分只改 `group_id`，但卡片是按组聚合显示的，索引里的别名字段没变；
     * 这里仍然广播一次让界面重新拉数据，免得用户看到的还是旧分组。
     */
    broadcast('data:changed', { reason: 'regroup' })
    log.info(`#40 拆开跨目录归并组：${r.groups} 组 / ${r.moved} 行 / 新建 ${r.createdGroups} 个组`)
    return { groups: r.groups, moved: r.moved, createdGroups: r.createdGroups }
  })

  /*
   * 第 9 轮 ② · B4 存量重并（`library/remerge.ts` 的头注讲了为什么需要它）。
   *
   * ⚠ 落地时**重扫一遍再执行**，不信前端传来的那份预览：预览是用户点开那一刻的库，
   * 中间只要有任何一次入库/改分类，那份就过期了 —— 拿过期预览写库等于按旧地图挪新数据。
   * `keys` 给空 = 处理预览里的全部；给了 groupKey 就只处理那几簇（和 regroup 那两条同口径）。
   */
  ipc.handle('health:plan-remerge', () => {
    const plan = planRemerge(getDb(), mainLexicon())
    return {
      scanned: plan.scanned,
      skippedAmbiguous: plan.skippedAmbiguous,
      clusters: plan.clusters.map((c) => ({
        groupKey: c.groupKey,
        name: c.name,
        newGroup: !c.keepGroupId,
        moved: c.moveAssetIds.length,
        droppedGroups: c.dropGroupIds.length,
        rows: c.rows.map((r) => ({ name: r.name, fromKey: r.fromKey, toKey: r.toKey }))
      }))
    }
  })

  ipc.handle('health:apply-remerge', (keys: unknown) => {
    const db = getDb()
    const lex = mainLexicon()
    const full = planRemerge(db, lex)
    const want =
      Array.isArray(keys) && keys.length ? new Set(keys.filter((x): x is string => typeof x === 'string')) : null
    const picked = want ? full.clusters.filter((c) => want.has(c.groupKey)) : full.clusters
    if (!picked.length) return { moved: 0, droppedGroups: 0, keyOnly: 0, clusters: 0 }
    const r = applyRemerge(db, { ...full, clusters: picked }, lex)
    /**
     * 归并关系变了 → 卡片分组、聚合视图的变体数、检索里的组别名全跟着变。
     * 只广播 data:changed 不够：`reclassify` 那次踩过"索引没重建，搜不到刚改过的东西"，
     * 所以这里连检索索引一起刷（reason 让订阅方自己决定刷什么）。
     */
    broadcast('data:changed', { reason: 'remerge' })
    log.info(`B4 存量重并：${picked.length} 簇 / 改挂 ${r.moved} 张卡 / 合并掉 ${r.droppedGroups} 个组`)
    return { moved: r.moved, droppedGroups: r.droppedGroups, keyOnly: r.keyOnly, clusters: picked.length }
  })

  /**
   * 「重新分析」的只读扫描（改动单 2 §交付 4）。
   * 界面必须在用户按下之前就把 affected / renamed / junk 三个数摆出来 ——
   * 这是那条要求点名的"在我按下之前先告诉我会影响多少条记录"。
   */
  ipc.handle('health:plan-reanalyze', () => {
    const db = getDb()
    const plan = planReanalyze(db, mainLexicon())
    return {
      scanned: plan.scanned,
      affected: plan.changes.length + plan.demote.length,
      renamed: plan.renamed,
      uuidNamed: plan.uuidNamed,
      demoted: plan.demote.length,
      demotePreview: plan.demote.slice(0, 40).map((d) => {
        const host = db.prepare(`SELECT name FROM asset WHERE id = ?`).get(d.hostId) as { name: string } | undefined
        return { id: d.id, name: d.name, kind: d.kind, host: host?.name ?? d.hostId }
      }),
      junk: plan.junk,
      preview: plan.changes.slice(0, 50).map((c) => ({
        id: c.id,
        name: c.name,
        fields: c.fields,
        fromName: c.name,
        toName: String(c.to.name ?? c.name),
        fromVersion: (c.from.version as string | null) ?? null,
        toVersion: (c.to.version as string | null) ?? null
      }))
    }
  })

  ipc.handle('health:apply-reanalyze', (ids: unknown) => {
    const db = getDb()
    const plan = planReanalyze(db, mainLexicon())
    const picked = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : undefined
    const r = applyReanalyze(db, plan, picked && picked.length ? { ids: picked } : undefined)
    if (r.updated) {
      const cfg = loadCategories()
      try {
        rebuildIndex(db, cfg, assetIndex)
      } catch (e) {
        log.warn('重新分析后重建索引失败：' + (e instanceof Error ? e.message : String(e)))
      }
      broadcast('data:changed', { reason: 'reanalyze' })
      log.info(`重新分析：重算 ${r.updated} 条（只改库列，未动磁盘）`)
    }
    return { updated: r.updated, batchId: r.batchId }
  })

  /**
   * 把"新规则认定本不该存在"的记录请出库。
   * **磁盘文件一个都不动** —— 删的是库里的行，而且整行存进 journal，撤销能塞回来。
   */
  ipc.handle('health:drop-junk-rows', (ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error('参数无效')
    const list = ids.filter((x): x is string => typeof x === 'string')
    const r = dropJunkRows(getDb(), list)
    if (r.deleted) {
      for (const id of list) assetIndex.remove(id)
      broadcast('data:changed', { reason: 'drop-junk' })
      log.info(`移除 ${r.deleted} 条垃圾素材记录（磁盘文件未动）`)
    }
    return { deleted: r.deleted, batchId: r.batchId }
  })

  ipc.handle('health:prune-thumbs', () => pruneThumbCache(getDb()))
  ipc.handle('health:duplicates', () => {
    const r = scanHealth()
    return { implemented: true, duplicates: r.duplicates, similar: r.similar }
  })
}

/** 扫描时给 dHash 用的"把缓存图缩到 9x8 取像素" */
function thumbDigest(key: string): { bitmap: Buffer; width: number; height: number } | null {
  try {
    const file = thumbPathFor(key)
    if (!fs.existsSync(file)) return null
    const img = nativeImage.createFromPath(file)
    if (img.isEmpty()) return null
    const small = img.resize({ width: 9, height: 8, quality: 'good' })
    const { width, height } = small.getSize()
    return { bitmap: small.toBitmap(), width, height }
  } catch {
    return null
  }
}

function scanHealth(under?: string | null): HealthReport {
  /** 词典带上：结构层的两条收口（同 groupKey 的散包 / 主体在子目录）要靠它才判得出 */
  return scanLibrary(getDb(), getSettings().libraryRoot ?? null, thumbDigest, under ?? null, mainLexicon())
}

function sizeOfDb(): number {
  try {
    return fs.statSync(P.db()).size
  } catch {
    return 0
  }
}
